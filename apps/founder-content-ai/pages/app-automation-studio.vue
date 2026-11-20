<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import type {
  BusinessMembership,
  GenerateContentPlanResponse,
  SocialContentPlanEntry,
  SocialContentPlanDuration,
  SocialContentPlanPlatform,
} from "../../../packages/shared-types";
import { useProductAccessContext } from "../access/product-access-context";
import { requestMyBusinesses } from "../services/admin-analytics-service";
import {
  requestApproveContentPlan,
  requestGenerateContentPlan,
  requestUpdateContentVariant,
} from "../services/content-plan-service";
import { appRoutes } from "../utils/routes";

type CampaignGoal = "bookings" | "awareness" | "leads" | "event" | "services" | "education";
type CampaignDuration = SocialContentPlanDuration;
type CampaignPlatform = SocialContentPlanPlatform;
type CreativeDirection =
  | "luxury"
  | "modern"
  | "cinematic"
  | "playful"
  | "minimal"
  | "high_energy";

interface PipelineStep {
  id: string;
  label: string;
  state: "completed" | "running" | "pending";
}

interface CampaignDayPreview {
  day: number;
  dateKey: string;
  entries: SocialContentPlanEntry[];
}

const isRunning = ref(false);
const progressDone = ref(0);
const progressTotal = ref(0);
const isApproving = ref(false);
const businesses = ref<BusinessMembership[]>([]);
const activeBusinessId = ref("");
const generatedPlan = ref<GenerateContentPlanResponse | null>(null);
const errorMessage = ref("");
const feedbackMessage = ref("");
const isLoadingWorkspace = ref(true);
const editingVariantId = ref("");
const variantDraftText = ref("");
const isSavingVariant = ref(false);
const { bootstrap, setActiveBusinessId } = useProductAccessContext();

const automationForm = reactive<{
  goal: CampaignGoal;
  duration: CampaignDuration;
  platforms: CampaignPlatform[];
  creativeDirection: CreativeDirection | "";
  referenceInput: string;
}>({
  goal: "leads",
  duration: "14_days",
  platforms: ["linkedin", "instagram"],
  creativeDirection: "",
  referenceInput: "",
});

const GOAL_OPTIONS: Array<{ value: CampaignGoal; label: string; description: string }> = [
  { value: "bookings", label: "Get bookings", description: "Prioritize appointment and demo conversion." },
  { value: "awareness", label: "Build awareness", description: "Increase reach and top-of-funnel attention." },
  { value: "leads", label: "Drive leads", description: "Maximize inbound intent and contact actions." },
  { value: "event", label: "Promote event", description: "Push registrations and event reminder cadence." },
  { value: "services", label: "Sell service", description: "Move audience toward service purchase decisions." },
  { value: "education", label: "Educate audience", description: "Teach, build trust, and nurture authority." },
];

const DURATION_OPTIONS: Array<{ value: CampaignDuration; label: string }> = [
  { value: "7_days", label: "7 days" },
  { value: "14_days", label: "14 days" },
  { value: "30_days", label: "30 days" },
];

const PLATFORM_OPTIONS: Array<{ value: CampaignPlatform; label: string }> = [
  { value: "linkedin", label: "LinkedIn" },
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
];

const CREATIVE_OPTIONS: Array<{ value: CreativeDirection; label: string }> = [
  { value: "luxury", label: "Luxury" },
  { value: "modern", label: "Modern" },
  { value: "cinematic", label: "Cinematic" },
  { value: "playful", label: "Playful" },
  { value: "minimal", label: "Minimal" },
  { value: "high_energy", label: "High-energy" },
];

const pipelineSteps = ref<PipelineStep[]>([
  { id: "strategy", label: "Generate daily strategy", state: "pending" },
  { id: "hook", label: "Generate hook", state: "pending" },
  { id: "caption", label: "Generate caption", state: "pending" },
  { id: "cta", label: "Generate CTA", state: "pending" },
  { id: "image_prompt", label: "Generate image prompt", state: "pending" },
  { id: "creative", label: "Generate creative asset", state: "pending" },
  { id: "quality", label: "Run quality validation", state: "pending" },
  { id: "save", label: "Save campaign batch", state: "pending" },
]);

const agentFeed = ref<string[]>([
  "Ready to turn one idea into a reviewable campaign.",
]);

const dayCards = ref<CampaignDayPreview[]>([]);

const selectedGoalMeta = computed(
  () => GOAL_OPTIONS.find((option) => option.value === automationForm.goal) ?? GOAL_OPTIONS[0],
);
const progressLabel = computed(() => `${progressDone.value}/${progressTotal.value}`);
const selectedPlatformsLabel = computed(() =>
  automationForm.platforms
    .map((platform) => PLATFORM_OPTIONS.find((option) => option.value === platform)?.label ?? platform)
    .join(" · "),
);
const campaignStartDate = computed(() => {
  const today = new Date();
  today.setDate(today.getDate() + 1);
  return today.toISOString().slice(0, 10);
});
const canRunCampaign = computed(
  () => Boolean(activeBusinessId.value) && automationForm.platforms.length > 0 && !isRunning.value,
);
const approvalStartDate = computed(
  () => generatedPlan.value?.plan[0]?.dateKey ?? campaignStartDate.value,
);

function startVariantEdit(entry: SocialContentPlanEntry): void {
  editingVariantId.value = entry.variantId;
  variantDraftText.value = entry.content;
}

function cancelVariantEdit(): void {
  editingVariantId.value = "";
  variantDraftText.value = "";
}

async function saveVariantEdit(entry: SocialContentPlanEntry): Promise<void> {
  if (!activeBusinessId.value || !variantDraftText.value.trim()) {
    errorMessage.value = "Add some content before saving the edit.";
    return;
  }

  isSavingVariant.value = true;
  errorMessage.value = "";

  try {
    const response = await requestUpdateContentVariant({
      businessId: activeBusinessId.value,
      variantId: entry.variantId,
      text: variantDraftText.value,
    });
    entry.content = response.variant.text;
    const persistedVariant = generatedPlan.value?.variants.find((variant) => variant.id === entry.variantId);
    if (persistedVariant) {
      persistedVariant.text = response.variant.text;
      persistedVariant.isCustomized = true;
      persistedVariant.source = "manual";
    }
    feedbackMessage.value = `${entry.platform} draft updated. The campaign remains unapproved.`;
    cancelVariantEdit();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Unable to save this draft edit.";
  } finally {
    isSavingVariant.value = false;
  }
}

function togglePlatform(value: CampaignPlatform): void {
  if (automationForm.platforms.includes(value)) {
    if (automationForm.platforms.length === 1) {
      return;
    }
    automationForm.platforms = automationForm.platforms.filter((platform) => platform !== value);
    return;
  }

  automationForm.platforms = [...automationForm.platforms, value];
}

function groupPlanByDay(plan: SocialContentPlanEntry[]): CampaignDayPreview[] {
  const grouped = new Map<number, CampaignDayPreview>();

  for (const entry of plan) {
    const existing = grouped.get(entry.day);

    if (existing) {
      existing.entries.push(entry);
      continue;
    }

    grouped.set(entry.day, {
      day: entry.day,
      dateKey: entry.dateKey,
      entries: [entry],
    });
  }

  return [...grouped.values()].sort((left, right) => left.day - right.day);
}

async function startCampaignRun(): Promise<void> {
  if (!activeBusinessId.value) {
    errorMessage.value = "Choose a workspace before starting a campaign.";
    return;
  }

  if (automationForm.platforms.length === 0) {
    errorMessage.value = "Select at least one publishing channel.";
    return;
  }

  isRunning.value = true;
  errorMessage.value = "";
  feedbackMessage.value = "";
  generatedPlan.value = null;
  dayCards.value = [];
  progressDone.value = 0;
  progressTotal.value = pipelineSteps.value.length;

  pipelineSteps.value = pipelineSteps.value.map((step, index) => ({
    ...step,
    state: index === 0 ? "running" : "pending",
  }));

  agentFeed.value = [
    "Reading the workspace brand profile.",
    `Goal locked: ${selectedGoalMeta.value.label}.`,
    `Platform plan ready: ${selectedPlatformsLabel.value}.`,
    "Generating a reviewable campaign batch...",
  ];

  pipelineSteps.value = pipelineSteps.value.map((step, index) => ({
    ...step,
    state: index === 0 ? "running" : "pending",
  }));

  try {
    const reference = automationForm.referenceInput.trim();
    const response = await requestGenerateContentPlan({
      businessId: activeBusinessId.value,
      duration: automationForm.duration,
      goal: [selectedGoalMeta.value.label, reference].filter(Boolean).join(". "),
      platforms: automationForm.platforms,
      tone: automationForm.creativeDirection || undefined,
      startDate: campaignStartDate.value,
      defaultScheduledTime: "09:00",
    });

    generatedPlan.value = response;
    dayCards.value = groupPlanByDay(response.plan);
    progressDone.value = pipelineSteps.value.length;
    pipelineSteps.value = pipelineSteps.value.map((step) => ({ ...step, state: "completed" }));
    agentFeed.value = [
      ...agentFeed.value,
      `Generated ${response.plan.length} channel-ready entries across ${dayCards.value.length} days.`,
      "Campaign pack ready. Review it before approving into the planner.",
    ].slice(-8);
    feedbackMessage.value = "Campaign generated. Review the entries below before they enter your publishing queue.";
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Unable to generate the campaign.";
    agentFeed.value = [...agentFeed.value, "Campaign generation stopped. Nothing was scheduled."];
    pipelineSteps.value = pipelineSteps.value.map((step) => ({ ...step, state: "pending" }));
  } finally {
    isRunning.value = false;
  }
}

async function approveCampaign(): Promise<void> {
  if (!activeBusinessId.value || !generatedPlan.value) {
    errorMessage.value = "Generate a campaign before approving it.";
    return;
  }

  isApproving.value = true;
  errorMessage.value = "";

  try {
    const response = await requestApproveContentPlan(generatedPlan.value.batch.id, {
      businessId: activeBusinessId.value,
      batchId: generatedPlan.value.batch.id,
      startDate: approvalStartDate.value,
      defaultScheduledTime: "09:00",
      platforms: automationForm.platforms,
    });
    feedbackMessage.value = `Approved ${response.scheduleItems.length} items into the planner.`;
    agentFeed.value = [...agentFeed.value, "Approval complete. The planner now owns the publishing queue."];
    generatedPlan.value = null;
    dayCards.value = [];
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Unable to approve the campaign.";
  } finally {
    isApproving.value = false;
  }
}

async function loadWorkspace(): Promise<void> {
  try {
    const response = await requestMyBusinesses();
    businesses.value = response.businesses;
    const preferredBusinessId = bootstrap.value?.activeBusinessId?.trim() || response.businesses[0]?.businessId || "";
    activeBusinessId.value = preferredBusinessId;

    if (preferredBusinessId && bootstrap.value?.activeBusinessId !== preferredBusinessId) {
      await setActiveBusinessId(preferredBusinessId);
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Unable to load your workspace.";
  } finally {
    isLoadingWorkspace.value = false;
  }
}

onMounted(() => {
  void loadWorkspace();
});
</script>

<template>
  <main class="automation-shell">
    <section class="automation-hero">
      <p class="automation-eyebrow">Automation Studio</p>
      <h1>Turn one idea into a campaign.</h1>
      <p class="automation-copy">
        Give the system a goal, a few channels, and optional context. It will generate a reviewable campaign batch;
        nothing enters your publishing queue until you approve it.
      </p>
      <p v-if="isLoadingWorkspace" class="automation-status">Loading your workspace…</p>
      <p v-else-if="activeBusinessId" class="automation-status">
        Workspace ready · {{ businesses.find((business) => business.businessId === activeBusinessId)?.business.name }}
      </p>
      <p v-else class="automation-status error">Create or select a workspace before generating a campaign.</p>
    </section>

    <section class="automation-layout">
      <article class="automation-card">
        <p class="automation-eyebrow">Mission setup</p>
        <h2>Define campaign intent before orchestration</h2>

        <div class="automation-grid">
          <label>
            <span>Campaign goal</span>
            <select v-model="automationForm.goal">
              <option v-for="option in GOAL_OPTIONS" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </select>
            <small>{{ selectedGoalMeta.description }}</small>
          </label>

          <label>
            <span>Duration</span>
            <select v-model="automationForm.duration">
              <option v-for="option in DURATION_OPTIONS" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </select>
          </label>

          <label>
            <span>Creative direction</span>
            <select v-model="automationForm.creativeDirection">
              <option value="">Use workspace defaults</option>
              <option v-for="option in CREATIVE_OPTIONS" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </select>
          </label>

          <label class="wide">
            <span>References (optional)</span>
            <textarea
              v-model="automationForm.referenceInput"
              rows="3"
              placeholder="Campaign context, top offers, competitor hooks, or previous winners."
            />
          </label>
        </div>

        <div class="platform-row">
          <span>Platforms</span>
          <div class="platform-chips">
            <button
              v-for="option in PLATFORM_OPTIONS"
              :key="option.value"
              type="button"
              class="platform-chip"
              :data-active="automationForm.platforms.includes(option.value)"
              @click="togglePlatform(option.value)"
            >
              {{ option.label }}
            </button>
          </div>
        </div>

        <div class="action-row">
          <button type="button" class="primary-button" :disabled="!canRunCampaign" @click="void startCampaignRun()">
            {{ isRunning ? "Generating campaign…" : generatedPlan ? "Generate a new version" : "Generate campaign" }}
          </button>
          <button
            v-if="generatedPlan"
            type="button"
            class="secondary-button approval-button"
            :disabled="isApproving"
            @click="void approveCampaign()"
          >
            {{ isApproving ? "Approving…" : "Approve into planner" }}
          </button>
          <router-link class="secondary-button" :to="appRoutes.appPlanner">Back to planner</router-link>
        </div>
        <p v-if="errorMessage" class="automation-feedback error">{{ errorMessage }}</p>
        <p v-else-if="feedbackMessage" class="automation-feedback">{{ feedbackMessage }}</p>
      </article>

      <article class="automation-card">
        <div class="mission-status">
          <div>
            <p class="automation-eyebrow">Mission control</p>
            <h2>{{ isRunning ? "Generation in progress" : generatedPlan ? "Review before approval" : "Ready for a campaign brief" }}</h2>
          </div>
          <span class="status-pill">{{ progressLabel }}</span>
        </div>

        <div class="pipeline-list">
          <article
            v-for="step in pipelineSteps"
            :key="step.id"
            class="pipeline-step"
            :data-state="step.state"
          >
            <strong>{{ step.label }}</strong>
            <span>{{ step.state }}</span>
          </article>
        </div>

        <div class="feed-card">
          <p class="automation-eyebrow">Live agent feed</p>
          <ul>
            <li v-for="entry in agentFeed" :key="entry">{{ entry }}</li>
          </ul>
        </div>
      </article>
    </section>

    <section class="automation-card">
      <div class="pack-header">
        <div>
          <p class="automation-eyebrow">Campaign pack</p>
          <h2>Review by day, then approve into planner</h2>
        </div>
        <router-link class="secondary-button" :to="appRoutes.appPlanner">Open planner queue</router-link>
      </div>

      <div v-if="dayCards.length === 0" class="empty-pack">
        Generate a campaign to preview channel-specific content by day. The planner stays untouched until you approve it.
      </div>

      <div v-else class="day-grid">
        <article v-for="card in dayCards" :key="card.day" class="day-card">
          <div class="day-top">
            <strong>Day {{ card.day }}</strong>
            <span>{{ card.dateKey }}</span>
          </div>
          <div v-for="entry in card.entries" :key="entry.variantId" class="campaign-entry">
            <div class="campaign-entry-topline">
              <strong>{{ entry.platform }}</strong>
              <span>
                {{ entry.type.replace("_", " ") }}
                <span v-if="generatedPlan?.variants.find((variant) => variant.id === entry.variantId)?.isCustomized" class="customized-label">Edited</span>
              </span>
            </div>
            <textarea
              v-if="editingVariantId === entry.variantId"
              v-model="variantDraftText"
              class="campaign-entry-editor"
              rows="7"
            />
            <p v-else>{{ entry.content }}</p>
            <p><strong>CTA:</strong> {{ entry.cta }}</p>
            <p v-if="entry.angle"><strong>Angle:</strong> {{ entry.angle }}</p>
            <div class="campaign-entry-actions">
              <template v-if="editingVariantId === entry.variantId">
                <button type="button" class="secondary-button" :disabled="isSavingVariant" @click="void saveVariantEdit(entry)">
                  {{ isSavingVariant ? "Saving…" : "Save edit" }}
                </button>
                <button type="button" class="secondary-button" :disabled="isSavingVariant" @click="cancelVariantEdit">
                  Cancel
                </button>
              </template>
              <button v-else type="button" class="secondary-button" @click="startVariantEdit(entry)">
                Edit draft
              </button>
            </div>
          </div>
        </article>
      </div>
    </section>
  </main>
</template>

<style scoped>
.automation-shell {
  display: grid;
  gap: 1.25rem;
  max-width: 1160px;
  margin: 0 auto;
  padding: 1.25rem;
}

.automation-hero h1,
.automation-card h2 {
  margin: 0.25rem 0 0;
  color: #1f2937;
}

.automation-copy {
  margin: 0.65rem 0 0;
  color: #4b5563;
  max-width: 76ch;
}

.automation-status,
.automation-feedback {
  margin: 0.65rem 0 0;
  color: #4b5563;
  font-size: 0.9rem;
}

.automation-status.error,
.automation-feedback.error {
  color: #b42318;
}

.automation-feedback {
  padding: 0.7rem 0.8rem;
  border: 1px solid #d8e8df;
  border-radius: 0.7rem;
  background: #f0fdf4;
}

.automation-feedback.error {
  border-color: #f4c7c3;
  background: #fff5f5;
}

.automation-eyebrow {
  margin: 0;
  font-size: 0.78rem;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  font-weight: 700;
  color: #8b5e34;
}

.automation-layout {
  display: grid;
  grid-template-columns: 1.1fr 0.9fr;
  gap: 1rem;
}

.automation-card {
  border: 1px solid #e5d6c9;
  border-radius: 1rem;
  background: #fff;
  padding: 1rem;
  display: grid;
  gap: 0.9rem;
}

.automation-grid {
  display: grid;
  gap: 0.8rem;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.automation-grid .wide {
  grid-column: 1 / -1;
}

.automation-grid label {
  display: grid;
  gap: 0.35rem;
}

.automation-grid span {
  font-size: 0.85rem;
  font-weight: 600;
  color: #374151;
}

.automation-grid small {
  color: #6b7280;
}

.automation-grid select,
.automation-grid textarea {
  border: 1px solid #d9cfc5;
  border-radius: 0.7rem;
  padding: 0.6rem 0.7rem;
  font: inherit;
}

.platform-row {
  display: grid;
  gap: 0.45rem;
}

.platform-row > span {
  font-size: 0.85rem;
  font-weight: 600;
  color: #374151;
}

.platform-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}

.platform-chip {
  border: 1px solid #d9cfc5;
  border-radius: 999px;
  background: #fff;
  padding: 0.4rem 0.7rem;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
}

.platform-chip[data-active="true"] {
  background: #1f2937;
  color: #fff;
  border-color: #1f2937;
}

.action-row {
  display: flex;
  gap: 0.6rem;
  flex-wrap: wrap;
}

.primary-button,
.secondary-button {
  min-height: 40px;
  border-radius: 0.7rem;
  padding: 0 0.9rem;
  font: inherit;
  font-weight: 700;
  border: 1px solid transparent;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  text-decoration: none;
}

.primary-button {
  background: #f97316;
  color: #fff;
}

.primary-button:disabled,
.secondary-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.approval-button {
  border-color: #15803d;
  color: #166534;
}

.secondary-button {
  background: #fff;
  color: #1f2937;
  border-color: #d9cfc5;
}

.mission-status {
  display: flex;
  justify-content: space-between;
  gap: 0.7rem;
  align-items: start;
}

.status-pill {
  border: 1px solid #d9cfc5;
  border-radius: 999px;
  padding: 0.3rem 0.65rem;
  font-size: 0.8rem;
  color: #4b5563;
}

.pipeline-list {
  display: grid;
  gap: 0.45rem;
}

.pipeline-step {
  display: flex;
  justify-content: space-between;
  gap: 0.6rem;
  border: 1px solid #efe4da;
  border-radius: 0.75rem;
  padding: 0.55rem 0.65rem;
  font-size: 0.88rem;
}

.pipeline-step[data-state="completed"] {
  background: #ecfdf5;
}

.pipeline-step[data-state="running"] {
  background: #fff7ed;
}

.feed-card {
  border: 1px solid #efe4da;
  border-radius: 0.75rem;
  padding: 0.7rem;
}

.feed-card ul {
  margin: 0.45rem 0 0;
  padding-left: 1rem;
  color: #4b5563;
}

.pack-header {
  display: flex;
  justify-content: space-between;
  gap: 0.8rem;
  align-items: start;
}

.empty-pack {
  border: 1px dashed #d9cfc5;
  border-radius: 0.8rem;
  padding: 0.9rem;
  color: #6b7280;
}

.day-grid {
  display: grid;
  gap: 0.7rem;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
}

.day-card {
  border: 1px solid #efe4da;
  border-radius: 0.8rem;
  padding: 0.75rem;
  display: grid;
  gap: 0.45rem;
}

.day-card p {
  margin: 0;
  color: #374151;
}

.campaign-entry {
  display: grid;
  gap: 0.4rem;
  padding-top: 0.65rem;
  border-top: 1px solid #efe4da;
}

.campaign-entry-topline {
  display: flex;
  justify-content: space-between;
  gap: 0.6rem;
  color: #6b7280;
  font-size: 0.78rem;
  text-transform: capitalize;
}

.customized-label {
  margin-left: 0.35rem;
  color: #166534;
  font-weight: 700;
  text-transform: none;
}

.campaign-entry-editor {
  width: 100%;
  resize: vertical;
  border: 1px solid #cbd5e1;
  border-radius: 0.6rem;
  padding: 0.65rem;
  color: #1f2937;
  font: inherit;
  line-height: 1.55;
  box-sizing: border-box;
}

.campaign-entry-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}

.day-top {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
}


@media (max-width: 980px) {
  .automation-layout {
    grid-template-columns: 1fr;
  }

  .automation-grid {
    grid-template-columns: 1fr;
  }
}
</style>
