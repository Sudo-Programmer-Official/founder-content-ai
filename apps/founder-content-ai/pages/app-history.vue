<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import type { BusinessMembership, ScheduledPost, ScheduledPostStatus } from "../../../packages/shared-types";
import { useProductAccessContext } from "../access/product-access-context";
import { requestMyBusinesses } from "../services/admin-analytics-service";
import { requestScheduledPosts, requestUpdateScheduledPost } from "../services/publishing-service";
import { appRoutes } from "../utils/routes";
import {
  convertZonedDateTimeToUtcIso,
  detectUserTimezone,
  formatDateInTimezone,
  formatTimeWithZone,
  toDateKeyInTimezone,
  toTimeValueInTimezone,
} from "../utils/timezone";

type HistoryTab = "published" | "scheduled" | "failed" | "all";

const HISTORY_TABS: { id: HistoryTab; label: string }[] = [
  { id: "published", label: "Posted" },
  { id: "scheduled", label: "Scheduled" },
  { id: "failed", label: "Failed" },
  { id: "all", label: "All" },
];

const router = useRouter();
const {
  bootstrap: productAccess,
  activeBusinessId,
  setActiveBusinessId,
  isFeatureEnabled,
} = useProductAccessContext();

const userTimezone = detectUserTimezone();
const COMMON_AUDIENCE_TIMEZONES = [
  "UTC",
  "America/Chicago",
  "America/New_York",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Singapore",
  "Australia/Sydney",
] as const;

const businesses = ref<BusinessMembership[]>([]);
const scheduledPosts = ref<ScheduledPost[]>([]);
const selectedTab = ref<HistoryTab>("published");
const selectedScheduledPostId = ref("");
const audienceTimezone = ref("");
const selectedAudienceDateKey = ref("");
const scheduleTime = ref("09:00");
const isLoading = ref(true);
const isUpdating = ref(false);
const errorMessage = ref("");
const feedbackMessage = ref("");

const resolvedBusinessId = computed(
  () => productAccess.value?.activeBusinessId || activeBusinessId.value || businesses.value[0]?.businessId || "",
);

const currentBusiness = computed(
  () => businesses.value.find((membership) => membership.businessId === resolvedBusinessId.value) ?? null,
);

const workspaceDefaultAudienceTimezone = computed(
  () => currentBusiness.value?.business.timezone || "UTC",
);

const schedulerEnabled = computed(
  () =>
    !resolvedBusinessId.value ||
    !productAccess.value?.activeBusinessId ||
    isFeatureEnabled("scheduler"),
);

const audienceTimezoneOptions = computed(() => {
  const unique = new Set<string>([
    workspaceDefaultAudienceTimezone.value,
    userTimezone,
    ...COMMON_AUDIENCE_TIMEZONES,
  ]);

  return [...unique].map((value) => ({
    value,
    label: value === workspaceDefaultAudienceTimezone.value ? `${value} · workspace default` : value,
  }));
});

function getHistoryAnchor(post: ScheduledPost): string {
  return post.publishedAt || post.scheduledAt;
}

function getDisplayTitle(post: ScheduledPost): string {
  const firstLine = post.contentText
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  return firstLine || "Untitled post";
}

function buildExcerpt(value: string, maxLength = 180): string {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength).trimEnd()}...`;
}

function getMediaCount(post: ScheduledPost): number {
  return post.assets.length > 0 ? post.assets.length : post.slides.length;
}

function resolveStatusLabel(status: ScheduledPostStatus): string {
  switch (status) {
    case "published":
      return "Posted";
    case "processing":
      return "Publishing";
    case "paused":
      return "Paused";
    case "failed":
      return "Failed";
    case "canceled":
      return "Canceled";
    default:
      return "Scheduled";
  }
}

function resolveStatusTone(status: ScheduledPostStatus): "default" | "success" | "warning" | "danger" {
  switch (status) {
    case "published":
      return "success";
    case "failed":
      return "danger";
    case "paused":
    case "processing":
      return "warning";
    default:
      return "default";
  }
}

function matchesTab(post: ScheduledPost, tab: HistoryTab): boolean {
  switch (tab) {
    case "published":
      return post.status === "published";
    case "scheduled":
      return post.status === "scheduled" || post.status === "paused" || post.status === "processing";
    case "failed":
      return post.status === "failed";
    default:
      return true;
  }
}

function looksLikeReconnectIssue(post: ScheduledPost): boolean {
  const message = post.errorMessage?.toLowerCase() || "";
  return (
    message.includes("linkedin") ||
    message.includes("token") ||
    message.includes("expired") ||
    message.includes("connect") ||
    message.includes("permission") ||
    message.includes("authorize")
  );
}

const sortedPosts = computed(() =>
  [...scheduledPosts.value].sort(
    (left, right) => new Date(getHistoryAnchor(right)).getTime() - new Date(getHistoryAnchor(left)).getTime(),
  ),
);

const filteredPosts = computed(() =>
  sortedPosts.value.filter((post) => matchesTab(post, selectedTab.value)),
);

const selectedScheduledPost = computed(
  () => filteredPosts.value.find((post) => post.id === selectedScheduledPostId.value) ?? filteredPosts.value[0] ?? null,
);

const selectedScheduledPostCanPause = computed(
  () => selectedScheduledPost.value?.status === "scheduled",
);

const selectedScheduledPostCanResume = computed(
  () => selectedScheduledPost.value?.status === "paused",
);

const selectedScheduledPostCanRetry = computed(
  () => selectedScheduledPost.value?.status === "failed",
);

const selectedScheduledPostCanCancel = computed(() => {
  const status = selectedScheduledPost.value?.status;
  return status === "scheduled" || status === "paused" || status === "failed";
});

const selectedScheduledPostCanReschedule = computed(() => {
  const status = selectedScheduledPost.value?.status;
  return status === "scheduled" || status === "paused" || status === "failed";
});

const overviewCards = computed(() => {
  const published = scheduledPosts.value.filter((post) => post.status === "published").length;
  const scheduled = scheduledPosts.value.filter(
    (post) => post.status === "scheduled" || post.status === "paused" || post.status === "processing",
  ).length;
  const failed = scheduledPosts.value.filter((post) => post.status === "failed").length;
  const withMedia = scheduledPosts.value.filter((post) => getMediaCount(post) > 0).length;

  return [
    { label: "Posted", value: String(published), tone: published > 0 ? "success" : "default" },
    { label: "Scheduled", value: String(scheduled), tone: "default" },
    { label: "Failed", value: String(failed), tone: failed > 0 ? "danger" : "default" },
    { label: "With media", value: String(withMedia), tone: withMedia > 0 ? "warning" : "default" },
  ] as const;
});

const selectedAudienceTimeLabel = computed(() => {
  if (!selectedAudienceDateKey.value || !scheduleTime.value || !audienceTimezone.value) {
    return "";
  }

  const scheduledAt = convertZonedDateTimeToUtcIso(
    selectedAudienceDateKey.value,
    scheduleTime.value,
    audienceTimezone.value,
  );

  return formatTimeWithZone(scheduledAt, audienceTimezone.value);
});

const selectedLocalTimeLabel = computed(() => {
  if (!selectedAudienceDateKey.value || !scheduleTime.value || !audienceTimezone.value) {
    return "";
  }

  const scheduledAt = convertZonedDateTimeToUtcIso(
    selectedAudienceDateKey.value,
    scheduleTime.value,
    audienceTimezone.value,
  );

  return formatTimeWithZone(scheduledAt, userTimezone);
});

function syncSelectedScheduleForm(post: ScheduledPost | null): void {
  if (!post) {
    return;
  }

  audienceTimezone.value = post.audienceTimezone || workspaceDefaultAudienceTimezone.value;
  selectedAudienceDateKey.value = toDateKeyInTimezone(post.scheduledAt, audienceTimezone.value);
  scheduleTime.value = toTimeValueInTimezone(post.scheduledAt, audienceTimezone.value);
}

function syncSelection(): void {
  if (filteredPosts.value.length === 0) {
    const fallbackTab = HISTORY_TABS.find((tab) =>
      sortedPosts.value.some((post) => matchesTab(post, tab.id)),
    );

    if (fallbackTab && fallbackTab.id !== selectedTab.value) {
      selectedTab.value = fallbackTab.id;
      return;
    }

    selectedScheduledPostId.value = "";
    return;
  }

  if (!filteredPosts.value.some((post) => post.id === selectedScheduledPostId.value)) {
    selectedScheduledPostId.value = filteredPosts.value[0].id;
  }

  syncSelectedScheduleForm(selectedScheduledPost.value);
}

async function loadBusinesses(): Promise<void> {
  const response = await requestMyBusinesses();
  businesses.value = response.businesses;

  const preferredBusinessId =
    productAccess.value?.activeBusinessId || activeBusinessId.value || response.businesses[0]?.businessId || "";

  if (preferredBusinessId && preferredBusinessId !== productAccess.value?.activeBusinessId) {
    await setActiveBusinessId(preferredBusinessId);
  }
}

async function loadHistoryData(): Promise<void> {
  if (!resolvedBusinessId.value || !schedulerEnabled.value) {
    scheduledPosts.value = [];
    return;
  }

  const response = await requestScheduledPosts(resolvedBusinessId.value);
  scheduledPosts.value = response.scheduledPosts;
}

async function initializePage(): Promise<void> {
  isLoading.value = true;
  errorMessage.value = "";

  try {
    await loadBusinesses();
    if (!audienceTimezone.value) {
      audienceTimezone.value = workspaceDefaultAudienceTimezone.value;
    }
    await loadHistoryData();
    syncSelection();
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "Unable to load post history right now.";
  } finally {
    isLoading.value = false;
  }
}

function selectPost(postId: string): void {
  selectedScheduledPostId.value = postId;
  syncSelectedScheduleForm(
    filteredPosts.value.find((post) => post.id === postId) ?? null,
  );
  feedbackMessage.value = "";
  errorMessage.value = "";
}

async function mutateSelectedPost(action: "pause" | "resume" | "cancel" | "retry"): Promise<void> {
  if (!resolvedBusinessId.value || !selectedScheduledPost.value) {
    errorMessage.value = "Pick a post first.";
    return;
  }

  isUpdating.value = true;
  errorMessage.value = "";

  try {
    const response = await requestUpdateScheduledPost(selectedScheduledPost.value.id, {
      businessId: resolvedBusinessId.value,
      action,
    });

    feedbackMessage.value =
      action === "pause"
        ? "Scheduled post paused."
        : action === "resume"
          ? "Scheduled post resumed."
          : action === "cancel"
            ? "Scheduled post canceled."
            : "Failed post re-queued for publishing.";
    selectedScheduledPostId.value = response.scheduledPost.id;
    await loadHistoryData();
    syncSelection();
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "Unable to update that post right now.";
  } finally {
    isUpdating.value = false;
  }
}

async function rescheduleSelectedPost(): Promise<void> {
  if (!resolvedBusinessId.value || !selectedScheduledPost.value) {
    errorMessage.value = "Pick a post first.";
    return;
  }

  isUpdating.value = true;
  errorMessage.value = "";

  try {
    const response = await requestUpdateScheduledPost(selectedScheduledPost.value.id, {
      businessId: resolvedBusinessId.value,
      action: "reschedule",
      scheduledAt: convertZonedDateTimeToUtcIso(
        selectedAudienceDateKey.value,
        scheduleTime.value,
        audienceTimezone.value || workspaceDefaultAudienceTimezone.value,
      ),
      audienceTimezone: audienceTimezone.value || workspaceDefaultAudienceTimezone.value,
    });

    feedbackMessage.value =
      response.scheduledPost.status === "paused"
        ? "Paused post rescheduled without resuming it."
        : "Publishing slot updated.";
    selectedScheduledPostId.value = response.scheduledPost.id;
    await loadHistoryData();
    syncSelection();
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "Unable to reschedule that post right now.";
  } finally {
    isUpdating.value = false;
  }
}

function openDraftEditor(assetId?: string): void {
  if (!assetId) {
    return;
  }

  void router.push({
    path: appRoutes.appCreate,
    query: {
      postId: assetId,
    },
  });
}

function openPlanner(): void {
  void router.push(appRoutes.appPlanner);
}

function openSettings(): void {
  void router.push(appRoutes.settingsPreferences);
}

watch(
  () => workspaceDefaultAudienceTimezone.value,
  (timezone) => {
    if (!audienceTimezone.value) {
      audienceTimezone.value = timezone;
    }
  },
  { immediate: true },
);

watch(
  () => [resolvedBusinessId.value, schedulerEnabled.value] as const,
  ([businessId]) => {
    if (!businessId) {
      return;
    }

    void initializePage();
  },
);

watch(
  () => selectedTab.value,
  () => {
    syncSelection();
  },
);

watch(
  () => scheduledPosts.value,
  () => {
    syncSelection();
  },
);

onMounted(() => {
  void initializePage();
});
</script>

<template>
  <main class="history-shell">
    <section class="workspace-hero">
      <div>
        <p class="workspace-eyebrow">/app/history</p>
        <h1>Post history</h1>
        <p class="workspace-description">
          Verify what shipped, see what failed, and recover execution issues without hunting through the planner.
        </p>
      </div>

      <div class="history-top-actions">
        <button type="button" class="workspace-secondary-button" @click="openPlanner">
          Open planner
        </button>
        <router-link class="workspace-primary-button link-button" :to="appRoutes.appCreate">
          Create post
        </router-link>
      </div>
    </section>

    <section class="history-overview-grid">
      <article
        v-for="card in overviewCards"
        :key="card.label"
        class="workspace-card history-overview-card"
        :data-tone="card.tone"
      >
        <span>{{ card.label }}</span>
        <strong>{{ card.value }}</strong>
      </article>
    </section>

    <p v-if="isLoading" class="workspace-description">Loading history...</p>

    <section v-else-if="errorMessage" class="workspace-card empty-state">
      <h2>History unavailable</h2>
      <p>{{ errorMessage }}</p>
    </section>

    <section v-else-if="!resolvedBusinessId" class="workspace-card empty-state">
      <h2>No workspace selected</h2>
      <p>Switch into a workspace first, then use history to verify what shipped and recover failures.</p>
    </section>

    <section v-else-if="!schedulerEnabled" class="workspace-card empty-state">
      <h2>History is not enabled here</h2>
      <p>Turn on the scheduler feature for this workspace to unlock execution history.</p>
    </section>

    <section v-else class="history-main-grid">
      <article class="workspace-card history-list-panel">
        <div class="history-toolbar">
          <div>
            <p class="workspace-chip">Execution stream · {{ userTimezone }}</p>
            <p class="workspace-description compact">
              Posted items confirm output. Failed items are the recovery queue. Scheduled items show what is still ahead.
            </p>
          </div>

          <div class="history-tab-row" role="tablist" aria-label="History filters">
            <button
              v-for="tab in HISTORY_TABS"
              :key="tab.id"
              type="button"
              class="history-tab"
              :class="{ active: tab.id === selectedTab }"
              @click="selectedTab = tab.id"
            >
              {{ tab.label }}
            </button>
          </div>
        </div>

        <div v-if="filteredPosts.length === 0" class="history-empty-state">
          <strong>No {{ HISTORY_TABS.find((tab) => tab.id === selectedTab)?.label.toLowerCase() }} posts yet.</strong>
          <span>
            {{
              selectedTab === "failed"
                ? "Failures will show up here with recovery actions."
                : selectedTab === "published"
                  ? "Published items land here after direct or scheduled posting."
                  : "The execution stream for this filter is still empty."
            }}
          </span>
        </div>

        <div v-else class="history-list">
          <button
            v-for="post in filteredPosts"
            :key="post.id"
            type="button"
            class="history-row"
            :class="{ active: post.id === selectedScheduledPost?.id }"
            :data-tone="resolveStatusTone(post.status)"
            @click="selectPost(post.id)"
          >
            <div class="history-row-topline">
              <div class="history-chip-row">
                <span class="workspace-chip">LI</span>
                <span class="workspace-chip">{{ resolveStatusLabel(post.status) }}</span>
                <span v-if="getMediaCount(post) > 0" class="workspace-chip">
                  📎 {{ getMediaCount(post) }}
                </span>
              </div>
              <span class="history-row-time">
                {{
                  formatDateInTimezone(getHistoryAnchor(post), userTimezone, {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })
                }}
              </span>
            </div>

            <strong>{{ getDisplayTitle(post) }}</strong>
            <p>{{ buildExcerpt(post.contentText, 140) }}</p>
            <span v-if="post.status === 'failed' && post.errorMessage" class="history-row-error">
              {{ buildExcerpt(post.errorMessage, 120) }}
            </span>
          </button>
        </div>
      </article>

      <aside class="workspace-card history-sidebar">
        <template v-if="selectedScheduledPost">
          <p class="workspace-eyebrow">Selected post</p>
          <h2>{{ getDisplayTitle(selectedScheduledPost) }}</h2>
          <p class="workspace-description compact">
            {{ resolveStatusLabel(selectedScheduledPost.status) }} ·
            {{
              formatDateInTimezone(
                selectedScheduledPost.status === "published"
                  ? selectedScheduledPost.publishedAt || selectedScheduledPost.scheduledAt
                  : selectedScheduledPost.scheduledAt,
                selectedScheduledPost.audienceTimezone,
                {
                  weekday: "long",
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                },
              )
            }}
            in {{ selectedScheduledPost.audienceTimezone }}
          </p>
          <p v-if="selectedScheduledPost.audienceTimezone !== userTimezone" class="workspace-description compact">
            Your time: {{
              formatTimeWithZone(
                selectedScheduledPost.status === "published"
                  ? selectedScheduledPost.publishedAt || selectedScheduledPost.scheduledAt
                  : selectedScheduledPost.scheduledAt,
                userTimezone,
              )
            }}
          </p>

          <article class="history-preview-card">
            <div class="history-preview-chip-row">
              <p class="workspace-chip">{{ resolveStatusLabel(selectedScheduledPost.status) }}</p>
              <p v-if="getMediaCount(selectedScheduledPost) > 0" class="workspace-chip">
                📎 {{ getMediaCount(selectedScheduledPost) }} image{{ getMediaCount(selectedScheduledPost) === 1 ? "" : "s" }}
              </p>
            </div>
            <p>{{ selectedScheduledPost.contentText }}</p>
          </article>

          <div v-if="selectedScheduledPost.errorMessage" class="history-feedback danger">
            {{ selectedScheduledPost.errorMessage }}
          </div>

          <div v-if="selectedScheduledPostCanReschedule" class="history-inline-section">
            <label class="history-inline-label">Reschedule slot</label>
            <div class="history-schedule-grid">
              <label>
                <span>Audience timezone</span>
                <select v-model="audienceTimezone">
                  <option
                    v-for="option in audienceTimezoneOptions"
                    :key="option.value"
                    :value="option.value"
                  >
                    {{ option.label }}
                  </option>
                </select>
              </label>
              <label>
                <span>Audience date</span>
                <input v-model="selectedAudienceDateKey" type="date" />
              </label>
              <label>
                <span>Time</span>
                <input v-model="scheduleTime" type="time" />
              </label>
            </div>

            <p class="workspace-description compact">
              Audience time: {{ selectedAudienceTimeLabel }} · Your time: {{ selectedLocalTimeLabel }}
            </p>
          </div>

          <div class="history-sidebar-actions">
            <button
              v-if="selectedScheduledPost.assetGroupId"
              type="button"
              class="workspace-secondary-button"
              :disabled="isUpdating"
              @click="openDraftEditor(selectedScheduledPost.assetGroupId)"
            >
              Edit draft
            </button>
            <a
              v-if="selectedScheduledPost.externalPostUrl"
              class="workspace-primary-button link-button"
              :href="selectedScheduledPost.externalPostUrl"
              target="_blank"
              rel="noreferrer"
            >
              View on LinkedIn
            </a>
            <button
              v-if="selectedScheduledPostCanRetry"
              type="button"
              class="workspace-primary-button"
              :disabled="isUpdating"
              @click="mutateSelectedPost('retry')"
            >
              {{ isUpdating ? "Updating..." : "Retry now" }}
            </button>
            <button
              v-if="selectedScheduledPostCanPause"
              type="button"
              class="workspace-secondary-button"
              :disabled="isUpdating"
              @click="mutateSelectedPost('pause')"
            >
              {{ isUpdating ? "Updating..." : "Pause" }}
            </button>
            <button
              v-if="selectedScheduledPostCanResume"
              type="button"
              class="workspace-secondary-button"
              :disabled="isUpdating"
              @click="mutateSelectedPost('resume')"
            >
              {{ isUpdating ? "Updating..." : "Resume" }}
            </button>
            <button
              v-if="selectedScheduledPostCanReschedule"
              type="button"
              class="workspace-secondary-button"
              :disabled="isUpdating"
              @click="rescheduleSelectedPost"
            >
              {{ isUpdating ? "Updating..." : "Reschedule" }}
            </button>
            <button
              v-if="selectedScheduledPostCanCancel"
              type="button"
              class="workspace-secondary-button history-danger-button"
              :disabled="isUpdating"
              @click="mutateSelectedPost('cancel')"
            >
              {{ isUpdating ? "Updating..." : "Cancel" }}
            </button>
            <button
              v-if="selectedScheduledPost.status === 'failed' && looksLikeReconnectIssue(selectedScheduledPost)"
              type="button"
              class="workspace-secondary-button"
              @click="openSettings"
            >
              Check LinkedIn connection
            </button>
          </div>
        </template>

        <template v-else>
          <p class="workspace-eyebrow">No post selected</p>
          <h2>Choose a history item</h2>
          <p class="workspace-description compact">
            Select a row to inspect the post, open the live LinkedIn link, or recover a failed publish.
          </p>
        </template>

        <p v-if="feedbackMessage" class="history-feedback success">{{ feedbackMessage }}</p>
      </aside>
    </section>
  </main>
</template>

<style scoped>
.history-shell,
.history-overview-grid,
.history-main-grid,
.history-toolbar,
.history-tab-row,
.history-row-topline,
.history-chip-row,
.history-sidebar-actions,
.history-schedule-grid,
.history-preview-chip-row {
  display: grid;
  gap: 1rem;
}

.history-shell {
  gap: 1.5rem;
}

.history-top-actions,
.history-sidebar-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  justify-content: flex-end;
}

.history-overview-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.history-overview-card span,
.history-row-time,
.history-row p,
.history-row-error,
.history-empty-state span,
.history-feedback,
.history-inline-label,
.history-schedule-grid span {
  color: rgba(68, 51, 43, 0.72);
  font-size: 0.92rem;
}

.history-overview-card strong {
  font-size: 2rem;
}

.history-overview-card[data-tone="success"] {
  background: rgba(226, 244, 232, 0.72);
  border-color: rgba(105, 164, 122, 0.32);
}

.history-overview-card[data-tone="danger"] {
  background: rgba(251, 233, 231, 0.82);
  border-color: rgba(199, 92, 92, 0.32);
}

.history-overview-card[data-tone="warning"] {
  background: rgba(255, 243, 224, 0.82);
  border-color: rgba(216, 142, 51, 0.26);
}

.history-main-grid {
  grid-template-columns: minmax(0, 1.25fr) minmax(320px, 0.75fr);
  align-items: start;
}

.history-list-panel,
.history-sidebar {
  gap: 1.25rem;
}

.history-sidebar {
  position: sticky;
  top: 1.5rem;
}

.history-toolbar {
  align-items: start;
}

.history-tab-row {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.history-tab {
  border: 1px solid rgba(128, 101, 77, 0.16);
  background: rgba(255, 252, 248, 0.72);
  color: inherit;
  border-radius: 999px;
  padding: 0.72rem 0.92rem;
  font: inherit;
  cursor: pointer;
}

.history-tab.active {
  background: rgba(225, 104, 48, 0.12);
  border-color: rgba(225, 104, 48, 0.38);
  color: #b45321;
}

.history-empty-state {
  display: grid;
  gap: 0.45rem;
  padding: 1.25rem;
  border-radius: 1.25rem;
  background: rgba(255, 252, 248, 0.7);
  border: 1px dashed rgba(128, 101, 77, 0.22);
}

.history-list {
  display: grid;
  gap: 0.9rem;
}

.history-row {
  text-align: left;
  border: 1px solid rgba(128, 101, 77, 0.14);
  background: rgba(255, 252, 248, 0.82);
  border-radius: 1.2rem;
  padding: 1rem 1.05rem;
  display: grid;
  gap: 0.7rem;
  cursor: pointer;
  transition: border-color 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease;
}

.history-row:hover,
.history-row.active {
  border-color: rgba(225, 104, 48, 0.28);
  transform: translateY(-1px);
  box-shadow: 0 14px 32px rgba(128, 101, 77, 0.08);
}

.history-row[data-tone="success"] {
  border-color: rgba(105, 164, 122, 0.22);
}

.history-row[data-tone="danger"] {
  border-color: rgba(199, 92, 92, 0.28);
}

.history-row[data-tone="warning"] {
  border-color: rgba(216, 142, 51, 0.24);
}

.history-row-topline {
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
}

.history-chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.history-row strong {
  font-size: 1rem;
}

.history-row p {
  margin: 0;
}

.history-row-error {
  color: #b84b3c;
}

.history-preview-card {
  display: grid;
  gap: 0.9rem;
  padding: 1rem 1.05rem;
  border-radius: 1.2rem;
  background: rgba(255, 252, 248, 0.82);
  border: 1px solid rgba(128, 101, 77, 0.14);
}

.history-inline-section {
  display: grid;
  gap: 0.8rem;
}

.history-inline-label,
.history-schedule-grid span {
  font-weight: 600;
}

.history-schedule-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.history-schedule-grid label {
  display: grid;
  gap: 0.45rem;
}

.history-schedule-grid input,
.history-schedule-grid select {
  border-radius: 1rem;
  border: 1px solid rgba(128, 101, 77, 0.18);
  background: rgba(255, 252, 248, 0.92);
  padding: 0.85rem 0.95rem;
  font: inherit;
  color: inherit;
}

.history-feedback.success {
  color: #25603d;
}

.history-feedback.danger {
  color: #b84b3c;
}

.history-danger-button {
  border-color: rgba(184, 75, 60, 0.22);
  color: #9f3f32;
}

@media (max-width: 1100px) {
  .history-main-grid,
  .history-overview-grid {
    grid-template-columns: 1fr;
  }

  .history-sidebar {
    position: static;
  }
}

@media (max-width: 760px) {
  .history-tab-row,
  .history-schedule-grid {
    grid-template-columns: 1fr;
  }

  .history-row-topline {
    grid-template-columns: 1fr;
  }

  .history-top-actions,
  .history-sidebar-actions {
    justify-content: stretch;
  }
}
</style>
