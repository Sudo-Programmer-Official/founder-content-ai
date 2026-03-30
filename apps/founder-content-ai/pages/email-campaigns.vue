<script setup lang="ts">
import type {
  BusinessEmailSettings,
  BusinessMembership,
  EmailCampaign,
  EmailList,
  ImportEmailContactsRequest,
} from "../../../packages/shared-types";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useProductAccessContext } from "../access/product-access-context";
import {
  requestEmailCampaignCreate,
  requestEmailCampaignSend,
  requestEmailCampaigns,
  requestEmailContactsImport,
  requestEmailDomainCreate,
  requestEmailDomainSettings,
  requestEmailDomainVerify,
  requestEmailLists,
} from "../services/email-service";
import { requestMyBusinesses } from "../services/admin-analytics-service";

const { bootstrap: productAccess, refreshProductAccess, setActiveBusinessId, isFeatureEnabled } =
  useProductAccessContext();

const businesses = ref<BusinessMembership[]>([]);
const selectedBusinessId = ref("");
const emailLists = ref<EmailList[]>([]);
const campaigns = ref<EmailCampaign[]>([]);
const domainSettings = ref<BusinessEmailSettings | null>(null);
const isLoading = ref(true);
const isImporting = ref(false);
const isCreatingCampaign = ref(false);
const isSending = ref(false);
const isSavingDomain = ref(false);
const errorMessage = ref("");
const feedbackMessage = ref("");
const lastDomainId = ref("");
let domainVerificationPollHandle: number | null = null;

const contactImport = ref<ImportEmailContactsRequest>({
  listName: "Launch List",
  csvText: "",
});

const campaignForm = ref({
  listId: "",
  name: "Launch Campaign",
  subject: "Quick note for founders trying to stay consistent",
  bodyHtml:
    "<p>Hi {{first_name}},</p><p>I built a system that tells founders what to post next and what to fix before publishing.</p><p>If that sounds useful, reply and I will send it over.</p>",
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
    !productAccess.value?.activeBusinessId ||
    isFeatureEnabled("email_campaigns"),
);
const emailLimitText = computed(() => {
  const limits = productAccess.value?.limits;
  return limits ? `Emails left today: ${limits.emailsRemaining}` : "";
});
const domainSetupAnalysis = computed(() => domainSettings.value?.domainSetupAnalysis);
const domainConflictFlags = computed(() => domainSetupAnalysis.value?.conflictFlags ?? []);
const safeToAddInstructions = computed(() => domainSetupAnalysis.value?.safeToAdd ?? []);
const mergeCarefullyInstructions = computed(() => domainSetupAnalysis.value?.mergeCarefully ?? []);
const doNotChangeInstructions = computed(() => domainSetupAnalysis.value?.doNotChange ?? []);
const providerSignals = computed(() => domainSetupAnalysis.value?.providerSignals ?? []);
const existingMxRecords = computed(() => domainSetupAnalysis.value?.existingMxRecords ?? []);
const brandedSendingReady = computed(() => domainSetupAnalysis.value?.brandedSendingReady ?? false);
const deliverability = computed(() => domainSettings.value?.deliverability);
const deliverabilityBlockers = computed(() => deliverability.value?.blockers ?? []);
const deliverabilityTopBlockers = computed(() => deliverabilityBlockers.value.slice(0, 3));
const dkimReady = computed(() => domainSetupAnalysis.value?.dkimReady ?? false);
const spfReady = computed(() => domainSetupAnalysis.value?.spfReady ?? false);
const spfValidationState = computed(() => domainSetupAnalysis.value?.spfValidationState ?? "missing");
const dmarcConfigured = computed(() => domainSetupAnalysis.value?.dmarcConfigured ?? false);
const usesBrandedSender = computed(() => {
  const fromEmail = domainSettings.value?.fromEmail?.trim().toLowerCase();
  const domainName = domainSettings.value?.domainName?.trim().toLowerCase();

  return Boolean(fromEmail && domainName && fromEmail.endsWith(`@${domainName}`));
});
const hasBlockingDnsConflict = computed(() =>
  domainConflictFlags.value.some((flag) => flag.severity === "error"),
);
const spfConflictFlag = computed(() =>
  domainConflictFlags.value.find((flag) =>
    flag.code === "multiple_spf_records" ||
    flag.code === "spf_malformed" ||
    flag.code === "spf_record_missing" ||
    flag.code === "spf_include_missing",
  ),
);
const dkimConflictFlag = computed(() =>
  domainConflictFlags.value.find((flag) =>
    flag.code === "dkim_record_conflict" || flag.code === "dkim_records_incomplete",
  ),
);
const dmarcConflictFlag = computed(() =>
  domainConflictFlags.value.find((flag) => flag.code === "malformed_dmarc"),
);
const hasDetectedEmailInfrastructure = computed(
  () =>
    existingMxRecords.value.length > 0 ||
    Boolean(domainSetupAnalysis.value?.existingSpfValue) ||
    Boolean(domainSetupAnalysis.value?.existingDmarcValue),
);
const domainStatusTone = computed(() => domainSetupAnalysis.value?.state ?? "yellow");
const domainStatusLabel = computed(() => {
  if (brandedSendingReady.value) {
    return "Ready to send";
  }

  if (hasBlockingDnsConflict.value) {
    return "Needs DNS fixes";
  }

  if (dkimReady.value && !spfReady.value) {
    return spfValidationState.value === "malformed" || spfValidationState.value === "multiple_records"
      ? "SPF fix needed"
      : "SPF update needed";
  }

  switch (domainSetupAnalysis.value?.state) {
    case "red":
      return "Needs DNS fixes";
    default:
      return "Waiting on DNS";
  }
});
const domainStatusCopy = computed(() => {
  if (brandedSendingReady.value) {
    return "SES verification is complete, DKIM is passing, and the SPF record is ready for branded sending.";
  }

  if (hasBlockingDnsConflict.value) {
    return "We found a risky DNS conflict. Keep the existing inbox provider untouched and resolve the flagged issue before sending from this domain.";
  }

  if (dkimReady.value && !spfReady.value) {
    return spfValidationState.value === "malformed"
      ? "SES verification is complete, but branded sending stays blocked until the malformed SPF record is fixed."
      : spfValidationState.value === "multiple_records"
        ? "SES verification is complete, but branded sending stays blocked until multiple SPF records are consolidated into one valid record."
        : "SES verification is complete, but branded sending stays blocked until your SPF record authorizes Amazon SES.";
  }

  switch (domainSetupAnalysis.value?.state) {
    case "red":
      return "We found a risky DNS conflict. Keep the existing inbox provider untouched and resolve the flagged issue before sending from this domain.";
    default:
      return "Add the DNS records below, keep MX unchanged, and wait for SES and DNS propagation checks to finish.";
  }
});
const deliverabilityTone = computed(() => {
  switch (deliverability.value?.scoreBand) {
    case "excellent":
      return "green";
    case "at_risk":
      return "red";
    default:
      return "yellow";
  }
});
const deliverabilityLabel = computed(() => {
  switch (deliverability.value?.scoreBand) {
    case "excellent":
      return "Excellent";
    case "at_risk":
      return "At Risk";
    default:
      return "Needs Attention";
  }
});
const deliverabilitySummary = computed(() => {
  if (!deliverability.value) {
    return "";
  }

  if (deliverability.value.scoreBand === "excellent") {
    return "This domain is ready to send. The current deliverability checks and recent feedback signals look healthy.";
  }

  if (deliverability.value.scoreBand === "at_risk") {
    return usesBrandedSender.value
      ? "Branded sending is paused until the blocking DNS or reputation issues below are fixed."
      : "This branded domain has blocking issues. Keep using the platform sender until the domain is healthy again.";
  }

  return "This domain can send, but delivery quality needs attention before you scale volume.";
});
const brandedSendWarning = computed(() => {
  if (!deliverability.value || !domainSettings.value?.domainName) {
    return null;
  }

  const leadingMessage =
    deliverabilityTopBlockers.value[0]?.message ||
    "This branded domain needs attention before you rely on it for sending.";

  if (usesBrandedSender.value && deliverability.value.scoreBand === "at_risk") {
    return {
      tone: "error",
      message: leadingMessage,
    };
  }

  if (usesBrandedSender.value && deliverability.value.scoreBand === "needs_attention") {
    return {
      tone: "warning",
      message: leadingMessage,
    };
  }

  if (!usesBrandedSender.value && deliverability.value.scoreBand === "at_risk") {
    return {
      tone: "warning",
      message: "This branded domain is currently blocked, but campaigns can still use the platform sender until the domain is healthy again.",
    };
  }

  return null;
});
const shouldPollDomainVerification = computed(() => {
  const settings = domainSettings.value;

  return Boolean(
    selectedBusinessId.value &&
      settings?.id &&
      settings.domainName &&
      !brandedSendingReady.value,
  );
});

function formatStatus(value?: string): string {
  return (value ?? "pending")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatPercent(value?: number): string {
  return `${((value ?? 0) * 100).toFixed(2)}%`;
}

function formatTimestamp(value?: string): string {
  if (!value) {
    return "Not checked yet";
  }

  return new Date(value).toLocaleString();
}

function applyDomainSettings(
  settings: BusinessEmailSettings | null,
  options: { syncForm?: boolean } = {},
): void {
  domainSettings.value = settings;
  lastDomainId.value = settings?.id || "";

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

function stopDomainVerificationPolling(): void {
  if (domainVerificationPollHandle === null || typeof window === "undefined") {
    return;
  }

  window.clearInterval(domainVerificationPollHandle);
  domainVerificationPollHandle = null;
}

function startDomainVerificationPolling(): void {
  stopDomainVerificationPolling();

  if (!shouldPollDomainVerification.value || typeof window === "undefined") {
    return;
  }

  domainVerificationPollHandle = window.setInterval(() => {
    if (!selectedBusinessId.value || isSavingDomain.value) {
      return;
    }

    void loadDomainSettings({ silent: true });
  }, 10000);
}

async function loadBusinesses(): Promise<void> {
  const response = await requestMyBusinesses();
  businesses.value = response.businesses;
  selectedBusinessId.value =
    productAccess.value?.activeBusinessId || response.businesses[0]?.businessId || "";
  if (selectedBusinessId.value) {
    setActiveBusinessId(selectedBusinessId.value);
  }
}

async function loadDomainSettings(options: { syncForm?: boolean; silent?: boolean } = {}): Promise<void> {
  if (!selectedBusinessId.value || !emailFeatureEnabled.value) {
    applyDomainSettings(null, { syncForm: options.syncForm });
    return;
  }

  try {
    const response = await requestEmailDomainSettings(selectedBusinessId.value);
    applyDomainSettings(response.settings, { syncForm: options.syncForm });
  } catch (error) {
    if (options.silent) {
      return;
    }

    errorMessage.value =
      error instanceof Error ? error.message : "Unable to load email domain settings.";
  }
}

async function loadEmailState(options: { syncDomainForm?: boolean } = {}): Promise<void> {
  if (!selectedBusinessId.value || !emailFeatureEnabled.value) {
    emailLists.value = [];
    campaigns.value = [];
    applyDomainSettings(null, { syncForm: options.syncDomainForm });
    return;
  }

  const [listsResponse, campaignsResponse, domainResponse] = await Promise.all([
    requestEmailLists(selectedBusinessId.value),
    requestEmailCampaigns(selectedBusinessId.value),
    requestEmailDomainSettings(selectedBusinessId.value),
  ]);
  emailLists.value = listsResponse.lists;
  campaigns.value = campaignsResponse.campaigns;
  applyDomainSettings(domainResponse.settings, { syncForm: options.syncDomainForm });

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
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Unable to load email campaigns.";
  } finally {
    isLoading.value = false;
  }
}

async function importContacts(): Promise<void> {
  if (!selectedBusinessId.value) {
    return;
  }

  isImporting.value = true;
  errorMessage.value = "";

  try {
    const response = await requestEmailContactsImport(selectedBusinessId.value, contactImport.value);
    campaignForm.value.listId = response.list.id;
    feedbackMessage.value = `Imported ${response.importedCount} contacts into ${response.list.name}.`;
    await loadEmailState();
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "Unable to import contacts.";
  } finally {
    isImporting.value = false;
  }
}

async function createCampaign(): Promise<void> {
  if (!selectedBusinessId.value || !campaignForm.value.listId) {
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
    feedbackMessage.value = `Created campaign: ${response.campaign.name}.`;
    await loadEmailState();
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "Unable to create campaign.";
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
    feedbackMessage.value = `Sent ${response.stats.sentCount} emails from ${response.campaign.name}. ${response.stats.unsubscribedCount} contacts are suppressed.`;
    await Promise.all([loadEmailState(), refreshProductAccess(selectedBusinessId.value)]);
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "Unable to send campaign.";
  } finally {
    isSending.value = false;
  }
}

async function saveDomainUpgrade(): Promise<void> {
  if (!selectedBusinessId.value) {
    return;
  }

  isSavingDomain.value = true;
  errorMessage.value = "";

  try {
    const response = await requestEmailDomainCreate(selectedBusinessId.value, domainForm.value);
    applyDomainSettings(response.settings, { syncForm: true });
    feedbackMessage.value = `Saved domain setup for ${response.settings.domainName}.`;
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "Unable to save domain settings.";
  } finally {
    isSavingDomain.value = false;
  }
}

async function verifyDomain(): Promise<void> {
  if (!selectedBusinessId.value || !lastDomainId.value) {
    return;
  }

  isSavingDomain.value = true;
  errorMessage.value = "";

  try {
    const response = await requestEmailDomainVerify(selectedBusinessId.value, lastDomainId.value);
    applyDomainSettings(response.settings);
    feedbackMessage.value = `Domain status: ${formatStatus(response.settings.domainStatus)}.`;
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "Unable to verify domain.";
  } finally {
    isSavingDomain.value = false;
  }
}

watch(selectedBusinessId, (nextBusinessId) => {
  stopDomainVerificationPolling();
  feedbackMessage.value = "";

  if (!nextBusinessId) {
    applyDomainSettings(null, { syncForm: true });
    return;
  }

  setActiveBusinessId(nextBusinessId);

  if (isLoading.value) {
    return;
  }

  void Promise.all([loadEmailState({ syncDomainForm: true }), refreshProductAccess(nextBusinessId)]);
});

watch(shouldPollDomainVerification, (shouldPoll) => {
  if (shouldPoll) {
    startDomainVerificationPolling();
    return;
  }

  stopDomainVerificationPolling();
}, { immediate: true });

onMounted(() => {
  void initializePage();
});

onBeforeUnmount(() => {
  stopDomainVerificationPolling();
});
</script>

<template>
  <main class="dashboard-shell">
    <section class="dashboard-hero">
      <p class="dashboard-eyebrow">/email-campaigns</p>
      <h1>Email Activation</h1>
      <p class="dashboard-description">
        Send a simple campaign with the platform sender first. Brand-domain setup stays optional.
      </p>
      <div class="hero-signal-row">
        <span v-if="emailLimitText" class="signal-chip">{{ emailLimitText }}</span>
        <span class="signal-chip">Reply-To supported</span>
        <span class="signal-chip">Unsubscribe included</span>
      </div>
    </section>

    <p v-if="isLoading" class="dashboard-feedback">Loading email workspace...</p>
    <p v-else-if="errorMessage" class="dashboard-feedback error">{{ errorMessage }}</p>

    <template v-else>
      <section class="dashboard-panel">
        <div class="panel-header">
          <div>
            <p class="panel-meta">Workspace</p>
            <h2>Select workspace</h2>
          </div>
        </div>

        <select v-model="selectedBusinessId" class="dashboard-select">
          <option value="" disabled>Select a workspace</option>
          <option v-for="membership in businesses" :key="membership.businessId" :value="membership.businessId">
            {{ membership.business.name }}
          </option>
        </select>

        <p v-if="feedbackMessage" class="dashboard-feedback">{{ feedbackMessage }}</p>
      </section>

      <section v-if="!emailFeatureEnabled" class="dashboard-panel">
        <h2>Email is not enabled for this workspace</h2>
        <p class="dashboard-description">
          Turn on the <code>email_campaigns</code> feature flag for this workspace, then reload.
        </p>
      </section>

      <template v-else>
        <section class="dashboard-grid-two">
          <article class="dashboard-panel">
            <div class="panel-header">
              <div>
                <p class="panel-meta">Step 1</p>
                <h2>Import Contacts</h2>
              </div>
            </div>

            <label class="field-label" for="email-list-name">List name</label>
            <input id="email-list-name" v-model="contactImport.listName" class="dashboard-input" />

            <label class="field-label" for="contacts-csv">CSV text</label>
            <textarea
              id="contacts-csv"
              v-model="contactImport.csvText"
              class="dashboard-textarea"
              rows="10"
              placeholder="email,name&#10;founder@yourbrand.com, Founder"
            />

            <button class="dashboard-button primary" :disabled="isImporting" @click="importContacts">
              {{ isImporting ? "Importing..." : "Import contacts" }}
            </button>
          </article>

          <article class="dashboard-panel">
            <div class="panel-header">
              <div>
                <p class="panel-meta">Step 2</p>
                <h2>Create Campaign</h2>
              </div>
            </div>

            <label class="field-label" for="campaign-list">Audience list</label>
            <select id="campaign-list" v-model="campaignForm.listId" class="dashboard-select">
              <option value="" disabled>Select a list</option>
              <option v-for="list in emailLists" :key="list.id" :value="list.id">
                {{ list.name }} ({{ list.contactCount }})
              </option>
            </select>

            <label class="field-label" for="campaign-name">Campaign name</label>
            <input id="campaign-name" v-model="campaignForm.name" class="dashboard-input" />

            <label class="field-label" for="campaign-subject">Subject</label>
            <input id="campaign-subject" v-model="campaignForm.subject" class="dashboard-input" />

            <label class="field-label" for="campaign-reply-to">Reply-To</label>
            <input id="campaign-reply-to" v-model="campaignForm.replyToEmail" class="dashboard-input" />

            <label class="field-label" for="campaign-body">Email body (HTML)</label>
            <textarea
              id="campaign-body"
              v-model="campaignForm.bodyHtml"
              class="dashboard-textarea"
              rows="10"
            />

            <button class="dashboard-button primary" :disabled="isCreatingCampaign" @click="createCampaign">
              {{ isCreatingCampaign ? "Creating..." : "Create campaign" }}
            </button>
          </article>
        </section>

        <section class="dashboard-panel">
          <div class="panel-header">
            <div>
              <p class="panel-meta">Step 3</p>
              <h2>Send Campaigns</h2>
            </div>
          </div>

          <article
            v-if="brandedSendWarning"
            class="setup-banner"
            :class="brandedSendWarning.tone"
          >
            <strong>{{ brandedSendWarning.tone === "error" ? "Branded send blocked:" : "Branded send warning:" }}</strong>
            {{ brandedSendWarning.message }}
          </article>

          <table class="data-table compact">
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>Recipients</th>
                <th>Sent</th>
                <th>Unsubscribed</th>
                <th>Failed</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="campaign in campaigns" :key="campaign.id">
                <td>{{ campaign.name }}</td>
                <td>{{ campaign.status }}</td>
                <td>{{ campaign.recipientCount }}</td>
                <td>{{ campaign.sentCount }}</td>
                <td>{{ campaign.unsubscribedCount }}</td>
                <td>{{ campaign.failedCount }}</td>
                <td>
                  <button
                    class="dashboard-button secondary"
                    :disabled="isSending || campaign.status === 'sent'"
                    @click="sendCampaign(campaign.id)"
                  >
                    {{ campaign.status === "sent" ? "Sent" : isSending ? "Sending..." : "Send" }}
                  </button>
                </td>
              </tr>
              <tr v-if="campaigns.length === 0">
                <td colspan="7">No campaigns yet.</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section class="dashboard-panel">
          <div class="panel-header">
            <div>
              <p class="panel-meta">Optional</p>
              <h2>Brand Email Setup</h2>
            </div>
          </div>

          <div class="dashboard-grid-two">
            <div>
              <label class="field-label" for="domain-name">Domain</label>
              <input id="domain-name" v-model="domainForm.domainName" class="dashboard-input" />

              <label class="field-label" for="domain-from-name">From name</label>
              <input id="domain-from-name" v-model="domainForm.fromName" class="dashboard-input" />
            </div>

            <div>
              <label class="field-label" for="domain-from-email">From email</label>
              <input id="domain-from-email" v-model="domainForm.fromEmail" class="dashboard-input" />

              <label class="field-label" for="domain-reply-to">Reply-To email</label>
              <input id="domain-reply-to" v-model="domainForm.replyToEmail" class="dashboard-input" />
            </div>
          </div>

          <div class="action-row">
            <button class="dashboard-button secondary" :disabled="isSavingDomain" @click="saveDomainUpgrade">
              {{ isSavingDomain ? "Saving..." : "Save domain setup" }}
            </button>
            <button class="dashboard-button secondary" :disabled="isSavingDomain || !lastDomainId" @click="verifyDomain">
              {{ isSavingDomain ? "Checking..." : "Verify" }}
            </button>
          </div>

          <div v-if="domainSettings?.domainName" class="domain-setup-shell">
            <div class="status-row">
              <span class="status-chip" :class="domainStatusTone">{{ domainStatusLabel }}</span>
              <span class="signal-chip">Domain: {{ formatStatus(domainSettings.domainStatus) }}</span>
              <span class="signal-chip">DKIM: {{ formatStatus(domainSettings.dkimStatus) }}</span>
              <span class="signal-chip">SPF: {{ formatStatus(domainSettings.spfStatus) }}</span>
            </div>

            <p class="dashboard-description">{{ domainStatusCopy }}</p>

            <article
              v-if="deliverability"
              class="deliverability-card"
              :class="deliverabilityTone"
            >
              <div class="deliverability-header">
                <div>
                  <p class="panel-meta">Deliverability Score</p>
                  <h3>{{ deliverabilityLabel }}</h3>
                </div>
                <div class="deliverability-score">
                  <strong>{{ deliverability.score }}</strong>
                  <span>/100</span>
                </div>
              </div>

              <p class="dashboard-description">{{ deliverabilitySummary }}</p>

              <div class="hero-signal-row">
                <span class="signal-chip">Bounce 7d: {{ formatPercent(deliverability.bounceRate7d) }}</span>
                <span class="signal-chip">Complaint 7d: {{ formatPercent(deliverability.complaintRate7d) }}</span>
                <span class="signal-chip">Delivery 7d: {{ formatPercent(deliverability.deliveryRate7d) }}</span>
                <span class="signal-chip">Checked: {{ formatTimestamp(deliverability.lastEvaluatedAt) }}</span>
              </div>

              <ul v-if="deliverabilityTopBlockers.length > 0" class="deliverability-list">
                <li v-for="blocker in deliverabilityTopBlockers" :key="blocker.code">
                  {{ blocker.message }}
                </li>
              </ul>
            </article>

            <div v-if="providerSignals.length > 0" class="hero-signal-row">
              <span v-for="signal in providerSignals" :key="signal" class="signal-chip">
                {{ signal }}
              </span>
            </div>

            <div v-if="domainConflictFlags.length > 0" class="banner-stack">
              <article
                v-for="flag in domainConflictFlags"
                :key="flag.code"
                class="setup-banner"
                :class="flag.severity"
              >
                <strong>{{ flag.severity === "error" ? "Action required:" : "Heads up:" }}</strong>
                {{ flag.message }}
              </article>
            </div>

            <div class="auto-check-grid">
              <article class="check-card">
                <p class="check-label">Branded Sending</p>
                <span class="check-chip" :class="brandedSendingReady ? 'ok' : hasBlockingDnsConflict ? 'alert' : 'pending'">
                  {{ brandedSendingReady ? "Ready" : hasBlockingDnsConflict ? "Blocked" : "Waiting" }}
                </span>
                <p class="dashboard-description">
                  <span v-if="brandedSendingReady">
                    All required DNS checks are passing.
                  </span>
                  <span v-else-if="hasBlockingDnsConflict">
                    A blocking DNS conflict must be fixed before campaigns can send from this domain.
                  </span>
                  <span v-else>
                    We are still waiting on SES verification or the SPF update.
                  </span>
                </p>
              </article>

              <article class="check-card">
                <p class="check-label">DKIM Auto-Check</p>
                <span class="check-chip" :class="dkimReady ? 'ok' : dkimConflictFlag?.severity === 'error' ? 'alert' : 'pending'">
                  {{ dkimReady ? "Verified" : dkimConflictFlag?.severity === "error" ? "Conflict" : "Pending" }}
                </span>
                <p class="dashboard-description">
                  {{
                    dkimReady
                      ? "SES can confirm the DKIM records."
                      : dkimConflictFlag?.message || "Add the SES DKIM CNAME records and wait for propagation."
                  }}
                </p>
              </article>

              <article class="check-card">
                <p class="check-label">SPF Auto-Check</p>
                <span class="check-chip" :class="spfReady ? 'ok' : spfConflictFlag?.severity === 'error' ? 'alert' : 'pending'">
                  {{
                    spfReady
                      ? "Ready"
                      : spfValidationState === "malformed"
                        ? "Malformed"
                        : spfValidationState === "multiple_records"
                          ? "Conflict"
                          : spfValidationState === "missing"
                            ? "Missing"
                            : "Needs update"
                  }}
                </span>
                <p class="dashboard-description">
                  {{
                    spfReady
                      ? "The current SPF record authorizes Amazon SES."
                      : spfConflictFlag?.message || "Update the existing SPF record and add include:amazonses.com."
                  }}
                </p>
              </article>

              <article class="check-card">
                <p class="check-label">DMARC</p>
                <span class="check-chip" :class="dmarcConflictFlag?.severity === 'error' ? 'alert' : dmarcConfigured ? 'ok' : 'pending'">
                  {{ dmarcConflictFlag?.severity === "error" ? "Conflict" : dmarcConfigured ? "Present" : "Optional" }}
                </span>
                <p class="dashboard-description">
                  {{
                    dmarcConflictFlag?.message ||
                    (dmarcConfigured
                      ? "A DMARC policy is already present. Keep it unless your IT team changes it."
                      : "DMARC is optional here. Add it only if your domain does not already manage one.")
                  }}
                </p>
              </article>
            </div>

            <div class="domain-grid">
              <article class="analysis-card">
                <p class="panel-meta">Detected Infrastructure</p>
                <h3>Current email setup</h3>
                <p class="dashboard-description">
                  <span v-if="hasDetectedEmailInfrastructure">
                    We detected existing email infrastructure on this domain. FounderContent will not ask you to replace it.
                  </span>
                  <span v-else>
                    We did not detect existing MX, SPF, or DMARC records yet.
                  </span>
                </p>

                <div class="record-stack">
                  <div v-for="record in existingMxRecords" :key="`${record.priority}-${record.exchange}`" class="current-record-card">
                    <div class="record-header">
                      <span class="record-label">MX</span>
                    </div>
                    <div class="record-line">
                      <span class="record-key">Priority</span>
                      <code>{{ record.priority }}</code>
                    </div>
                    <div class="record-line">
                      <span class="record-key">Exchange</span>
                      <code>{{ record.exchange }}</code>
                    </div>
                  </div>

                  <div v-if="domainSetupAnalysis?.existingSpfValue" class="current-record-card">
                    <div class="record-header">
                      <span class="record-label">Current SPF</span>
                    </div>
                    <div class="record-line full">
                      <code>{{ domainSetupAnalysis.existingSpfValue }}</code>
                    </div>
                  </div>

                  <div v-if="domainSetupAnalysis?.existingDmarcValue" class="current-record-card">
                    <div class="record-header">
                      <span class="record-label">Current DMARC</span>
                    </div>
                    <div class="record-line full">
                      <code>{{ domainSetupAnalysis.existingDmarcValue }}</code>
                    </div>
                  </div>
                </div>
              </article>

              <article class="analysis-card">
                <p class="panel-meta">Do Not Change</p>
                <h3>Keep inbox routing intact</h3>
                <p class="dashboard-description">
                  Do not change your MX records for app sending. Your current inbox provider can stay exactly as-is.
                </p>

                <div class="record-stack">
                  <article
                    v-for="instruction in doNotChangeInstructions"
                    :key="`${instruction.category}-${instruction.type}-${instruction.name}-${instruction.value}`"
                    class="dns-record-card"
                  >
                    <div class="record-header">
                      <span class="record-label">{{ instruction.label }}</span>
                      <span class="record-type">{{ instruction.type }}</span>
                    </div>
                    <p class="record-note">{{ instruction.note }}</p>
                    <div class="record-line">
                      <span class="record-key">Name</span>
                      <code>{{ instruction.name }}</code>
                    </div>
                    <div class="record-line full">
                      <span class="record-key">Value</span>
                      <code>{{ instruction.value }}</code>
                    </div>
                  </article>
                </div>
              </article>
            </div>

            <div class="domain-grid">
              <article class="analysis-card">
                <p class="panel-meta">Safe To Add</p>
                <h3>Add these records</h3>
                <p class="dashboard-description">
                  These records are additive and should not interrupt the current inbox provider when added correctly.
                </p>

                <div class="record-stack">
                  <article
                    v-for="instruction in safeToAddInstructions"
                    :key="`${instruction.category}-${instruction.type}-${instruction.name}-${instruction.value}`"
                    class="dns-record-card"
                  >
                    <div class="record-header">
                      <span class="record-label">{{ instruction.label }}</span>
                      <span class="record-type">{{ instruction.type }}</span>
                    </div>
                    <p class="record-note">{{ instruction.note }}</p>
                    <div class="record-line">
                      <span class="record-key">Name</span>
                      <code>{{ instruction.name }}</code>
                    </div>
                    <div class="record-line full">
                      <span class="record-key">Value</span>
                      <code>{{ instruction.value }}</code>
                    </div>
                  </article>

                  <p v-if="safeToAddInstructions.length === 0" class="dashboard-description">
                    No additive DNS records are pending right now.
                  </p>
                </div>
              </article>

              <article class="analysis-card">
                <p class="panel-meta">Merge Carefully</p>
                <h3>Update SPF without replacing it</h3>
                <p class="dashboard-description">
                  If SPF already exists, edit that record instead of creating a second SPF entry.
                </p>

                <div class="record-stack">
                  <article
                    v-for="instruction in mergeCarefullyInstructions"
                    :key="`${instruction.category}-${instruction.type}-${instruction.name}-${instruction.value}`"
                    class="dns-record-card"
                  >
                    <div class="record-header">
                      <span class="record-label">{{ instruction.label }}</span>
                      <span class="record-type">{{ instruction.type }}</span>
                    </div>
                    <p class="record-note">{{ instruction.note }}</p>
                    <div v-if="domainSetupAnalysis?.existingSpfValue" class="record-line full">
                      <span class="record-key">Current SPF</span>
                      <code>{{ domainSetupAnalysis.existingSpfValue }}</code>
                    </div>
                    <div class="record-line">
                      <span class="record-key">Name</span>
                      <code>{{ instruction.name }}</code>
                    </div>
                    <div class="record-line full">
                      <span class="record-key">Recommended SPF</span>
                      <code>{{ instruction.value }}</code>
                    </div>
                  </article>

                  <p v-if="mergeCarefullyInstructions.length === 0" class="dashboard-description">
                    No SPF merge is required right now.
                  </p>
                </div>
              </article>
            </div>
          </div>

          <p v-else class="dashboard-description domain-empty-state">
            Add a domain to generate SES DNS records, inspect the current email provider, and show safe setup guidance.
          </p>
        </section>
      </template>
    </template>
  </main>
</template>

<style scoped>
.hero-signal-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.signal-chip {
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  padding: 0 12px;
  border: 1px solid var(--fc-border);
  border-radius: 999px;
  background: var(--fc-surface-subtle);
  color: var(--fc-text-muted);
  font-size: 0.8rem;
  font-weight: 700;
}

.field-label {
  display: block;
  margin: 14px 0 8px;
  font-size: 0.84rem;
  font-weight: 700;
  color: var(--fc-text-muted);
}

.dashboard-input,
.dashboard-select,
.dashboard-textarea {
  width: 100%;
  padding: 12px 14px;
  border: 1px solid var(--fc-border);
  border-radius: 16px;
  background: var(--fc-surface);
  color: var(--fc-text);
}

.dashboard-textarea {
  min-height: 180px;
  resize: vertical;
}

.action-row {
  display: flex;
  gap: 12px;
  margin-top: 20px;
  flex-wrap: wrap;
}

.domain-setup-shell {
  display: grid;
  gap: 18px;
  margin-top: 28px;
}

.status-row {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
}

.status-chip {
  display: inline-flex;
  align-items: center;
  min-height: 36px;
  padding: 0 14px;
  border-radius: 999px;
  font-size: 0.82rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.status-chip.green {
  background: rgba(31, 127, 87, 0.12);
  color: #14543a;
}

.status-chip.yellow {
  background: rgba(180, 115, 22, 0.14);
  color: #7a4a07;
}

.status-chip.red {
  background: rgba(176, 55, 41, 0.12);
  color: #8a2419;
}

.banner-stack {
  display: grid;
  gap: 12px;
}

.auto-check-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.check-card {
  padding: 18px;
  border: 1px solid rgba(112, 84, 62, 0.12);
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.78);
}

.check-label {
  margin: 0 0 10px;
  font-size: 0.8rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--fc-text-muted);
}

.check-chip {
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  padding: 0 12px;
  border-radius: 999px;
  font-size: 0.76rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.check-chip.ok {
  background: rgba(31, 127, 87, 0.12);
  color: #14543a;
}

.check-chip.pending {
  background: rgba(180, 115, 22, 0.14);
  color: #7a4a07;
}

.check-chip.alert {
  background: rgba(176, 55, 41, 0.12);
  color: #8a2419;
}

.setup-banner {
  padding: 14px 16px;
  border-radius: 18px;
  border: 1px solid transparent;
  font-size: 0.95rem;
  line-height: 1.6;
}

.setup-banner.warning {
  background: rgba(180, 115, 22, 0.08);
  border-color: rgba(180, 115, 22, 0.2);
  color: #7a4a07;
}

.setup-banner.error {
  background: rgba(176, 55, 41, 0.08);
  border-color: rgba(176, 55, 41, 0.2);
  color: #8a2419;
}

.deliverability-card {
  padding: 20px;
  border-radius: 24px;
  border: 1px solid rgba(112, 84, 62, 0.14);
  background: rgba(255, 255, 255, 0.8);
}

.deliverability-card.green {
  border-color: rgba(31, 127, 87, 0.2);
  background: rgba(31, 127, 87, 0.08);
}

.deliverability-card.yellow {
  border-color: rgba(180, 115, 22, 0.2);
  background: rgba(180, 115, 22, 0.08);
}

.deliverability-card.red {
  border-color: rgba(176, 55, 41, 0.2);
  background: rgba(176, 55, 41, 0.08);
}

.deliverability-header {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
}

.deliverability-header h3 {
  margin: 4px 0 0;
  font-size: 1.15rem;
}

.deliverability-score {
  display: flex;
  align-items: baseline;
  gap: 4px;
  font-weight: 800;
  color: var(--fc-text);
}

.deliverability-score strong {
  font-size: 2rem;
  line-height: 1;
}

.deliverability-score span {
  color: var(--fc-text-muted);
  font-size: 0.9rem;
}

.deliverability-list {
  margin: 16px 0 0;
  padding-left: 18px;
  color: var(--fc-text);
}

.deliverability-list li + li {
  margin-top: 8px;
}

.domain-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}

.analysis-card {
  padding: 20px;
  border: 1px solid var(--fc-border);
  border-radius: 24px;
  background: rgba(255, 250, 245, 0.68);
}

.analysis-card h3 {
  margin: 4px 0 10px;
  font-size: 1.1rem;
}

.record-stack {
  display: grid;
  gap: 12px;
  margin-top: 16px;
}

.dns-record-card,
.current-record-card {
  padding: 14px;
  border: 1px solid rgba(112, 84, 62, 0.12);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.72);
}

.record-header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  margin-bottom: 8px;
}

.record-label {
  font-size: 0.84rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--fc-text-muted);
}

.record-type {
  font-size: 0.74rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #70543e;
}

.record-note {
  margin: 0 0 12px;
  color: var(--fc-text-muted);
  line-height: 1.6;
}

.record-line {
  display: grid;
  grid-template-columns: 88px minmax(0, 1fr);
  gap: 12px;
  align-items: start;
  margin-top: 10px;
}

.record-line.full {
  grid-template-columns: 1fr;
}

.record-key {
  font-size: 0.78rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--fc-text-muted);
}

.record-line code {
  display: block;
  width: 100%;
  overflow-wrap: anywhere;
  padding: 10px 12px;
  border-radius: 14px;
  background: rgba(36, 24, 19, 0.06);
  color: var(--fc-text);
}

.domain-empty-state {
  margin-top: 18px;
}

@media (max-width: 920px) {
  .auto-check-grid,
  .domain-grid {
    grid-template-columns: 1fr;
  }
}
</style>
