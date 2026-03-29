<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import type {
  AiAssistLevel,
  ProductAccessLimits,
  SocialAccount,
  SocialAccountIdentity,
  UiDensity,
  UiFontSize,
  UiLayoutMode,
  UiTheme,
  UpdateUserPreferencesRequest,
} from "../../../packages/shared-types";
import { useProductAccessContext } from "../access/product-access-context";
import AiAssistPanel from "../components/AiAssistPanel.vue";
import { useAiAssistSuggestions } from "../composables/use-ai-assist";
import { usePreferenceContext } from "../preferences/preference-context";
import {
  requestDisconnectSocialAccount,
  requestLinkedInSocialAuthStart,
  requestSelectSocialAccountIdentity,
  requestSocialAccounts,
} from "../services/publishing-service";
import { appRoutes } from "../utils/routes";

type WorkspaceChannelKey = "linkedin" | "instagram" | "reddit";

interface WorkspaceChannelDefinition {
  key: WorkspaceChannelKey;
  label: string;
  description: string;
  availability: "live" | "coming_soon";
}

const { preferences, isSaving, errorMessage, updatePreferences } = usePreferenceContext();
const { bootstrap } = useProductAccessContext();
const route = useRoute();
const router = useRouter();

const socialAccounts = ref<SocialAccount[]>([]);
const isLoadingChannels = ref(false);
const isStartingChannelConnect = ref<WorkspaceChannelKey | "">("");
const disconnectingAccountId = ref("");
const selectingIdentityAccountId = ref("");
const channelFeedback = ref("");
const channelError = ref("");

const workspaceChannelDefinitions: WorkspaceChannelDefinition[] = [
  {
    key: "linkedin",
    label: "LinkedIn",
    description: "Connect the publishing account for this workspace so drafts and scheduled posts stay tied to the right brand.",
    availability: "live",
  },
  {
    key: "instagram",
    label: "Instagram",
    description: "Reserve a slot for the visual publishing workflow. This will land after LinkedIn stabilizes.",
    availability: "coming_soon",
  },
  {
    key: "reddit",
    label: "Reddit",
    description: "Prepare for community-first publishing per workspace without mixing accounts across products.",
    availability: "coming_soon",
  },
];

const themeModel = computed<UiTheme>({
  get: () => preferences.value.theme,
  set: (value) => {
    void updatePreference("theme", value);
  },
});

const fontSizeModel = computed<UiFontSize>({
  get: () => preferences.value.fontSize,
  set: (value) => {
    void updatePreference("fontSize", value);
  },
});

const densityModel = computed<UiDensity>({
  get: () => preferences.value.density,
  set: (value) => {
    void updatePreference("density", value);
  },
});

const layoutModeModel = computed<UiLayoutMode>({
  get: () => preferences.value.layoutMode,
  set: (value) => {
    void updatePreference("layoutMode", value);
  },
});

const aiAssistLevelModel = computed<AiAssistLevel>({
  get: () => preferences.value.aiAssistLevel,
  set: (value) => {
    void updatePreference("aiAssistLevel", value);
  },
});

async function updatePreference<T extends keyof typeof preferences.value>(
  key: T,
  value: (typeof preferences.value)[T],
) {
  const payload = {
    [key]: value,
  } as UpdateUserPreferencesRequest;
  await updatePreferences(payload);
}

const assistSuggestions = useAiAssistSuggestions([
  {
    id: "creator-mode",
    title: "Use creator layout while drafting",
    description: "Switch to the creator layout when you want a narrower reading width and less dashboard chrome.",
    minimumLevel: "minimal",
  },
  {
    id: "focus-theme",
    title: "Try the focus theme for writing sessions",
    description: "The focus theme reduces visual noise and works well with larger type when you are deep in content work.",
    minimumLevel: "balanced",
  },
  {
    id: "analytics-loop",
    title: "Pair planner layout with analytics review",
    description: "Planner mode gives you more horizontal room for scheduling and performance review workflows.",
    minimumLevel: "proactive",
    ctaLabel: "Open analytics",
    ctaTo: appRoutes.dashboardAnalytics,
  },
]);

const usageLimits = computed<ProductAccessLimits | null>(() => bootstrap.value?.limits ?? null);
const activeBusinessId = computed(() => bootstrap.value?.activeBusinessId ?? null);
const usageCards = computed(() => {
  if (!usageLimits.value) {
    return [];
  }

  return [
    {
      label: "Posts",
      remaining: usageLimits.value.postsRemaining,
      used: usageLimits.value.postsUsed,
      limit: usageLimits.value.postsLimit,
    },
    {
      label: "Emails",
      remaining: usageLimits.value.emailsRemaining,
      used: usageLimits.value.emailsUsed,
      limit: usageLimits.value.emailsLimit,
    },
    {
      label: "Outreach",
      remaining: usageLimits.value.outreachRemaining,
      used: usageLimits.value.outreachUsed,
      limit: usageLimits.value.outreachLimit,
    },
  ];
});
const isReadOnly = computed(() => bootstrap.value?.access?.readOnly ?? false);
const workspaceChannels = computed(() =>
  workspaceChannelDefinitions.map((definition) => {
    const linkedInAccount =
      definition.key === "linkedin"
        ? socialAccounts.value.find((account) => account.platform === "linkedin")
        : undefined;
    const selectedIdentity = linkedInAccount?.selectedIdentity;
    const linkedInName =
      linkedInAccount &&
      typeof linkedInAccount.metadata?.linkedInName === "string" &&
      linkedInAccount.metadata.linkedInName.trim() !== ""
        ? linkedInAccount.metadata.linkedInName.trim()
        : undefined;

    return {
      ...definition,
      account: linkedInAccount,
      selectedIdentity,
      identityOptions: linkedInAccount?.availableIdentities ?? [],
      connectedLabel:
        selectedIdentity?.displayName ||
        linkedInName ||
        linkedInAccount?.accountEmail ||
        linkedInAccount?.platformUserId,
      status:
        definition.availability === "coming_soon"
          ? "coming_soon"
          : linkedInAccount?.status ?? "not_connected",
    };
  }),
);

function formatIdentityOption(identity: SocialAccountIdentity): string {
  return identity.type === "organization"
    ? `${identity.displayName} · Page`
    : `${identity.displayName} · Personal`;
}

async function loadWorkspaceChannels(): Promise<void> {
  const businessId = activeBusinessId.value;

  if (!businessId) {
    socialAccounts.value = [];
    return;
  }

  isLoadingChannels.value = true;
  channelError.value = "";

  try {
    const response = await requestSocialAccounts(businessId);
    socialAccounts.value = response.accounts;
  } catch (error) {
    channelError.value = error instanceof Error ? error.message : "Unable to load workspace channels.";
  } finally {
    isLoadingChannels.value = false;
  }
}

async function handleChannelConnect(platform: WorkspaceChannelKey): Promise<void> {
  const businessId = activeBusinessId.value;

  if (!businessId || platform !== "linkedin") {
    return;
  }

  isStartingChannelConnect.value = platform;
  channelError.value = "";

  try {
    const response = await requestLinkedInSocialAuthStart({
      businessId,
      returnPath: appRoutes.settingsPreferences,
    });
    window.location.href = response.authorizationUrl;
  } catch (error) {
    isStartingChannelConnect.value = "";
    channelError.value = error instanceof Error ? error.message : "Unable to start channel connection.";
  }
}

async function handleChannelDisconnect(accountId: string): Promise<void> {
  const businessId = activeBusinessId.value;

  if (!businessId) {
    return;
  }

  disconnectingAccountId.value = accountId;
  channelError.value = "";

  try {
    await requestDisconnectSocialAccount({
      accountId,
      businessId,
    });
    channelFeedback.value = "Channel disconnected from this workspace.";
    await loadWorkspaceChannels();
  } catch (error) {
    channelError.value = error instanceof Error ? error.message : "Unable to disconnect the channel.";
  } finally {
    disconnectingAccountId.value = "";
  }
}

async function handleChannelIdentitySelect(
  accountId: string,
  identityId: string,
): Promise<void> {
  const businessId = activeBusinessId.value;

  if (!businessId || !identityId) {
    return;
  }

  selectingIdentityAccountId.value = accountId;
  channelError.value = "";

  try {
    await requestSelectSocialAccountIdentity({
      accountId,
      businessId,
      identityId,
    });
    channelFeedback.value = "LinkedIn publishing target updated for this workspace.";
    await loadWorkspaceChannels();
  } catch (error) {
    channelError.value =
      error instanceof Error ? error.message : "Unable to update the LinkedIn publishing target.";
  } finally {
    selectingIdentityAccountId.value = "";
  }
}

watch(
  activeBusinessId,
  () => {
    void loadWorkspaceChannels();
  },
  { immediate: true },
);

watch(
  () => [route.query.linkedin, route.query.message],
  async ([status, message]) => {
    if (typeof status !== "string" && typeof message !== "string") {
      return;
    }

    if (status === "connected") {
      channelFeedback.value = "LinkedIn connected for this workspace.";
      channelError.value = "";
      await loadWorkspaceChannels();
    } else if (status === "error") {
      channelError.value = typeof message === "string" && message.trim() !== ""
        ? message
        : "LinkedIn connection failed.";
    }

    const nextQuery = { ...route.query };
    delete nextQuery.linkedin;
    delete nextQuery.message;
    void router.replace({ query: nextQuery });
    isStartingChannelConnect.value = "";
  },
  { immediate: true },
);
</script>

<template>
  <main class="dashboard-shell">
    <section class="dashboard-hero">
      <p class="dashboard-eyebrow">/settings/preferences</p>
      <h1>Interface Preferences</h1>
      <p class="dashboard-description">
        Control theme, density, layout, and how much AI guidance the product surfaces while you work.
      </p>
    </section>

    <p v-if="errorMessage" class="dashboard-feedback error">{{ errorMessage }}</p>
    <p v-else-if="isSaving" class="dashboard-feedback">Saving preferences...</p>

    <section class="dashboard-grid-two">
      <article class="dashboard-panel">
        <p class="panel-meta">Appearance</p>
        <div class="settings-grid">
          <label class="dashboard-field">
            <span>Theme</span>
            <select v-model="themeModel">
              <option value="light">Light</option>
              <option value="dark">Dark</option>
              <option value="focus">Focus</option>
            </select>
          </label>

          <label class="dashboard-field">
            <span>Font Size</span>
            <select v-model="fontSizeModel">
              <option value="small">Small</option>
              <option value="medium">Medium</option>
              <option value="large">Large</option>
            </select>
          </label>

          <label class="dashboard-field">
            <span>Density</span>
            <select v-model="densityModel">
              <option value="compact">Compact</option>
              <option value="comfortable">Comfortable</option>
              <option value="spacious">Spacious</option>
            </select>
          </label>
        </div>
      </article>

      <article class="dashboard-panel">
        <p class="panel-meta">Workspace Mode</p>
        <div class="settings-grid">
          <label class="dashboard-field">
            <span>Layout Mode</span>
            <select v-model="layoutModeModel">
              <option value="dashboard">Dashboard</option>
              <option value="creator">Creator</option>
              <option value="planner">Planner</option>
            </select>
          </label>

          <label class="dashboard-field">
            <span>AI Assist</span>
            <select v-model="aiAssistLevelModel">
              <option value="off">Off</option>
              <option value="minimal">Minimal</option>
              <option value="balanced">Balanced</option>
              <option value="proactive">Proactive</option>
            </select>
          </label>
        </div>
      </article>
    </section>

    <section class="dashboard-panel channels-panel">
      <div class="channels-panel-header">
        <div>
          <p class="panel-meta">Workspace Channels</p>
          <h2>Connect the right distribution account for each workspace.</h2>
        </div>
        <span class="usage-badge">
          {{ activeBusinessId ? "Workspace scoped" : "Select a workspace first" }}
        </span>
      </div>

      <p class="dashboard-description">
        Every workspace should keep its own publishing channels. Connect LinkedIn now, then layer Instagram and Reddit later without mixing brand accounts across products.
      </p>

      <p v-if="channelFeedback" class="dashboard-feedback">{{ channelFeedback }}</p>
      <p v-if="channelError" class="dashboard-feedback error">{{ channelError }}</p>

      <div class="channel-grid">
        <article
          v-for="channel in workspaceChannels"
          :key="channel.key"
          class="channel-card"
          :data-tone="channel.availability"
        >
          <div class="channel-card-header">
            <div>
              <p class="dashboard-card-label">{{ channel.label }}</p>
              <strong>{{ channel.availability === "live" ? "Workspace connection" : "Coming soon" }}</strong>
            </div>
            <span
              class="channel-status-badge"
              :class="{
                connected: channel.status === 'connected',
                warning: channel.status === 'expired' || channel.status === 'error',
              }"
            >
              {{
                channel.status === "connected"
                  ? "Connected"
                  : channel.status === "expired"
                    ? "Reconnect required"
                    : channel.status === "error"
                      ? "Needs attention"
                      : channel.status === "coming_soon"
                        ? "Soon"
                        : "Not connected"
              }}
            </span>
          </div>

          <p>{{ channel.description }}</p>

          <div v-if="channel.account" class="channel-account-meta">
            <span>{{ channel.connectedLabel }}</span>
            <small>
              {{
                channel.account.accountEmail
                  ? channel.account.accountEmail
                  : `Connected ${new Date(channel.account.updatedAt).toLocaleDateString()}`
              }}
            </small>
          </div>

          <label
            v-if="channel.account && channel.identityOptions.length > 0"
            class="dashboard-field channel-identity-field"
          >
            <span>Publish this workspace as</span>
            <select
              :value="channel.selectedIdentity?.id ?? ''"
              :disabled="selectingIdentityAccountId === channel.account.id"
              @change="
                void handleChannelIdentitySelect(
                  channel.account.id,
                  ($event.target as HTMLSelectElement).value,
                )
              "
            >
              <option
                v-for="identity in channel.identityOptions"
                :key="identity.id"
                :value="identity.id"
              >
                {{ formatIdentityOption(identity) }}
              </option>
            </select>
          </label>

          <div class="channel-actions">
            <button
              v-if="channel.availability === 'live'"
              type="button"
              class="dashboard-button"
              :disabled="!activeBusinessId || isStartingChannelConnect === channel.key"
              @click="void handleChannelConnect(channel.key)"
            >
              {{
                channel.status === "connected"
                  ? isStartingChannelConnect === channel.key
                    ? "Refreshing..."
                    : "Reconnect"
                  : isStartingChannelConnect === channel.key
                    ? "Connecting..."
                    : "Connect"
              }}
            </button>

            <button
              v-if="channel.account"
              type="button"
              class="dashboard-button secondary"
              :disabled="
                disconnectingAccountId === channel.account.id ||
                selectingIdentityAccountId === channel.account.id
              "
              @click="void handleChannelDisconnect(channel.account.id)"
            >
              {{ disconnectingAccountId === channel.account.id ? "Disconnecting..." : "Disconnect" }}
            </button>

            <button
              v-if="channel.availability === 'coming_soon'"
              type="button"
              class="dashboard-button secondary"
              disabled
            >
              Planned
            </button>
          </div>
        </article>
      </div>
    </section>

    <section class="dashboard-panel usage-panel">
      <div class="usage-panel-header">
        <div>
          <p class="panel-meta">Usage & Billing</p>
          <h2>Keep workspace limits visible without cluttering navigation.</h2>
        </div>
        <span v-if="isReadOnly" class="usage-badge warning">Read-only</span>
        <span v-else class="usage-badge">Billing page next</span>
      </div>

      <p class="dashboard-description">
        This is the clearest place to review daily credits for the active workspace. Pricing and billing controls can slot in here later without crowding the rest of the product.
      </p>

      <div v-if="usageCards.length > 0" class="usage-grid">
        <article v-for="card in usageCards" :key="card.label" class="usage-card">
          <p class="dashboard-card-label">{{ card.label }}</p>
          <strong>{{ card.remaining }} left</strong>
          <p>{{ card.used }} used of {{ card.limit }} total today</p>
        </article>
      </div>

      <p v-else class="dashboard-feedback">
        Usage appears once you have an active workspace with product access loaded.
      </p>
    </section>

    <section class="dashboard-panel preference-preview-panel">
      <p class="panel-meta">Live Preview</p>
      <div class="dashboard-card-grid">
        <article class="dashboard-card">
          <p class="dashboard-card-label">Theme</p>
          <strong>{{ preferences.theme }}</strong>
        </article>
        <article class="dashboard-card">
          <p class="dashboard-card-label">Type Scale</p>
          <strong>{{ preferences.fontSize }}</strong>
        </article>
        <article class="dashboard-card">
          <p class="dashboard-card-label">Density</p>
          <strong>{{ preferences.density }}</strong>
        </article>
        <article class="dashboard-card">
          <p class="dashboard-card-label">Layout</p>
          <strong>{{ preferences.layoutMode }}</strong>
        </article>
      </div>
    </section>

    <AiAssistPanel title="AI Assist Preview" :suggestions="assistSuggestions" />
  </main>
</template>

<style scoped>
.settings-grid {
  display: grid;
  gap: 16px;
}

.usage-panel {
  display: grid;
  gap: 18px;
  margin-top: 18px;
}

.channels-panel {
  display: grid;
  gap: 18px;
  margin-top: 18px;
}

.channels-panel-header {
  display: flex;
  flex-wrap: wrap;
  align-items: start;
  justify-content: space-between;
  gap: 12px;
}

.channels-panel-header h2 {
  margin: 0;
}

.channel-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}

.channel-card {
  display: grid;
  gap: 14px;
  padding: 18px;
  border: 1px solid var(--fc-border);
  border-radius: 18px;
  background: color-mix(in srgb, var(--fc-panel-bg) 84%, var(--fc-surface-muted));
}

.channel-card[data-tone="coming_soon"] {
  background: color-mix(in srgb, var(--fc-surface-subtle) 92%, var(--fc-panel-bg));
}

.channel-card-header {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 12px;
}

.channel-card-header strong {
  display: block;
  margin-top: 4px;
  font-size: 1.1rem;
}

.channel-card p {
  margin: 0;
  color: var(--fc-text-muted);
  line-height: 1.6;
}

.channel-status-badge {
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

.channel-status-badge.connected {
  border-color: color-mix(in srgb, var(--fc-success-text) 16%, var(--fc-border));
  background: color-mix(in srgb, var(--fc-success-bg) 82%, var(--fc-panel-bg));
  color: var(--fc-success-text);
}

.channel-status-badge.warning {
  border-color: var(--fc-warning-bg);
  background: var(--fc-warning-bg);
  color: var(--fc-warning-text);
}

.channel-account-meta {
  display: grid;
  gap: 4px;
  padding: 12px 14px;
  border: 1px solid var(--fc-border);
  border-radius: 16px;
  background: color-mix(in srgb, var(--fc-panel-bg) 88%, white 12%);
}

.channel-account-meta span {
  font-weight: 700;
}

.channel-account-meta small {
  color: var(--fc-text-muted);
}

.channel-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.channel-identity-field {
  gap: 8px;
}

.channel-identity-field select {
  width: 100%;
}

.usage-panel-header {
  display: flex;
  flex-wrap: wrap;
  align-items: start;
  justify-content: space-between;
  gap: 12px;
}

.usage-panel-header h2 {
  margin: 0;
}

.usage-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}

.usage-card {
  display: grid;
  gap: 8px;
  padding: 18px;
  border: 1px solid var(--fc-border);
  border-radius: 18px;
  background: color-mix(in srgb, var(--fc-panel-bg) 84%, var(--fc-surface-muted));
}

.usage-card strong {
  font-size: 1.9rem;
}

.usage-card p {
  margin: 0;
  color: var(--fc-text-muted);
  line-height: 1.55;
}

.usage-badge {
  display: inline-flex;
  align-items: center;
  min-height: 34px;
  padding: 0 12px;
  border: 1px solid var(--fc-border);
  border-radius: 999px;
  background: var(--fc-surface-subtle);
  color: var(--fc-text-muted);
  font-size: 0.82rem;
  font-weight: 700;
}

.usage-badge.warning {
  border-color: var(--fc-warning-bg);
  background: var(--fc-warning-bg);
  color: var(--fc-warning-text);
}

.preference-preview-panel {
  margin-top: 18px;
}

@media (max-width: 920px) {
  .channel-grid,
  .usage-grid {
    grid-template-columns: 1fr;
  }
}
</style>
