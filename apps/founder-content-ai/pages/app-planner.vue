<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import type {
  BusinessMembership,
  ControlDashboardResponse,
  PostAsset,
  RecommendedPostTimeSlot,
  ScheduledPost,
  SchedulingSafetyWarning,
  ScheduledPostStatus,
  SocialAccount,
} from "../../../packages/shared-types";
import { useAuthContext } from "../auth/auth-context";
import { useProductAccessContext } from "../access/product-access-context";
import MetaPageSelectionModal from "../components/MetaPageSelectionModal.vue";
import PlannerSkeleton from "../components/skeletons/PlannerSkeleton.vue";
import { requestMyBusinesses } from "../services/admin-analytics-service";
import { ApiRequestError } from "../services/api-client";
import {
  requestControlDashboard,
  requestDeletePipelineItem,
  requestDuplicatePipelineItem,
} from "../services/control-dashboard-service";
import {
  requestLinkedInSocialAuthStart,
  requestMetaSocialAuthStart,
  requestRecommendedPostTimes,
  requestSchedulePost,
  requestScheduledPosts,
  requestSocialAccounts,
  requestUpdateScheduledPost,
} from "../services/publishing-service";
import { requestPostAssets } from "../services/post-assets-service";
import { appRoutes } from "../utils/routes";
import {
  addDaysToDateKey,
  convertZonedDateTimeToUtcIso,
  detectUserTimezone,
  formatDateInTimezone,
  formatTimeWithZone,
  startOfWeekDateKey,
  toDateKeyInTimezone,
  toTimeValueInTimezone,
} from "../utils/timezone";
import {
  formatScheduledPostDispatchWindow,
  resolveScheduledPostStatusLabel,
  resolveScheduledPostStatusSummary,
} from "../utils/scheduled-post-status";
import {
  findConnectedFacebookAccount,
  findConnectedInstagramAccount,
  findConnectedLinkedInAccount,
  formatSelectedPlatformsLabel,
  looksLikeSocialReconnectIssue,
  parsePublishableSocialPlatform,
  parsePublishableSocialPlatforms,
  PUBLISHABLE_SOCIAL_PLATFORMS,
  resolveExternalPostLabel,
  resolveScheduledIdentityLabel,
  resolveSocialPlatformLabel,
  type PublishableSocialPlatform,
} from "../utils/social-platforms";
import { toFriendlySocialAuthMessage } from "../utils/social-auth-errors";
import { toFriendlyMediaStorageMessage } from "../services/media-storage-errors";

interface PlannerDayModel {
  key: string;
  weekdayLabel: string;
  dayLabel: string;
  longLabel: string;
  isToday: boolean;
  isGap: boolean;
  posts: ScheduledPost[];
}

interface LinkedInPreviewModel {
  visibleText: string;
  truncated: boolean;
}

const route = useRoute();
const router = useRouter();
const auth = useAuthContext();
const {
  bootstrap: productAccess,
  activeBusinessId,
  refreshProductAccess,
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
const dashboard = ref<ControlDashboardResponse | null>(null);
const scheduledPosts = ref<ScheduledPost[]>([]);
const socialAccounts = ref<SocialAccount[]>([]);
const selectedBacklogPostAssets = ref<PostAsset[]>([]);
const recommendedSlots = ref<RecommendedPostTimeSlot[]>([]);
const recommendedTimezone = ref("UTC");
const isLoading = ref(true);
const isScheduling = ref(false);
const isUpdatingScheduledPost = ref(false);
const loadErrorMessage = ref("");
const errorMessage = ref("");
const feedbackMessage = ref("");
const selectedGridDateKey = ref("");
const selectedAudienceDateKey = ref("");
const selectedWeekStartKey = ref("");
const selectedScheduledPostId = ref("");
const selectedBacklogAssetId = ref("");
const scheduleTime = ref("09:00");
const audienceTimezone = ref("");
const isConnectingLinkedIn = ref(false);
const isConnectingMeta = ref(false);
const initialSchedulingPlatforms = parsePublishableSocialPlatforms(route.query.platforms);
const initialSchedulingPlatform =
  parsePublishableSocialPlatform(route.query.platform)
  ?? initialSchedulingPlatforms[0]
  ?? "linkedin";
const selectedSchedulingPlatform = ref<PublishableSocialPlatform>(initialSchedulingPlatform);
const selectedSchedulingPlatforms = ref<PublishableSocialPlatform[]>(
  initialSchedulingPlatforms.length > 0 ? initialSchedulingPlatforms : [initialSchedulingPlatform],
);
const isMetaSelectionModalOpen = ref(false);
const pendingMetaSession = ref("");
const draftActionAssetId = ref("");
const draftActionKind = ref<"duplicate" | "delete" | "">("");

const resolvedBusinessId = computed(
  () => {
    const availableBusinessIds = new Set(businesses.value.map((membership) => membership.businessId));
    const bootstrapBusinessId = productAccess.value?.activeBusinessId?.trim() ?? "";

    if (bootstrapBusinessId && availableBusinessIds.has(bootstrapBusinessId)) {
      return bootstrapBusinessId;
    }

    const storedBusinessId = activeBusinessId.value?.trim() ?? "";

    if (storedBusinessId && availableBusinessIds.has(storedBusinessId)) {
      return storedBusinessId;
    }

    return businesses.value[0]?.businessId || "";
  },
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

const canReadDraftBacklog = computed(
  () =>
    !resolvedBusinessId.value ||
    !productAccess.value?.activeBusinessId ||
    isFeatureEnabled("control_dashboard"),
);
const accessMatchesResolvedBusiness = computed(
  () => productAccess.value?.businessId === resolvedBusinessId.value,
);
const accessLimits = computed(() =>
  accessMatchesResolvedBusiness.value ? productAccess.value?.limits ?? null : null,
);
const scheduledQueueLimit = computed(() => accessLimits.value?.scheduledQueueLimit ?? null);
const scheduledQueueUsed = computed(() => accessLimits.value?.scheduledQueueUsed ?? 0);
const scheduledQueueRemaining = computed(() => accessLimits.value?.scheduledQueueRemaining ?? null);
const hasScheduledQueuePreview = computed(() => scheduledQueueLimit.value !== null);
const queueLimitReached = computed(
  () => hasScheduledQueuePreview.value && scheduledQueueRemaining.value === 0,
);
const queuePreviewHeadline = computed(() => {
  if (!hasScheduledQueuePreview.value || scheduledQueueLimit.value === null) {
    return "";
  }

  if (queueLimitReached.value) {
    return `${scheduledQueueUsed.value} of ${scheduledQueueLimit.value} queued`;
  }

  if (scheduledQueueRemaining.value === scheduledQueueLimit.value) {
    return `${scheduledQueueLimit.value} queued post${scheduledQueueLimit.value === 1 ? "" : "s"} available`;
  }

  return `${scheduledQueueRemaining.value} queue slot${scheduledQueueRemaining.value === 1 ? "" : "s"} left`;
});
const queuePreviewCopy = computed(() => {
  if (!hasScheduledQueuePreview.value) {
    return "";
  }

  if (queueLimitReached.value) {
    return "Your free queue is full. Upgrade to line up the rest of the week and stay consistent.";
  }

  return `Queue up to ${scheduledQueueLimit.value} post${scheduledQueueLimit.value === 1 ? "" : "s"} for free, feel the timing advantage, then upgrade when you want the rest of the week lined up.`;
});
const queueLimitPrompt = computed(() =>
  queueLimitReached.value
    ? "Plan your week in advance and stay consistent. Upgrade to unlock scheduling queue."
    : "",
);

const pipelineItems = computed(() => dashboard.value?.pipeline.flatMap((column) => column.items) ?? []);

const unscheduledBacklog = computed(() =>
  pipelineItems.value.filter((item) => {
    const stage = item.pipelineStage ?? "draft";
    return stage === "draft" || stage === "review";
  }),
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

const connectedLinkedInAccount = computed(() => findConnectedLinkedInAccount(socialAccounts.value));
const connectedFacebookAccount = computed(() => findConnectedFacebookAccount(socialAccounts.value));
const connectedInstagramAccount = computed(() => findConnectedInstagramAccount(socialAccounts.value));
const selectedSchedulingPlatformLabel = computed(() => resolveSocialPlatformLabel(selectedSchedulingPlatform.value));
const selectedSchedulingPlatformsLabel = computed(() =>
  formatSelectedPlatformsLabel(selectedSchedulingPlatforms.value),
);

function resolveSchedulingGuardrail(platform: PublishableSocialPlatform): string {
  const readyImageCount = selectedBacklogPostAssets.value.filter((asset) => asset.type === "image").length;
  const readyVideoCount = selectedBacklogPostAssets.value.filter((asset) => asset.type === "video").length;

  if (readyImageCount > 0 && readyVideoCount > 0) {
    return "Mixed image and video drafts are not publishable yet. Use only one media type per post.";
  }

  if (platform === "linkedin" && !connectedLinkedInAccount.value) {
    return "Connect LinkedIn before queueing LinkedIn posts.";
  }

  if (platform === "linkedin" && readyVideoCount > 0) {
    return "Video is publishable on Instagram and Facebook. LinkedIn video support is coming soon.";
  }

  if (platform === "facebook" && !connectedFacebookAccount.value) {
    return "Connect a Facebook Page before queueing Facebook posts.";
  }

  if (platform === "instagram") {
    if (!connectedInstagramAccount.value) {
      return "Connect a Facebook Page with a linked Instagram business account before queueing Instagram posts.";
    }

    if (!selectedBacklogAsset.value) {
      return "";
    }

    if (readyVideoCount > 1) {
      return "Instagram video scheduling currently supports exactly 1 ready video on the draft.";
    }

    if (readyVideoCount === 0 && (readyImageCount < 1 || readyImageCount > 10)) {
      return "Instagram scheduling requires either 1 ready video or between 1 and 10 ready images on the draft.";
    }
  }

  if (platform === "facebook") {
    if (readyVideoCount > 1) {
      return "Facebook video scheduling currently supports exactly 1 ready video on the draft.";
    }

    if (readyVideoCount === 0 && readyImageCount > 10) {
      return "Facebook scheduling supports up to 10 ready images on the draft.";
    }
  }

  if (platform === "linkedin" && readyImageCount > 20) {
    return "LinkedIn image scheduling supports up to 20 ready images on the draft.";
  }

  return "";
}

const selectedSchedulingGuardrail = computed(() => resolveSchedulingGuardrail(selectedSchedulingPlatform.value));
const selectableSchedulingPlatforms = computed(() =>
  PUBLISHABLE_SOCIAL_PLATFORMS.filter((platform) => resolveSchedulingGuardrail(platform) === ""),
);
const canScheduleSelectedPlatforms = computed(() => selectedSchedulingPlatforms.value.length > 0);
const selectedSchedulingCapacityGuardrail = computed(() => {
  if (scheduledQueueRemaining.value === null || selectedSchedulingPlatforms.value.length === 0) {
    return "";
  }

  if (scheduledQueueRemaining.value === 0) {
    return queueLimitPrompt.value;
  }

  return "";
});

function isSchedulingPlatformSelected(platform: PublishableSocialPlatform): boolean {
  return selectedSchedulingPlatforms.value.includes(platform);
}

function resolveSchedulingPlatformHint(platform: PublishableSocialPlatform): string {
  const guardrail = resolveSchedulingGuardrail(platform);

  if (guardrail) {
    return guardrail;
  }

  if (platform === "instagram") {
    return connectedInstagramAccount.value
      ? "Instagram business account ready for queueing."
      : "Connect Instagram through Meta.";
  }

  if (platform === "facebook") {
    return connectedFacebookAccount.value
      ? "Workspace Facebook Page is ready."
      : "Connect a Facebook Page to enable queueing.";
  }

  return connectedLinkedInAccount.value
    ? "LinkedIn identity ready for queueing."
    : "Connect LinkedIn to enable queueing.";
}

function toggleSchedulingPlatform(platform: PublishableSocialPlatform): void {
  selectedSchedulingPlatform.value = platform;

  if (resolveSchedulingGuardrail(platform) !== "") {
    return;
  }

  if (isSchedulingPlatformSelected(platform)) {
    selectedSchedulingPlatforms.value = selectedSchedulingPlatforms.value.filter(
      (candidate) => candidate !== platform,
    );
    return;
  }

  selectedSchedulingPlatforms.value = [
    ...selectedSchedulingPlatforms.value,
    platform,
  ];
}

watch(
  selectableSchedulingPlatforms,
  (nextSelectable) => {
    const nextSelected = PUBLISHABLE_SOCIAL_PLATFORMS.filter(
      (platform) =>
        nextSelectable.includes(platform) && selectedSchedulingPlatforms.value.includes(platform),
    );

    if (
      nextSelected.length !== selectedSchedulingPlatforms.value.length
      || nextSelected.some((platform, index) => platform !== selectedSchedulingPlatforms.value[index])
    ) {
      selectedSchedulingPlatforms.value = nextSelected;
    }

    if (
      selectedSchedulingPlatforms.value.length > 0
      && !selectedSchedulingPlatforms.value.includes(selectedSchedulingPlatform.value)
    ) {
      selectedSchedulingPlatform.value = selectedSchedulingPlatforms.value[0];
    }
  },
  { immediate: true },
);

const postsByDayKey = computed(() => {
  const grouped = new Map<string, ScheduledPost[]>();

  for (const post of scheduledPosts.value) {
    const anchor = post.status === "published" ? post.publishedAt || post.scheduledAt : post.scheduledAt;
    const key = toDateKeyInTimezone(anchor, userTimezone);
    const bucket = grouped.get(key) ?? [];
    bucket.push(post);
    grouped.set(key, bucket);
  }

  for (const bucket of grouped.values()) {
    bucket.sort((left, right) => new Date(left.scheduledAt).getTime() - new Date(right.scheduledAt).getTime());
  }

  return grouped;
});

const weekDays = computed<PlannerDayModel[]>(() => {
  if (!selectedWeekStartKey.value) {
    return [];
  }

  return Array.from({ length: 7 }, (_, index) => {
    const dateKey = addDaysToDateKey(selectedWeekStartKey.value, index);
    const displayDate = new Date(`${dateKey}T12:00:00.000Z`);
    const posts = postsByDayKey.value.get(dateKey) ?? [];
    const isGap = !posts.some((post) =>
      post.status === "scheduled" || post.status === "processing" || post.status === "published",
    );

    return {
      key: dateKey,
      weekdayLabel: formatDateInTimezone(displayDate, "UTC", { weekday: "short" }),
      dayLabel: formatDateInTimezone(displayDate, "UTC", { day: "numeric" }),
      longLabel: formatDateInTimezone(displayDate, "UTC", {
        weekday: "long",
        month: "short",
        day: "numeric",
      }),
      isToday: dateKey === toDateKeyInTimezone(new Date(), userTimezone),
      isGap,
      posts,
    };
  });
});

const selectedDay = computed(
  () => weekDays.value.find((day) => day.key === selectedGridDateKey.value) ?? weekDays.value[0] ?? null,
);

const gapDays = computed(() => weekDays.value.filter((day) => day.isGap));

const weekRangeLabel = computed(() => {
  if (weekDays.value.length === 0) {
    return "This week";
  }

  const firstDate = new Date(`${weekDays.value[0].key}T12:00:00.000Z`);
  const lastDate = new Date(`${weekDays.value[weekDays.value.length - 1].key}T12:00:00.000Z`);

  const firstMonth = formatDateInTimezone(firstDate, "UTC", { month: "short" });
  const lastMonth = formatDateInTimezone(lastDate, "UTC", { month: "short" });
  const firstDay = formatDateInTimezone(firstDate, "UTC", { day: "numeric" });
  const lastDay = formatDateInTimezone(lastDate, "UTC", { day: "numeric" });

  return firstMonth === lastMonth
    ? `${firstMonth} ${firstDay}-${lastDay}`
    : `${firstMonth} ${firstDay} - ${lastMonth} ${lastDay}`;
});

const bestSlot = computed(() => recommendedSlots.value[0] ?? null);

const plannerHeaderTitle = computed(() => {
  if (gapDays.value.length > 0) {
    return `This week: ${gapDays.value.length} gap${gapDays.value.length === 1 ? "" : "s"} to fill`;
  }

  return "This week is covered";
});

const plannerGridHint = computed(() => {
  if (bestSlot.value) {
    return `Tip: ${bestSlot.value.localLabel} is your strongest engagement window in ${recommendedTimezone.value}.`;
  }

  if (queueLimitReached.value) {
    return queueLimitPrompt.value;
  }

  return "Empty days show one action. Filled days stay focused on the post itself.";
});

const backlogTitle = computed(() => {
  const count = unscheduledBacklog.value.length;
  return `${count} saved draft${count === 1 ? "" : "s"} waiting for a slot`;
});

const selectedScheduledPost = computed(
  () => scheduledPosts.value.find((post) => post.id === selectedScheduledPostId.value) ?? null,
);

const selectedScheduledPostPreview = computed<LinkedInPreviewModel | null>(() => {
  if (!selectedScheduledPost.value) {
    return null;
  }

  return buildLinkedInPreview(selectedScheduledPost.value.contentText);
});

const selectedScheduledPostPreviewImageUrl = computed(() => {
  const post = selectedScheduledPost.value;

  if (!post) {
    return "";
  }

  const assetPreviewUrl =
    post.assets.find((asset) => asset.previewUrl || asset.storageUrl)?.previewUrl
    || post.assets.find((asset) => asset.previewUrl || asset.storageUrl)?.storageUrl;

  if (assetPreviewUrl) {
    return assetPreviewUrl;
  }

  return post.slides[0]?.imageDataUrl || "";
});

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

const selectedBacklogAsset = computed(
  () => unscheduledBacklog.value.find((asset) => asset.id === selectedBacklogAssetId.value) ?? null,
);
const canQueueSelectedAsset = computed(
  () => Boolean(selectedBacklogAsset.value) && !queueLimitReached.value,
);
const isPlannerDetailModalOpen = computed(
  () => Boolean(selectedScheduledPost.value || selectedBacklogAsset.value),
);

const activeDraftActionLabel = computed(() => {
  if (draftActionKind.value === "duplicate") {
    return "Duplicating...";
  }

  if (draftActionKind.value === "delete") {
    return "Deleting...";
  }

  return "";
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
const selectedAudienceDateLabel = computed(() => {
  if (!selectedAudienceDateKey.value) {
    return "";
  }

  return formatDateInTimezone(`${selectedAudienceDateKey.value}T12:00:00.000Z`, "UTC", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
});

const selectedScheduledPostNeedsReconnect = computed(() => {
  return selectedScheduledPost.value ? looksLikeSocialReconnectIssue(selectedScheduledPost.value) : false;
});

const selectedScheduledPostFriendlyError = computed(() =>
  toFriendlyMediaStorageMessage(selectedScheduledPost.value?.errorMessage),
);

const selectedScheduledPostErrorContext = computed<{
  title: string;
  description: string;
  tone: "danger" | "warning";
} | null>(() => {
  const post = selectedScheduledPost.value;

  if (!post?.errorMessage) {
    return null;
  }

  if (post.status === "failed") {
    return {
      title: "Last publish failure",
      description: "This was the reason the most recent publish attempt failed. Fix it, then retry or publish now.",
      tone: "danger",
    };
  }

  if (post.status === "scheduled" && post.retryCount > 0) {
    return {
      title: "Retry queued",
      description: "A previous attempt failed, but the worker is scheduled to try again automatically.",
      tone: "warning",
    };
  }

  return {
    title: "Delivery note",
    description: "This message came from the last delivery attempt.",
    tone: "warning",
  };
});

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

function extractScheduledQueueLimitMessage(error: unknown): string | null {
  if (!(error instanceof ApiRequestError) || error.code !== "scheduled_queue_limit_reached") {
    return null;
  }

  return error.message || "Plan your week in advance and stay consistent. Upgrade to unlock scheduling queue.";
}

async function connectInstagram(): Promise<void> {
  if (!resolvedBusinessId.value) {
    errorMessage.value = "Pick a workspace before connecting Instagram.";
    return;
  }

  isConnectingMeta.value = true;
  errorMessage.value = "";

  try {
    const response = await requestMetaSocialAuthStart({
      businessId: resolvedBusinessId.value,
      platform: "instagram",
      returnPath: route.fullPath,
    });

    window.location.assign(response.authorizationUrl);
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "Unable to start Meta reconnection.";
  } finally {
    isConnectingMeta.value = false;
  }
}

async function connectFacebook(): Promise<void> {
  if (!resolvedBusinessId.value) {
    errorMessage.value = "Pick a workspace before connecting Facebook.";
    return;
  }

  isConnectingMeta.value = true;
  errorMessage.value = "";

  try {
    const response = await requestMetaSocialAuthStart({
      businessId: resolvedBusinessId.value,
      platform: "facebook",
      returnPath: route.fullPath,
    });

    window.location.assign(response.authorizationUrl);
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "Unable to start Meta reconnection.";
  } finally {
    isConnectingMeta.value = false;
  }
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

async function reconnectSelectedPlatform(): Promise<void> {
  if (
    selectedScheduledPost.value?.platform === "instagram"
    || selectedScheduledPost.value?.platform === "facebook"
  ) {
    if (selectedScheduledPost.value?.platform === "facebook") {
      await connectFacebook();
      return;
    }

    await connectInstagram();
    return;
  }

  await reconnectLinkedIn();
}

function closeMetaSelectionModal(): void {
  isMetaSelectionModalOpen.value = false;
  pendingMetaSession.value = "";
  isConnectingMeta.value = false;
}

async function handleMetaConnected(): Promise<void> {
  closeMetaSelectionModal();
  feedbackMessage.value =
    selectedSchedulingPlatform.value === "facebook"
      ? "Facebook connected. The planner is ready to queue Facebook posts."
      : "Instagram connected. The planner is ready to queue Instagram posts.";
  await loadSocialAccounts();
}

function handleMetaSelectionError(message: string): void {
  errorMessage.value = message;
  isConnectingMeta.value = false;
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

function buildExcerpt(value: string, maxLength = 140): string {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength).trimEnd()}...`;
}

function normalizePreviewParagraphs(value: string): string[] {
  return value
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/[ \t]+\n/g, "\n").trim())
    .filter((paragraph) => paragraph.length > 0);
}

function buildLinkedInPreview(value: string, visibleLimit = 230): LinkedInPreviewModel {
  const normalizedParagraphs = normalizePreviewParagraphs(value);
  const normalizedText = normalizedParagraphs.join("\n\n").trim();

  if (normalizedText.length <= visibleLimit) {
    return {
      visibleText: normalizedText,
      truncated: false,
    };
  }

  const truncatedText = normalizedText.slice(0, visibleLimit).trimEnd();
  const lastWhitespaceIndex = truncatedText.lastIndexOf(" ");
  const safePreview = lastWhitespaceIndex > 120
    ? truncatedText.slice(0, lastWhitespaceIndex).trimEnd()
    : truncatedText;

  return {
    visibleText: `${safePreview}...`,
    truncated: true,
  };
}

function initializeWeekState(): void {
  const todayKey = toDateKeyInTimezone(new Date(), userTimezone);

  if (!selectedWeekStartKey.value) {
    selectedWeekStartKey.value = startOfWeekDateKey(todayKey);
  }

  if (!selectedGridDateKey.value) {
    selectedGridDateKey.value = todayKey;
  }

  if (!selectedAudienceDateKey.value) {
    selectedAudienceDateKey.value = todayKey;
  }
}

function syncSelection(): void {
  const dayExists = weekDays.value.some((day) => day.key === selectedGridDateKey.value);

  if (!dayExists) {
    selectedGridDateKey.value = weekDays.value[0]?.key ?? "";
  }

  if (
    selectedScheduledPostId.value &&
    !scheduledPosts.value.some((post) => post.id === selectedScheduledPostId.value)
  ) {
    selectedScheduledPostId.value = "";
  }

  if (
    selectedBacklogAssetId.value &&
    !unscheduledBacklog.value.some((asset) => asset.id === selectedBacklogAssetId.value)
  ) {
    selectedBacklogAssetId.value = "";
  }
}

async function consumeIncomingDraftSelection(): Promise<void> {
  const incomingDraftId = typeof route.query.draftId === "string" ? route.query.draftId.trim() : "";
  const incomingPlatforms = parsePublishableSocialPlatforms(route.query.platforms);
  const incomingPlatform =
    parsePublishableSocialPlatform(route.query.platform)
    ?? incomingPlatforms[0]
    ?? "linkedin";

  if (!incomingDraftId) {
    return;
  }

  const nextQuery = { ...route.query };
  delete nextQuery.draftId;
  delete nextQuery.platform;
  delete nextQuery.platforms;

  const matchingDraft = unscheduledBacklog.value.find((asset) => asset.id === incomingDraftId);

  if (matchingDraft) {
    selectedSchedulingPlatform.value = incomingPlatform;
    if (incomingPlatforms.length > 0) {
      selectedSchedulingPlatforms.value = incomingPlatforms.filter(
        (platform) => resolveSchedulingGuardrail(platform) === "",
      );
    } else if (resolveSchedulingGuardrail(incomingPlatform) === "") {
      selectedSchedulingPlatforms.value = [incomingPlatform];
    }
    selectBacklogAsset(matchingDraft.id, selectedGridDateKey.value || toDateKeyInTimezone(new Date(), userTimezone));
    feedbackMessage.value = "Draft loaded from the result page. Pick the slot and schedule it.";
    await router.replace({ query: nextQuery });
    return;
  }

  if (scheduledPosts.value.some((post) => post.assetGroupId === incomingDraftId)) {
    feedbackMessage.value = "That draft is already scheduled. Update the existing slot from here.";
    await router.replace({ query: nextQuery });
    return;
  }

  feedbackMessage.value = "That draft is not available in the backlog right now.";
  await router.replace({ query: nextQuery });
}

async function loadBusinesses(): Promise<void> {
  const response = await requestMyBusinesses();
  businesses.value = response.businesses;

  const availableBusinessIds = new Set(response.businesses.map((membership) => membership.businessId));
  const requestedBusinessId = productAccess.value?.activeBusinessId?.trim() ?? activeBusinessId.value?.trim() ?? "";
  const preferredBusinessId = requestedBusinessId && availableBusinessIds.has(requestedBusinessId)
    ? requestedBusinessId
    : response.businesses[0]?.businessId || "";

  if (!preferredBusinessId) {
    if (activeBusinessId.value) {
      await setActiveBusinessId("");
    }
    return;
  }

  if (preferredBusinessId !== productAccess.value?.activeBusinessId) {
    await setActiveBusinessId(preferredBusinessId);
  }
}

async function loadSocialAccounts(): Promise<void> {
  if (!resolvedBusinessId.value) {
    socialAccounts.value = [];
    return;
  }

  try {
    const response = await requestSocialAccounts(resolvedBusinessId.value);
    socialAccounts.value = response.accounts;
  } catch {
    socialAccounts.value = [];
  }
}

async function loadSelectedBacklogPostAssets(): Promise<void> {
  if (!resolvedBusinessId.value || !selectedBacklogAssetId.value) {
    selectedBacklogPostAssets.value = [];
    return;
  }

  try {
    const response = await requestPostAssets(resolvedBusinessId.value, selectedBacklogAssetId.value);
    selectedBacklogPostAssets.value = response.assets.filter((asset) => asset.status === "ready");
  } catch {
    selectedBacklogPostAssets.value = [];
  }
}

async function loadPlannerData(): Promise<void> {
  if (!auth.isReady.value || !auth.isAuthenticated.value || !resolvedBusinessId.value || !schedulerEnabled.value) {
    dashboard.value = null;
    scheduledPosts.value = [];
    recommendedSlots.value = [];
    socialAccounts.value = [];
    return;
  }

  const [scheduledResponse, recommendationsResponse] = await Promise.all([
    requestScheduledPosts(resolvedBusinessId.value),
    requestRecommendedPostTimes(
      resolvedBusinessId.value,
      "text",
      audienceTimezone.value || workspaceDefaultAudienceTimezone.value,
    ).catch(() => null),
    loadSocialAccounts(),
  ]);

  scheduledPosts.value = scheduledResponse.scheduledPosts;

  if (recommendationsResponse) {
    recommendedSlots.value = recommendationsResponse.slots;
    recommendedTimezone.value = recommendationsResponse.timezone;

    if (!scheduleTime.value && recommendationsResponse.slots[0]) {
      scheduleTime.value = toTimeValueInTimezone(
        recommendationsResponse.slots[0].scheduledAt,
        audienceTimezone.value || workspaceDefaultAudienceTimezone.value,
      );
    }
  } else {
    recommendedSlots.value = [];
    recommendedTimezone.value = audienceTimezone.value || workspaceDefaultAudienceTimezone.value;
  }

  if (canReadDraftBacklog.value) {
    try {
      dashboard.value = await requestControlDashboard(resolvedBusinessId.value);
    } catch {
      dashboard.value = null;
    }
  } else {
    dashboard.value = null;
  }
}

async function initializePage(): Promise<void> {
  if (!isProductAccessReady.value) {
    isLoading.value = true;
    return;
  }

  isLoading.value = true;
  loadErrorMessage.value = "";

  try {
    await loadBusinesses();
    initializeWeekState();
    await loadPlannerData();
    syncSelection();
    await consumeIncomingDraftSelection();
  } catch (error) {
    loadErrorMessage.value =
      error instanceof Error ? error.message : "Unable to load the planner right now.";
  } finally {
    isLoading.value = false;
  }
}

function goToPreviousWeek(): void {
  selectedWeekStartKey.value = addDaysToDateKey(selectedWeekStartKey.value, -7);
  selectedGridDateKey.value = selectedWeekStartKey.value;
  selectedScheduledPostId.value = "";
  selectedBacklogAssetId.value = "";
}

function goToNextWeek(): void {
  selectedWeekStartKey.value = addDaysToDateKey(selectedWeekStartKey.value, 7);
  selectedGridDateKey.value = selectedWeekStartKey.value;
  selectedScheduledPostId.value = "";
  selectedBacklogAssetId.value = "";
}

function goToCurrentWeek(): void {
  const todayKey = toDateKeyInTimezone(new Date(), userTimezone);
  selectedWeekStartKey.value = startOfWeekDateKey(todayKey);
  selectedGridDateKey.value = todayKey;
  selectedAudienceDateKey.value = todayKey;
  selectedScheduledPostId.value = "";
  selectedBacklogAssetId.value = "";
}

function selectDay(dayKey: string): void {
  selectedGridDateKey.value = dayKey;
  selectedAudienceDateKey.value = dayKey;
  selectedScheduledPostId.value = "";
  selectedBacklogAssetId.value = "";
  feedbackMessage.value = "";
}

function selectScheduledPost(postId: string, dayKey: string): void {
  selectedGridDateKey.value = dayKey;
  selectedScheduledPostId.value = postId;
  selectedBacklogAssetId.value = "";
  const post = scheduledPosts.value.find((candidate) => candidate.id === postId);

  if (post) {
    audienceTimezone.value = post.audienceTimezone;
    selectedAudienceDateKey.value = toDateKeyInTimezone(post.scheduledAt, post.audienceTimezone);
    scheduleTime.value = toTimeValueInTimezone(post.scheduledAt, post.audienceTimezone);
  }

  feedbackMessage.value = "";
}

function selectBacklogAsset(assetId: string, dayKey?: string): void {
  selectedBacklogAssetId.value = assetId;
  selectedScheduledPostId.value = "";

  if (dayKey) {
    selectedGridDateKey.value = dayKey;
    selectedAudienceDateKey.value = dayKey;
  }

  feedbackMessage.value = "";
  void loadSelectedBacklogPostAssets();
}

function isDraftActionPending(assetId: string, kind?: "duplicate" | "delete"): boolean {
  if (!assetId || assetId !== draftActionAssetId.value) {
    return false;
  }

  if (!kind) {
    return true;
  }

  return draftActionKind.value === kind;
}

function applyRecommendedSlot(slot: RecommendedPostTimeSlot): void {
  const gridDayKey = toDateKeyInTimezone(slot.scheduledAt, userTimezone);
  const audienceDayKey = toDateKeyInTimezone(
    slot.scheduledAt,
    audienceTimezone.value || workspaceDefaultAudienceTimezone.value,
  );
  selectedWeekStartKey.value = startOfWeekDateKey(gridDayKey);
  selectedGridDateKey.value = gridDayKey;
  selectedAudienceDateKey.value = audienceDayKey;
  scheduleTime.value = toTimeValueInTimezone(
    slot.scheduledAt,
    audienceTimezone.value || workspaceDefaultAudienceTimezone.value,
  );
  selectedScheduledPostId.value = "";
}

async function scheduleSelectedAsset(): Promise<void> {
  if (!resolvedBusinessId.value || !selectedBacklogAsset.value) {
    errorMessage.value = "Pick a draft before scheduling it.";
    return;
  }

  if (!canScheduleSelectedPlatforms.value) {
    errorMessage.value = "Select at least one publishable platform before queueing this draft.";
    return;
  }

  if (queueLimitReached.value) {
    errorMessage.value = queueLimitPrompt.value;
    return;
  }

  if (selectedSchedulingCapacityGuardrail.value) {
    errorMessage.value = selectedSchedulingCapacityGuardrail.value;
    return;
  }

  const contentText = selectedBacklogAsset.value.textContent?.trim() || "";

  if (!contentText) {
    errorMessage.value = "That draft has no usable post text yet.";
    return;
  }

  isScheduling.value = true;
  errorMessage.value = "";
  feedbackMessage.value = "";

  try {
    const scheduledAt = convertZonedDateTimeToUtcIso(
      selectedAudienceDateKey.value,
      scheduleTime.value,
      audienceTimezone.value || workspaceDefaultAudienceTimezone.value,
    );
    const successes: PublishableSocialPlatform[] = [];
    const failures: string[] = [];

    for (const platform of selectedSchedulingPlatforms.value) {
      const scheduleRequest = {
        businessId: resolvedBusinessId.value,
        platform,
        contentText,
        assetGroupId: selectedBacklogAsset.value.id,
        slides: [],
        scheduledAt,
        audienceTimezone: audienceTimezone.value || workspaceDefaultAudienceTimezone.value,
      };

      try {
        try {
          await requestSchedulePost(scheduleRequest);
        } catch (error) {
          const warnings = extractSchedulingWarnings(error);

          if (warnings.length === 0 || !confirmSchedulingWarnings(warnings)) {
            throw error;
          }

          await requestSchedulePost({
            ...scheduleRequest,
            ignoreSafetyWarnings: true,
          });
          feedbackMessage.value = "Draft scheduled with a manual safety override.";
        }

        successes.push(platform);
      } catch (error) {
        failures.push(
          `${resolveSocialPlatformLabel(platform)}: ${error instanceof Error ? error.message : "Unable to queue."}`,
        );
      }
    }

    if (successes.length === 0) {
      errorMessage.value = failures[0] ?? "Unable to schedule this draft right now.";
      return;
    }

    if (!feedbackMessage.value) {
      feedbackMessage.value = `Added to ${selectedAudienceDateLabel.value} at ${selectedAudienceTimeLabel.value} for ${formatSelectedPlatformsLabel(successes)}.`;
    }
    if (failures.length > 0) {
      feedbackMessage.value = `${feedbackMessage.value} Failed: ${failures.join(" · ")}`;
    }
    selectedBacklogAssetId.value = "";
    await loadPlannerData();
    const refreshedAccess = await refreshProductAccess(resolvedBusinessId.value);
    const queueFilledByThisSchedule =
      refreshedAccess?.limits?.scheduledQueueLimit !== null
      && refreshedAccess?.limits?.scheduledQueueRemaining === 0;

    if (queueFilledByThisSchedule) {
      feedbackMessage.value = `Nice — your post is queued for peak engagement on ${selectedAudienceDateLabel.value} at ${selectedAudienceTimeLabel.value}. Upgrade to line up the rest of your week.`;
    }
    syncSelection();
  } catch (error) {
    errorMessage.value =
      extractScheduledQueueLimitMessage(error)
      ?? (error instanceof Error ? error.message : "Unable to schedule this draft right now.");
  } finally {
    isScheduling.value = false;
  }
}

async function duplicateBacklogAsset(assetId: string): Promise<void> {
  if (!resolvedBusinessId.value) {
    errorMessage.value = "Pick a workspace before duplicating drafts.";
    return;
  }

  draftActionAssetId.value = assetId;
  draftActionKind.value = "duplicate";
  errorMessage.value = "";
  feedbackMessage.value = "";

  try {
    const response = await requestDuplicatePipelineItem({
      businessId: resolvedBusinessId.value,
      assetId,
    });
    await loadPlannerData();
    selectBacklogAsset(response.asset.id, selectedGridDateKey.value);
    syncSelection();
    feedbackMessage.value = "Draft duplicated. The copy is ready to schedule.";
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Unable to duplicate that draft.";
  } finally {
    draftActionAssetId.value = "";
    draftActionKind.value = "";
  }
}

async function deleteBacklogAsset(assetId: string): Promise<void> {
  if (!resolvedBusinessId.value) {
    errorMessage.value = "Pick a workspace before deleting drafts.";
    return;
  }

  if (typeof window !== "undefined") {
    const confirmed = window.confirm(
      "Delete this draft? Active scheduled slots must be cleared first, and this cannot be undone.",
    );

    if (!confirmed) {
      return;
    }
  }

  draftActionAssetId.value = assetId;
  draftActionKind.value = "delete";
  errorMessage.value = "";
  feedbackMessage.value = "";

  try {
    await requestDeletePipelineItem({
      businessId: resolvedBusinessId.value,
      assetId,
    });
    await loadPlannerData();
    if (selectedBacklogAssetId.value === assetId) {
      selectedBacklogAssetId.value = "";
    }
    syncSelection();
    feedbackMessage.value = "Draft deleted from the backlog.";
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Unable to delete that draft.";
  } finally {
    draftActionAssetId.value = "";
    draftActionKind.value = "";
  }
}

async function updateSelectedScheduledPost(
  action: "pause" | "resume" | "cancel" | "retry" | "publish_now" | "move_to_draft",
): Promise<void> {
  if (!resolvedBusinessId.value || !selectedScheduledPost.value) {
    errorMessage.value = "Pick a scheduled post first.";
    return;
  }

  const selectedAssetGroupId = selectedScheduledPost.value.assetGroupId;
  isUpdatingScheduledPost.value = true;
  errorMessage.value = "";
  feedbackMessage.value = "";

  try {
    const response = await requestUpdateScheduledPost(selectedScheduledPost.value.id, {
      businessId: resolvedBusinessId.value,
      action,
    });

    const successMessage =
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
                : "Slot removed. The draft is back in the backlog.";
    await loadPlannerData();
    await refreshProductAccess(resolvedBusinessId.value);

    if (action === "move_to_draft" && selectedAssetGroupId) {
      selectBacklogAsset(selectedAssetGroupId, selectedGridDateKey.value);
      selectedScheduledPostId.value = "";
    } else {
      selectedScheduledPostId.value = response.scheduledPost.id;
    }

    syncSelection();
    feedbackMessage.value = successMessage;
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "Unable to update that scheduled post.";
  } finally {
    isUpdatingScheduledPost.value = false;
  }
}

async function rescheduleSelectedPost(): Promise<void> {
  if (!resolvedBusinessId.value || !selectedScheduledPost.value) {
    errorMessage.value = "Pick a scheduled post first.";
    return;
  }

  isUpdatingScheduledPost.value = true;
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
      feedbackMessage.value = "Scheduled slot updated with a manual safety override.";
    }

    if (!feedbackMessage.value) {
      feedbackMessage.value =
        response.scheduledPost.status === "paused"
          ? "Paused post rescheduled without resuming it."
          : "Scheduled slot updated.";
    }
    selectedScheduledPostId.value = response.scheduledPost.id;
    await loadPlannerData();
    await refreshProductAccess(resolvedBusinessId.value);
    syncSelection();
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "Unable to reschedule that post right now.";
  } finally {
    isUpdatingScheduledPost.value = false;
  }
}

function openNewPostFlow(dayKey?: string): void {
  void router.push({
    path: appRoutes.appCreate,
    query: {
      from: "planner",
      day: dayKey || selectedGridDateKey.value || "",
      platform: selectedSchedulingPlatform.value,
      platforms: selectedSchedulingPlatforms.value.join(","),
    },
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

function focusFirstGap(): void {
  const gap = gapDays.value[0];

  if (!gap) {
    return;
  }

  if (unscheduledBacklog.value.length === 0) {
    openNewPostFlow(gap.key);
    return;
  }

  focusBacklog(gap.key);
}

function focusBacklog(dayKey?: string): void {
  if (dayKey) {
    selectDay(dayKey);
  }

  if (unscheduledBacklog.value.length === 0) {
    openNewPostFlow(dayKey);
    return;
  }

  if (typeof document !== "undefined") {
    document.getElementById("planner-backlog-panel")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }
}

function closePlannerDetailModal(): void {
  selectedScheduledPostId.value = "";
  selectedBacklogAssetId.value = "";
}

watch(
  () => resolvedBusinessId.value,
  () => {
    audienceTimezone.value = workspaceDefaultAudienceTimezone.value;
    void loadSocialAccounts();
  },
);

watch(
  () => [resolvedBusinessId.value, selectedBacklogAssetId.value],
  () => {
    void loadSelectedBacklogPostAssets();
  },
  { immediate: true },
);

watch(
  () => workspaceDefaultAudienceTimezone.value,
  (timezone) => {
    if (!audienceTimezone.value) {
      audienceTimezone.value = timezone;
    }

    const todayKey = toDateKeyInTimezone(new Date(), userTimezone);

    if (!selectedWeekStartKey.value) {
      selectedWeekStartKey.value = startOfWeekDateKey(todayKey);
    }

    if (!selectedGridDateKey.value) {
      selectedGridDateKey.value = todayKey;
    }

    if (!selectedAudienceDateKey.value) {
      selectedAudienceDateKey.value = todayKey;
    }
  },
  { immediate: true },
);

watch(
  () =>
    [
      auth.isReady.value,
      auth.isAuthenticated.value,
      isProductAccessReady.value,
      resolvedBusinessId.value,
      schedulerEnabled.value,
      canReadDraftBacklog.value,
      audienceTimezone.value || workspaceDefaultAudienceTimezone.value,
    ] as const,
  ([authReady, isAuthenticated, accessReady]) => {
    if (!authReady || !isAuthenticated || !accessReady) {
      return;
    }

    void initializePage();
  },
);

watch(
  () => [route.query.linkedin, route.query.meta, route.query.message, route.query.session, route.query.platform],
  async ([linkedInStatus, metaStatus, message, session, platform]) => {
    if (
      typeof linkedInStatus !== "string"
      && typeof metaStatus !== "string"
      && typeof message !== "string"
      && typeof session !== "string"
      && typeof platform !== "string"
    ) {
      return;
    }

    if (platform === "instagram" || platform === "facebook" || platform === "linkedin") {
      selectedSchedulingPlatform.value = platform;
    }

    if (linkedInStatus === "connected") {
      feedbackMessage.value = "LinkedIn connected. The planner is ready.";
      await loadSocialAccounts();
    } else if (linkedInStatus === "error") {
      errorMessage.value =
        typeof message === "string" && message.trim() !== ""
          ? toFriendlySocialAuthMessage(message, "linkedin")
          : toFriendlySocialAuthMessage(undefined, "linkedin");
    }

    if (metaStatus === "connected") {
      feedbackMessage.value =
        selectedSchedulingPlatform.value === "facebook"
          ? "Facebook connected. The planner is ready."
          : "Instagram connected. The planner is ready.";
      await loadSocialAccounts();
    } else if (metaStatus === "error") {
      errorMessage.value =
        typeof message === "string" && message.trim() !== ""
          ? toFriendlySocialAuthMessage(message, selectedSchedulingPlatform.value === "facebook" ? "facebook" : "instagram")
          : toFriendlySocialAuthMessage(undefined, selectedSchedulingPlatform.value === "facebook" ? "facebook" : "instagram");
    } else if (metaStatus === "select_page" && typeof session === "string" && session.trim() !== "") {
      pendingMetaSession.value = session.trim();
      isMetaSelectionModalOpen.value = true;
    }

    const nextQuery = { ...route.query };
    delete nextQuery.linkedin;
    delete nextQuery.meta;
    delete nextQuery.message;
    delete nextQuery.session;
    delete nextQuery.platform;
    void router.replace({ query: nextQuery });
    isConnectingLinkedIn.value = false;
    isConnectingMeta.value = false;
  },
  { immediate: true },
);

onMounted(() => {
  if (auth.isReady.value && auth.isAuthenticated.value && isProductAccessReady.value) {
    void initializePage();
  }
});
</script>

<template>
  <main class="planner-shell">
    <section class="workspace-hero planner-hero-compact">
      <div>
        <p class="workspace-eyebrow">{{ weekRangeLabel }}</p>
        <h1>{{ plannerHeaderTitle }}</h1>
      </div>

      <div class="planner-top-actions">
        <button
          type="button"
          class="workspace-secondary-button planner-header-button planner-header-button-secondary"
          :disabled="gapDays.length === 0"
          @click="focusFirstGap"
        >
          <span class="planner-header-button-icon" aria-hidden="true">↘</span>
          <span class="planner-header-button-copy">
            <strong>Fill next gap</strong>
            <small>
              {{
                gapDays.length === 0
                  ? "Week already covered"
                  : `${gapDays.length} open slot${gapDays.length === 1 ? "" : "s"} this week`
              }}
            </small>
          </span>
        </button>
        <button
          type="button"
          class="workspace-primary-button planner-header-button planner-header-button-primary"
          @click="() => openNewPostFlow()"
        >
          <span class="planner-header-button-icon" aria-hidden="true">+</span>
          <span class="planner-header-button-copy">
            <strong>New post</strong>
            <small>Open composer</small>
          </span>
        </button>
      </div>
    </section>

    <PlannerSkeleton v-if="isLoading" />

    <template v-else>
      <section v-if="loadErrorMessage" class="workspace-card empty-state">
        <h2>Planner unavailable</h2>
        <p>{{ loadErrorMessage }}</p>
      </section>

      <section v-else-if="!resolvedBusinessId" class="workspace-card empty-state">
        <h2>No workspace selected</h2>
        <p>Create or switch to a workspace first, then use the planner to see execution gaps.</p>
      </section>

      <section v-else-if="!schedulerEnabled" class="workspace-card empty-state">
        <h2>Scheduling is not enabled here</h2>
        <p>Turn on the scheduler feature for this workspace to unlock the execution planner.</p>
      </section>

      <template v-else>
        <section class="planner-main-grid">
          <article class="workspace-card planner-grid-panel">
            <div class="planner-grid-header planner-grid-header-simple">
              <div class="planner-grid-header-copy">
                <p class="workspace-chip planner-chip">
                  {{ userTimezone }} grid · {{ audienceTimezone || workspaceDefaultAudienceTimezone }} audience
                </p>
                <p class="planner-inline-tip">{{ plannerGridHint }}</p>
              </div>

              <div class="planner-week-nav">
                <button type="button" class="workspace-secondary-button compact planner-nav-button" @click="goToPreviousWeek">
                  &larr;
                </button>
                <button type="button" class="workspace-secondary-button compact planner-nav-button planner-nav-button-active" @click="goToCurrentWeek">
                  This week
                </button>
                <button type="button" class="workspace-secondary-button compact planner-nav-button" @click="goToNextWeek">
                  &rarr;
                </button>
              </div>
            </div>

            <div class="planner-week-grid">
              <article
                v-for="day in weekDays"
                :key="day.key"
                class="planner-day-card"
                :class="{
                  selected: day.key === selectedGridDateKey,
                  today: day.isToday,
                  gap: day.isGap,
                }"
                @click="selectDay(day.key)"
              >
                <div class="planner-day-header">
                  <div class="planner-day-title">
                    <span class="planner-day-weekday">{{ day.weekdayLabel }}</span>
                    <strong>{{ day.dayLabel }}</strong>
                  </div>
                  <span v-if="day.posts.length > 0" class="planner-day-count">
                    {{ day.posts.length }}
                  </span>
                </div>

                <div v-if="day.posts.length === 0" class="planner-day-empty-state">
                  <strong>(empty)</strong>
                  <button
                    type="button"
                    class="planner-day-add-button"
                    @click.stop="focusBacklog(day.key)"
                  >
                    + Add post
                  </button>
                </div>

                <ul v-else class="planner-day-posts">
                  <li
                    v-for="post in day.posts"
                    :key="post.id"
                    class="planner-post-pill"
                    :data-tone="resolveStatusTone(post.status)"
                    @click.stop="selectScheduledPost(post.id, day.key)"
                  >
                    <div class="planner-post-pill-header">
                      <div class="planner-pill-stack">
                        <span class="planner-platform-pill">{{ resolveSocialPlatformLabel(post.platform) }}</span>
                        <span v-if="getMediaCount(post) > 0" class="planner-status-pill subtle">
                          {{ getMediaCount(post) }} media
                        </span>
                      </div>
                      <span class="planner-post-time">
                        {{ formatTimeWithZone(post.scheduledAt, post.audienceTimezone) }}
                      </span>
                    </div>
                    <strong>{{ buildExcerpt(post.contentText, 120) }}</strong>
                    <div class="planner-post-pill-actions">
                      <span class="planner-status-pill">{{ resolveScheduledPostStatusLabel(post.status) }}</span>
                      <button
                        type="button"
                        class="workspace-secondary-button compact planner-post-inline-button"
                        @click.stop="selectScheduledPost(post.id, day.key)"
                      >
                        Edit
                      </button>
                    </div>
                  </li>
                </ul>
              </article>
            </div>
          </article>
        </section>

        <section id="planner-backlog-panel" class="workspace-card planner-backlog-panel">
      <div class="planner-backlog-header">
        <div>
          <p class="workspace-eyebrow">Draft backlog</p>
          <h2>{{ backlogTitle }}</h2>
        </div>
        <p class="workspace-description compact">
          These are the ideas already in motion. Pick one, preview it, and drop it into the day that needs coverage.
        </p>
      </div>

      <div v-if="unscheduledBacklog.length === 0" class="planner-empty-state">
        No backlog yet. Generate a draft first, then bring it back here to turn ideas into a real publishing plan.
      </div>

      <div v-else class="planner-backlog-grid">
        <article
          v-for="asset in unscheduledBacklog"
          :key="asset.id"
          class="planner-backlog-card"
          :class="{ active: asset.id === selectedBacklogAssetId }"
          @click="selectBacklogAsset(asset.id, selectedGridDateKey)"
        >
          <div class="planner-backlog-card-header">
            <span class="workspace-chip">
              {{ asset.pipelineStage === "review" ? "Ready" : "Draft" }}
            </span>
            <div class="planner-card-action-row">
              <button
                type="button"
                class="workspace-secondary-button compact"
                :disabled="isDraftActionPending(asset.id)"
                @click.stop="openDraftEditor(asset.id)"
              >
                Edit
              </button>
              <button
                type="button"
                class="workspace-secondary-button compact"
                :disabled="isDraftActionPending(asset.id)"
                @click.stop="duplicateBacklogAsset(asset.id)"
              >
                {{
                  isDraftActionPending(asset.id, "duplicate")
                    ? activeDraftActionLabel
                    : "Duplicate"
                }}
              </button>
            </div>
          </div>
          <strong>{{ asset.title || "Untitled draft" }}</strong>
          <p>{{ buildExcerpt(asset.textContent || "", 180) }}</p>
          <div class="planner-backlog-card-footer">
            <span>Updated {{ formatDateInTimezone(asset.updatedAt || asset.createdAt, userTimezone, {
              month: "short",
              day: "numeric",
            }) }}</span>
            <div class="planner-card-action-row">
              <button
                type="button"
                class="workspace-secondary-button compact planner-danger-button"
                :disabled="isDraftActionPending(asset.id)"
                @click.stop="deleteBacklogAsset(asset.id)"
              >
                {{
                  isDraftActionPending(asset.id, "delete")
                    ? activeDraftActionLabel
                    : "Delete"
                }}
              </button>
              <button
                type="button"
                class="workspace-primary-button compact"
                @click.stop="selectBacklogAsset(asset.id, selectedGridDateKey)"
              >
                Schedule
              </button>
            </div>
          </div>
        </article>
      </div>
        </section>

        <p v-if="feedbackMessage" class="planner-feedback success">{{ feedbackMessage }}</p>
        <p v-if="errorMessage" class="planner-feedback danger">{{ errorMessage }}</p>

        <section
          v-if="isPlannerDetailModalOpen"
          class="planner-detail-overlay"
          @click.self="closePlannerDetailModal"
        >
          <article class="workspace-card planner-detail-modal">
            <div class="planner-detail-header">
              <div>
                <p class="workspace-eyebrow">
                  {{ selectedScheduledPost ? "Scheduled slot" : "Draft details" }}
                </p>
                <h2>
                  {{ selectedScheduledPost ? "Review execution slot" : "Queue this draft" }}
                </h2>
                <p class="workspace-description compact">
                  {{
                    selectedScheduledPost
                      ? "Review timing, status, and execution actions without leaving the planner."
                      : "Preview the draft, pick a time, and add it to the queue when the slot makes sense."
                  }}
                </p>
              </div>

              <button
                type="button"
                class="workspace-secondary-button compact"
                @click="closePlannerDetailModal"
              >
                Close
              </button>
            </div>

            <template v-if="selectedScheduledPost">
              <div class="planner-detail-meta-grid">
                <article class="planner-detail-meta-card">
                  <span>Status</span>
                  <strong>{{ resolveScheduledPostStatusLabel(selectedScheduledPost.status) }}</strong>
                </article>
                <article class="planner-detail-meta-card">
                  <span>Audience time</span>
                  <strong>{{ formatTimeWithZone(selectedScheduledPost.scheduledAt, selectedScheduledPost.audienceTimezone) }}</strong>
                </article>
                <article class="planner-detail-meta-card">
                  <span>Dispatch window</span>
                  <strong>{{ formatScheduledPostDispatchWindow(selectedScheduledPost) }}</strong>
                </article>
                <article class="planner-detail-meta-card">
                  <span>Identity</span>
                  <strong>{{ resolveScheduledIdentityLabel(selectedScheduledPost) }}</strong>
                </article>
              </div>

              <article class="planner-preview-card">
                <div class="planner-preview-card-header">
                  <div>
                    <p class="workspace-eyebrow">Preview on {{ resolveSocialPlatformLabel(selectedScheduledPost.platform) }}</p>
                    <h3>What people see first</h3>
                  </div>
                  <p class="workspace-chip planner-preview-attention">
                    {{ selectedScheduledPostPreview?.truncated ? "Visible before click" : "Full post visible" }}
                  </p>
                </div>

                <div class="planner-linkedin-preview">
                  <div class="planner-linkedin-preview-header">
                    <div class="planner-linkedin-avatar">
                      {{ (selectedScheduledPost.selectedIdentityDisplayName || resolveSocialPlatformLabel(selectedScheduledPost.platform)).slice(0, 2).toUpperCase() }}
                    </div>

                    <div class="planner-linkedin-author">
                      <strong>{{ selectedScheduledPost.selectedIdentityDisplayName || (selectedScheduledPost.platform === "instagram" ? "Workspace Instagram account" : selectedScheduledPost.platform === "facebook" ? "Workspace Facebook page" : "Workspace LinkedIn identity") }}</strong>
                      <span>
                        {{ resolveScheduledIdentityLabel(selectedScheduledPost) }} · {{ resolveScheduledPostStatusSummary(selectedScheduledPost) }}
                      </span>
                    </div>
                  </div>

                  <div class="planner-linkedin-preview-body">
                    <p>{{ selectedScheduledPostPreview?.visibleText || selectedScheduledPost.contentText }}</p>
                    <button
                      v-if="selectedScheduledPostPreview?.truncated"
                      type="button"
                      class="planner-linkedin-see-more"
                      disabled
                    >
                      ...see more
                    </button>
                  </div>

                  <div
                    v-if="selectedScheduledPostPreviewImageUrl"
                    class="planner-linkedin-preview-media"
                  >
                    <img
                      :src="selectedScheduledPostPreviewImageUrl"
                      alt="Attached media preview"
                    />
                  </div>
                </div>

                <div class="planner-preview-meta-row">
                  <p class="workspace-chip">{{ resolveScheduledPostStatusLabel(selectedScheduledPost.status) }}</p>
                  <p v-if="selectedScheduledPost.selectedIdentityDisplayName" class="workspace-chip">
                    {{ resolveScheduledIdentityLabel(selectedScheduledPost) }}
                  </p>
                  <p v-if="getMediaCount(selectedScheduledPost) > 0" class="workspace-chip">
                    📎 {{ getMediaCount(selectedScheduledPost) }} image{{ getMediaCount(selectedScheduledPost) === 1 ? "" : "s" }}
                  </p>
                </div>

                <div class="planner-preview-full-copy">
                  <span class="planner-inline-label">Full post copy</span>
                  <p>{{ selectedScheduledPost.contentText }}</p>
                </div>
              </article>

              <section
                v-if="selectedScheduledPost.errorMessage && selectedScheduledPostErrorContext"
                class="planner-status-note"
                :data-tone="selectedScheduledPostErrorContext.tone"
              >
                <span class="planner-inline-label">{{ selectedScheduledPostErrorContext.title }}</span>
                <p>{{ selectedScheduledPostFriendlyError }}</p>
                <p class="planner-status-note-description">
                  {{ selectedScheduledPostErrorContext.description }}
                </p>
              </section>

              <div
                v-if="selectedScheduledPostCanReschedule"
                class="planner-inline-section"
              >
                <label class="planner-inline-label">Reschedule slot</label>
                <div class="planner-schedule-grid">
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

              <div class="planner-sidebar-actions">
                <button
                  v-if="selectedScheduledPost.assetGroupId"
                  type="button"
                  class="workspace-secondary-button"
                  :disabled="isUpdatingScheduledPost"
                  @click="openDraftEditor(selectedScheduledPost.assetGroupId)"
                >
                  Edit draft
                </button>
                <button
                  v-if="selectedScheduledPostCanPublishNow"
                  type="button"
                  class="workspace-primary-button"
                  :disabled="isUpdatingScheduledPost"
                  @click="updateSelectedScheduledPost('publish_now')"
                >
                  {{ isUpdatingScheduledPost ? "Updating..." : "Publish now" }}
                </button>
                <button
                  v-if="selectedScheduledPostCanRetry"
                  type="button"
                  class="workspace-primary-button"
                  :disabled="isUpdatingScheduledPost"
                  @click="updateSelectedScheduledPost('retry')"
                >
                  {{ isUpdatingScheduledPost ? "Updating..." : "Retry now" }}
                </button>
                <button
                  v-if="selectedScheduledPostCanPause"
                  type="button"
                  class="workspace-secondary-button"
                  :disabled="isUpdatingScheduledPost"
                  @click="updateSelectedScheduledPost('pause')"
                >
                  {{ isUpdatingScheduledPost ? "Updating..." : "Pause" }}
                </button>
                <button
                  v-if="selectedScheduledPostCanResume"
                  type="button"
                  class="workspace-secondary-button"
                  :disabled="isUpdatingScheduledPost"
                  @click="updateSelectedScheduledPost('resume')"
                >
                  {{ isUpdatingScheduledPost ? "Updating..." : "Resume" }}
                </button>
                <button
                  v-if="selectedScheduledPostNeedsReconnect"
                  type="button"
                  class="workspace-secondary-button"
                  :disabled="isConnectingLinkedIn || isConnectingMeta"
                  @click="reconnectSelectedPlatform"
                >
                  {{
                    isConnectingLinkedIn || isConnectingMeta
                      ? "Redirecting..."
                      : `Reconnect ${resolveSocialPlatformLabel(selectedScheduledPost.platform)}`
                  }}
                </button>
                <button
                  v-if="selectedScheduledPostCanReschedule"
                  type="button"
                  class="workspace-primary-button"
                  :disabled="isUpdatingScheduledPost"
                  @click="rescheduleSelectedPost"
                >
                  {{ isUpdatingScheduledPost ? "Updating..." : "Reschedule" }}
                </button>
                <button
                  v-if="selectedScheduledPostCanMoveToDraft"
                  type="button"
                  class="workspace-secondary-button"
                  :disabled="isUpdatingScheduledPost"
                  @click="updateSelectedScheduledPost('move_to_draft')"
                >
                  {{ isUpdatingScheduledPost ? "Updating..." : "Move to draft" }}
                </button>
                <button
                  v-if="selectedScheduledPostCanCancel"
                  type="button"
                  class="workspace-secondary-button planner-danger-button"
                  :disabled="isUpdatingScheduledPost"
                  @click="updateSelectedScheduledPost('cancel')"
                >
                  {{ isUpdatingScheduledPost ? "Updating..." : "Cancel" }}
                </button>
                <a
                  v-if="selectedScheduledPost.externalPostUrl"
                  class="workspace-primary-button link-button"
                  :href="selectedScheduledPost.externalPostUrl"
                  target="_blank"
                  rel="noreferrer"
                >
                  {{ resolveExternalPostLabel(selectedScheduledPost.platform) }}
                </a>
              </div>
            </template>

            <template v-else-if="selectedBacklogAsset">
              <article class="planner-preview-card">
                <div class="planner-preview-chip-row">
                  <p class="workspace-chip">{{ selectedBacklogAsset.pipelineStage === "review" ? "Ready" : "Draft" }}</p>
                  <p class="workspace-chip">{{ selectedDay?.longLabel || "Selected day" }}</p>
                  <p class="workspace-chip">{{ selectedSchedulingPlatformLabel }}</p>
                </div>
                <strong>{{ selectedBacklogAsset.title || "Untitled draft" }}</strong>
                <p>{{ buildExcerpt(selectedBacklogAsset.textContent || "", 280) }}</p>
              </article>

              <div class="planner-inline-section">
                <label class="planner-inline-label">Select platforms</label>
                <div class="planner-platform-selector">
                  <article
                    v-for="platform in PUBLISHABLE_SOCIAL_PLATFORMS"
                    :key="platform"
                    class="planner-platform-option"
                    :data-active="selectedSchedulingPlatform === platform"
                    :data-selected="isSchedulingPlatformSelected(platform)"
                    :data-disabled="Boolean(resolveSchedulingGuardrail(platform))"
                    @click="selectedSchedulingPlatform = platform"
                  >
                    <div class="planner-platform-option-topline">
                      <label class="planner-platform-checkbox">
                        <input
                          type="checkbox"
                          :checked="isSchedulingPlatformSelected(platform)"
                          :disabled="Boolean(resolveSchedulingGuardrail(platform))"
                          @click.stop="toggleSchedulingPlatform(platform)"
                        />
                        <span>{{ resolveSocialPlatformLabel(platform) }}</span>
                      </label>
                      <span class="planner-platform-state">
                        {{
                          isSchedulingPlatformSelected(platform)
                            ? "Selected"
                            : resolveSchedulingGuardrail(platform)
                              ? "Unavailable"
                              : "Ready"
                        }}
                      </span>
                    </div>
                    <p>{{ resolveSchedulingPlatformHint(platform) }}</p>
                  </article>
                </div>

                <p v-if="selectedSchedulingCapacityGuardrail" class="planner-feedback danger">
                  {{ selectedSchedulingCapacityGuardrail }}
                </p>
                <p v-else-if="selectedSchedulingGuardrail" class="planner-feedback danger">
                  {{ selectedSchedulingGuardrail }}
                </p>

                <label class="planner-inline-label">Choose queue time</label>
                <div class="planner-schedule-grid">
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
                <p
                  v-if="hasScheduledQueuePreview"
                  class="planner-status-note"
                  :data-tone="queueLimitReached ? 'warning' : undefined"
                >
                  <span class="planner-inline-label">Queue preview</span>
                  {{ queueLimitReached ? queueLimitPrompt : queuePreviewCopy }}
                </p>
              </div>

              <div class="planner-sidebar-actions">
                <button type="button" class="workspace-secondary-button" @click="openDraftEditor(selectedBacklogAsset.id)">
                  Edit draft
                </button>
                <button
                  type="button"
                  class="workspace-secondary-button"
                  :disabled="isDraftActionPending(selectedBacklogAsset.id)"
                  @click="duplicateBacklogAsset(selectedBacklogAsset.id)"
                >
                  {{
                    isDraftActionPending(selectedBacklogAsset.id, "duplicate")
                      ? activeDraftActionLabel
                      : "Duplicate"
                  }}
                </button>
                <button
                  type="button"
                  class="workspace-secondary-button planner-danger-button"
                  :disabled="isDraftActionPending(selectedBacklogAsset.id)"
                  @click="deleteBacklogAsset(selectedBacklogAsset.id)"
                >
                  {{
                    isDraftActionPending(selectedBacklogAsset.id, "delete")
                      ? activeDraftActionLabel
                      : "Delete"
                  }}
                </button>
                <button
                  type="button"
                  class="workspace-primary-button"
                  :disabled="
                    isScheduling ||
                    !canQueueSelectedAsset ||
                    !canScheduleSelectedPlatforms ||
                    Boolean(selectedSchedulingCapacityGuardrail)
                  "
                  @click="scheduleSelectedAsset"
                >
                  {{
                    queueLimitReached
                      ? "Queue full"
                      : isScheduling
                        ? "Scheduling..."
                        : `Queue for ${selectedSchedulingPlatformsLabel || selectedSchedulingPlatformLabel}`
                  }}
                </button>
              </div>
            </template>
          </article>
        </section>

        <MetaPageSelectionModal
          :open="isMetaSelectionModalOpen"
          :business-id="resolvedBusinessId"
          :session="pendingMetaSession"
          :platform="selectedSchedulingPlatform === 'instagram' ? 'instagram' : 'facebook'"
          @close="closeMetaSelectionModal"
          @connected="void handleMetaConnected()"
          @error="handleMetaSelectionError"
        />
      </template>
    </template>
  </main>
</template>

<style scoped>
.planner-shell {
  display: grid;
  gap: 1.75rem;
}

.workspace-hero,
.planner-command-bar,
.planner-overview-grid,
.planner-main-grid,
.planner-backlog-grid,
.planner-insight-row,
.planner-grid-header,
.planner-week-nav,
.planner-command-bar-actions,
.planner-command-summary,
.planner-day-header,
.planner-post-pill-header,
.planner-sidebar-actions,
.planner-backlog-card-header,
.planner-backlog-card-footer,
.planner-schedule-grid,
.planner-pill-stack,
.planner-preview-chip-row,
.planner-day-schedule-card-header,
.planner-day-schedule-header {
  display: flex;
  gap: 0.85rem;
}

.workspace-hero,
.planner-command-bar,
.planner-grid-header,
.planner-day-header,
.planner-post-pill-header,
.planner-backlog-card-header,
.planner-backlog-card-footer,
.planner-preview-chip-row,
.planner-day-schedule-card-header,
.planner-day-schedule-header {
  align-items: center;
  justify-content: space-between;
}

.planner-top-actions,
.planner-command-bar,
.planner-command-bar-copy,
.planner-command-bar-actions,
.planner-command-summary,
.planner-overview-grid,
.planner-insight-row,
.planner-week-grid,
.planner-main-grid,
.planner-backlog-grid,
.planner-inline-section,
.planner-grid-header-copy,
.planner-grid-header-actions,
.planner-sidebar,
.planner-day-posts,
.planner-preview-card-header,
.planner-preview-meta-row,
.planner-post-pill,
.planner-backlog-card,
.planner-day-schedule-list,
.planner-day-schedule-card {
  display: grid;
  gap: 0.9rem;
}

.planner-top-actions {
  justify-items: end;
}

.planner-command-bar {
  grid-template-columns: minmax(0, 1.1fr) minmax(22rem, 0.9fr);
  align-items: stretch;
  padding: 1.45rem 1.5rem;
  border: 1px solid rgba(204, 102, 45, 0.12);
  background:
    radial-gradient(circle at top left, rgba(255, 187, 132, 0.2), transparent 42%),
    linear-gradient(135deg, rgba(255, 252, 247, 0.98), rgba(255, 246, 237, 0.96));
  box-shadow: 0 24px 60px rgba(145, 84, 39, 0.08);
}

.planner-command-bar-copy h2 {
  margin: 0;
  font-size: clamp(1.7rem, 2vw, 2.3rem);
  line-height: 1.05;
}

.planner-command-bar-actions {
  align-content: space-between;
  justify-items: end;
}

.planner-command-summary {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.planner-overview-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.planner-overview-card {
  display: grid;
  gap: 0.45rem;
  min-width: 0;
  padding: 1rem 1.05rem;
  border: 1px solid rgba(60, 41, 30, 0.08);
  border-radius: 1.1rem;
  background: rgba(255, 255, 255, 0.82);
  backdrop-filter: blur(10px);
  box-shadow: 0 16px 34px rgba(145, 84, 39, 0.06);
}

.planner-overview-card span {
  color: rgba(64, 42, 28, 0.7);
  font-size: 0.82rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.planner-overview-card strong {
  font-size: 1.9rem;
}

.planner-overview-card[data-tone="success"] {
  border-color: rgba(74, 144, 96, 0.24);
  background: rgba(244, 251, 245, 0.92);
}

.planner-overview-card[data-tone="warning"] {
  border-color: rgba(210, 138, 62, 0.24);
  background: rgba(255, 247, 239, 0.92);
}

.planner-main-grid {
  grid-template-columns: minmax(0, 1fr);
  align-items: start;
}

.planner-grid-panel,
.planner-backlog-panel,
.planner-detail-modal {
  padding: 1.45rem;
}

.workspace-primary-button,
.workspace-secondary-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.72rem;
  min-height: 46px;
  padding: 0 18px;
  border-radius: 999px;
  border: 1px solid transparent;
  font: inherit;
  font-weight: 700;
  text-decoration: none;
  cursor: pointer;
  transition:
    transform 160ms ease,
    box-shadow 160ms ease,
    border-color 160ms ease,
    background 160ms ease,
    color 160ms ease;
}

.workspace-primary-button {
  background: linear-gradient(135deg, var(--fc-accent) 0%, var(--fc-accent-dark) 100%);
  color: var(--fc-accent-contrast);
  box-shadow: 0 20px 36px rgba(221, 128, 56, 0.25);
}

.workspace-secondary-button {
  background: rgba(255, 255, 255, 0.86);
  color: var(--fc-text);
  border-color: color-mix(in srgb, var(--fc-border) 85%, rgba(221, 128, 56, 0.18));
  box-shadow: 0 12px 24px rgba(70, 42, 24, 0.05);
}

.workspace-primary-button:hover,
.workspace-secondary-button:hover {
  transform: translateY(-1px);
}

.workspace-primary-button:disabled,
.workspace-secondary-button:disabled {
  cursor: not-allowed;
  opacity: 0.68;
  transform: none;
  box-shadow: none;
}

.workspace-description.compact {
  margin: 0;
  font-size: 0.95rem;
}

.planner-hero-compact {
  align-items: flex-end;
}

.planner-hero-compact h1 {
  margin: 0;
  font-size: clamp(1.95rem, 3vw, 2.7rem);
  line-height: 1.02;
}

.planner-top-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 0.75rem;
}

.planner-header-button {
  min-width: 13rem;
  justify-content: flex-start;
  padding: 0.82rem 0.98rem;
  border-radius: 1.2rem;
  text-align: left;
}

.planner-header-button-primary {
  box-shadow:
    0 22px 38px rgba(221, 128, 56, 0.28),
    inset 0 1px 0 rgba(255, 255, 255, 0.2);
}

.planner-header-button-secondary {
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.95), rgba(255, 246, 237, 0.92));
  border-color: rgba(204, 102, 45, 0.16);
}

.planner-header-button-icon,
.planner-inline-action-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 1.9rem;
  height: 1.9rem;
  border-radius: 999px;
  font-size: 1rem;
  font-weight: 800;
}

.planner-header-button-primary .planner-header-button-icon {
  background: rgba(255, 255, 255, 0.2);
  color: currentColor;
}

.planner-header-button-secondary .planner-header-button-icon,
.planner-inline-action-icon {
  background: rgba(245, 232, 219, 0.92);
  color: #c76528;
}

.planner-header-button-copy {
  display: grid;
  gap: 0.12rem;
}

.planner-header-button-copy strong {
  font-size: 0.98rem;
  line-height: 1.1;
}

.planner-header-button-copy small {
  color: inherit;
  opacity: 0.72;
  font-size: 0.82rem;
  line-height: 1.2;
}

.planner-inline-action-button {
  gap: 0.55rem;
}

.planner-grid-header {
  margin-bottom: 1rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid rgba(60, 41, 30, 0.08);
}

.planner-grid-header-copy {
  max-width: 30rem;
}

.planner-grid-header-copy h2 {
  margin: 0;
  font-size: 1.55rem;
  line-height: 1.1;
}

.planner-grid-header-simple {
  margin-bottom: 1.15rem;
  align-items: flex-end;
}

.planner-chip {
  width: fit-content;
}

.planner-inline-tip {
  margin: 0;
  color: rgba(64, 42, 28, 0.72);
  line-height: 1.55;
}

.planner-week-nav {
  align-items: center;
}

.planner-nav-button {
  min-width: 3rem;
}

.planner-nav-button-active {
  border-color: rgba(204, 102, 45, 0.24);
  background: rgba(255, 243, 230, 0.94);
  color: #c76528;
}

.planner-sidebar-actions,
.planner-card-action-row {
  flex-wrap: wrap;
}

.planner-platform-selector {
  display: grid;
  gap: 0.75rem;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.planner-platform-option {
  display: grid;
  gap: 0.65rem;
  padding: 0.9rem 1rem;
  border: 1px solid rgba(60, 41, 30, 0.12);
  border-radius: 1rem;
  background: rgba(255, 255, 255, 0.88);
  cursor: pointer;
  transition:
    transform 160ms ease,
    border-color 160ms ease,
    box-shadow 160ms ease,
    background 160ms ease;
}

.planner-platform-option:hover {
  transform: translateY(-1px);
  box-shadow: 0 14px 28px rgba(145, 84, 39, 0.08);
}

.planner-platform-option[data-active="true"] {
  border-color: rgba(225, 104, 48, 0.34);
  background: rgba(255, 247, 241, 0.96);
}

.planner-platform-option[data-selected="true"] {
  border-color: color-mix(in srgb, var(--fc-success-text) 20%, rgba(60, 41, 30, 0.12));
  background: color-mix(in srgb, var(--fc-success-bg) 44%, rgba(255, 255, 255, 0.92));
}

.planner-platform-option[data-disabled="true"] {
  opacity: 0.84;
}

.planner-platform-option-topline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.65rem;
}

.planner-platform-checkbox {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  font-weight: 800;
  cursor: pointer;
}

.planner-platform-checkbox input {
  width: 16px;
  height: 16px;
  accent-color: var(--fc-accent);
}

.planner-platform-state {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid rgba(60, 41, 30, 0.12);
  background: rgba(249, 243, 237, 0.92);
  color: rgba(74, 50, 34, 0.76);
  font-size: 0.76rem;
  font-weight: 700;
}

.planner-platform-option[data-selected="true"] .planner-platform-state {
  border-color: color-mix(in srgb, var(--fc-success-text) 16%, rgba(60, 41, 30, 0.12));
  background: color-mix(in srgb, var(--fc-success-bg) 82%, rgba(255, 255, 255, 0.92));
  color: var(--fc-success-text);
}

.planner-platform-option p {
  margin: 0;
  color: rgba(74, 50, 34, 0.72);
  font-size: 0.92rem;
  line-height: 1.45;
}

.planner-card-action-row {
  display: inline-flex;
  gap: 0.55rem;
  align-items: center;
}

.planner-day-add-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: fit-content;
  min-width: 9rem;
  border: 1px dashed rgba(204, 102, 45, 0.28);
  border-radius: 0.95rem;
  background: linear-gradient(180deg, rgba(255, 247, 239, 0.98), rgba(255, 241, 228, 0.92));
  color: #c76528;
  font: inherit;
  font-weight: 600;
  padding: 0.68rem 0.85rem;
  cursor: pointer;
  box-shadow: 0 8px 18px rgba(145, 84, 39, 0.05);
  transition: transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease;
}

.planner-day-add-button:hover {
  border-color: rgba(204, 102, 45, 0.42);
  transform: translateY(-1px);
  box-shadow: 0 12px 22px rgba(145, 84, 39, 0.09);
}

.workspace-secondary-button.compact,
.workspace-primary-button.compact {
  min-height: 40px;
  padding: 0.7rem 1rem;
  font-size: 0.9rem;
}

.planner-insight-row {
  flex-wrap: wrap;
}

.planner-insight-card {
  flex: 1 1 16rem;
  display: grid;
  gap: 0.45rem;
  border: 1px solid rgba(60, 41, 30, 0.1);
  border-radius: 1.15rem;
  padding: 1.05rem 1.1rem;
  background: rgba(255, 252, 247, 0.84);
}

.planner-insight-card strong {
  display: block;
  font-size: 1.1rem;
}

.planner-insight-card p {
  margin: 0;
  color: rgba(64, 42, 28, 0.72);
}

.planner-insight-label {
  color: rgba(64, 42, 28, 0.58);
  font-size: 0.76rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.planner-week-grid {
  grid-template-columns: repeat(7, minmax(14.5rem, 15.75rem));
  gap: 1rem;
  overflow-x: auto;
  padding: 0.25rem 0.1rem 0.7rem;
  min-height: clamp(14rem, 36vh, 20rem);
  align-items: stretch;
  justify-content: start;
  scrollbar-width: thin;
  scroll-snap-type: x proximity;
}

.planner-day-card {
  position: relative;
  isolation: isolate;
  display: grid;
  grid-template-rows: auto 1fr;
  gap: 0.82rem;
  align-content: start;
  min-height: clamp(11rem, 33vh, 18rem);
  border: 1px solid rgba(60, 41, 30, 0.1);
  border-radius: 1.35rem;
  background:
    linear-gradient(165deg, rgba(255, 255, 255, 0.97), rgba(255, 247, 238, 0.94) 62%, rgba(253, 238, 223, 0.9));
  padding: 0.95rem 0.95rem 0.9rem;
  text-align: left;
  color: inherit;
  cursor: pointer;
  box-shadow:
    0 18px 34px rgba(145, 84, 39, 0.08),
    0 2px 0 rgba(255, 255, 255, 0.8) inset;
  transition: border-color 180ms ease, transform 180ms ease, box-shadow 180ms ease;
  scroll-snap-align: start;
  overflow: hidden;
}

.planner-day-card::before {
  content: "";
  position: absolute;
  inset: 0 0 auto;
  height: 42%;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.9), rgba(255, 255, 255, 0));
  pointer-events: none;
  z-index: -1;
}

.planner-day-card::after {
  content: "";
  position: absolute;
  right: -2.25rem;
  bottom: -2.5rem;
  width: 7rem;
  height: 7rem;
  border-radius: 999px;
  background: radial-gradient(circle, rgba(255, 178, 112, 0.18), rgba(255, 178, 112, 0));
  pointer-events: none;
  z-index: -1;
}

.planner-day-card:hover {
  border-color: rgba(204, 102, 45, 0.34);
  transform: translateY(-3px);
  box-shadow:
    0 28px 48px rgba(145, 84, 39, 0.14),
    0 2px 0 rgba(255, 255, 255, 0.82) inset;
}

.planner-day-card.selected {
  border-color: rgba(204, 102, 45, 0.42);
  box-shadow:
    0 30px 56px rgba(145, 84, 39, 0.16),
    0 2px 0 rgba(255, 255, 255, 0.85) inset;
}

.planner-day-card.today {
  background:
    linear-gradient(165deg, rgba(255, 242, 226, 0.98), rgba(255, 248, 240, 0.94) 58%, rgba(255, 233, 207, 0.9));
}

.planner-day-card.gap {
  border-style: dashed;
  border-color: rgba(204, 102, 45, 0.24);
}

.planner-day-weekday,
.planner-day-label,
.planner-post-time,
.planner-post-overflow,
.planner-gap-state span,
.planner-backlog-card-footer span,
.planner-feedback,
.planner-inline-label,
.planner-schedule-grid span {
  color: rgba(64, 42, 28, 0.72);
}

.planner-day-weekday {
  display: block;
  font-size: 0.72rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.planner-day-title {
  display: grid;
  gap: 0.2rem;
}

.planner-day-header strong {
  font-size: 1.65rem;
  line-height: 0.9;
}

.planner-day-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.8rem;
  height: 1.8rem;
  border-radius: 999px;
  padding: 0 0.55rem;
  background: rgba(255, 244, 232, 0.96);
  color: #c76528;
  font-size: 0.82rem;
  font-weight: 700;
}

.planner-day-badge,
.planner-platform-pill,
.planner-status-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  padding: 0.3rem 0.65rem;
  font-size: 0.78rem;
  font-weight: 600;
  background: rgba(243, 234, 222, 0.96);
}

.planner-platform-pill {
  background: rgba(231, 239, 255, 0.96);
  color: #3759b8;
}

.planner-status-pill.subtle {
  background: rgba(251, 245, 237, 0.96);
}

.planner-day-badge.gap {
  background: rgba(255, 243, 230, 0.96);
  color: #c76528;
}

.planner-day-empty-state {
  display: grid;
  align-content: center;
  justify-items: start;
  gap: 0.85rem;
  min-height: 100%;
}

.planner-day-empty-state strong {
  display: block;
  color: rgba(64, 42, 28, 0.56);
  font-size: 1rem;
  font-weight: 700;
}

.planner-day-posts {
  display: grid;
  gap: 0.7rem;
  align-content: start;
  margin: 0;
  padding: 0;
  list-style: none;
}

.planner-post-pill {
  display: grid;
  gap: 0.45rem;
  border: 1px solid rgba(60, 41, 30, 0.11);
  border-radius: 1rem;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(249, 244, 238, 0.9));
  padding: 0.72rem;
  cursor: pointer;
  box-shadow:
    0 10px 18px rgba(145, 84, 39, 0.06),
    0 1px 0 rgba(255, 255, 255, 0.9) inset;
  transition: transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease, background 160ms ease;
}

.planner-post-pill:hover {
  transform: translateY(-3px);
  border-color: rgba(60, 41, 30, 0.18);
  box-shadow:
    0 16px 28px rgba(145, 84, 39, 0.11),
    0 1px 0 rgba(255, 255, 255, 0.94) inset;
}

.planner-post-pill strong,
.planner-day-schedule-card p,
.planner-backlog-card p,
.planner-preview-card p {
  line-height: 1.45;
}

.planner-post-pill strong {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}

.planner-post-time.secondary {
  font-size: 0.82rem;
}

.planner-post-pill-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.65rem;
  flex-wrap: wrap;
}

.planner-post-inline-button {
  min-height: 34px;
  padding: 0 12px;
  font-size: 0.84rem;
}

.planner-post-pill[data-tone="success"] {
  border-color: rgba(74, 144, 96, 0.24);
  background: rgba(244, 251, 245, 0.96);
}

.planner-post-pill[data-tone="warning"] {
  border-color: rgba(210, 138, 62, 0.24);
  background: rgba(255, 247, 239, 0.96);
}

.planner-post-pill[data-tone="danger"] {
  border-color: rgba(180, 78, 60, 0.24);
  background: rgba(255, 243, 242, 0.96);
}

.planner-preview-card {
  display: grid;
  gap: 1rem;
  border: 1px solid rgba(60, 41, 30, 0.1);
  border-radius: 1.1rem;
  background: rgba(255, 255, 255, 0.82);
  padding: 1rem;
}

.planner-preview-card-header h3 {
  margin: 0.2rem 0 0;
  font-size: 1.1rem;
}

.planner-preview-attention {
  align-self: start;
}

.planner-linkedin-preview {
  display: grid;
  gap: 0.9rem;
  border: 1px solid rgba(60, 41, 30, 0.12);
  border-radius: 1.2rem;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(249, 244, 238, 0.94));
  padding: 1rem;
  box-shadow: 0 16px 28px rgba(145, 84, 39, 0.07);
}

.planner-linkedin-preview-header {
  display: flex;
  gap: 0.85rem;
  align-items: center;
}

.planner-linkedin-avatar {
  width: 3rem;
  height: 3rem;
  border-radius: 999px;
  display: grid;
  place-items: center;
  background: linear-gradient(180deg, rgba(232, 239, 255, 1), rgba(214, 226, 255, 0.96));
  color: #3759b8;
  font-weight: 800;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.92);
}

.planner-linkedin-author {
  display: grid;
  gap: 0.15rem;
}

.planner-linkedin-author strong {
  font-size: 1rem;
  line-height: 1.2;
}

.planner-linkedin-author span {
  color: rgba(64, 42, 28, 0.66);
  font-size: 0.88rem;
}

.planner-linkedin-preview-body {
  display: grid;
  gap: 0.55rem;
}

.planner-linkedin-preview-body p {
  margin: 0;
  white-space: pre-wrap;
  line-height: 1.55;
}

.planner-linkedin-see-more {
  width: fit-content;
  border: 0;
  padding: 0;
  background: transparent;
  color: rgba(64, 42, 28, 0.66);
  font: inherit;
  font-weight: 700;
  cursor: default;
}

.planner-linkedin-preview-media {
  overflow: hidden;
  border-radius: 1rem;
  border: 1px solid rgba(60, 41, 30, 0.08);
  background: rgba(245, 240, 233, 0.86);
}

.planner-linkedin-preview-media img {
  width: 100%;
  max-height: 22rem;
  object-fit: cover;
  display: block;
}

.planner-preview-meta-row {
  gap: 0.65rem;
  flex-wrap: wrap;
}

.planner-preview-full-copy {
  display: grid;
  gap: 0.45rem;
  padding-top: 0.2rem;
  border-top: 1px solid rgba(60, 41, 30, 0.08);
}

.planner-preview-full-copy p {
  margin: 0;
  white-space: pre-wrap;
}

.planner-day-schedule-card {
  border: 1px solid rgba(60, 41, 30, 0.1);
  border-radius: 1.1rem;
  background: rgba(255, 255, 255, 0.84);
  padding: 1rem;
  box-shadow: 0 12px 24px rgba(145, 84, 39, 0.05);
}

.planner-day-schedule-card[data-tone="success"] {
  border-color: rgba(74, 144, 96, 0.24);
  background: rgba(244, 251, 245, 0.94);
}

.planner-day-schedule-card[data-tone="warning"] {
  border-color: rgba(210, 138, 62, 0.24);
  background: rgba(255, 247, 239, 0.94);
}

.planner-day-schedule-card[data-tone="danger"] {
  border-color: rgba(180, 78, 60, 0.24);
  background: rgba(255, 243, 242, 0.94);
}

.planner-detail-overlay {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: grid;
  place-items: center;
  padding: 1.25rem;
  background: rgba(33, 18, 11, 0.3);
  backdrop-filter: blur(10px);
}

.planner-detail-modal {
  width: min(100%, 56rem);
  max-height: min(88vh, 58rem);
  overflow: auto;
  border: 1px solid rgba(60, 41, 30, 0.08);
  background:
    linear-gradient(180deg, rgba(255, 252, 247, 0.99), rgba(255, 248, 241, 0.97));
  box-shadow: 0 34px 80px rgba(33, 18, 11, 0.22);
}

.planner-detail-header {
  display: flex;
  gap: 1rem;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 1rem;
}

.planner-detail-header h2 {
  margin: 0;
  font-size: clamp(1.45rem, 2vw, 1.9rem);
  line-height: 1.05;
}

.planner-detail-meta-grid {
  display: grid;
  gap: 0.9rem;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  margin-bottom: 1rem;
}

.planner-detail-meta-card {
  display: grid;
  gap: 0.35rem;
  padding: 0.95rem 1rem;
  border: 1px solid rgba(60, 41, 30, 0.1);
  border-radius: 1rem;
  background: rgba(255, 255, 255, 0.84);
}

.planner-detail-meta-card span {
  color: rgba(64, 42, 28, 0.64);
  font-size: 0.78rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.planner-detail-meta-card strong {
  line-height: 1.35;
}

.planner-inline-section {
  border-top: 1px solid rgba(60, 41, 30, 0.1);
  padding-top: 1rem;
}

.planner-composer-copy {
  margin-top: -0.15rem;
}

.planner-inline-label,
.planner-schedule-grid span {
  display: block;
  font-size: 0.8rem;
  letter-spacing: 0.06em;
  margin-bottom: 0.35rem;
  text-transform: uppercase;
}

.planner-inline-section textarea,
.planner-schedule-grid input,
.planner-schedule-grid select {
  width: 100%;
  border: 1px solid rgba(60, 41, 30, 0.14);
  border-radius: 0.95rem;
  padding: 0.85rem 0.95rem;
  font: inherit;
  color: inherit;
  background: rgba(255, 255, 255, 0.88);
}

.planner-inline-section textarea:focus,
.planner-schedule-grid input:focus,
.planner-schedule-grid select:focus {
  outline: none;
  border-color: rgba(204, 102, 45, 0.38);
  box-shadow: 0 0 0 4px rgba(255, 187, 132, 0.16);
}

.planner-tone-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.7rem;
}

.planner-tone-chip {
  border: 1px solid rgba(60, 41, 30, 0.12);
  border-radius: 999px;
  background: rgba(255, 252, 247, 0.92);
  color: inherit;
  font: inherit;
  font-weight: 600;
  padding: 0.55rem 0.9rem;
  cursor: pointer;
}

.planner-tone-chip.active {
  border-color: rgba(204, 102, 45, 0.4);
  background: rgba(255, 243, 230, 0.94);
  color: #c76528;
}

.planner-schedule-grid {
  flex-wrap: wrap;
}

.planner-schedule-grid label {
  flex: 1 1 10rem;
}

.planner-sidebar-actions.stacked {
  grid-template-columns: 1fr;
}

.planner-backlog-header {
  display: grid;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.planner-backlog-grid {
  grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
}

.planner-backlog-card {
  padding: 1rem;
  border: 1px solid rgba(60, 41, 30, 0.12);
  border-radius: 1.1rem;
  background: rgba(255, 255, 255, 0.86);
  cursor: pointer;
  box-shadow: 0 14px 28px rgba(145, 84, 39, 0.05);
  transition: transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease;
}

.planner-backlog-card:hover {
  transform: translateY(-2px);
  border-color: rgba(204, 102, 45, 0.26);
  box-shadow: 0 18px 32px rgba(145, 84, 39, 0.09);
}

.planner-backlog-card.active {
  border-color: rgba(204, 102, 45, 0.45);
  box-shadow: 0 22px 40px rgba(145, 84, 39, 0.12);
}

.planner-empty-state {
  border: 1px dashed rgba(60, 41, 30, 0.16);
  border-radius: 1rem;
  padding: 1.25rem;
  color: rgba(64, 42, 28, 0.72);
  background: rgba(255, 249, 243, 0.78);
}

.planner-feedback.success {
  color: #2f7c4a;
}

.planner-feedback.danger {
  color: #a24430;
}

.planner-status-note {
  display: grid;
  gap: 0.45rem;
  margin: 1rem 0 0;
  padding: 0.95rem 1rem;
  border: 1px solid rgba(180, 78, 60, 0.18);
  border-radius: 1rem;
  background: rgba(255, 247, 245, 0.9);
}

.planner-status-note[data-tone="warning"] {
  border-color: rgba(210, 138, 62, 0.2);
  background: rgba(255, 249, 241, 0.92);
}

.planner-status-note p {
  margin: 0;
}

.planner-status-note-description {
  color: rgba(64, 42, 28, 0.72);
  font-size: 0.95rem;
}

.planner-danger-button {
  border-color: rgba(180, 78, 60, 0.24);
  color: #a24430;
}

.link-button {
  text-decoration: none;
}

@media (max-width: 1180px) {
  .planner-command-bar,
  .planner-main-grid,
  .planner-detail-meta-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 960px) {
  .planner-command-summary,
  .planner-week-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 720px) {
  .workspace-hero,
  .planner-command-bar,
  .planner-grid-header,
  .planner-detail-header,
  .planner-day-header,
  .planner-backlog-card-footer,
  .planner-preview-card-header {
    flex-direction: column;
    align-items: flex-start;
  }

  .planner-command-summary,
  .planner-week-grid,
  .planner-backlog-grid,
  .planner-platform-selector {
    grid-template-columns: 1fr;
  }

  .planner-top-actions {
    display: grid;
    width: 100%;
    justify-items: stretch;
  }

  .planner-header-button {
    width: 100%;
    min-width: 0;
  }

  .planner-day-card {
    min-height: auto;
  }
}
</style>
