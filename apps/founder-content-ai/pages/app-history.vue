<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import type {
  BusinessMembership,
  PostPerformanceLabel,
  ScheduledPost,
  SchedulingSafetyWarning,
  ScheduledPostStatus,
} from "../../../packages/shared-types";
import { useProductAccessContext } from "../access/product-access-context";
import HistorySkeleton from "../components/skeletons/HistorySkeleton.vue";
import { requestMyBusinesses } from "../services/admin-analytics-service";
import { ApiRequestError } from "../services/api-client";
import {
  requestLinkedInSocialAuthStart,
  requestScheduledPosts,
  requestUpdateScheduledPost,
  requestUpdateScheduledPostPerformance,
} from "../services/publishing-service";
import { saveRepurposeSeed } from "../utils/repurpose-loop";
import { appRoutes } from "../utils/routes";
import {
  formatScheduledPostDispatchWindow,
  resolveScheduledPostStatusLabel,
  resolveScheduledPostStatusSummary,
} from "../utils/scheduled-post-status";
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
  { id: "scheduled", label: "Queued" },
  { id: "failed", label: "Failed" },
  { id: "all", label: "All" },
];
const HISTORY_PAGE_SIZE = 20;
const PERFORMANCE_OPTIONS: { value: PostPerformanceLabel; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

const route = useRoute();
const router = useRouter();
const {
  bootstrap: productAccess,
  activeBusinessId,
  setActiveBusinessId,
  isReady: isProductAccessReady,
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
const selectedTab = ref<HistoryTab>(
  HISTORY_TABS.some((tab) => tab.id === route.query.tab)
    ? (route.query.tab as HistoryTab)
    : "published",
);
const selectedScheduledPostId = ref("");
const audienceTimezone = ref("");
const selectedAudienceDateKey = ref("");
const scheduleTime = ref("09:00");
const searchQuery = ref("");
const currentPage = ref(1);
const isLoading = ref(true);
const isUpdating = ref(false);
const isConnectingLinkedIn = ref(false);
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

function resolvePerformanceLabel(label: PostPerformanceLabel | undefined): string {
  switch (label) {
    case "high":
      return "High signal";
    case "medium":
      return "Medium signal";
    case "low":
      return "Low signal";
    default:
      return "Not rated";
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
  sortedPosts.value.filter((post) => {
    if (!matchesTab(post, selectedTab.value)) {
      return false;
    }

    const query = searchQuery.value.trim().toLowerCase();

    if (!query) {
      return true;
    }

    return (
      getDisplayTitle(post).toLowerCase().includes(query) ||
      post.contentText.toLowerCase().includes(query) ||
      resolveScheduledPostStatusLabel(post.status).toLowerCase().includes(query)
    );
  }),
);
const totalPages = computed(() => Math.max(1, Math.ceil(filteredPosts.value.length / HISTORY_PAGE_SIZE)));
const paginatedPosts = computed(() => {
  const startIndex = (currentPage.value - 1) * HISTORY_PAGE_SIZE;
  return filteredPosts.value.slice(startIndex, startIndex + HISTORY_PAGE_SIZE);
});

const selectedScheduledPost = computed(
  () =>
    paginatedPosts.value.find((post) => post.id === selectedScheduledPostId.value) ??
    paginatedPosts.value[0] ??
    null,
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

const selectedScheduledPostCanPublishNow = computed(() => {
  const status = selectedScheduledPost.value?.status;
  return status === "scheduled" || status === "paused" || status === "failed";
});

const selectedScheduledPostCanCancel = computed(() => {
  const status = selectedScheduledPost.value?.status;
  return status === "scheduled" || status === "paused" || status === "failed";
});

const selectedScheduledPostCanReschedule = computed(() => {
  const status = selectedScheduledPost.value?.status;
  return status === "scheduled" || status === "paused" || status === "failed";
});

const selectedScheduledPostCanMoveToDraft = computed(() => {
  const post = selectedScheduledPost.value;

  if (!post?.assetGroupId) {
    return false;
  }

  return (
    post.status === "scheduled"
    || post.status === "paused"
    || post.status === "failed"
    || post.status === "canceled"
  );
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
    { label: "Queued", value: String(scheduled), tone: "default" },
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

const selectedScheduledPostNeedsReconnect = computed(() => {
  const message = selectedScheduledPost.value?.errorMessage?.toLowerCase() || "";
  return message.includes("reconnect linkedin") || message.includes("connection expired");
});

function resolveIdentityTypeLabel(post: ScheduledPost): string {
  if (post.selectedIdentityType === "organization") {
    return "Page";
  }

  if (post.selectedIdentityType === "person") {
    return "Personal";
  }

  return "LinkedIn";
}

function resolveSelectedIdentityLabel(post: ScheduledPost): string {
  if (!post.selectedIdentityDisplayName) {
    return "Workspace LinkedIn identity";
  }

  return `${post.selectedIdentityDisplayName} · ${resolveIdentityTypeLabel(post)}`;
}

function extractSchedulingWarnings(error: unknown): SchedulingSafetyWarning[] {
  if (!(error instanceof ApiRequestError) || error.code !== "scheduling_safety_warning") {
    return [];
  }

  const warnings = error.details?.warnings;

  if (!Array.isArray(warnings)) {
    return [];
  }

  return warnings.flatMap((warning) => {
    if (!warning || typeof warning !== "object") {
      return [];
    }

    const candidate = warning as Record<string, unknown>;

    if (
      typeof candidate.code !== "string" ||
      typeof candidate.title !== "string" ||
      typeof candidate.message !== "string"
    ) {
      return [];
    }

    return [
      {
        code: candidate.code as SchedulingSafetyWarning["code"],
        title: candidate.title,
        message: candidate.message,
      },
    ];
  });
}

function buildSchedulingWarningMessage(warnings: SchedulingSafetyWarning[]): string {
  return warnings.map((warning) => `${warning.title}\n${warning.message}`).join("\n\n");
}

function confirmSchedulingWarnings(warnings: SchedulingSafetyWarning[]): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  return window.confirm(
    `${buildSchedulingWarningMessage(warnings)}\n\nChoose OK to schedule anyway, or Cancel to keep the safer spacing.`,
  );
}

async function reconnectLinkedIn(): Promise<void> {
  if (!resolvedBusinessId.value) {
    errorMessage.value = "Pick a workspace before reconnecting LinkedIn.";
    return;
  }

  isConnectingLinkedIn.value = true;
  errorMessage.value = "";

  try {
    const response = await requestLinkedInSocialAuthStart({
      businessId: resolvedBusinessId.value,
      returnPath: route.fullPath,
    });

    window.location.assign(response.authorizationUrl);
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "Unable to start LinkedIn reconnection.";
  } finally {
    isConnectingLinkedIn.value = false;
  }
}

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

  currentPage.value = Math.min(currentPage.value, totalPages.value);

  if (!paginatedPosts.value.some((post) => post.id === selectedScheduledPostId.value)) {
    selectedScheduledPostId.value = paginatedPosts.value[0]?.id ?? "";
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
  if (!isProductAccessReady.value) {
    isLoading.value = true;
    return;
  }

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
    paginatedPosts.value.find((post) => post.id === postId) ?? null,
  );
  feedbackMessage.value = "";
  errorMessage.value = "";
}

async function mutateSelectedPost(
  action: "pause" | "resume" | "cancel" | "retry" | "publish_now" | "move_to_draft",
): Promise<void> {
  if (!resolvedBusinessId.value || !selectedScheduledPost.value) {
    errorMessage.value = "Pick a post first.";
    return;
  }

  const selectedAssetGroupId = selectedScheduledPost.value.assetGroupId;
  isUpdating.value = true;
  errorMessage.value = "";
  feedbackMessage.value = "";

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
            : action === "retry"
              ? "Failed post re-queued for publishing."
              : action === "publish_now"
                ? "Post pushed to publish now."
                : "Slot removed. The draft is back in the planner backlog.";
    selectedScheduledPostId.value = response.scheduledPost.id;
    await loadHistoryData();
    syncSelection();

    if (action === "move_to_draft" && selectedAssetGroupId) {
      await router.push({
        path: appRoutes.appPlanner,
        query: {
          draftId: selectedAssetGroupId,
        },
      });
    }
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

  const rescheduleRequest = {
    businessId: resolvedBusinessId.value,
    action: "reschedule" as const,
    scheduledAt: convertZonedDateTimeToUtcIso(
      selectedAudienceDateKey.value,
      scheduleTime.value,
      audienceTimezone.value || workspaceDefaultAudienceTimezone.value,
    ),
    audienceTimezone: audienceTimezone.value || workspaceDefaultAudienceTimezone.value,
  };

  try {
    let response;

    try {
      response = await requestUpdateScheduledPost(selectedScheduledPost.value.id, rescheduleRequest);
    } catch (error) {
      const warnings = extractSchedulingWarnings(error);

      if (warnings.length === 0 || !confirmSchedulingWarnings(warnings)) {
        throw error;
      }

      response = await requestUpdateScheduledPost(selectedScheduledPost.value.id, {
        ...rescheduleRequest,
        ignoreSafetyWarnings: true,
      });
      feedbackMessage.value = "Publishing slot updated with a manual safety override.";
    }

    if (!feedbackMessage.value) {
      feedbackMessage.value =
        response.scheduledPost.status === "paused"
          ? "Paused post rescheduled without resuming it."
          : "Publishing slot updated.";
    }
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

async function saveSelectedPostPerformance(performanceLabel: PostPerformanceLabel): Promise<void> {
  if (!resolvedBusinessId.value || !selectedScheduledPost.value) {
    errorMessage.value = "Pick a published post before saving performance.";
    return;
  }

  isUpdating.value = true;
  errorMessage.value = "";
  feedbackMessage.value = "";

  try {
    const response = await requestUpdateScheduledPostPerformance(selectedScheduledPost.value.id, {
      businessId: resolvedBusinessId.value,
      performanceLabel,
    });

    selectedScheduledPostId.value = response.scheduledPost.id;
    scheduledPosts.value = scheduledPosts.value.map((post) =>
      post.id === response.scheduledPost.id ? response.scheduledPost : post,
    );
    feedbackMessage.value = `Saved ${resolvePerformanceLabel(performanceLabel).toLowerCase()} for this post.`;
    syncSelection();
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "Unable to save post performance right now.";
  } finally {
    isUpdating.value = false;
  }
}

function openRepurpose(post: ScheduledPost): void {
  saveRepurposeSeed({
    text: post.contentText,
    title: getDisplayTitle(post),
    source: "history",
  });

  void router.push({
    path: appRoutes.appCreate,
    query: {
      mode: "repurpose",
    },
    hash: "#repurpose-panel",
  });
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
  () => [isProductAccessReady.value, resolvedBusinessId.value, schedulerEnabled.value] as const,
  ([accessReady]) => {
    if (!accessReady) {
      return;
    }

    void initializePage();
  },
);

watch(
  () => selectedTab.value,
  () => {
    currentPage.value = 1;
    void router.replace({
      query: {
        ...route.query,
        tab: selectedTab.value,
      },
    });
    syncSelection();
  },
);

watch(
  () => searchQuery.value,
  () => {
    currentPage.value = 1;
    syncSelection();
  },
);

watch(
  () => currentPage.value,
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
  if (isProductAccessReady.value) {
    void initializePage();
  }
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

    <HistorySkeleton v-if="isLoading" />

    <template v-else>
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

      <section v-if="errorMessage" class="workspace-card empty-state">
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
              Posted items confirm output. Failed items are the recovery queue. Queued items show what is waiting for dispatch.
            </p>
          </div>

          <div class="history-toolbar-actions">
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

            <label class="history-search">
              <span>Search posts</span>
              <input
                v-model="searchQuery"
                type="search"
                placeholder="Search title, content, or status"
              />
            </label>
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
          <div class="history-list-meta">
            <span>{{ filteredPosts.length }} matching post{{ filteredPosts.length === 1 ? "" : "s" }}</span>
            <div class="history-page-controls">
              <button
                type="button"
                class="workspace-secondary-button compact"
                :disabled="currentPage <= 1"
                @click="currentPage -= 1"
              >
                Previous
              </button>
              <span>Page {{ currentPage }} / {{ totalPages }}</span>
              <button
                type="button"
                class="workspace-secondary-button compact"
                :disabled="currentPage >= totalPages"
                @click="currentPage += 1"
              >
                Next
              </button>
            </div>
          </div>
          <button
            v-for="post in paginatedPosts"
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
                <span class="workspace-chip">{{ resolveScheduledPostStatusLabel(post.status) }}</span>
                <span v-if="post.selectedIdentityDisplayName" class="workspace-chip">
                  {{ resolveSelectedIdentityLabel(post) }}
                </span>
                <span v-if="post.performanceLabel" class="workspace-chip">
                  {{ resolvePerformanceLabel(post.performanceLabel) }}
                </span>
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
          <p class="workspace-eyebrow">Selected slot</p>
          <h2>{{ getDisplayTitle(selectedScheduledPost) }}</h2>
          <p class="workspace-description compact">
            {{ resolveScheduledPostStatusLabel(selectedScheduledPost.status) }} ·
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
          <p class="workspace-description compact">
            Publishing as {{ resolveSelectedIdentityLabel(selectedScheduledPost) }}
          </p>
          <p class="workspace-description compact">
            {{ resolveScheduledPostStatusSummary(selectedScheduledPost) }}
          </p>

          <article class="history-preview-card">
            <div class="history-preview-chip-row">
              <p class="workspace-chip">{{ resolveScheduledPostStatusLabel(selectedScheduledPost.status) }}</p>
              <p v-if="selectedScheduledPost.selectedIdentityDisplayName" class="workspace-chip">
                {{ resolveSelectedIdentityLabel(selectedScheduledPost) }}
              </p>
              <p v-if="selectedScheduledPost.performanceLabel" class="workspace-chip">
                {{ resolvePerformanceLabel(selectedScheduledPost.performanceLabel) }}
              </p>
              <p v-if="getMediaCount(selectedScheduledPost) > 0" class="workspace-chip">
                📎 {{ getMediaCount(selectedScheduledPost) }} image{{ getMediaCount(selectedScheduledPost) === 1 ? "" : "s" }}
              </p>
            </div>
            <p>{{ selectedScheduledPost.contentText }}</p>
          </article>

          <div v-if="selectedScheduledPost.status === 'published'" class="history-inline-section">
            <label class="history-inline-label">How did this perform?</label>
            <div class="history-chip-row">
              <button
                v-for="option in PERFORMANCE_OPTIONS"
                :key="option.value"
                type="button"
                class="workspace-secondary-button"
                :disabled="isUpdating"
                :data-active="selectedScheduledPost.performanceLabel === option.value"
                @click="saveSelectedPostPerformance(option.value)"
              >
                {{ option.label }}
              </button>
            </div>
            <p class="workspace-description compact">
              Save a simple signal now. This becomes the first step toward performance-informed generation.
            </p>
          </div>

          <div v-if="selectedScheduledPost.errorMessage" class="history-feedback danger">
            {{ selectedScheduledPost.errorMessage }}
          </div>

          <p class="workspace-description compact">
            Dispatch window: {{ formatScheduledPostDispatchWindow(selectedScheduledPost) }}
          </p>

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
              type="button"
              class="workspace-secondary-button"
              @click="openRepurpose(selectedScheduledPost)"
            >
              Repurpose
            </button>
            <button
              v-if="selectedScheduledPostCanPublishNow"
              type="button"
              class="workspace-primary-button"
              :disabled="isUpdating"
              @click="mutateSelectedPost('publish_now')"
            >
              {{ isUpdating ? "Updating..." : "Publish now" }}
            </button>
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
              v-if="selectedScheduledPostNeedsReconnect"
              type="button"
              class="workspace-secondary-button"
              :disabled="isConnectingLinkedIn"
              @click="reconnectLinkedIn"
            >
              {{ isConnectingLinkedIn ? "Redirecting..." : "Reconnect LinkedIn" }}
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
              v-if="selectedScheduledPostCanMoveToDraft"
              type="button"
              class="workspace-secondary-button"
              :disabled="isUpdating"
              @click="mutateSelectedPost('move_to_draft')"
            >
              {{ isUpdating ? "Updating..." : "Move to draft" }}
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
    </template>
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
.history-sidebar-actions,
.history-page-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  justify-content: flex-end;
}

.history-toolbar-actions,
.history-list-meta {
  display: grid;
  gap: 1rem;
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

.history-search {
  display: grid;
  gap: 0.4rem;
}

.history-search span {
  color: rgba(68, 51, 43, 0.72);
  font-size: 0.82rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.history-search input {
  min-width: min(100%, 18rem);
  border: 1px solid rgba(68, 51, 43, 0.14);
  border-radius: 0.95rem;
  padding: 0.85rem 0.95rem;
  font: inherit;
  color: inherit;
  background: rgba(255, 255, 255, 0.88);
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

.history-list-meta {
  grid-template-columns: 1fr auto;
  align-items: center;
  color: rgba(68, 51, 43, 0.72);
  font-size: 0.92rem;
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

.workspace-secondary-button[data-active="true"] {
  background: rgba(225, 104, 48, 0.12);
  border-color: rgba(225, 104, 48, 0.38);
  color: #b45321;
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
