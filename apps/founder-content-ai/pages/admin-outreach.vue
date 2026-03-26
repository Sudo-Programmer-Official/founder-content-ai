<script setup lang="ts">
import type {
  OutreachLead,
  OutreachLeadFilters,
  OutreachLeadStatus,
  OutreachMessageTone,
  OutreachQueue,
} from "../../../packages/shared-types";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import LeadCard from "../components/outreach/LeadCard.vue";
import MessagePanel from "../components/outreach/MessagePanel.vue";
import OutreachTopBar from "../components/outreach/OutreachTopBar.vue";
import PipelineStrip from "../components/outreach/PipelineStrip.vue";
import {
  requestOutreachFollowupDraft,
  requestOutreachLeadStatusUpdate,
  requestOutreachLeads,
  requestOutreachMessageDraft,
  requestOutreachOverview,
  requestOutreachReplyDraft,
} from "../services/outreach-service";
import { appRoutes } from "../utils/routes";

const overview = ref<Awaited<ReturnType<typeof requestOutreachOverview>>["overview"] | null>(null);
const leads = ref<OutreachLead[]>([]);
const selectedLeadId = ref<string | null>(null);
const filters = ref<OutreachLeadFilters>({
  platform: "all",
  status: "all",
  priority: "all",
  queue: "new",
});
const draftTone = ref<OutreachMessageTone>("casual");
const messageDraft = ref("");
const savedDrafts = ref<Record<string, string>>({});
const isLoading = ref(true);
const isGenerating = ref(false);
const isSaving = ref(false);
const errorMessage = ref("");
const feedbackMessage = ref("");

const selectedLead = computed<OutreachLead | null>(
  () => leads.value.find((lead) => lead.id === selectedLeadId.value) ?? null,
);
const activePipelineStatus = computed<OutreachLeadStatus | null>(
  () => (filters.value.status && filters.value.status !== "all" ? filters.value.status : null),
);

async function copyToClipboard(content: string): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.clipboard || !content.trim()) {
    return;
  }

  try {
    await navigator.clipboard.writeText(content);
  } catch {
    // Ignore clipboard failures; the draft still updates in-app.
  }
}

function getLeadNextStatus(lead: OutreachLead): OutreachLeadStatus {
  if (lead.replyContent || lead.status === "replied") {
    return "activated";
  }

  return "contacted";
}

function setFeedback(message: string): void {
  feedbackMessage.value = message;
}

async function loadOverview(): Promise<void> {
  const response = await requestOutreachOverview();
  overview.value = response.overview;
}

async function generateDraftForLead(lead: OutreachLead): Promise<void> {
  isGenerating.value = true;
  errorMessage.value = "";

  try {
    const response =
      lead.replyContent && lead.status === "replied"
        ? await requestOutreachReplyDraft({
            leadId: lead.id,
            tone: draftTone.value,
          })
        : filters.value.queue === "followups"
          ? await requestOutreachFollowupDraft({
              leadId: lead.id,
              tone: draftTone.value,
            })
          : await requestOutreachMessageDraft({
              leadId: lead.id,
              tone: draftTone.value,
            });

    messageDraft.value = response.message.content;
    savedDrafts.value = {
      ...savedDrafts.value,
      [lead.id]: response.message.content,
    };
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "Unable to generate outreach message.";
  } finally {
    isGenerating.value = false;
  }
}

async function applySelectedLead(lead: OutreachLead | null): Promise<void> {
  selectedLeadId.value = lead?.id ?? null;

  if (!lead) {
    messageDraft.value = "";
    return;
  }

  const existingDraft = savedDrafts.value[lead.id];

  if (existingDraft) {
    messageDraft.value = existingDraft;
    return;
  }

  await generateDraftForLead(lead);
}

async function loadLeads(preferredLeadId?: string | null): Promise<void> {
  errorMessage.value = "";

  const response = await requestOutreachLeads(filters.value);
  leads.value = response.leads;

  const nextSelectedLead =
    (preferredLeadId
      ? response.leads.find((lead) => lead.id === preferredLeadId)
      : null) ??
    (selectedLeadId.value
      ? response.leads.find((lead) => lead.id === selectedLeadId.value)
      : null) ??
    response.leads[0] ??
    null;

  await applySelectedLead(nextSelectedLead);
}

async function loadOutreachState(): Promise<void> {
  isLoading.value = true;
  errorMessage.value = "";

  try {
    await Promise.all([loadOverview(), loadLeads()]);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Unable to load outreach dashboard.";
  } finally {
    isLoading.value = false;
  }
}

function queueHeading(): string {
  if (filters.value.status && filters.value.status !== "all") {
    return `${filters.value.status[0].toUpperCase()}${filters.value.status.slice(1)} leads`;
  }

  if (filters.value.queue === "followups") {
    return "Follow-ups";
  }

  if (filters.value.queue === "new") {
    return "New leads";
  }

  return "All leads";
}

function nextLeadCandidate(currentLeadId: string | null): OutreachLead | null {
  if (!currentLeadId) {
    return leads.value[0] ?? null;
  }

  const currentIndex = leads.value.findIndex((lead) => lead.id === currentLeadId);

  if (currentIndex === -1) {
    return leads.value[0] ?? null;
  }

  return leads.value[currentIndex + 1] ?? leads.value[currentIndex - 1] ?? null;
}

async function selectLead(lead: OutreachLead): Promise<void> {
  await applySelectedLead(lead);
}

async function regenerateDraft(): Promise<void> {
  if (!selectedLead.value) {
    return;
  }

  await generateDraftForLead(selectedLead.value);
  setFeedback("Fresh outreach draft ready.");
}

function saveDraft(): void {
  if (!selectedLead.value) {
    return;
  }

  savedDrafts.value = {
    ...savedDrafts.value,
    [selectedLead.value.id]: messageDraft.value,
  };
  setFeedback("Draft saved locally for this session.");
}

async function sendDraft(): Promise<void> {
  if (!selectedLead.value || !messageDraft.value.trim()) {
    return;
  }

  isSaving.value = true;
  errorMessage.value = "";

  const currentLeadId = selectedLead.value.id;
  const preferredNextLead = nextLeadCandidate(currentLeadId);
  const nextStatus = getLeadNextStatus(selectedLead.value);

  try {
    await copyToClipboard(messageDraft.value);
    await requestOutreachLeadStatusUpdate(currentLeadId, {
      status: nextStatus,
      messageContent: messageDraft.value,
      tone: draftTone.value,
    });

    setFeedback(
      nextStatus === "activated"
        ? "Response copied and lead moved to converted."
        : filters.value.queue === "followups"
          ? "Follow-up copied and logged."
          : "Message copied and lead moved to contacted.",
    );

    await Promise.all([loadOverview(), loadLeads(preferredNextLead?.id ?? null)]);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Unable to update outreach lead.";
  } finally {
    isSaving.value = false;
  }
}

async function generateReplyDraft(): Promise<void> {
  if (!selectedLead.value?.replyContent) {
    return;
  }

  isGenerating.value = true;
  errorMessage.value = "";

  try {
    const response = await requestOutreachReplyDraft({
      leadId: selectedLead.value.id,
      tone: draftTone.value,
    });
    messageDraft.value = response.message.content;
    savedDrafts.value = {
      ...savedDrafts.value,
      [selectedLead.value.id]: response.message.content,
    };
    setFeedback("Reply draft ready.");
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Unable to generate reply.";
  } finally {
    isGenerating.value = false;
  }
}

async function moveToNextLead(): Promise<void> {
  const nextLead = nextLeadCandidate(selectedLeadId.value);
  await applySelectedLead(nextLead);
}

async function setQueue(queue: OutreachQueue): Promise<void> {
  filters.value = {
    ...filters.value,
    queue,
    status: "all",
  };
}

async function applyFilterPatch(patch: Partial<OutreachLeadFilters>): Promise<void> {
  filters.value = {
    ...filters.value,
    ...patch,
  };
}

async function selectPipelineStage(status: OutreachLeadStatus | null): Promise<void> {
  filters.value = {
    ...filters.value,
    status: status ?? "all",
    queue: undefined,
  };
}

async function handleToneChange(nextTone: OutreachMessageTone): Promise<void> {
  draftTone.value = nextTone;

  if (selectedLead.value) {
    await generateDraftForLead(selectedLead.value);
    setFeedback(`${nextTone[0].toUpperCase()}${nextTone.slice(1)} tone applied.`);
  }
}

function handleKeydown(event: KeyboardEvent): void {
  const hasModifier = event.metaKey || event.ctrlKey;

  if (!hasModifier) {
    return;
  }

  if (event.key === "Enter") {
    event.preventDefault();
    void sendDraft();
    return;
  }

  if (event.key.toLowerCase() === "r") {
    event.preventDefault();
    void regenerateDraft();
    return;
  }

  if (event.key === "ArrowDown") {
    event.preventDefault();
    void moveToNextLead();
  }
}

watch(
  filters,
  async () => {
    if (isLoading.value) {
      return;
    }

    try {
      await loadLeads();
    } catch (error) {
      errorMessage.value =
        error instanceof Error ? error.message : "Unable to refresh outreach queue.";
    }
  },
  { deep: true },
);

onMounted(() => {
  window.addEventListener("keydown", handleKeydown);
  void loadOutreachState();
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleKeydown);
});
</script>

<template>
  <main class="dashboard-shell outreach-shell">
    <section class="dashboard-hero outreach-hero">
      <div>
        <p class="dashboard-eyebrow">/admin/outreach</p>
        <h1>Outreach Control Panel</h1>
        <p class="dashboard-description">
          Work the next best lead, review the draft, and move the pipeline forward in minutes.
        </p>
      </div>

      <router-link class="topbar-pill" :to="appRoutes.admin">Back to admin</router-link>
    </section>

    <p v-if="isLoading" class="dashboard-feedback">Loading outreach queue...</p>
    <p v-else-if="errorMessage" class="dashboard-feedback error">{{ errorMessage }}</p>

    <template v-else>
      <OutreachTopBar :overview="overview" :filters="filters" @filter-change="applyFilterPatch" />

      <p v-if="feedbackMessage" class="dashboard-feedback outreach-feedback">{{ feedbackMessage }}</p>

      <section class="outreach-main-grid">
        <article class="dashboard-panel outreach-queue-panel">
          <div class="panel-header outreach-panel-header">
            <div>
              <p class="panel-meta">Lead Queue</p>
              <h2>{{ queueHeading() }}</h2>
            </div>

            <span class="topbar-pill muted">{{ leads.length }} loaded</span>
          </div>

          <div class="queue-toggle-row">
            <button
              type="button"
              class="topbar-pill"
              :data-active="filters.queue !== 'followups'"
              @click="setQueue('new')"
            >
              New Leads
            </button>
            <button
              type="button"
              class="topbar-pill"
              :data-active="filters.queue === 'followups'"
              @click="setQueue('followups')"
            >
              Follow-ups
            </button>
          </div>

          <div v-if="leads.length === 0" class="outreach-empty-state">
            <p>No leads match the current filters.</p>
            <span>Change the queue or clear the status filter to widen the list.</span>
          </div>

          <div v-else class="lead-list">
            <LeadCard
              v-for="lead in leads"
              :key="lead.id"
              :lead="lead"
              :selected="lead.id === selectedLeadId"
              @select="selectLead"
            />
          </div>
        </article>

        <MessagePanel
          :lead="selectedLead"
          :message-draft="messageDraft"
          :tone="draftTone"
          :queue="filters.queue ?? 'new'"
          :is-generating="isGenerating"
          :is-saving="isSaving"
          @update:message-draft="messageDraft = $event"
          @tone-change="handleToneChange"
          @regenerate="regenerateDraft"
          @send="sendDraft"
          @save="saveDraft"
          @next="moveToNextLead"
          @generate-reply="generateReplyDraft"
        />
      </section>

      <PipelineStrip
        :stages="overview?.pipeline ?? []"
        :active-status="activePipelineStatus"
        @select-stage="selectPipelineStage"
      />
    </template>
  </main>
</template>

<style scoped>
.outreach-shell,
.outreach-main-grid,
.lead-list {
  display: grid;
  gap: 18px;
}

.outreach-hero {
  display: flex;
  justify-content: space-between;
  gap: 18px;
  align-items: start;
}

.outreach-main-grid {
  grid-template-columns: minmax(320px, 0.95fr) minmax(0, 1.45fr);
}

.outreach-queue-panel,
.lead-list {
  align-content: start;
}

.lead-list {
  max-height: 720px;
  overflow-y: auto;
  padding-right: 4px;
}

.queue-toggle-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 16px;
}

.topbar-pill[data-active="true"] {
  border-color: color-mix(in srgb, var(--fc-accent) 44%, var(--fc-border));
  background: color-mix(in srgb, var(--fc-accent) 10%, var(--fc-panel-bg));
  color: var(--fc-text);
}

.outreach-feedback {
  margin: 14px 0 0;
  color: var(--fc-success-text);
}

.outreach-empty-state {
  display: grid;
  gap: 8px;
  min-height: 220px;
  align-content: center;
  justify-items: start;
  padding: 20px;
  border: 1px dashed var(--fc-border);
  border-radius: 16px;
  background: color-mix(in srgb, var(--fc-surface-muted) 54%, var(--fc-panel-bg));
}

.outreach-empty-state p,
.outreach-empty-state span {
  margin: 0;
}

.outreach-empty-state span {
  color: var(--fc-text-muted);
  line-height: 1.6;
}

@media (max-width: 980px) {
  .outreach-main-grid {
    grid-template-columns: 1fr;
  }

  .lead-list {
    max-height: none;
    overflow: visible;
  }
}

@media (max-width: 720px) {
  .outreach-hero {
    flex-direction: column;
  }
}
</style>
