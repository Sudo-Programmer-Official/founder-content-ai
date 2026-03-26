<script setup lang="ts">
import type {
  BusinessMembership,
  EmailCampaign,
  EmailList,
  ImportEmailContactsRequest,
} from "../../../packages/shared-types";
import { computed, onMounted, ref, watch } from "vue";
import { useProductAccessContext } from "../access/product-access-context";
import {
  requestEmailCampaignCreate,
  requestEmailCampaignSend,
  requestEmailCampaigns,
  requestEmailContactsImport,
  requestEmailDomainCreate,
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
const isLoading = ref(true);
const isImporting = ref(false);
const isCreatingCampaign = ref(false);
const isSending = ref(false);
const isSavingDomain = ref(false);
const errorMessage = ref("");
const feedbackMessage = ref("");
const lastDomainId = ref("");

const contactImport = ref<ImportEmailContactsRequest>({
  listName: "Launch List",
  csvText: "email,name\nfounder@example.com,Sample Founder",
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

async function loadBusinesses(): Promise<void> {
  const response = await requestMyBusinesses();
  businesses.value = response.businesses;
  selectedBusinessId.value =
    productAccess.value?.activeBusinessId || response.businesses[0]?.businessId || "";
  if (selectedBusinessId.value) {
    setActiveBusinessId(selectedBusinessId.value);
  }
}

async function loadEmailState(): Promise<void> {
  if (!selectedBusinessId.value || !emailFeatureEnabled.value) {
    emailLists.value = [];
    campaigns.value = [];
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
    lastDomainId.value = response.settings.id || "";
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
    feedbackMessage.value = `Domain status: ${response.settings.domainStatus}.`;
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "Unable to verify domain.";
  } finally {
    isSavingDomain.value = false;
  }
}

watch(selectedBusinessId, (nextBusinessId) => {
  if (!nextBusinessId) {
    return;
  }

  setActiveBusinessId(nextBusinessId);
  void Promise.all([loadEmailState(), refreshProductAccess(nextBusinessId)]);
});

onMounted(() => {
  void initializePage();
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
              Verify
            </button>
          </div>
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
}
</style>
