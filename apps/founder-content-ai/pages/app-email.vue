<script setup lang="ts">
import type {
  BusinessEmailSettings,
  BusinessMembership,
  EmailContact,
  EmailContactImportDuplicateStrategy,
  EmailContactImportField,
  EmailContactImportJob,
  EmailContactImportMapping,
  EmailContactStatus,
  ImportEmailContactsPreviewResponse,
  EmailCampaign,
  EmailCampaignStats,
  EmailList,
  ImportEmailContactsRequest,
} from "../../../packages/shared-types";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useProductAccessContext } from "../access/product-access-context";
import EmailSkeleton from "../components/skeletons/EmailSkeleton.vue";
import { getActivationDraft } from "../services/activation-flow-service";
import { requestMyBusinesses } from "../services/admin-analytics-service";
import {
  requestEmailCampaignCreate,
  requestEmailCampaignSend,
  requestEmailCampaignStats,
  requestEmailCampaigns,
  requestEmailContactImportJobs,
  requestEmailContacts,
  requestEmailContactsImportJobCreate,
  requestEmailContactsImportPreview,
  requestEmailDomainCreate,
  requestEmailDomainSettings,
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
const router = useRouter();
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
const emailContacts = ref<EmailContact[]>([]);
const emailContactsTotal = ref(0);
const contactImportJobs = ref<EmailContactImportJob[]>([]);
const campaigns = ref<EmailCampaign[]>([]);
const latestStats = ref<EmailCampaignStats | null>(null);
const domainSettings = ref<BusinessEmailSettings | null>(null);
const isLoading = ref(true);
const isImporting = ref(false);
const isCreatingCampaign = ref(false);
const isSending = ref(false);
const isSavingDomain = ref(false);
const isEditingDomainSetup = ref(false);
const errorMessage = ref("");
const feedbackMessage = ref("");
const latestStatsCampaignId = ref("");
let campaignProgressPollHandle: number | null = null;
let importJobPollHandle: number | null = null;

type EmailTabKey = "overview" | "campaigns" | "contacts" | "settings";

const EMAIL_TABS: Array<{ key: EmailTabKey; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "campaigns", label: "Campaigns" },
  { key: "contacts", label: "Contacts" },
  { key: "settings", label: "Settings" },
];
const CONTACT_IMPORT_FIELDS: Array<{
  field: EmailContactImportField;
  label: string;
  required: boolean;
}> = [
  { field: "email", label: "Email", required: true },
  { field: "name", label: "Full name", required: false },
  { field: "firstName", label: "First name", required: false },
  { field: "lastName", label: "Last name", required: false },
  { field: "tags", label: "Tags", required: false },
];

const contactImport = ref<ImportEmailContactsRequest>({
  listName: "Launch List",
  csvText: "",
});
const contactImportPreview = ref<ImportEmailContactsPreviewResponse | null>(null);
const contactImportMapping = ref<EmailContactImportMapping>({});
const contactImportDuplicateStrategy = ref<EmailContactImportDuplicateStrategy>("upsert");
const contactImportFileName = ref("");
const isPreviewingContacts = ref(false);
const contactSearch = ref("");
const contactStatusFilter = ref<EmailContactStatus | "all">("all");
const latestImportJobId = ref("");

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
const hasConfiguredDomain = computed(() => Boolean(domainSettings.value?.domainName));
const domainStatusSummary = computed(() => {
  const settings = domainSettings.value;

  if (!settings?.domainName) {
    return "Not configured";
  }

  if (settings.domainStatus === "verified" && settings.dkimStatus === "verified" && settings.spfStatus === "verified") {
    return "Ready to send";
  }

  return "Verification in progress";
});
const activeEmailTab = computed<EmailTabKey>(() => {
  const requestedTab = typeof route.query.tab === "string" ? route.query.tab : "";

  if (EMAIL_TABS.some((tab) => tab.key === requestedTab)) {
    return requestedTab as EmailTabKey;
  }

  if (activationSeed.value) {
    return "campaigns";
  }

  return "overview";
});
const overviewStats = computed(() => {
  const totals = campaigns.value.reduce(
    (accumulator, campaign) => ({
      campaigns: accumulator.campaigns + 1,
      recipients: accumulator.recipients + campaign.recipientCount,
      sent: accumulator.sent + campaign.sentCount,
      delivered: accumulator.delivered + campaign.deliveredCount,
      failed: accumulator.failed + campaign.failedCount,
    }),
    {
      campaigns: 0,
      recipients: 0,
      sent: 0,
      delivered: 0,
      failed: 0,
    },
  );

  return [
    { label: "Lists", value: String(emailLists.value.length), tone: "default" as const },
    { label: "Campaigns", value: String(totals.campaigns), tone: "default" as const },
    { label: "Sent", value: String(totals.sent), tone: totals.sent > 0 ? "success" as const : "default" as const },
    { label: "Delivered", value: String(totals.delivered), tone: totals.delivered > 0 ? "success" as const : "default" as const },
    { label: "Failed", value: String(totals.failed), tone: totals.failed > 0 ? "warning" as const : "default" as const },
  ];
});
const recentCampaigns = computed(() => campaigns.value.slice(0, 4));
const contactImportColumns = computed(() => contactImportPreview.value?.columns ?? []);
const canPreviewContacts = computed(() => contactImport.value.csvText.trim().length > 0);
const canImportContacts = computed(
  () =>
    Boolean(selectedBusinessId.value) &&
    contactImport.value.listName.trim().length > 0 &&
    contactImport.value.csvText.trim().length > 0 &&
    Boolean(contactImportMapping.value.email || contactImportPreview.value?.suggestedMapping.email),
);
const filteredContacts = computed(() => {
  const searchValue = contactSearch.value.trim().toLowerCase();

  return emailContacts.value.filter((contact) => {
    if (contactStatusFilter.value !== "all" && contact.status !== contactStatusFilter.value) {
      return false;
    }

    if (!searchValue) {
      return true;
    }

    const fullName = [contact.firstName, contact.lastName].filter(Boolean).join(" ").toLowerCase();
    return (
      contact.email.toLowerCase().includes(searchValue) ||
      fullName.includes(searchValue) ||
      contact.tags.some((tag) => tag.toLowerCase().includes(searchValue))
    );
  });
});
const activeImportJob = computed(() => {
  if (latestImportJobId.value) {
    const matchingJob = contactImportJobs.value.find((job) => job.id === latestImportJobId.value);

    if (matchingJob) {
      return matchingJob;
    }
  }

  return (
    contactImportJobs.value.find((job) => job.status === "queued" || job.status === "processing") ||
    contactImportJobs.value[0] ||
    null
  );
});
const hasProcessingImportJobs = computed(() =>
  contactImportJobs.value.some((job) => job.status === "queued" || job.status === "processing"),
);
const contactCoverageSummary = computed(() => {
  return emailContacts.value.reduce(
    (summary, contact) => {
      summary.total += 1;

      if (contact.status === "active") {
        summary.active += 1;
      } else if (contact.status === "unsubscribed") {
        summary.unsubscribed += 1;
      } else {
        summary.suppressed += 1;
      }

      return summary;
    },
    {
      total: 0,
      active: 0,
      unsubscribed: 0,
      suppressed: 0,
    },
  );
});
const hasProcessingCampaigns = computed(() =>
  campaigns.value.some((campaign) => campaign.status === "queued" || campaign.status === "sending"),
);
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

function formatStatus(value?: string): string {
  return (value ?? "pending")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatImportProgress(job: EmailContactImportJob): string {
  return `${job.processedRows} / ${job.totalRows} rows processed`;
}

function getImportProgressPercent(job: EmailContactImportJob): number {
  if (job.totalRows <= 0) {
    return 0;
  }

  return Math.min(100, Math.round((job.processedRows / job.totalRows) * 100));
}

function getProcessedRecipientCount(campaign: EmailCampaign): number {
  return campaign.sentCount + campaign.failedCount + campaign.unsubscribedCount;
}

function getCampaignProgressPercent(campaign: EmailCampaign): number {
  if (campaign.recipientCount <= 0) {
    return 0;
  }

  const processedCount = getProcessedRecipientCount(campaign);
  return Math.min(100, Math.round((processedCount / campaign.recipientCount) * 100));
}

function formatCampaignProgress(campaign: EmailCampaign): string {
  if (campaign.recipientCount <= 0) {
    return "No recipients";
  }

  return `${getProcessedRecipientCount(campaign)} / ${campaign.recipientCount} processed`;
}

function getCampaignActionLabel(campaign: EmailCampaign): string {
  if (campaign.status === "queued") {
    return "Queued";
  }

  if (campaign.status === "sending") {
    return "Sending...";
  }

  if (campaign.status === "sent") {
    return "Sent";
  }

  if (campaign.status === "failed") {
    return "Retry";
  }

  return isSending.value ? "Starting..." : "Send";
}

function stopCampaignProgressPolling(): void {
  if (campaignProgressPollHandle === null || typeof window === "undefined") {
    return;
  }

  window.clearInterval(campaignProgressPollHandle);
  campaignProgressPollHandle = null;
}

function stopImportJobPolling(): void {
  if (importJobPollHandle === null || typeof window === "undefined") {
    return;
  }

  window.clearInterval(importJobPollHandle);
  importJobPollHandle = null;
}

async function refreshCampaignProgress(): Promise<void> {
  if (!selectedBusinessId.value || !emailFeatureEnabled.value) {
    stopCampaignProgressPolling();
    return;
  }

  await loadEmailState();

  if (!latestStatsCampaignId.value) {
    return;
  }

  try {
    const statsResponse = await requestEmailCampaignStats(selectedBusinessId.value, latestStatsCampaignId.value);
    latestStats.value = statsResponse.stats;
  } catch {
    // Keep the last known stats visible; the list itself still refreshes.
  }
}

async function refreshImportJobProgress(): Promise<void> {
  if (!selectedBusinessId.value || !emailFeatureEnabled.value) {
    stopImportJobPolling();
    return;
  }

  await loadEmailState();
}

function startCampaignProgressPolling(): void {
  stopCampaignProgressPolling();

  if (!hasProcessingCampaigns.value || typeof window === "undefined") {
    return;
  }

  campaignProgressPollHandle = window.setInterval(() => {
    if (isLoading.value || isSending.value) {
      return;
    }

    void refreshCampaignProgress();
  }, 5000);
}

function startImportJobPolling(): void {
  stopImportJobPolling();

  if (!hasProcessingImportJobs.value || typeof window === "undefined") {
    return;
  }

  importJobPollHandle = window.setInterval(() => {
    if (isLoading.value || isImporting.value) {
      return;
    }

    void refreshImportJobProgress();
  }, 5000);
}

function applyDomainSettings(
  settings: BusinessEmailSettings | null,
  options: { syncForm?: boolean } = {},
): void {
  domainSettings.value = settings;

  if (!options.syncForm) {
    return;
  }

  domainForm.value = {
    domainName: settings?.domainName ?? "",
    fromName: settings?.fromName ?? "",
    fromEmail: settings?.fromEmail ?? "",
    replyToEmail: settings?.replyToEmail ?? "",
  };
}

function setEmailTab(tab: EmailTabKey): void {
  const nextQuery = {
    ...route.query,
    tab: tab === "overview" ? undefined : tab,
  };

  void router.replace({ query: nextQuery });
}

function resetContactImportPreview(): void {
  contactImportPreview.value = null;
  contactImportMapping.value = {};
}

function applySuggestedContactImportMapping(preview: ImportEmailContactsPreviewResponse): void {
  const nextMapping: EmailContactImportMapping = {};

  for (const field of preview.fields) {
    if (field.columnName) {
      nextMapping[field.field] = field.columnName;
    }
  }

  contactImportMapping.value = nextMapping;
}

async function handleContactFileSelection(event: Event): Promise<void> {
  const target = event.target as HTMLInputElement | null;
  const file = target?.files?.[0];

  if (!file) {
    return;
  }

  contactImport.value.csvText = await file.text();
  contactImportFileName.value = file.name;
  resetContactImportPreview();

  if (target) {
    target.value = "";
  }
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

async function loadEmailState(options: { syncDomainForm?: boolean } = {}): Promise<void> {
  if (!selectedBusinessId.value || !emailFeatureEnabled.value) {
    stopCampaignProgressPolling();
    stopImportJobPolling();
    emailLists.value = [];
    emailContacts.value = [];
    emailContactsTotal.value = 0;
    contactImportJobs.value = [];
    campaigns.value = [];
    latestStats.value = null;
    applyDomainSettings(null, { syncForm: options.syncDomainForm });
    return;
  }

  const [listsResponse, campaignsResponse, domainResponse, contactsResponse, importJobsResponse] = await Promise.all([
    requestEmailLists(selectedBusinessId.value),
    requestEmailCampaigns(selectedBusinessId.value),
    requestEmailDomainSettings(selectedBusinessId.value),
    requestEmailContacts(selectedBusinessId.value, { limit: 200 }),
    requestEmailContactImportJobs(selectedBusinessId.value),
  ]);

  emailLists.value = listsResponse.lists;
  emailContacts.value = contactsResponse.contacts;
  emailContactsTotal.value = contactsResponse.total;
  contactImportJobs.value = importJobsResponse.importJobs;
  campaigns.value = campaignsResponse.campaigns;
  applyDomainSettings(domainResponse.settings, { syncForm: options.syncDomainForm });

  if (latestStatsCampaignId.value) {
    const matchingCampaign = campaigns.value.find((campaign) => campaign.id === latestStatsCampaignId.value);

    if (!matchingCampaign) {
      latestStatsCampaignId.value = "";
      latestStats.value = null;
    } else {
      latestStats.value = {
        campaignId: matchingCampaign.id,
        recipientCount: matchingCampaign.recipientCount,
        pendingCount: matchingCampaign.pendingCount,
        sentCount: matchingCampaign.sentCount,
        deliveredCount: matchingCampaign.deliveredCount,
        failedCount: matchingCampaign.failedCount,
        unsubscribedCount: matchingCampaign.unsubscribedCount,
      };
    }
  }

  startCampaignProgressPolling();
  startImportJobPolling();

  if (!campaignForm.value.listId && emailLists.value[0]) {
    campaignForm.value.listId = emailLists.value[0].id;
  }
}

async function initializePage(): Promise<void> {
  isLoading.value = true;
  errorMessage.value = "";

  try {
    await loadBusinesses();
    await loadEmailState({ syncDomainForm: true });
    applyActivationSeed();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Unable to load email.";
  } finally {
    isLoading.value = false;
  }
}

async function previewContactsImport(): Promise<void> {
  if (!selectedBusinessId.value) {
    errorMessage.value = "Select a workspace before previewing contacts.";
    return;
  }

  if (!contactImport.value.csvText.trim()) {
    errorMessage.value = "Paste or upload a CSV before previewing contacts.";
    return;
  }

  isPreviewingContacts.value = true;
  errorMessage.value = "";

  try {
    const response = await requestEmailContactsImportPreview(selectedBusinessId.value, {
      csvText: contactImport.value.csvText,
      mapping: Object.keys(contactImportMapping.value).length > 0 ? contactImportMapping.value : undefined,
    });
    contactImportPreview.value = response;

    if (Object.keys(contactImportMapping.value).length === 0) {
      applySuggestedContactImportMapping(response);
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Unable to preview contacts.";
  } finally {
    isPreviewingContacts.value = false;
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
    const response = await requestEmailContactsImportJobCreate(selectedBusinessId.value, {
      ...contactImport.value,
      fileName: contactImportFileName.value || undefined,
      mapping: Object.keys(contactImportMapping.value).length > 0 ? contactImportMapping.value : undefined,
      duplicateStrategy: contactImportDuplicateStrategy.value,
    });
    latestImportJobId.value = response.importJob.id;
    feedbackMessage.value = `Import queued for ${response.importJob.listName}. ${response.importJob.totalRows} rows are being processed in the background.`;
    contactImport.value.csvText = "";
    contactImportFileName.value = "";
    resetContactImportPreview();
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
    latestStatsCampaignId.value = campaignId;
    latestStats.value = response.stats;
    feedbackMessage.value = `Campaign queued. Processing ${response.stats.recipientCount} recipients in the background.`;
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
    applyDomainSettings(response.settings, { syncForm: true });
    isEditingDomainSetup.value = false;
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
  contactImportFileName.value = "";
  resetContactImportPreview();

  void (async () => {
    await loadBusinesses();
    await loadEmailState({ syncDomainForm: true });
  })();
});

watch(
  () => route.query.draftId,
  () => {
    applyActivationSeed();
  },
);

watch(
  () => contactImport.value.csvText,
  (nextValue, previousValue) => {
    if (nextValue === previousValue) {
      return;
    }

    resetContactImportPreview();
  },
);

onMounted(() => {
  void initializePage();
});

onBeforeUnmount(() => {
  stopCampaignProgressPolling();
  stopImportJobPolling();
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

    <EmailSkeleton v-if="isLoading" />

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

      <section v-else class="email-workspace-stack">
        <section class="workspace-card email-tabs-card">
          <div class="email-tabs-header">
            <div>
              <p class="panel-meta">Email workspace</p>
              <h2>Run campaigns without mixing contacts, sending, and settings.</h2>
            </div>

            <div class="workspace-actions">
              <button type="button" class="secondary-action" @click="setEmailTab('contacts')">
                Import contacts
              </button>
              <button type="button" class="primary-action" @click="setEmailTab('campaigns')">
                New campaign
              </button>
            </div>
          </div>

          <div class="email-tab-row" role="tablist" aria-label="Email sections">
            <button
              v-for="tab in EMAIL_TABS"
              :key="tab.key"
              type="button"
              class="email-tab-button"
              :class="{ active: activeEmailTab === tab.key }"
              :aria-selected="activeEmailTab === tab.key"
              @click="setEmailTab(tab.key)"
            >
              {{ tab.label }}
            </button>
          </div>
        </section>

        <section v-if="activeEmailTab === 'overview'" class="email-overview-stack">
          <section class="email-overview-grid">
            <article
              v-for="card in overviewStats"
              :key="card.label"
              class="workspace-card email-stat-card"
              :data-tone="card.tone"
            >
              <span>{{ card.label }}</span>
              <strong>{{ card.value }}</strong>
            </article>
          </section>

          <section class="workspace-grid overview-grid">
            <article class="workspace-card">
              <div class="panel-header">
                <div>
                  <p class="panel-meta">Recent campaigns</p>
                  <h2>What is already moving</h2>
                </div>
              </div>

              <div v-if="recentCampaigns.length > 0" class="campaign-list">
                <article v-for="campaign in recentCampaigns" :key="campaign.id" class="campaign-card">
                  <div>
                    <strong>{{ campaign.name }}</strong>
                    <p>{{ campaign.subject }}</p>
                    <p class="campaign-metrics">
                      {{ formatStatus(campaign.status) }} · {{ campaign.sentCount }} sent · {{ campaign.deliveredCount }} delivered
                    </p>
                  </div>
                  <button type="button" class="secondary-action" @click="setEmailTab('campaigns')">
                    View
                  </button>
                </article>
              </div>
              <p v-else class="empty-note">
                No campaigns yet. Import contacts, then create the first send from the campaigns tab.
              </p>
            </article>

            <article class="workspace-card">
              <div class="panel-header">
                <div>
                  <p class="panel-meta">Quick actions</p>
                  <h2>Move the workflow forward</h2>
                </div>
              </div>

              <div class="overview-action-stack">
                <button type="button" class="primary-action" @click="setEmailTab('campaigns')">
                  Create campaign
                </button>
                <button type="button" class="secondary-action" @click="setEmailTab('contacts')">
                  Import contacts
                </button>
                <button type="button" class="secondary-action" @click="setEmailTab('settings')">
                  Email settings
                </button>
              </div>

              <div v-if="hasConfiguredDomain" class="overview-domain-status">
                <span class="workspace-chip">{{ domainStatusSummary }}</span>
                <p class="workspace-description compact">
                  {{ domainSettings?.fromName || "Your brand" }} is configured to send from
                  {{ domainSettings?.fromEmail || domainSettings?.domainName }}.
                </p>
              </div>
            </article>
          </section>
        </section>

        <section v-else-if="activeEmailTab === 'campaigns'" class="workspace-card">
          <div class="panel-header">
            <div>
              <p class="panel-meta">Campaigns</p>
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
                  {{ formatStatus(campaign.status) }} · {{ formatCampaignProgress(campaign) }} · {{ campaign.deliveredCount }} delivered ·
                  {{ campaign.failedCount }} failed
                </p>
                <div v-if="campaign.recipientCount > 0" class="campaign-progress">
                  <span class="campaign-progress-fill" :style="{ width: `${getCampaignProgressPercent(campaign)}%` }"></span>
                </div>
                <p v-if="campaign.recipientCount > 0" class="campaign-progress-copy">
                  {{ getCampaignProgressPercent(campaign) }}% complete
                </p>
              </div>
              <button
                type="button"
                class="secondary-action"
                :disabled="isSending || campaign.status === 'queued' || campaign.status === 'sending' || campaign.status === 'sent'"
                @click="sendCampaign(campaign.id)"
              >
                {{ getCampaignActionLabel(campaign) }}
              </button>
            </article>
          </div>

          <div v-if="latestStats" class="stats-strip">
            <span>Sent: {{ latestStats.sentCount }}</span>
            <span>Delivered: {{ latestStats.deliveredCount }}</span>
            <span>Failed: {{ latestStats.failedCount }}</span>
            <span>Unsubscribed: {{ latestStats.unsubscribedCount }}</span>
          </div>
        </section>

        <section v-else-if="activeEmailTab === 'contacts'" class="workspace-card">
          <div class="panel-header">
            <div>
              <p class="panel-meta">Contacts</p>
              <h2>Import and manage your launch audience</h2>
              <p class="panel-note">
                {{ businesses.find((membership) => membership.businessId === selectedBusinessId)?.business.name || "No workspace selected" }}
              </p>
            </div>
          </div>

          <div class="contact-import-stack">
            <div class="contact-import-inputs">
              <input v-model="contactImport.listName" class="workspace-input" placeholder="List name" />

              <div class="contact-upload-row">
                <label class="secondary-action contact-upload-button">
                  <input
                    class="contact-upload-input"
                    type="file"
                    accept=".csv,text/csv"
                    @change="handleContactFileSelection"
                  />
                  Upload CSV
                </label>
                <span class="panel-note">
                  {{ contactImportFileName || "Or paste rows below. We will auto-detect columns." }}
                </span>
              </div>

              <textarea
                v-model="contactImport.csvText"
                class="workspace-textarea compact"
                placeholder="email,name&#10;founder@yourbrand.com, Founder"
              />
            </div>

            <div v-if="contactImportPreview" class="contact-preview-panel">
              <div class="contact-preview-summary">
                <article class="workspace-card contact-preview-stat">
                  <span>Total rows</span>
                  <strong>{{ contactImportPreview.summary.totalRows }}</strong>
                </article>
                <article class="workspace-card contact-preview-stat">
                  <span>Valid</span>
                  <strong>{{ contactImportPreview.summary.validRows }}</strong>
                </article>
                <article class="workspace-card contact-preview-stat">
                  <span>Invalid</span>
                  <strong>{{ contactImportPreview.summary.invalidRows }}</strong>
                </article>
                <article class="workspace-card contact-preview-stat">
                  <span>Existing</span>
                  <strong>{{ contactImportPreview.summary.existingContacts }}</strong>
                </article>
              </div>

              <div class="contact-mapping-grid">
                <label
                  v-for="field in CONTACT_IMPORT_FIELDS"
                  :key="field.field"
                  class="contact-mapping-field"
                >
                  <span>{{ field.label }}<small v-if="field.required">Required</small></span>
                  <select v-model="contactImportMapping[field.field]">
                    <option value="">Ignore</option>
                    <option
                      v-for="column in contactImportColumns"
                      :key="`${field.field}-${column}`"
                      :value="column"
                    >
                      {{ column }}
                    </option>
                  </select>
                </label>
              </div>

              <div class="contact-import-mode-row">
                <button
                  type="button"
                  class="workspace-secondary-button compact"
                  :class="{ active: contactImportDuplicateStrategy === 'upsert' }"
                  @click="contactImportDuplicateStrategy = 'upsert'"
                >
                  Update existing
                </button>
                <button
                  type="button"
                  class="workspace-secondary-button compact"
                  :class="{ active: contactImportDuplicateStrategy === 'skip' }"
                  @click="contactImportDuplicateStrategy = 'skip'"
                >
                  Skip duplicates
                </button>
              </div>

              <div class="contact-preview-table">
                <div class="contact-preview-row contact-preview-head">
                  <span>Email</span>
                  <span>Name</span>
                  <span>Tags</span>
                  <span>Issues</span>
                </div>
                <div
                  v-for="(row, index) in contactImportPreview.previewRows"
                  :key="`preview-${index}`"
                  class="contact-preview-row"
                >
                  <span>{{ row.email || "—" }}</span>
                  <span>{{ row.name || [row.firstName, row.lastName].filter(Boolean).join(' ') || "—" }}</span>
                  <span>{{ row.tags.join(", ") || "—" }}</span>
                  <span>{{ row.issues.join(", ") || "Looks good" }}</span>
                </div>
              </div>
            </div>
          </div>

          <div class="workspace-actions">
            <button
              type="button"
              class="secondary-action"
              :disabled="isPreviewingContacts || !canPreviewContacts"
              @click="previewContactsImport"
            >
              {{ isPreviewingContacts ? "Previewing..." : contactImportPreview ? "Refresh preview" : "Preview import" }}
            </button>
            <button type="button" class="primary-action" :disabled="isImporting || !canImportContacts" @click="importContacts">
              {{ isImporting ? "Importing..." : "Import contacts" }}
            </button>
          </div>

          <article v-if="activeImportJob" class="workspace-card contact-job-card">
            <div class="panel-header">
              <div>
                <p class="panel-meta">Latest import</p>
                <h3>{{ activeImportJob.listName }}</h3>
                <p class="panel-note">
                  {{ formatStatus(activeImportJob.status) }}
                  <span v-if="activeImportJob.fileName"> · {{ activeImportJob.fileName }}</span>
                </p>
              </div>
              <span class="workspace-chip">{{ formatImportProgress(activeImportJob) }}</span>
            </div>

            <div class="campaign-progress import-progress">
              <span
                class="campaign-progress-fill"
                :style="{ width: `${getImportProgressPercent(activeImportJob)}%` }"
              ></span>
            </div>

            <div class="stats-strip">
              <span>Inserted: {{ activeImportJob.insertedCount }}</span>
              <span>Updated: {{ activeImportJob.updatedCount }}</span>
              <span>Skipped: {{ activeImportJob.skippedCount }}</span>
              <span>Errors: {{ activeImportJob.errorCount }}</span>
            </div>

            <ul v-if="activeImportJob.errorSummary.length > 0" class="import-error-summary">
              <li v-for="(entry, index) in activeImportJob.errorSummary" :key="`${activeImportJob.id}-${index}`">
                {{ entry.message }}<span v-if="entry.rowCount"> · {{ entry.rowCount }} rows</span>
              </li>
            </ul>
          </article>

          <ul v-if="emailLists.length > 0" class="list-summary">
            <li v-for="list in emailLists" :key="list.id">
              {{ list.name }} · {{ list.contactCount }} contacts
            </li>
          </ul>
          <div v-else class="empty-note">No lists yet. Import a CSV and the first list is created automatically.</div>

          <section class="contact-directory">
            <div class="panel-header">
              <div>
                <p class="panel-meta">Contact directory</p>
                <h3>{{ emailContactsTotal }} contacts in this workspace</h3>
                <p class="panel-note">
                  Active {{ contactCoverageSummary.active }} · Unsubscribed {{ contactCoverageSummary.unsubscribed }} ·
                  Suppressed {{ contactCoverageSummary.suppressed }}
                </p>
              </div>
            </div>

            <div class="contact-directory-toolbar">
              <input
                v-model="contactSearch"
                class="workspace-input toolbar-input"
                placeholder="Search contacts"
              />
              <select v-model="contactStatusFilter" class="workspace-select toolbar-select">
                <option value="all">All statuses</option>
                <option value="active">Active</option>
                <option value="unsubscribed">Unsubscribed</option>
                <option value="bounced">Bounced</option>
                <option value="complained">Complained</option>
                <option value="suppressed">Suppressed</option>
              </select>
            </div>

            <div v-if="filteredContacts.length > 0" class="contact-directory-table">
              <div class="contact-directory-row contact-directory-head">
                <span>Email</span>
                <span>Name</span>
                <span>Status</span>
                <span>Tags</span>
                <span>Updated</span>
              </div>
              <div
                v-for="contact in filteredContacts"
                :key="contact.id"
                class="contact-directory-row"
              >
                <span>{{ contact.email }}</span>
                <span>{{ [contact.firstName, contact.lastName].filter(Boolean).join(" ") || "—" }}</span>
                <span>{{ formatStatus(contact.status) }}</span>
                <span>{{ contact.tags.join(", ") || "—" }}</span>
                <span>{{ contact.updatedAt ? new Date(contact.updatedAt).toLocaleDateString() : "—" }}</span>
              </div>
            </div>
            <p v-else class="empty-note">
              {{ emailContacts.length > 0 ? "No contacts match the current filter." : "No contacts yet. Queue an import to populate this workspace." }}
            </p>
          </section>
        </section>

        <section v-else class="workspace-card domain-card">
          <div class="panel-header">
            <div>
              <p class="panel-meta">Settings</p>
              <h2>{{ hasConfiguredDomain && !isEditingDomainSetup ? "Branded sender connected" : "Email sender setup" }}</h2>
            </div>
          </div>

          <div v-if="hasConfiguredDomain && !isEditingDomainSetup" class="domain-summary-card">
            <div class="workspace-chip-row">
              <span class="workspace-chip">{{ domainStatusSummary }}</span>
              <span class="workspace-chip">Domain: {{ formatStatus(domainSettings?.domainStatus) }}</span>
              <span class="workspace-chip">DKIM: {{ formatStatus(domainSettings?.dkimStatus) }}</span>
              <span class="workspace-chip">SPF: {{ formatStatus(domainSettings?.spfStatus) }}</span>
            </div>

            <div class="domain-summary-grid">
              <div>
                <span class="domain-summary-label">Domain</span>
                <strong>{{ domainSettings?.domainName }}</strong>
              </div>
              <div>
                <span class="domain-summary-label">From name</span>
                <strong>{{ domainSettings?.fromName || "Not set" }}</strong>
              </div>
              <div>
                <span class="domain-summary-label">From email</span>
                <strong>{{ domainSettings?.fromEmail || "Not set" }}</strong>
              </div>
              <div>
                <span class="domain-summary-label">Reply-to</span>
                <strong>{{ domainSettings?.replyToEmail || "Not set" }}</strong>
              </div>
            </div>

            <div class="workspace-actions">
              <button type="button" class="secondary-action" @click="isEditingDomainSetup = true">
                Edit domain setup
              </button>
            </div>
          </div>
          <template v-else>
            <p class="workspace-description compact">
              {{
                hasConfiguredDomain
                  ? "Update the saved sender setup. The current values are already persisted for this workspace."
                  : "Save a sender identity once, then reuse it every time this workspace comes back to email."
              }}
            </p>

            <div class="domain-grid">
              <input v-model="domainForm.domainName" class="workspace-input" placeholder="yourbrand.com" />
              <input v-model="domainForm.fromName" class="workspace-input" placeholder="From name" />
              <input v-model="domainForm.fromEmail" class="workspace-input" placeholder="marketing@yourbrand.com" />
              <input v-model="domainForm.replyToEmail" class="workspace-input" placeholder="reply-to email" />
            </div>

            <div class="workspace-actions">
              <button type="button" class="primary-action" :disabled="isSavingDomain" @click="saveDomainUpgrade">
                {{ isSavingDomain ? "Saving..." : hasConfiguredDomain ? "Update domain setup" : "Save domain setup" }}
              </button>
              <button
                v-if="hasConfiguredDomain"
                type="button"
                class="secondary-action"
                :disabled="isSavingDomain"
                @click="isEditingDomainSetup = false"
              >
                Cancel
              </button>
            </div>
          </template>
        </section>
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

.workspace-description.compact {
  margin-top: 10px;
}

.workspace-grid {
  display: grid;
  gap: 20px;
  grid-template-columns: minmax(0, 0.85fr) minmax(0, 1.15fr);
}

.overview-grid {
  margin-top: 0;
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

.email-workspace-stack {
  display: grid;
  gap: 20px;
}

.email-tabs-card,
.email-overview-stack {
  display: grid;
  gap: 18px;
}

.email-tabs-header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
}

.email-tab-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.email-tab-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 42px;
  padding: 0 16px;
  border-radius: 999px;
  border: 1px solid var(--fc-border);
  background: transparent;
  color: var(--fc-text);
  font: inherit;
  font-weight: 800;
  cursor: pointer;
}

.email-tab-button.active {
  background: linear-gradient(135deg, var(--fc-accent) 0%, var(--fc-accent-dark) 100%);
  border-color: transparent;
  box-shadow: var(--fc-accent-shadow);
  color: var(--fc-accent-contrast);
}

.email-overview-grid {
  display: grid;
  gap: 16px;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
}

.email-stat-card {
  display: grid;
  gap: 8px;
}

.email-stat-card span {
  color: var(--fc-text-muted);
  font-size: 0.86rem;
  font-weight: 700;
}

.email-stat-card strong {
  font-size: 2rem;
  line-height: 1;
}

.email-stat-card[data-tone="success"] {
  border-color: color-mix(in srgb, var(--fc-success-text, #2c6b35) 18%, var(--fc-border));
}

.email-stat-card[data-tone="warning"] {
  border-color: color-mix(in srgb, #b46a00 20%, var(--fc-border));
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

.overview-action-stack {
  display: grid;
  gap: 12px;
}

.overview-domain-status {
  display: grid;
  gap: 8px;
  margin-top: 20px;
}

.contact-import-stack,
.contact-import-inputs,
.contact-preview-panel,
.contact-preview-summary,
.contact-mapping-grid,
.contact-preview-table {
  display: grid;
  gap: 14px;
}

.contact-import-stack {
  grid-template-columns: minmax(0, 0.95fr) minmax(0, 1.05fr);
  margin-top: 16px;
}

.contact-upload-row,
.contact-import-mode-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}

.contact-upload-button {
  position: relative;
  overflow: hidden;
}

.contact-upload-input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

.contact-preview-panel {
  padding: 18px;
  border: 1px solid var(--fc-border);
  border-radius: 22px;
  background: color-mix(in srgb, var(--fc-surface) 92%, white 8%);
}

.contact-preview-summary {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.contact-preview-stat {
  gap: 8px;
  padding: 18px;
  border-radius: 20px;
  box-shadow: none;
}

.contact-preview-stat span {
  color: var(--fc-text-muted);
  font-size: 0.8rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.contact-preview-stat strong {
  font-size: 1.8rem;
  line-height: 1;
}

.contact-mapping-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.contact-mapping-field {
  display: grid;
  gap: 8px;
}

.contact-mapping-field span {
  display: flex;
  gap: 8px;
  align-items: center;
  color: var(--fc-text-muted);
  font-size: 0.84rem;
  font-weight: 700;
}

.contact-mapping-field small {
  color: var(--fc-accent-dark);
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.contact-mapping-field select {
  width: 100%;
  min-width: 0;
  padding: 14px 16px;
  border: 1px solid var(--fc-border);
  border-radius: 16px;
  background: var(--fc-surface);
  color: var(--fc-text);
  font: inherit;
}

.contact-import-mode-row .workspace-secondary-button.active {
  border-color: transparent;
  background: linear-gradient(135deg, var(--fc-accent) 0%, var(--fc-accent-dark) 100%);
  color: var(--fc-accent-contrast);
  box-shadow: var(--fc-accent-shadow);
}

.contact-preview-row {
  display: grid;
  grid-template-columns: minmax(180px, 1.2fr) minmax(140px, 0.9fr) minmax(120px, 0.8fr) minmax(180px, 1.2fr);
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid var(--fc-border);
  border-radius: 16px;
  background: var(--fc-surface);
}

.contact-preview-row span {
  min-width: 0;
  color: var(--fc-text-muted);
  line-height: 1.5;
  word-break: break-word;
}

.contact-preview-head {
  background: transparent;
  border-style: dashed;
}

.contact-preview-head span {
  color: var(--fc-text);
  font-size: 0.8rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.contact-job-card,
.contact-directory {
  display: grid;
  gap: 16px;
  margin-top: 18px;
}

.import-progress {
  width: 100%;
  margin-top: 0;
}

.import-error-summary {
  display: grid;
  gap: 10px;
  margin: 0;
  padding-left: 18px;
  color: var(--fc-text-muted);
  line-height: 1.6;
}

.contact-directory-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.toolbar-input {
  flex: 1 1 280px;
  margin-top: 0;
}

.toolbar-select {
  margin-top: 0;
}

.contact-directory-table {
  display: grid;
  gap: 10px;
}

.contact-directory-row {
  display: grid;
  grid-template-columns: minmax(180px, 1.4fr) minmax(140px, 1fr) minmax(120px, 0.8fr) minmax(120px, 0.9fr) minmax(110px, 0.7fr);
  gap: 12px;
  padding: 14px 16px;
  border: 1px solid var(--fc-border);
  border-radius: 16px;
  background: var(--fc-surface);
}

.contact-directory-row span {
  min-width: 0;
  color: var(--fc-text-muted);
  line-height: 1.5;
  word-break: break-word;
}

.contact-directory-head {
  background: transparent;
  border-style: dashed;
}

.contact-directory-head span {
  color: var(--fc-text);
  font-size: 0.8rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.08em;
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

.campaign-progress {
  position: relative;
  width: min(320px, 100%);
  height: 8px;
  margin-top: 10px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--fc-surface-subtle);
  border: 1px solid var(--fc-border);
}

.campaign-progress-fill {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--fc-accent-strong), var(--fc-accent-soft));
}

.campaign-progress-copy {
  font-size: 0.8rem;
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

.domain-summary-card {
  display: grid;
  gap: 16px;
}

.domain-summary-grid {
  display: grid;
  gap: 14px;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
}

.domain-summary-label {
  display: block;
  margin-bottom: 6px;
  color: var(--fc-text-muted);
  font-size: 0.82rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.domain-summary-grid strong {
  display: block;
  line-height: 1.45;
  word-break: break-word;
}

.domain-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

@media (max-width: 920px) {
  .workspace-grid,
  .domain-grid,
  .contact-import-stack {
    grid-template-columns: 1fr;
  }

  .email-tabs-header {
    align-items: stretch;
  }

  .contact-preview-summary,
  .contact-mapping-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .contact-preview-row,
  .contact-directory-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .contact-preview-summary,
  .contact-mapping-grid,
  .contact-preview-row,
  .contact-directory-row {
    grid-template-columns: 1fr;
  }
}
</style>
