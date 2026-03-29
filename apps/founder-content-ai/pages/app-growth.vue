<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import type {
  BusinessMembership,
  CreateGrowthLeadRequest,
  GrowthAutomationFlow,
  GrowthLead,
  GrowthLeadEvent,
  GrowthLeadSource,
  GrowthLeadStatus,
} from "../../../packages/shared-types";
import { useProductAccessContext } from "../access/product-access-context";
import { requestMyBusinesses } from "../services/admin-analytics-service";
import {
  growthLeadStatusOptions,
  requestCreateGrowthLead,
  requestGrowthFlows,
  requestGrowthLeadEvents,
  requestGrowthLeads,
  requestUpdateGrowthLeadStatus,
} from "../services/growth-service";
import { appRoutes } from "../utils/routes";

const {
  bootstrap: productAccess,
  setActiveBusinessId,
  refreshProductAccess,
  isFeatureEnabled,
} = useProductAccessContext();

const businesses = ref<BusinessMembership[]>([]);
const selectedBusinessId = ref("");
const leads = ref<GrowthLead[]>([]);
const flows = ref<GrowthAutomationFlow[]>([]);
const leadEvents = ref<GrowthLeadEvent[]>([]);
const selectedLeadId = ref("");
const selectedLeadStatusDraft = ref<GrowthLeadStatus>("new");
const isLoading = ref(true);
const isLoadingEvents = ref(false);
const isSavingLead = ref(false);
const isUpdatingStatus = ref(false);
const errorMessage = ref("");
const feedbackMessage = ref("");

const leadForm = ref<{
  name: string;
  email: string;
  phone: string;
  source: GrowthLeadSource;
  notes: string;
}>({
  name: "",
  email: "",
  phone: "",
  source: "manual",
  notes: "",
});

const leadSourceOptions: Array<{ value: GrowthLeadSource; label: string }> = [
  { value: "manual", label: "Manual" },
  { value: "landing_page", label: "Landing page" },
  { value: "demo_request", label: "Demo request" },
  { value: "csv_import", label: "CSV import" },
];

const currentBusiness = computed(() =>
  businesses.value.find((membership) => membership.businessId === selectedBusinessId.value) ?? null,
);

const selectedLead = computed(() =>
  leads.value.find((lead) => lead.id === selectedLeadId.value) ?? null,
);

const growthFeatureEnabled = computed(
  () =>
    !selectedBusinessId.value ||
    !productAccess.value?.activeBusinessId ||
    isFeatureEnabled("email_campaigns"),
);

const overviewCards = computed(() => {
  const sentCount = leads.value.filter((lead) => Boolean(lead.firstEmailSentAt)).length;
  const convertedCount = leads.value.filter((lead) => lead.status === "converted").length;
  const activeCount = leads.value.filter((lead) => !["converted", "churned"].includes(lead.status)).length;

  return [
    { label: "Captured leads", value: String(leads.value.length), tone: "default" as const },
    { label: "Emails started", value: String(sentCount), tone: "default" as const },
    { label: "Active pipeline", value: String(activeCount), tone: "default" as const },
    { label: "Converted", value: String(convertedCount), tone: convertedCount > 0 ? ("success" as const) : ("default" as const) },
  ];
});

const primaryFlow = computed(() => flows.value[0] ?? null);

const flowPreviewSteps = computed(() =>
  (primaryFlow.value?.steps ?? []).map((step) => ({
    id: step.id,
    dayLabel: step.dayOffset === 0 ? "Day 0" : `Day ${step.dayOffset}`,
    subject: step.subject,
    preview: step.bodyText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 2)
      .join(" "),
  })),
);

const leadActivitySummary = computed(() => {
  const counts = {
    sent: 0,
    delivered: 0,
    bounced: 0,
    complained: 0,
  };

  for (const event of leadEvents.value) {
    if (event.eventType === "email_sent") {
      counts.sent += 1;
    } else if (event.eventType === "email_delivered") {
      counts.delivered += 1;
    } else if (event.eventType === "email_bounced") {
      counts.bounced += 1;
    } else if (event.eventType === "email_complained") {
      counts.complained += 1;
    }
  }

  return counts;
});

function formatLeadSource(value: GrowthLeadSource): string {
  switch (value) {
    case "landing_page":
      return "Landing page";
    case "demo_request":
      return "Demo request";
    case "csv_import":
      return "CSV import";
    case "system":
      return "System";
    default:
      return "Manual";
  }
}

function formatLeadStatus(value: GrowthLeadStatus): string {
  switch (value) {
    case "new":
      return "New";
    case "engaged":
      return "Engaged";
    case "trial":
      return "Trial";
    case "converted":
      return "Converted";
    case "churned":
      return "Churned";
  }
}

function formatEventTitle(event: GrowthLeadEvent): string {
  switch (event.eventType) {
    case "captured":
      return "Lead captured";
    case "enrolled":
      return "Enrolled in flow";
    case "email_sent":
      return "Email sent";
    case "email_delivered":
      return "Email delivered";
    case "email_bounced":
      return "Email bounced";
    case "email_complained":
      return "Complaint received";
    case "email_failed":
      return "Send failed";
    case "step_skipped":
      return "Step skipped";
    case "status_changed":
      return "Status changed";
    case "email_opened":
      return "Email opened";
    case "email_clicked":
      return "Link clicked";
  }
}

function formatEventCopy(event: GrowthLeadEvent): string {
  const templateKey =
    typeof event.metadata.templateKey === "string" ? event.metadata.templateKey : "";
  const reason = typeof event.metadata.reason === "string" ? event.metadata.reason : "";

  if (event.eventType === "status_changed") {
    const fromStatus =
      typeof event.metadata.fromStatus === "string" ? event.metadata.fromStatus : "unknown";
    const toStatus = typeof event.metadata.toStatus === "string" ? event.metadata.toStatus : "unknown";
    return `${formatLeadStatus(fromStatus as GrowthLeadStatus)} -> ${formatLeadStatus(toStatus as GrowthLeadStatus)}`;
  }

  if (event.eventType === "captured") {
    const source = typeof event.metadata.source === "string" ? event.metadata.source : "manual";
    return `Source: ${formatLeadSource(source as GrowthLeadSource)}`;
  }

  if (templateKey) {
    return reason ? `${templateKey} · ${reason}` : templateKey;
  }

  return reason || "Tracked by the growth engine.";
}

function syncSelectedLead(): void {
  const preferredLead =
    leads.value.find((lead) => lead.id === selectedLeadId.value) ?? leads.value[0] ?? null;
  selectedLeadId.value = preferredLead?.id ?? "";
  selectedLeadStatusDraft.value = preferredLead?.status ?? "new";
}

async function loadBusinesses(): Promise<void> {
  const response = await requestMyBusinesses();
  businesses.value = response.businesses;
  selectedBusinessId.value =
    productAccess.value?.activeBusinessId || response.businesses[0]?.businessId || "";

  if (selectedBusinessId.value) {
    await setActiveBusinessId(selectedBusinessId.value);
  }
}

async function loadLeadEvents(): Promise<void> {
  if (!selectedBusinessId.value || !selectedLeadId.value || !growthFeatureEnabled.value) {
    leadEvents.value = [];
    return;
  }

  isLoadingEvents.value = true;

  try {
    const response = await requestGrowthLeadEvents(selectedBusinessId.value, selectedLeadId.value);
    leadEvents.value = response.events;
  } catch (error) {
    leadEvents.value = [];
    errorMessage.value =
      error instanceof Error ? error.message : "Unable to load lead activity.";
  } finally {
    isLoadingEvents.value = false;
  }
}

async function loadWorkspaceGrowth(): Promise<void> {
  if (!selectedBusinessId.value || !growthFeatureEnabled.value) {
    leads.value = [];
    flows.value = [];
    leadEvents.value = [];
    selectedLeadId.value = "";
    return;
  }

  const [leadResponse, flowResponse] = await Promise.all([
    requestGrowthLeads(selectedBusinessId.value),
    requestGrowthFlows(selectedBusinessId.value),
  ]);

  leads.value = leadResponse.leads;
  flows.value = flowResponse.flows;
  syncSelectedLead();
  await loadLeadEvents();
}

async function initializePage(): Promise<void> {
  isLoading.value = true;
  errorMessage.value = "";

  try {
    await loadBusinesses();
    await loadWorkspaceGrowth();
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "Unable to load the growth workspace.";
  } finally {
    isLoading.value = false;
  }
}

async function handleAddLead(): Promise<void> {
  if (!selectedBusinessId.value) {
    errorMessage.value = "Select a workspace before adding a lead.";
    return;
  }

  if (!leadForm.value.name.trim() || !leadForm.value.email.trim()) {
    errorMessage.value = "Lead name and email are required.";
    return;
  }

  isSavingLead.value = true;
  errorMessage.value = "";

  try {
    const payload: CreateGrowthLeadRequest = {
      businessId: selectedBusinessId.value,
      name: leadForm.value.name.trim(),
      email: leadForm.value.email.trim(),
      phone: leadForm.value.phone.trim() || undefined,
      source: leadForm.value.source,
      notes: leadForm.value.notes.trim() || undefined,
    };
    const response = await requestCreateGrowthLead(payload);
    feedbackMessage.value = `${response.lead.name} added and enrolled in ${response.enrolledFlowIds.length} flow.`;
    leadForm.value = {
      name: "",
      email: "",
      phone: "",
      source: "manual",
      notes: "",
    };
    await loadWorkspaceGrowth();
    selectedLeadId.value = response.lead.id;
    await loadLeadEvents();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Unable to create lead.";
  } finally {
    isSavingLead.value = false;
  }
}

async function handleStatusUpdate(): Promise<void> {
  if (!selectedBusinessId.value || !selectedLead.value) {
    return;
  }

  isUpdatingStatus.value = true;
  errorMessage.value = "";

  try {
    const response = await requestUpdateGrowthLeadStatus(selectedLead.value.id, {
      businessId: selectedBusinessId.value,
      status: selectedLeadStatusDraft.value,
    });
    leads.value = leads.value.map((lead) => (lead.id === response.lead.id ? response.lead : lead));
    feedbackMessage.value = `Lead moved to ${formatLeadStatus(response.lead.status)}.`;
    await loadLeadEvents();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Unable to update lead status.";
  } finally {
    isUpdatingStatus.value = false;
  }
}

watch(selectedBusinessId, (businessId, previousBusinessId) => {
  if (!businessId || businessId === previousBusinessId) {
    return;
  }

  void (async () => {
    await Promise.all([setActiveBusinessId(businessId), refreshProductAccess(businessId)]);
    await loadWorkspaceGrowth();
  })();
});

watch(selectedLeadId, () => {
  selectedLeadStatusDraft.value = selectedLead.value?.status ?? "new";
  void loadLeadEvents();
});

onMounted(() => {
  void initializePage();
});
</script>

<template>
  <main class="dashboard-shell growth-shell">
    <section class="dashboard-hero">
      <p class="dashboard-eyebrow">/app/growth</p>
      <h1>Make the automation engine visible.</h1>
      <p class="dashboard-description">
        Capture leads, see the nurture sequence, and inspect activity without touching a builder.
      </p>
    </section>

    <section class="dashboard-panel growth-toolbar">
      <label class="dashboard-field">
        <span>Workspace</span>
        <select v-model="selectedBusinessId" class="growth-select">
          <option
            v-for="business in businesses"
            :key="business.businessId"
            :value="business.businessId"
          >
            {{ business.business.name }}
          </option>
        </select>
      </label>

      <div class="growth-toolbar-copy">
        <strong>{{ currentBusiness?.business.brandName || currentBusiness?.business.name || "No workspace selected" }}</strong>
        <small>
          {{ growthFeatureEnabled ? "Inbound funnel engine runs through the workspace email system." : "Enable email campaigns for this workspace to use growth automation." }}
        </small>
      </div>
    </section>

    <p v-if="isLoading" class="dashboard-feedback">Loading growth workspace...</p>
    <p v-else-if="errorMessage" class="dashboard-feedback error">{{ errorMessage }}</p>
    <p v-if="feedbackMessage" class="dashboard-feedback">{{ feedbackMessage }}</p>

    <template v-if="!isLoading && !errorMessage">
      <section v-if="businesses.length === 0" class="dashboard-panel empty-state-panel">
        <h2>Create a workspace first.</h2>
        <p class="dashboard-description">
          Growth automation is workspace-scoped, so start by creating the brand container that will own leads, flows, and sending.
        </p>
        <router-link class="dashboard-button" :to="appRoutes.onboarding">Go to onboarding</router-link>
      </section>

      <section v-else-if="!growthFeatureEnabled" class="dashboard-panel empty-state-panel">
        <h2>Email access is required for growth automation.</h2>
        <p class="dashboard-description">
          This workspace does not have the email campaign feature available yet, so the nurture engine stays disabled.
        </p>
        <router-link class="dashboard-button secondary" :to="appRoutes.settingsPreferences">
          Open settings
        </router-link>
      </section>

      <template v-else>
        <section class="dashboard-card-grid growth-overview-grid">
          <article
            v-for="card in overviewCards"
            :key="card.label"
            class="dashboard-card"
            :class="{ 'success-card': card.tone === 'success' }"
          >
            <p class="dashboard-card-label">{{ card.label }}</p>
            <strong>{{ card.value }}</strong>
          </article>
        </section>

        <section class="dashboard-grid-two growth-top-grid">
          <article class="dashboard-panel growth-form-panel">
            <div class="panel-heading">
              <div>
                <p class="dashboard-card-label">Manual lead entry</p>
                <h2>Add one lead and let the sequence start.</h2>
              </div>
              <span class="topbar-pill">V1</span>
            </div>

            <div class="growth-form-grid">
              <label class="dashboard-field">
                <span>Name</span>
                <input v-model="leadForm.name" class="growth-input" placeholder="Jane Founder" />
              </label>

              <label class="dashboard-field">
                <span>Email</span>
                <input v-model="leadForm.email" class="growth-input" placeholder="jane@company.com" />
              </label>

              <label class="dashboard-field">
                <span>Phone</span>
                <input v-model="leadForm.phone" class="growth-input" placeholder="+1 555 010 1234" />
              </label>

              <label class="dashboard-field">
                <span>Source</span>
                <select v-model="leadForm.source" class="growth-select">
                  <option
                    v-for="option in leadSourceOptions"
                    :key="option.value"
                    :value="option.value"
                  >
                    {{ option.label }}
                  </option>
                </select>
              </label>
            </div>

            <label class="dashboard-field">
              <span>Notes</span>
              <textarea
                v-model="leadForm.notes"
                class="growth-textarea"
                rows="4"
                placeholder="What this lead asked for, how they came in, or what you want the sequence to emphasize."
              />
            </label>

            <div class="growth-form-actions">
              <button class="dashboard-button" :disabled="isSavingLead" @click="handleAddLead">
                {{ isSavingLead ? "Adding..." : "Add Lead" }}
              </button>
              <small>Lead is captured, enrolled, and scheduled immediately.</small>
            </div>
          </article>

          <article class="dashboard-panel growth-flow-panel">
            <div class="panel-heading">
              <div>
                <p class="dashboard-card-label">Default nurture flow</p>
                <h2>{{ primaryFlow?.name || "SaaS trial nurture" }}</h2>
              </div>
              <span class="topbar-pill">{{ flowPreviewSteps.length }} steps</span>
            </div>

            <div class="flow-step-list">
              <article v-for="step in flowPreviewSteps" :key="step.id" class="flow-step-card">
                <span class="flow-step-day">{{ step.dayLabel }}</span>
                <strong>{{ step.subject }}</strong>
                <p>{{ step.preview }}</p>
              </article>
            </div>

            <p class="dashboard-description flow-footnote">
              Tracking is live for sent, delivered, bounced, and complained events. Opens and clicks can land next without changing this page shape.
            </p>
          </article>
        </section>

        <section class="dashboard-grid-two growth-main-grid">
          <article class="dashboard-panel leads-panel">
            <div class="panel-heading">
              <div>
                <p class="dashboard-card-label">Leads</p>
                <h2>{{ leads.length }} in this workspace</h2>
              </div>
              <span class="topbar-pill">{{ leads.filter((lead) => lead.status === "new").length }} new</span>
            </div>

            <div class="growth-table-wrap">
              <table class="growth-table">
                <thead>
                  <tr>
                    <th>Lead</th>
                    <th>Source</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th>Last contact</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="lead in leads"
                    :key="lead.id"
                    :class="{ selected: lead.id === selectedLeadId }"
                    @click="selectedLeadId = lead.id"
                  >
                    <td>
                      <strong>{{ lead.name }}</strong>
                      <small>{{ lead.email }}</small>
                    </td>
                    <td>{{ formatLeadSource(lead.source) }}</td>
                    <td>
                      <span class="status-pill" :data-status="lead.status">
                        {{ formatLeadStatus(lead.status) }}
                      </span>
                    </td>
                    <td>{{ new Date(lead.createdAt).toLocaleDateString() }}</td>
                    <td>{{ lead.lastContactedAt ? new Date(lead.lastContactedAt).toLocaleString() : "Not contacted" }}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <p v-if="leads.length === 0" class="dashboard-description empty-copy">
              Add the first lead above and the nurture worker can start doing useful work.
            </p>
          </article>

          <article class="dashboard-panel activity-panel">
            <div class="panel-heading">
              <div>
                <p class="dashboard-card-label">Selected lead activity</p>
                <h2>{{ selectedLead?.name || "Choose a lead" }}</h2>
              </div>
              <span v-if="selectedLead" class="topbar-pill">{{ formatLeadStatus(selectedLead.status) }}</span>
            </div>

            <template v-if="selectedLead">
              <div class="activity-summary">
                <div class="activity-stat">
                  <strong>{{ leadActivitySummary.sent }}</strong>
                  <small>Sent</small>
                </div>
                <div class="activity-stat">
                  <strong>{{ leadActivitySummary.delivered }}</strong>
                  <small>Delivered</small>
                </div>
                <div class="activity-stat warning">
                  <strong>{{ leadActivitySummary.bounced }}</strong>
                  <small>Bounced</small>
                </div>
                <div class="activity-stat danger">
                  <strong>{{ leadActivitySummary.complained }}</strong>
                  <small>Complaints</small>
                </div>
              </div>

              <div class="status-editor">
                <label class="dashboard-field">
                  <span>Lead status</span>
                  <select v-model="selectedLeadStatusDraft" class="growth-select">
                    <option
                      v-for="status in growthLeadStatusOptions"
                      :key="status"
                      :value="status"
                    >
                      {{ formatLeadStatus(status) }}
                    </option>
                  </select>
                </label>
                <button class="dashboard-button secondary" :disabled="isUpdatingStatus" @click="handleStatusUpdate">
                  {{ isUpdatingStatus ? "Saving..." : "Update Status" }}
                </button>
              </div>

              <div v-if="isLoadingEvents" class="dashboard-feedback">Loading activity...</div>
              <div v-else class="activity-timeline">
                <article v-for="event in leadEvents" :key="event.id" class="timeline-event">
                  <div class="timeline-event-head">
                    <strong>{{ formatEventTitle(event) }}</strong>
                    <small>{{ new Date(event.occurredAt).toLocaleString() }}</small>
                  </div>
                  <p>{{ formatEventCopy(event) }}</p>
                </article>

                <p v-if="leadEvents.length === 0" class="dashboard-description empty-copy">
                  No activity yet. Once the worker sends the first step, the timeline starts filling in.
                </p>
              </div>
            </template>

            <p v-else class="dashboard-description empty-copy">
              Select a lead from the table to inspect their timeline and update funnel status.
            </p>
          </article>
        </section>
      </template>
    </template>
  </main>
</template>

<style scoped>
.growth-shell {
  gap: 24px;
}

.growth-toolbar,
.growth-form-grid,
.growth-form-actions,
.panel-heading,
.status-editor,
.activity-summary,
.timeline-event-head {
  display: flex;
  gap: 16px;
}

.growth-toolbar,
.panel-heading,
.status-editor,
.timeline-event-head {
  align-items: center;
  justify-content: space-between;
}

.growth-toolbar-copy,
.growth-form-actions,
.activity-stat {
  display: grid;
  gap: 4px;
}

.growth-toolbar-copy strong,
.panel-heading h2 {
  font-size: 1.2rem;
  line-height: 1.2;
}

.growth-toolbar-copy small,
.growth-form-actions small {
  color: rgba(59, 46, 40, 0.72);
}

.growth-overview-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.growth-top-grid,
.growth-main-grid {
  align-items: start;
}

.growth-form-panel,
.growth-flow-panel,
.leads-panel,
.activity-panel {
  display: grid;
  gap: 18px;
}

.growth-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.growth-input,
.growth-select,
.growth-textarea {
  width: 100%;
  border: 1px solid rgba(211, 199, 187, 0.92);
  border-radius: 18px;
  padding: 14px 16px;
  background: rgba(255, 252, 247, 0.9);
  color: inherit;
  font: inherit;
}

.growth-textarea {
  min-height: 110px;
  resize: vertical;
}

.flow-step-list,
.activity-timeline {
  display: grid;
  gap: 12px;
}

.flow-step-card,
.timeline-event {
  border: 1px solid rgba(224, 214, 203, 0.92);
  border-radius: 20px;
  padding: 16px 18px;
  background: rgba(255, 252, 247, 0.78);
  display: grid;
  gap: 8px;
}

.flow-step-day {
  width: fit-content;
  border-radius: 999px;
  padding: 6px 12px;
  font-size: 0.75rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  background: rgba(214, 101, 44, 0.12);
  color: rgba(171, 72, 21, 0.96);
}

.flow-footnote,
.empty-copy {
  margin: 0;
}

.growth-table-wrap {
  overflow-x: auto;
  border: 1px solid rgba(224, 214, 203, 0.92);
  border-radius: 22px;
}

.growth-table {
  width: 100%;
  min-width: 700px;
  border-collapse: collapse;
}

.growth-table th,
.growth-table td {
  padding: 16px 18px;
  border-bottom: 1px solid rgba(236, 226, 214, 0.95);
  text-align: left;
  vertical-align: top;
}

.growth-table th {
  font-size: 0.76rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(103, 86, 74, 0.72);
}

.growth-table tbody tr {
  cursor: pointer;
  transition: background 0.18s ease;
}

.growth-table tbody tr:hover,
.growth-table tbody tr.selected {
  background: rgba(214, 101, 44, 0.08);
}

.growth-table td strong,
.timeline-event strong {
  display: block;
}

.growth-table td small,
.timeline-event small {
  color: rgba(86, 69, 58, 0.72);
}

.status-pill {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 6px 12px;
  font-size: 0.82rem;
  font-weight: 700;
  background: rgba(224, 214, 203, 0.72);
}

.status-pill[data-status="new"] {
  background: rgba(214, 101, 44, 0.12);
  color: rgba(171, 72, 21, 0.96);
}

.status-pill[data-status="engaged"] {
  background: rgba(50, 135, 245, 0.14);
  color: rgba(29, 94, 187, 0.96);
}

.status-pill[data-status="trial"] {
  background: rgba(113, 88, 226, 0.14);
  color: rgba(80, 57, 176, 0.96);
}

.status-pill[data-status="converted"] {
  background: rgba(52, 168, 83, 0.14);
  color: rgba(20, 111, 54, 0.96);
}

.status-pill[data-status="churned"] {
  background: rgba(220, 38, 38, 0.14);
  color: rgba(153, 27, 27, 0.96);
}

.activity-summary {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.activity-stat {
  padding: 14px 16px;
  border-radius: 18px;
  background: rgba(255, 252, 247, 0.82);
  border: 1px solid rgba(224, 214, 203, 0.92);
}

.activity-stat.warning {
  background: rgba(245, 158, 11, 0.08);
}

.activity-stat.danger {
  background: rgba(220, 38, 38, 0.08);
}

.activity-stat strong {
  font-size: 1.2rem;
}

.success-card {
  background: linear-gradient(180deg, rgba(240, 255, 244, 0.92), rgba(255, 252, 247, 0.96));
}

@media (max-width: 1080px) {
  .growth-overview-grid,
  .activity-summary,
  .growth-form-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 820px) {
  .growth-toolbar,
  .panel-heading,
  .status-editor,
  .timeline-event-head {
    align-items: stretch;
    flex-direction: column;
  }

  .growth-overview-grid,
  .activity-summary,
  .growth-form-grid {
    grid-template-columns: 1fr;
  }
}
</style>
