<script setup lang="ts">
import type {
  BusinessMembership,
  EmailCampaign,
  EmailCampaignStats,
  EmailList,
  ImportEmailContactsRequest,
} from "../../../packages/shared-types";
import { computed, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { useProductAccessContext } from "../access/product-access-context";
import { getActivationDraft } from "../services/activation-flow-service";
import { requestMyBusinesses } from "../services/admin-analytics-service";
import {
  requestEmailCampaignCreate,
  requestEmailCampaignSend,
  requestEmailCampaignStats,
  requestEmailCampaigns,
  requestEmailContactsImport,
  requestEmailDomainCreate,
  requestEmailLists,
} from "../services/email-service";
import { appRoutes } from "../utils/routes";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function plainTextToHtml(value: string): string {
  return value
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replaceAll("\n", "<br />")}</p>`)
    .join("");
}

function buildSuggestedSubject(value: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");

  if (!normalized) {
    return "Quick thought for founders trying to stay consistent";
  }

  return normalized.length <= 68 ? normalized : `${normalized.slice(0, 65).trim()}...`;
}

const route = useRoute();
const {
  bootstrap: productAccess,
  activeBusinessId,
  setActiveBusinessId,
  refreshProductAccess,
  isFeatureEnabled,
} = useProductAccessContext();

const businesses = ref<BusinessMembership[]>([]);
const selectedBusinessId = ref("");
const emailLists = ref<EmailList[]>([]);
const campaigns = ref<EmailCampaign[]>([]);
const latestStats = ref<EmailCampaignStats | null>(null);
const isLoading = ref(true);
const isImporting = ref(false);
const isCreatingCampaign = ref(false);
const isSending = ref(false);
const isSavingDomain = ref(false);
const errorMessage = ref("");
const feedbackMessage = ref("");

const contactImport = ref<ImportEmailContactsRequest>({
  listName: "Launch List",
  csvText: "email,name\nfounder@example.com,Sample Founder",
});

const campaignForm = ref({
  listId: "",
  name: "First Campaign",
  subject: "Quick thought for founders trying to stay consistent",
  bodyHtml:
    "<p>Hi {{first_name}},</p><p>I am sharing one idea that might help you post more consistently without overthinking every draft.</p>",
  replyToEmail: "",
});

const domainForm = ref({
  domainName: "",
  fromName: "",
  fromEmail: "",
  replyToEmail: "",
});

const emailFeatureEnabled = computed(
  () =>
    !selectedBusinessId.value ||
    !productAccess.value?.activeBusinessId ||
    isFeatureEnabled("email_campaigns"),
);
const emailLimitText = computed(() => {
  const limits = productAccess.value?.limits;
  return limits ? `Emails left today: ${limits.emailsRemaining}` : "";
});
const activationSeed = computed(() => {
  const draftId = typeof route.query.draftId === "string" ? route.query.draftId : "";
  const prefillText = typeof route.query.prefill === "string" ? route.query.prefill.trim() : "";

  if (draftId) {
    return getActivationDraft(draftId)?.result.post ?? prefillText;
  }

  return prefillText;
});

function applyActivationSeed(): void {
  if (!activationSeed.value) {
    return;
  }

  campaignForm.value.subject = buildSuggestedSubject(activationSeed.value.split("\n")[0] ?? activationSeed.value);
  campaignForm.value.bodyHtml = plainTextToHtml(activationSeed.value);
}

async function loadBusinesses(): Promise<void> {
  const response = await requestMyBusinesses();
  businesses.value = response.businesses;
  selectedBusinessId.value =
    productAccess.value?.activeBusinessId ||
    activeBusinessId.value ||
    response.businesses[0]?.businessId ||
    "";

  if (!productAccess.value?.activeBusinessId && selectedBusinessId.value) {
    await setActiveBusinessId(selectedBusinessId.value);
  }
}

async function loadEmailState(): Promise<void> {
  if (!selectedBusinessId.value || !emailFeatureEnabled.value) {
    emailLists.value = [];
    campaigns.value = [];
    latestStats.value = null;
    return;
  }

  const [listsResponse, campaignsResponse] = await Promise.all([
    requestEmailLists(selectedBusinessId.value),
    requestEmailCampaigns(selectedBusinessId.value),
  ]);

  emailLists.value = listsResponse.lists;
  campaigns.value = campaignsResponse.campaigns;

  if (!campaignForm.value.listId && emailLists.value[0]) {
    campaignForm.value.listId = emailLists.value[0].id;
  }
}

async function initializePage(): Promise<void> {
  isLoading.value = true;
  errorMessage.value = "";

  try {
    await loadBusinesses();
    await loadEmailState();
    applyActivationSeed();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Unable to load email.";
  } finally {
    isLoading.value = false;
  }
}

async function importContacts(): Promise<void> {
  if (!selectedBusinessId.value) {
    errorMessage.value = "Select a workspace before importing contacts.";
    return;
  }

  isImporting.value = true;
  errorMessage.value = "";

  try {
    const response = await requestEmailContactsImport(selectedBusinessId.value, contactImport.value);
    feedbackMessage.value = `Imported ${response.importedCount} contacts into ${response.list.name}.`;
    await loadEmailState();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Unable to import contacts.";
  } finally {
    isImporting.value = false;
  }
}

async function createCampaign(): Promise<void> {
  if (!selectedBusinessId.value || !campaignForm.value.listId) {
    errorMessage.value = "Import contacts first so a list exists for this campaign.";
    return;
  }

  isCreatingCampaign.value = true;
  errorMessage.value = "";

  try {
    const response = await requestEmailCampaignCreate(selectedBusinessId.value, {
      listId: campaignForm.value.listId,
      name: campaignForm.value.name,
      subject: campaignForm.value.subject,
      bodyHtml: campaignForm.value.bodyHtml,
      replyToEmail: campaignForm.value.replyToEmail || undefined,
    });
    feedbackMessage.value = `Campaign created: ${response.campaign.name}.`;
    await loadEmailState();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Unable to create campaign.";
  } finally {
    isCreatingCampaign.value = false;
  }
}

async function sendCampaign(campaignId: string): Promise<void> {
  if (!selectedBusinessId.value) {
    return;
  }

  isSending.value = true;
  errorMessage.value = "";

  try {
    const response = await requestEmailCampaignSend(selectedBusinessId.value, campaignId);
    latestStats.value = response.stats;
    feedbackMessage.value = `Sent successfully to ${response.stats.sentCount} recipients. ${response.stats.unsubscribedCount} contacts are suppressed globally.`;
    await Promise.all([
      loadEmailState(),
      refreshProductAccess(selectedBusinessId.value),
      requestEmailCampaignStats(selectedBusinessId.value, campaignId).then((statsResponse) => {
        latestStats.value = statsResponse.stats;
      }),
    ]);
  } catch (error) {
    errorMessage.value =
      error instanceof Error
        ? error.message
        : "Something failed sending your email. Try again or contact support.";
  } finally {
    isSending.value = false;
  }
}

async function saveDomainUpgrade(): Promise<void> {
  if (!selectedBusinessId.value || !domainForm.value.domainName.trim()) {
    errorMessage.value = "Add a domain name before saving the brand sender setup.";
    return;
  }

  isSavingDomain.value = true;
  errorMessage.value = "";

  try {
    const response = await requestEmailDomainCreate(selectedBusinessId.value, domainForm.value);
    feedbackMessage.value = `Domain setup saved for ${response.settings.domainName}.`;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Unable to save domain settings.";
  } finally {
    isSavingDomain.value = false;
  }
}

watch(() => productAccess.value?.activeBusinessId || activeBusinessId.value, (nextBusinessId, previousBusinessId) => {
  if (!nextBusinessId || nextBusinessId === previousBusinessId) {
    return;
  }

  selectedBusinessId.value = nextBusinessId;

  void (async () => {
    await loadBusinesses();
    await loadEmailState();
  })();
});

watch(
  () => route.query.draftId,
  () => {
    applyActivationSeed();
  },
);

onMounted(() => {
  void initializePage();
});
</script>

<template>
  <main class="workspace-shell">
    <section class="workspace-hero">
      <p class="workspace-eyebrow">/app/email</p>
      <h1>Turn the post into a simple email campaign.</h1>
      <p class="workspace-description">
        Import contacts, create one plain campaign, and send it with the platform sender before
        worrying about brand-domain setup.
      </p>
      <div class="workspace-chip-row">
        <span v-if="emailLimitText" class="workspace-chip">{{ emailLimitText }}</span>
        <span class="workspace-chip">Platform sender first</span>
        <span class="workspace-chip">Reply-To supported</span>
      </div>
    </section>

    <p v-if="errorMessage" class="workspace-feedback error">{{ errorMessage }}</p>
    <p v-else-if="feedbackMessage" class="workspace-feedback">{{ feedbackMessage }}</p>

    <section v-if="isLoading" class="workspace-card">
      <p class="workspace-description">Loading email workspace...</p>
    </section>

    <template v-else>
      <section v-if="!selectedBusinessId" class="workspace-card empty-state">
        <h2>Email needs a workspace.</h2>
        <p>Create or select a workspace first, then send the first campaign from there.</p>
        <router-link class="primary-action" :to="appRoutes.onboarding">Set up workspace</router-link>
      </section>

      <section v-else-if="!emailFeatureEnabled" class="workspace-card empty-state">
        <h2>Email is not enabled for this workspace.</h2>
        <p>You can still generate content now, then enable email later when access is ready.</p>
      </section>

      <div v-else class="workspace-grid">
        <article class="workspace-card">
          <div class="panel-header">
            <div>
              <p class="panel-meta">Contacts</p>
              <h2>Import a small list</h2>
              <p class="panel-note">
                {{ businesses.find((membership) => membership.businessId === selectedBusinessId)?.business.name || "No workspace selected" }}
              </p>
            </div>
          </div>

          <input v-model="contactImport.listName" class="workspace-input" placeholder="List name" />
          <textarea v-model="contactImport.csvText" class="workspace-textarea compact" />

          <div class="workspace-actions">
            <button type="button" class="primary-action" :disabled="isImporting" @click="importContacts">
              {{ isImporting ? "Importing..." : "Import contacts" }}
            </button>
          </div>

          <ul v-if="emailLists.length > 0" class="list-summary">
            <li v-for="list in emailLists" :key="list.id">
              {{ list.name }} · {{ list.contactCount }} contacts
            </li>
          </ul>
          <div v-else class="empty-note">No lists yet. Import a CSV and the first list is created automatically.</div>
        </article>

        <article class="workspace-card">
          <div class="panel-header">
            <div>
              <p class="panel-meta">Campaign</p>
              <h2>Send the first version fast</h2>
            </div>
          </div>

          <select v-model="campaignForm.listId" class="workspace-select full-width">
            <option value="" disabled>Select list</option>
            <option v-for="list in emailLists" :key="list.id" :value="list.id">
              {{ list.name }}
            </option>
          </select>
          <input v-model="campaignForm.name" class="workspace-input" placeholder="Campaign name" />
          <input v-model="campaignForm.subject" class="workspace-input" placeholder="Subject line" />
          <input
            v-model="campaignForm.replyToEmail"
            class="workspace-input"
            placeholder="Reply-to email (optional)"
          />
          <textarea
            v-model="campaignForm.bodyHtml"
            class="workspace-textarea"
            placeholder="Write the campaign body here"
          />

          <div class="workspace-actions">
            <button type="button" class="primary-action" :disabled="isCreatingCampaign" @click="createCampaign">
              {{ isCreatingCampaign ? "Creating..." : "Create campaign" }}
            </button>
            <router-link class="secondary-action" :to="appRoutes.appGenerate">
              Generate another post
            </router-link>
          </div>

          <div class="campaign-list">
            <article v-for="campaign in campaigns" :key="campaign.id" class="campaign-card">
              <div>
                <strong>{{ campaign.name }}</strong>
                <p>{{ campaign.subject }}</p>
                <p class="campaign-metrics">
                  {{ campaign.sentCount }} sent · {{ campaign.deliveredCount }} delivered ·
                  {{ campaign.unsubscribedCount }} unsubscribed
                </p>
              </div>
              <button type="button" class="secondary-action" :disabled="isSending" @click="sendCampaign(campaign.id)">
                {{ isSending ? "Sending..." : "Send" }}
              </button>
            </article>
          </div>

          <div v-if="latestStats" class="stats-strip">
            <span>Sent: {{ latestStats.sentCount }}</span>
            <span>Delivered: {{ latestStats.deliveredCount }}</span>
            <span>Failed: {{ latestStats.failedCount }}</span>
            <span>Unsubscribed: {{ latestStats.unsubscribedCount }}</span>
          </div>
        </article>
      </div>

      <section class="workspace-card domain-card">
        <div class="panel-header">
          <div>
            <p class="panel-meta">Upgrade lane</p>
            <h2>Send from your own domain later</h2>
          </div>
        </div>

        <div class="domain-grid">
          <input v-model="domainForm.domainName" class="workspace-input" placeholder="yourbrand.com" />
          <input v-model="domainForm.fromName" class="workspace-input" placeholder="From name" />
          <input v-model="domainForm.fromEmail" class="workspace-input" placeholder="marketing@yourbrand.com" />
          <input v-model="domainForm.replyToEmail" class="workspace-input" placeholder="reply-to email" />
        </div>

        <div class="workspace-actions">
          <button type="button" class="primary-action" :disabled="isSavingDomain" @click="saveDomainUpgrade">
            {{ isSavingDomain ? "Saving..." : "Save domain setup" }}
          </button>
        </div>
      </section>
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
.workspace-actions,
.stats-strip {
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
  grid-template-columns: minmax(0, 0.85fr) minmax(0, 1.15fr);
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

.panel-note {
  margin: 6px 0 0;
  color: rgba(59, 46, 40, 0.72);
}

.workspace-select,
.workspace-input,
.workspace-textarea {
  width: 100%;
  margin-top: 14px;
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

.workspace-select.full-width {
  width: 100%;
  min-width: 0;
  margin-top: 18px;
}

.workspace-textarea {
  min-height: 220px;
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
  background: transparent;
  color: var(--fc-text);
  cursor: pointer;
}

.list-summary,
.campaign-list {
  display: grid;
  gap: 12px;
  margin: 18px 0 0;
  padding: 0;
  list-style: none;
}

.campaign-card {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  border: 1px solid var(--fc-border);
  border-radius: 18px;
  background: var(--fc-surface);
}

.campaign-card p,
.empty-note {
  margin: 4px 0 0;
  color: var(--fc-text-muted);
  line-height: 1.6;
}

.campaign-metrics {
  font-size: 0.88rem;
}

.stats-strip {
  margin-top: 18px;
}

.stats-strip span {
  display: inline-flex;
  align-items: center;
  min-height: 36px;
  padding: 0 12px;
  border-radius: 999px;
  background: var(--fc-surface-subtle);
  border: 1px solid var(--fc-border);
  font-weight: 700;
}

.domain-card {
  margin-top: 20px;
}

.domain-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

@media (max-width: 920px) {
  .workspace-grid,
  .domain-grid {
    grid-template-columns: 1fr;
  }
}
</style>
