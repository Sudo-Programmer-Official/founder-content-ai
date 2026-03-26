<script setup lang="ts">
import type {
  BusinessMembership,
  ImportOutreachLeadItem,
  OutreachLead,
} from "../../../packages/shared-types";
import { computed, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { useProductAccessContext } from "../access/product-access-context";
import { getActivationDraft } from "../services/activation-flow-service";
import { requestMyBusinesses } from "../services/admin-analytics-service";
import {
  requestWorkspaceOutreachLeadHistory,
  requestWorkspaceOutreachLeadImport,
  requestWorkspaceOutreachLeads,
  requestWorkspaceOutreachMessageCreate,
} from "../services/outreach-service";
import { appRoutes } from "../utils/routes";

const SAMPLE_IMPORT_CSV = [
  "name,platform,profileUrl,recentPost,bio",
  "Ava Founder,linkedin,https://linkedin.com/in/ava-founder,Shipping consistently is harder than building consistently,Founder sharing startup lessons",
].join("\n");

const route = useRoute();
const {
  bootstrap: productAccess,
  setActiveBusinessId,
  refreshProductAccess,
  isFeatureEnabled,
} = useProductAccessContext();

const businesses = ref<BusinessMembership[]>([]);
const selectedBusinessId = ref("");
const leads = ref<OutreachLead[]>([]);
const selectedLeadId = ref("");
const importCsv = ref(SAMPLE_IMPORT_CSV);
const messageBody = ref("");
const isLoading = ref(true);
const isImporting = ref(false);
const isSending = ref(false);
const errorMessage = ref("");
const feedbackMessage = ref("");

const selectedLead = computed(() => leads.value.find((lead) => lead.id === selectedLeadId.value) ?? null);
const outreachFeatureEnabled = computed(
  () =>
    !selectedBusinessId.value ||
    !productAccess.value?.activeBusinessId ||
    isFeatureEnabled("outreach"),
);
const outreachLimitText = computed(() => {
  const limits = productAccess.value?.limits;
  return limits ? `Outreach left today: ${limits.outreachRemaining}` : "";
});
const activationSeed = computed(() => {
  const draftId = typeof route.query.draftId === "string" ? route.query.draftId : "";
  const prefillText = typeof route.query.prefill === "string" ? route.query.prefill.trim() : "";

  if (draftId) {
    return getActivationDraft(draftId)?.result.post ?? prefillText;
  }

  return prefillText;
});

function parseCsvLine(value: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (const character of value) {
    if (character === '"') {
      quoted = !quoted;
      continue;
    }

    if (character === "," && !quoted) {
      cells.push(current.trim());
      current = "";
      continue;
    }

    current += character;
  }

  cells.push(current.trim());
  return cells;
}

function toImportItems(csvText: string): ImportOutreachLeadItem[] {
  const lines = csvText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length < 2) {
    return [];
  }

  const headers = parseCsvLine(lines[0]).map((header) => header.toLowerCase());
  const indexByHeader = new Map(headers.map((header, index) => [header, index]));

  return lines.slice(1).flatMap((line) => {
    const values = parseCsvLine(line);
    const name = values[indexByHeader.get("name") ?? -1]?.trim();
    const platform = values[indexByHeader.get("platform") ?? -1]?.trim();
    const profileUrl = values[indexByHeader.get("profileurl") ?? -1]?.trim();

    if (!name || !profileUrl || (platform !== "linkedin" && platform !== "reddit" && platform !== "x")) {
      return [];
    }

    return [
      {
        name,
        platform,
        profileUrl,
        recentPost: values[indexByHeader.get("recentpost") ?? -1]?.trim(),
        bio: values[indexByHeader.get("bio") ?? -1]?.trim(),
      } satisfies ImportOutreachLeadItem,
    ];
  });
}

function applyLeadSelection(lead: OutreachLead | null): void {
  selectedLeadId.value = lead?.id ?? "";

  if (!lead) {
    return;
  }

  if (!messageBody.value.trim() && activationSeed.value) {
    messageBody.value = activationSeed.value;
  }
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

async function loadLeads(): Promise<void> {
  if (!selectedBusinessId.value || !outreachFeatureEnabled.value) {
    leads.value = [];
    selectedLeadId.value = "";
    return;
  }

  const response = await requestWorkspaceOutreachLeads({
    businessId: selectedBusinessId.value,
  });
  leads.value = response.leads;

  const preferredLead = response.leads.find((lead) => lead.id === selectedLeadId.value) ?? response.leads[0] ?? null;
  applyLeadSelection(preferredLead);
}

async function initializePage(): Promise<void> {
  isLoading.value = true;
  errorMessage.value = "";

  try {
    await loadBusinesses();
    await loadLeads();

    if (activationSeed.value && !messageBody.value.trim()) {
      messageBody.value = activationSeed.value;
    }
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "Unable to load the outreach workspace.";
  } finally {
    isLoading.value = false;
  }
}

async function importLeads(): Promise<void> {
  if (!selectedBusinessId.value) {
    errorMessage.value = "Select a workspace before importing leads.";
    return;
  }

  const parsedLeads = toImportItems(importCsv.value);

  if (parsedLeads.length === 0) {
    errorMessage.value = "Add a CSV with name, platform, and profileUrl columns.";
    return;
  }

  isImporting.value = true;
  errorMessage.value = "";

  try {
    const response = await requestWorkspaceOutreachLeadImport({
      businessId: selectedBusinessId.value,
      leads: parsedLeads,
    });
    feedbackMessage.value = `Imported ${response.importedCount} leads.`;
    await loadLeads();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Unable to import leads.";
  } finally {
    isImporting.value = false;
  }
}

async function copyMessage(content: string): Promise<void> {
  if (!content.trim() || typeof navigator === "undefined" || !navigator.clipboard) {
    return;
  }

  try {
    await navigator.clipboard.writeText(content);
  } catch {
    // Keep the send flow moving even if copy fails.
  }
}

async function sendMessage(): Promise<void> {
  if (!selectedBusinessId.value || !selectedLead.value || !messageBody.value.trim()) {
    errorMessage.value = "Select a lead and add a message before sending.";
    return;
  }

  isSending.value = true;
  errorMessage.value = "";
  const currentLeadId = selectedLead.value.id;

  try {
    await copyMessage(messageBody.value);
    await requestWorkspaceOutreachMessageCreate({
      businessId: selectedBusinessId.value,
      leadId: currentLeadId,
      content: messageBody.value.trim(),
      type: selectedLead.value.status === "contacted" ? "followup" : "initial",
      markStatus: "contacted",
    });

    await requestWorkspaceOutreachLeadHistory(currentLeadId, selectedBusinessId.value);
    feedbackMessage.value = "Sent successfully. The message is logged and copied for manual outreach.";
    await Promise.all([loadLeads(), refreshProductAccess(selectedBusinessId.value)]);

    const currentIndex = leads.value.findIndex((lead) => lead.id === currentLeadId);
    const nextLead = leads.value[currentIndex + 1] ?? leads.value[currentIndex] ?? null;
    applyLeadSelection(nextLead);
  } catch (error) {
    errorMessage.value =
      error instanceof Error
        ? error.message
        : "Something failed while logging that outreach message.";
  } finally {
    isSending.value = false;
  }
}

watch(selectedBusinessId, (nextBusinessId) => {
  if (!nextBusinessId) {
    return;
  }

  void (async () => {
    await Promise.all([setActiveBusinessId(nextBusinessId), refreshProductAccess(nextBusinessId)]);
    await loadLeads();
  })();
});

watch(
  () => route.query.draftId,
  () => {
    if (!messageBody.value.trim() && activationSeed.value) {
      messageBody.value = activationSeed.value;
    }
  },
);

onMounted(() => {
  void initializePage();
});
</script>

<template>
  <main class="workspace-shell">
    <section class="workspace-hero">
      <p class="workspace-eyebrow">/app/outreach</p>
      <h1>Use the generated post in real conversations.</h1>
      <p class="workspace-description">
        Import a few founder leads, prefill the message from your new post, then send manually with
        almost no rewriting.
      </p>
      <div class="workspace-chip-row">
        <span v-if="outreachLimitText" class="workspace-chip">{{ outreachLimitText }}</span>
        <span class="workspace-chip">Manual send only</span>
        <span class="workspace-chip">Message copied on send</span>
      </div>
    </section>

    <p v-if="errorMessage" class="workspace-feedback error">{{ errorMessage }}</p>
    <p v-else-if="feedbackMessage" class="workspace-feedback">{{ feedbackMessage }}</p>

    <section v-if="isLoading" class="workspace-card">
      <p class="workspace-description">Loading outreach workspace...</p>
    </section>

    <template v-else>
      <section v-if="!selectedBusinessId" class="workspace-card empty-state">
        <h2>Outreach needs a workspace.</h2>
        <p>Create or select a workspace first, then come back to use this message as outreach copy.</p>
        <router-link class="primary-action" :to="appRoutes.onboarding">Set up workspace</router-link>
      </section>

      <section v-else-if="!outreachFeatureEnabled" class="workspace-card empty-state">
        <h2>Outreach is not enabled for this workspace.</h2>
        <p>Upgrade access or switch to a workspace where outreach is enabled.</p>
      </section>

      <div v-else class="workspace-grid">
        <article class="workspace-card">
          <div class="panel-header">
            <div>
              <p class="panel-meta">Lead queue</p>
              <h2>Import a small list</h2>
            </div>
            <select v-model="selectedBusinessId" class="workspace-select">
              <option value="" disabled>Select workspace</option>
              <option
                v-for="membership in businesses"
                :key="membership.businessId"
                :value="membership.businessId"
              >
                {{ membership.business.name }}
              </option>
            </select>
          </div>

          <textarea v-model="importCsv" class="workspace-textarea compact" />

          <div class="workspace-actions">
            <button type="button" class="primary-action" :disabled="isImporting" @click="importLeads">
              {{ isImporting ? "Importing..." : "Import leads" }}
            </button>
          </div>

          <div class="lead-list">
            <button
              v-for="lead in leads"
              :key="lead.id"
              type="button"
              class="lead-card"
              :class="{ active: selectedLeadId === lead.id }"
              @click="applyLeadSelection(lead)"
            >
              <strong>{{ lead.name }}</strong>
              <span>{{ lead.role || "Founder" }}</span>
              <span>{{ lead.status }}</span>
            </button>
          </div>

          <div v-if="leads.length === 0" class="empty-note">
            No leads yet. Import a CSV, then send this post into your first conversations.
          </div>
        </article>

        <article class="workspace-card">
          <div class="panel-header">
            <div>
              <p class="panel-meta">Message</p>
              <h2>{{ selectedLead ? `Write to ${selectedLead.name}` : "Pick a lead" }}</h2>
            </div>
          </div>

          <p v-if="selectedLead" class="lead-context">
            {{ selectedLead.platform }} · {{ selectedLead.recentPost || selectedLead.bio || "No recent context saved yet." }}
          </p>

          <textarea
            v-model="messageBody"
            class="workspace-textarea"
            placeholder="The generated post will prefill here. Tweak it into a short outreach note."
          />

          <div class="workspace-actions">
            <button type="button" class="primary-action" :disabled="isSending" @click="sendMessage">
              {{ isSending ? "Sending..." : "Send manually + log it" }}
            </button>
            <router-link class="secondary-action" :to="appRoutes.appGenerate">
              Generate another post
            </router-link>
          </div>
        </article>
      </div>
    </template>
  </main>
</template>

<style scoped>
.workspace-shell {
  width: min(100%, 1120px);
  margin: 0 auto;
  padding: 48px 20px 80px;
}

.workspace-hero {
  margin-bottom: 24px;
}

.workspace-eyebrow,
.panel-meta {
  margin: 0 0 10px;
  color: var(--fc-text-muted);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.workspace-hero h1 {
  margin: 0;
  font-size: clamp(2.1rem, 4vw, 3.3rem);
  line-height: 1.04;
}

.workspace-description {
  margin: 16px 0 0;
  color: var(--fc-text-muted);
  line-height: 1.7;
}

.workspace-chip-row,
.workspace-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.workspace-chip {
  display: inline-flex;
  align-items: center;
  min-height: 36px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid var(--fc-border);
  background: var(--fc-surface-subtle);
  color: var(--fc-text-muted);
  font-size: 0.84rem;
  font-weight: 700;
}

.workspace-feedback {
  margin: 0 0 18px;
  font-weight: 700;
}

.workspace-feedback.error {
  color: var(--fc-danger-text, #a63d32);
}

.workspace-grid {
  display: grid;
  gap: 20px;
  grid-template-columns: minmax(0, 0.95fr) minmax(0, 1.05fr);
}

.workspace-card {
  padding: clamp(22px, 3vw, 32px);
  border: 1px solid var(--fc-border);
  border-radius: 28px;
  background: linear-gradient(180deg, var(--fc-surface) 0%, var(--fc-surface-subtle) 100%);
  box-shadow: var(--fc-card-shadow);
}

.empty-state {
  text-align: center;
}

.panel-header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
}

.panel-header h2 {
  margin: 0;
}

.workspace-select,
.workspace-textarea {
  width: 100%;
  margin-top: 18px;
  padding: 16px;
  border: 1px solid var(--fc-border);
  border-radius: 18px;
  background: var(--fc-surface);
  color: var(--fc-text);
  font: inherit;
}

.workspace-select {
  width: auto;
  min-width: 220px;
  margin-top: 0;
}

.workspace-textarea {
  min-height: 210px;
  line-height: 1.7;
  resize: vertical;
}

.workspace-textarea.compact {
  min-height: 160px;
}

.primary-action,
.secondary-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 48px;
  padding: 0 18px;
  border-radius: 999px;
  text-decoration: none;
  font-weight: 800;
}

.primary-action {
  border: none;
  background: linear-gradient(135deg, var(--fc-accent) 0%, var(--fc-accent-dark) 100%);
  box-shadow: var(--fc-accent-shadow);
  color: var(--fc-accent-contrast);
  cursor: pointer;
}

.primary-action:disabled {
  cursor: wait;
  opacity: 0.7;
}

.secondary-action {
  border: 1px solid var(--fc-border);
  color: var(--fc-text);
}

.lead-list {
  display: grid;
  gap: 12px;
  margin-top: 18px;
}

.lead-card {
  display: grid;
  gap: 6px;
  padding: 14px 16px;
  border: 1px solid var(--fc-border);
  border-radius: 18px;
  background: var(--fc-surface);
  color: var(--fc-text);
  text-align: left;
  cursor: pointer;
}

.lead-card span {
  color: var(--fc-text-muted);
  font-size: 0.88rem;
}

.lead-card.active {
  border-color: var(--fc-accent);
  box-shadow: 0 0 0 1px rgba(149, 77, 46, 0.18);
}

.lead-context,
.empty-note {
  margin: 18px 0 0;
  color: var(--fc-text-muted);
  line-height: 1.6;
}

@media (max-width: 920px) {
  .workspace-grid {
    grid-template-columns: 1fr;
  }
}
</style>
