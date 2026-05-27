<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { appRoutes } from "../utils/routes";

type CampaignGoal = "bookings" | "awareness" | "leads" | "event" | "services" | "education";
type CampaignDuration = "7_days" | "14_days" | "30_days" | "autopilot";
type CampaignPlatform = "linkedin" | "instagram" | "facebook" | "x" | "google_business";
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
  strategy: string;
  hook: string;
  cta: string;
  platform: CampaignPlatform;
  status: "ready" | "running" | "pending";
}

const isRunning = ref(false);
const progressDone = ref(0);
const progressTotal = ref(0);

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
  { value: "autopilot", label: "Ongoing autopilot" },
];

const PLATFORM_OPTIONS: Array<{ value: CampaignPlatform; label: string }> = [
  { value: "linkedin", label: "LinkedIn" },
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
  { value: "x", label: "X" },
  { value: "google_business", label: "Google Business" },
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
  "Waiting for campaign mission start.",
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

function buildDayCards(): CampaignDayPreview[] {
  const durationCount = automationForm.duration === "7_days"
    ? 7
    : automationForm.duration === "14_days"
      ? 14
      : automationForm.duration === "30_days"
        ? 30
        : 10;

  return Array.from({ length: Math.min(durationCount, 10) }, (_value, index) => {
    const day = index + 1;
    const platform = automationForm.platforms[index % automationForm.platforms.length] ?? "linkedin";

    return {
      day,
      strategy: `Day ${day}: ${selectedGoalMeta.value.label} content focused on proof + trust.`,
      hook: `Hook ${day}: The simplest shift that improves ${selectedGoalMeta.value.label.toLowerCase()}.`,
      cta: "Reply 'PLAN' and we’ll send the execution playbook.",
      platform,
      status: day <= 2 ? "ready" : day === 3 ? "running" : "pending",
    };
  });
}

function startCampaignRun(): void {
  isRunning.value = true;
  progressDone.value = 3;
  progressTotal.value = 8;

  pipelineSteps.value = pipelineSteps.value.map((step, index) => ({
    ...step,
    state: index < 3 ? "completed" : index === 3 ? "running" : "pending",
  }));

  agentFeed.value = [
    "Brand analysis complete.",
    `Goal locked: ${selectedGoalMeta.value.label}.`,
    `Platform plan ready: ${selectedPlatformsLabel.value}.`,
    "Generating Day 1 strategy and hooks...",
  ];

  dayCards.value = buildDayCards();
}
</script>

<template>
  <main class="automation-shell">
    <section class="automation-hero">
      <p class="automation-eyebrow">Automation Studio</p>
      <h1>Campaign Automation Engine</h1>
      <p class="automation-copy">
        Run goal-driven orchestration separately from planner editing. Generate a complete campaign pack, review by day,
        then send approved output into Planner.
      </p>
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
          <button type="button" class="primary-button" @click="startCampaignRun">
            {{ isRunning ? "Re-run campaign mission" : "Start campaign mission" }}
          </button>
          <router-link class="secondary-button" :to="appRoutes.appPlanner">Back to planner</router-link>
        </div>
      </article>

      <article class="automation-card">
        <div class="mission-status">
          <div>
            <p class="automation-eyebrow">Mission control</p>
            <h2>{{ isRunning ? "Execution in progress" : "Awaiting mission start" }}</h2>
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
        Start a campaign mission to generate day-by-day strategy, hooks, CTAs, and creative direction.
      </div>

      <div v-else class="day-grid">
        <article v-for="card in dayCards" :key="card.day" class="day-card" :data-state="card.status">
          <div class="day-top">
            <strong>Day {{ card.day }}</strong>
            <span>{{ card.status }}</span>
          </div>
          <p>{{ card.strategy }}</p>
          <p><strong>Hook:</strong> {{ card.hook }}</p>
          <p><strong>CTA:</strong> {{ card.cta }}</p>
          <p><strong>Platform:</strong> {{ card.platform.replace("_", " ") }}</p>
          <div class="day-actions">
            <button type="button" class="secondary-button">Regenerate day</button>
            <button type="button" class="secondary-button">Open editor</button>
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

.day-top {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
}

.day-card[data-state="ready"] {
  background: #ecfdf5;
}

.day-card[data-state="running"] {
  background: #fff7ed;
}

.day-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
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
