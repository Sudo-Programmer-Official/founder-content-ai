<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import type {
  BusinessMembership,
  ControlDashboardResponse,
  RecommendedPostTimeSlot,
  ScheduledPost,
  SchedulingSafetyWarning,
  ScheduledPostStatus,
} from "../../../packages/shared-types";
import { useProductAccessContext } from "../access/product-access-context";
import PlannerSkeleton from "../components/skeletons/PlannerSkeleton.vue";
import { requestMyBusinesses } from "../services/admin-analytics-service";
import { ApiRequestError } from "../services/api-client";
import {
  requestControlDashboard,
  requestCreateIdeaInboxItem,
  requestCreatePipelineItem,
  requestDeletePipelineItem,
  requestDuplicatePipelineItem,
} from "../services/control-dashboard-service";
import { requestRepurposeContent } from "../services/generation-service";
import {
  requestLinkedInSocialAuthStart,
  requestRecommendedPostTimes,
  requestSchedulePost,
  requestScheduledPosts,
  requestUpdateScheduledPost,
} from "../services/publishing-service";
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

interface PlannerDayModel {
  key: string;
  weekdayLabel: string;
  dayLabel: string;
  longLabel: string;
  isToday: boolean;
  isGap: boolean;
  posts: ScheduledPost[];
}

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
const plannerToneOptions = [
  { label: "Founder", value: "storytelling" },
  { label: "Direct", value: "direct" },
  { label: "Structured", value: "professional" },
] as const;

const businesses = ref<BusinessMembership[]>([]);
const dashboard = ref<ControlDashboardResponse | null>(null);
const scheduledPosts = ref<ScheduledPost[]>([]);
const recommendedSlots = ref<RecommendedPostTimeSlot[]>([]);
const recommendedTimezone = ref("UTC");
const isLoading = ref(true);
const isScheduling = ref(false);
const isUpdatingScheduledPost = ref(false);
const isSavingIdea = ref(false);
const errorMessage = ref("");
const feedbackMessage = ref("");
const selectedGridDateKey = ref("");
const selectedAudienceDateKey = ref("");
const selectedWeekStartKey = ref("");
const selectedScheduledPostId = ref("");
const selectedBacklogAssetId = ref("");
const quickIdeaText = ref("");
const quickDraftTone = ref<(typeof plannerToneOptions)[number]["value"]>("storytelling");
const scheduleTime = ref("09:00");
const audienceTimezone = ref("");
const isCreatingDraft = ref(false);
const isGeneratingDraft = ref(false);
const isConnectingLinkedIn = ref(false);
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

const selectedDayPosts = computed(() => selectedDay.value?.posts ?? []);

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

const plannerWeeklyFocus = computed(() => {
  if (gapDays.value.length > 0) {
    return `You have ${gapDays.value.length} open ${gapDays.value.length === 1 ? "slot" : "slots"} this week. Fill them before consistency breaks.`;
  }

  if (bestSlot.value) {
    return `Your week has coverage. Tighten it around the strongest window: ${bestSlot.value.localLabel}.`;
  }

  return "Use this week view as the control center for every post that should go live.";
});

const plannerCards = computed(() => {
  const scheduledCount = weekDays.value.reduce(
    (total, day) => total + day.posts.filter((post) => post.status === "scheduled").length,
    0,
  );
  const postedCount = weekDays.value.reduce(
    (total, day) => total + day.posts.filter((post) => post.status === "published").length,
    0,
  );
  const streakDays = dashboard.value?.today.streakDays ?? 0;

  return [
    { label: "Open days", value: String(gapDays.value.length), tone: gapDays.value.length > 2 ? "warning" : "default" },
    { label: "Queued this week", value: String(scheduledCount), tone: "default" },
    { label: "Published this week", value: String(postedCount), tone: postedCount > 0 ? "success" : "default" },
    { label: "Current streak", value: streakDays > 0 ? `${streakDays}d` : "0d", tone: streakDays > 0 ? "success" : "default" },
  ] as const;
});

const bestSlot = computed(() => recommendedSlots.value[0] ?? null);

const selectedDayFocusMessage = computed(() => {
  if (!selectedDay.value) {
    return "Choose a day to create, review, and move work into a real publishing slot.";
  }

  if (selectedDay.value.isGap) {
    return "This day is empty. Close the gap with a saved draft or generate something new without leaving the planner.";
  }

  return "This day already has momentum. Review the live mix, tighten the slot, or add another post if it earns the space.";
});

const backlogTitle = computed(() => {
  const count = unscheduledBacklog.value.length;
  return `${count} saved draft${count === 1 ? "" : "s"} waiting for a slot`;
});

const selectedScheduledPost = computed(
  () => scheduledPosts.value.find((post) => post.id === selectedScheduledPostId.value) ?? null,
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

const selectedBacklogAsset = computed(
  () => unscheduledBacklog.value.find((asset) => asset.id === selectedBacklogAssetId.value) ?? null,
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

function buildDraftTitle(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.slice(0, 80) || "Untitled draft";
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

  if (!incomingDraftId) {
    return;
  }

  const nextQuery = { ...route.query };
  delete nextQuery.draftId;

  const matchingDraft = unscheduledBacklog.value.find((asset) => asset.id === incomingDraftId);

  if (matchingDraft) {
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

async function loadPlannerData(): Promise<void> {
  if (!resolvedBusinessId.value || !schedulerEnabled.value) {
    dashboard.value = null;
    scheduledPosts.value = [];
    recommendedSlots.value = [];
    return;
  }

  const [scheduledResponse, recommendationsResponse] = await Promise.all([
    requestScheduledPosts(resolvedBusinessId.value),
    requestRecommendedPostTimes(
      resolvedBusinessId.value,
      "text",
      audienceTimezone.value || workspaceDefaultAudienceTimezone.value,
    ).catch(() => null),
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
  errorMessage.value = "";

  try {
    await loadBusinesses();
    initializeWeekState();
    await loadPlannerData();
    syncSelection();
    await consumeIncomingDraftSelection();
  } catch (error) {
    errorMessage.value =
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
}

function clearSelectedScheduledPost(): void {
  selectedScheduledPostId.value = "";
  feedbackMessage.value = "";
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

async function addIdeaToInbox(): Promise<void> {
  if (!resolvedBusinessId.value || !quickIdeaText.value.trim()) {
    errorMessage.value = "Add a quick idea before saving it to the inbox.";
    return;
  }

  isSavingIdea.value = true;
  errorMessage.value = "";

  try {
    await requestCreateIdeaInboxItem({
      businessId: resolvedBusinessId.value,
      text: quickIdeaText.value.trim(),
    });
    quickIdeaText.value = "";
    feedbackMessage.value = "Idea saved to the inbox.";
    await loadPlannerData();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Unable to save that idea.";
  } finally {
    isSavingIdea.value = false;
  }
}

async function selectCreatedDraft(assetId: string, message: string): Promise<void> {
  await loadPlannerData();
  selectBacklogAsset(assetId, selectedGridDateKey.value);
  syncSelection();
  feedbackMessage.value = message;
  quickIdeaText.value = "";
}

async function saveDraftForSelectedDay(): Promise<void> {
  if (!resolvedBusinessId.value || !quickIdeaText.value.trim()) {
    errorMessage.value = "Add one idea before saving a draft.";
    return;
  }

  isCreatingDraft.value = true;
  errorMessage.value = "";
  feedbackMessage.value = "";

  try {
    const text = quickIdeaText.value.trim();
    const response = await requestCreatePipelineItem({
      businessId: resolvedBusinessId.value,
      title: buildDraftTitle(text),
      textContent: text,
      contentBody: { content: text },
      sourceKind: "idea",
    });

    await selectCreatedDraft(response.asset.id, "Draft created in the planner. Pick a time and schedule it.");
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Unable to save this draft right now.";
  } finally {
    isCreatingDraft.value = false;
  }
}

async function generateDraftForSelectedDay(): Promise<void> {
  if (!resolvedBusinessId.value || !quickIdeaText.value.trim()) {
    errorMessage.value = "Add one idea before generating a draft.";
    return;
  }

  isGeneratingDraft.value = true;
  errorMessage.value = "";
  feedbackMessage.value = "";

  try {
    const ideaInput = quickIdeaText.value.trim();
    const response = await requestRepurposeContent({
      inputType: "text",
      intent: "capture",
      text: ideaInput,
      tone: quickDraftTone.value,
      businessId: resolvedBusinessId.value,
    });
    const generatedPost = response.variations[0]?.content?.trim() || response.post.trim();

    if (!generatedPost) {
      throw new Error("The generator returned an empty draft.");
    }

    const assetId =
      response.asset?.id ??
      (
        await requestCreatePipelineItem({
          businessId: resolvedBusinessId.value,
          title: response.idea.title || buildDraftTitle(ideaInput),
          textContent: generatedPost,
          contentBody: response as unknown as Record<string, unknown>,
          sourceKind: "generated",
        })
      ).asset.id;

    await selectCreatedDraft(assetId, "Draft generated in the planner. Pick a time and schedule it.");
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "Unable to generate a planner draft right now.";
  } finally {
    isGeneratingDraft.value = false;
  }
}

async function scheduleSelectedAsset(): Promise<void> {
  if (!resolvedBusinessId.value || !selectedBacklogAsset.value) {
    errorMessage.value = "Pick a draft before scheduling it.";
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

  const scheduleRequest = {
    businessId: resolvedBusinessId.value,
    platform: "linkedin" as const,
    contentText,
    assetGroupId: selectedBacklogAsset.value.id,
    slides: [],
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
      response = await requestSchedulePost(scheduleRequest);
    } catch (error) {
      const warnings = extractSchedulingWarnings(error);

      if (warnings.length === 0 || !confirmSchedulingWarnings(warnings)) {
        throw error;
      }

      response = await requestSchedulePost({
        ...scheduleRequest,
        ignoreSafetyWarnings: true,
      });
      feedbackMessage.value = "Draft scheduled with a manual safety override.";
    }

    if (!feedbackMessage.value) {
      feedbackMessage.value = "Draft scheduled and added to the grid.";
    }
    selectedBacklogAssetId.value = "";
    selectedScheduledPostId.value = response.scheduledPost.id;
    await loadPlannerData();
    syncSelection();
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "Unable to schedule this draft right now.";
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
    await selectCreatedDraft(response.asset.id, "Draft duplicated. The copy is ready to schedule.");
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
    syncSelection();
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "Unable to reschedule that post right now.";
  } finally {
    isUpdatingScheduledPost.value = false;
  }
}

function openCreatePage(): void {
  const targetDayKey = selectedGridDateKey.value || toDateKeyInTimezone(new Date(), userTimezone);
  selectDay(targetDayKey);

  if (typeof document !== "undefined") {
    document.getElementById("planner-composer-panel")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
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

function focusFirstGap(): void {
  const gap = gapDays.value[0];

  if (!gap) {
    return;
  }

  selectDay(gap.key);
}

watch(
  () => resolvedBusinessId.value,
  () => {
    audienceTimezone.value = workspaceDefaultAudienceTimezone.value;
  },
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
      isProductAccessReady.value,
      resolvedBusinessId.value,
      schedulerEnabled.value,
      canReadDraftBacklog.value,
      audienceTimezone.value || workspaceDefaultAudienceTimezone.value,
    ] as const,
  ([accessReady]) => {
    if (!accessReady) {
      return;
    }

    void initializePage();
  },
);

onMounted(() => {
  if (isProductAccessReady.value) {
    void initializePage();
  }
});
</script>

<template>
  <main class="planner-shell">
    <section class="workspace-hero">
      <div>
        <p class="workspace-eyebrow">/app/planner</p>
        <h1>Execution planner</h1>
        <p class="workspace-description">
          See the week, fill content gaps, and move saved drafts into real publishing slots without leaving the workspace loop.
        </p>
      </div>

      <div class="planner-top-actions">
        <button
          type="button"
          class="workspace-secondary-button"
          :disabled="gapDays.length === 0"
          @click="focusFirstGap"
        >
          Fill gaps
        </button>
        <button type="button" class="workspace-primary-button" @click="openCreatePage">
          Create in planner
        </button>
      </div>
    </section>

    <PlannerSkeleton v-if="isLoading" />

    <template v-else>
      <section class="workspace-card planner-command-bar">
        <div class="planner-command-bar-copy">
          <p class="workspace-eyebrow">Content command center</p>
          <h2>{{ weekRangeLabel }}</h2>
          <p class="workspace-description compact">
            {{ plannerWeeklyFocus }}
          </p>
        </div>

        <div class="planner-command-bar-actions">
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

          <div class="planner-command-summary">
            <article
              v-for="card in plannerCards"
              :key="card.label"
              class="planner-overview-card"
              :data-tone="card.tone"
            >
              <span>{{ card.label }}</span>
              <strong>{{ card.value }}</strong>
            </article>
          </div>
        </div>
      </section>

      <section v-if="errorMessage" class="workspace-card empty-state">
        <h2>Planner unavailable</h2>
        <p>{{ errorMessage }}</p>
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
        <div class="planner-grid-header">
          <div class="planner-grid-header-copy">
            <p class="workspace-chip planner-chip">
              Grid: {{ userTimezone }} · Audience default: {{ audienceTimezone || workspaceDefaultAudienceTimezone }}
            </p>
            <h2>{{ selectedDay?.longLabel || weekRangeLabel }}</h2>
            <p class="workspace-description compact">
              {{ selectedDayFocusMessage }}
            </p>
          </div>

          <div class="planner-grid-header-actions">
            <button
              type="button"
              class="workspace-secondary-button compact"
              :disabled="gapDays.length === 0"
              @click="focusFirstGap"
            >
              Fill first gap
            </button>
            <button type="button" class="workspace-primary-button compact" @click="openCreatePage">
              Create in planner
            </button>
          </div>
        </div>

        <div class="planner-insight-row">
          <div class="planner-insight-card">
            <span class="planner-insight-label">Coverage</span>
            <strong v-if="gapDays.length > 0">{{ gapDays.length }} growth gap{{ gapDays.length === 1 ? "" : "s" }}</strong>
            <strong v-else>Every day has coverage</strong>
            <p>
              {{
                gapDays.length > 0
                  ? "Empty days are where momentum drops. Use the backlog to lock a real slot in."
                  : "The week is protected. Review quality, not just quantity."
              }}
            </p>
          </div>

          <div class="planner-insight-card" v-if="bestSlot">
            <span class="planner-insight-label">Best window</span>
            <strong>{{ bestSlot.localLabel }}</strong>
            <p>{{ recommendedTimezone }} is the strongest recommendation right now.</p>
            <button type="button" class="workspace-secondary-button compact" @click="applyRecommendedSlot(bestSlot)">
              Use this slot
            </button>
          </div>
        </div>

        <div class="planner-week-grid">
          <button
            v-for="day in weekDays"
            :key="day.key"
            type="button"
            class="planner-day-card"
            :class="{
              selected: day.key === selectedGridDateKey,
              today: day.isToday,
              gap: day.isGap,
            }"
            @click="selectDay(day.key)"
          >
            <div class="planner-day-header">
              <div>
                <span class="planner-day-weekday">{{ day.weekdayLabel }}</span>
                <strong>{{ day.dayLabel }}</strong>
              </div>
              <span v-if="day.isGap" class="planner-day-badge gap">
                {{ day.posts.length === 0 ? "Growth gap" : "Needs coverage" }}
              </span>
              <span v-else class="planner-day-badge">{{ day.posts.length }}</span>
            </div>

            <p class="planner-day-label">{{ day.longLabel }}</p>

            <div v-if="day.posts.length === 0" class="planner-gap-state">
              <strong>{{ day.isToday ? "Today is quiet." : "Open slot." }}</strong>
              <span>
                {{
                  day.isGap
                    ? "Fill it before the week loses momentum."
                    : "Only use it if another post clearly earns the space."
                }}
              </span>
            </div>

            <ul v-if="day.posts.length > 0" class="planner-day-posts">
              <li
                v-for="post in day.posts.slice(0, 2)"
                :key="post.id"
                class="planner-post-pill"
                :data-tone="resolveStatusTone(post.status)"
                @click.stop="selectScheduledPost(post.id, day.key)"
              >
                <div class="planner-post-pill-header">
                  <div class="planner-pill-stack">
                    <span class="planner-platform-pill">LinkedIn</span>
                    <span v-if="getMediaCount(post) > 0" class="planner-status-pill subtle">
                      📎 {{ getMediaCount(post) }}
                    </span>
                  </div>
                  <span class="planner-status-pill">{{ resolveScheduledPostStatusLabel(post.status) }}</span>
                </div>
                <strong>{{ buildExcerpt(post.contentText, 44) }}</strong>
                <span class="planner-post-time">
                  {{ formatTimeWithZone(post.scheduledAt, post.audienceTimezone) }}
                </span>
                <span
                  v-if="post.audienceTimezone !== userTimezone"
                  class="planner-post-time secondary"
                >
                  Your time: {{ formatTimeWithZone(post.scheduledAt, userTimezone) }}
                </span>
              </li>
              <li v-if="day.posts.length > 2" class="planner-post-overflow">
                +{{ day.posts.length - 2 }} more in queue
              </li>
            </ul>

            <div class="planner-day-footer">
              <button
                type="button"
                class="planner-day-add-button"
                @click.stop="selectDay(day.key)"
              >
                {{ day.posts.length === 0 ? "Plan this day" : "Add another slot" }}
              </button>
            </div>
          </button>
        </div>
      </article>

      <aside id="planner-composer-panel" class="workspace-card planner-sidebar">
        <template v-if="selectedScheduledPost">
          <p class="workspace-eyebrow">Action hub</p>
          <h2>Review this slot</h2>
          <p class="workspace-description compact">
            {{ formatDateInTimezone(selectedScheduledPost.scheduledAt, selectedScheduledPost.audienceTimezone, {
              weekday: "long",
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            }) }}
            in {{ selectedScheduledPost.audienceTimezone }}
          </p>
          <p v-if="selectedScheduledPost.audienceTimezone !== userTimezone" class="workspace-description compact">
            Your time: {{ formatTimeWithZone(selectedScheduledPost.scheduledAt, userTimezone) }}
          </p>
          <p class="workspace-description compact">
            Dispatch window: {{ formatScheduledPostDispatchWindow(selectedScheduledPost) }}
          </p>
          <p class="workspace-description compact">
            Publishing as {{ resolveSelectedIdentityLabel(selectedScheduledPost) }}
          </p>
          <p class="workspace-description compact">
            {{ resolveScheduledPostStatusSummary(selectedScheduledPost) }}
          </p>
          <p class="workspace-description compact">
            {{ selectedDayPosts.length }} scheduled item{{ selectedDayPosts.length === 1 ? "" : "s" }} on
            {{ selectedDay?.longLabel || "this day" }}.
          </p>

          <article class="planner-preview-card">
            <div class="planner-preview-chip-row">
              <p class="workspace-chip">{{ resolveScheduledPostStatusLabel(selectedScheduledPost.status) }}</p>
              <p v-if="selectedScheduledPost.selectedIdentityDisplayName" class="workspace-chip">
                {{ resolveSelectedIdentityLabel(selectedScheduledPost) }}
              </p>
              <p v-if="getMediaCount(selectedScheduledPost) > 0" class="workspace-chip">
                📎 {{ getMediaCount(selectedScheduledPost) }} image{{ getMediaCount(selectedScheduledPost) === 1 ? "" : "s" }}
              </p>
            </div>
            <p>{{ selectedScheduledPost.contentText }}</p>
          </article>

          <div
            v-if="selectedScheduledPost.errorMessage"
            class="planner-feedback danger"
          >
            {{ selectedScheduledPost.errorMessage }}
          </div>

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
              v-if="selectedDayPosts.length > 0"
              type="button"
              class="workspace-secondary-button"
              :disabled="isUpdatingScheduledPost"
              @click="clearSelectedScheduledPost"
            >
              View day schedule
            </button>
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
              :disabled="isConnectingLinkedIn"
              @click="reconnectLinkedIn"
            >
              {{ isConnectingLinkedIn ? "Redirecting..." : "Reconnect LinkedIn" }}
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
              View on LinkedIn
            </a>
          </div>
        </template>

        <template v-else>
          <p class="workspace-eyebrow">Action hub</p>
          <h2>{{ selectedDay?.longLabel || "Choose a day" }}</h2>
          <p class="workspace-description compact">
            {{ selectedDayFocusMessage }}
          </p>

          <div v-if="selectedDayPosts.length > 0" class="planner-inline-section">
            <div class="planner-day-schedule-header">
              <div>
                <label class="planner-inline-label">Scheduled on this day</label>
                <p class="workspace-description compact">
                  Open any slot to edit, move, retry, or push it live now.
                </p>
              </div>
              <span class="workspace-chip">
                {{ selectedDayPosts.length }} item{{ selectedDayPosts.length === 1 ? "" : "s" }}
              </span>
            </div>

            <div class="planner-day-schedule-list">
              <article
                v-for="post in selectedDayPosts"
                :key="post.id"
                class="planner-day-schedule-card"
                :data-tone="resolveStatusTone(post.status)"
              >
                <div class="planner-day-schedule-card-header">
                  <div class="planner-pill-stack">
                    <span class="planner-platform-pill">LinkedIn</span>
                    <span class="planner-status-pill">{{ resolveScheduledPostStatusLabel(post.status) }}</span>
                    <span v-if="post.selectedIdentityDisplayName" class="planner-status-pill subtle">
                      {{ resolveSelectedIdentityLabel(post) }}
                    </span>
                    <span v-if="getMediaCount(post) > 0" class="planner-status-pill subtle">
                      📎 {{ getMediaCount(post) }}
                    </span>
                  </div>
                  <strong>{{ formatTimeWithZone(post.scheduledAt, post.audienceTimezone) }}</strong>
                </div>

                <p>{{ buildExcerpt(post.contentText, 140) }}</p>
                <p class="planner-post-time secondary">
                  Your time: {{ formatTimeWithZone(post.scheduledAt, userTimezone) }}
                </p>

                <div class="planner-sidebar-actions">
                  <button
                    type="button"
                    class="workspace-secondary-button compact"
                    @click="selectScheduledPost(post.id, selectedDay?.key || '')"
                  >
                    Edit / move
                  </button>
                  <button
                    v-if="post.assetGroupId"
                    type="button"
                    class="workspace-secondary-button compact"
                    @click="openDraftEditor(post.assetGroupId)"
                  >
                    Edit draft
                  </button>
                </div>
              </article>
            </div>
          </div>

          <div class="planner-inline-section">
            <label class="planner-inline-label" for="planner-idea-input">
              Create for {{ selectedDay?.longLabel || "this day" }}
            </label>
            <p class="workspace-description compact planner-composer-copy">
              Drop one raw idea here. Generate turns it into a usable draft. Save draft keeps your thought intact without leaving the planner.
            </p>
            <textarea
              id="planner-idea-input"
              v-model="quickIdeaText"
              rows="4"
              placeholder="Drop the seed for this post. Example: tell the story of why customer proof matters more than feature lists."
            />
            <div class="planner-tone-row">
              <button
                v-for="option in plannerToneOptions"
                :key="option.value"
                type="button"
                class="planner-tone-chip"
                :class="{ active: quickDraftTone === option.value }"
                @click="quickDraftTone = option.value"
              >
                {{ option.label }}
              </button>
            </div>
            <div class="planner-sidebar-actions">
              <button
                type="button"
                class="workspace-secondary-button"
                :disabled="isSavingIdea || !quickIdeaText.trim()"
                @click="addIdeaToInbox"
              >
                {{ isSavingIdea ? "Saving..." : "Save idea" }}
              </button>
              <button
                type="button"
                class="workspace-secondary-button"
                :disabled="isCreatingDraft || !quickIdeaText.trim()"
                @click="saveDraftForSelectedDay"
              >
                {{ isCreatingDraft ? "Saving..." : "Save draft" }}
              </button>
              <button
                type="button"
                class="workspace-primary-button"
                :disabled="isGeneratingDraft || !quickIdeaText.trim()"
                @click="generateDraftForSelectedDay"
              >
                {{ isGeneratingDraft ? "Generating..." : "Generate draft" }}
              </button>
            </div>
          </div>

          <template v-if="selectedBacklogAsset">
            <div class="planner-inline-section">
              <label class="planner-inline-label">Schedule selected draft</label>
              <article class="planner-preview-card">
                <p class="workspace-chip">{{ selectedBacklogAsset.pipelineStage === "review" ? "Ready" : "Draft" }}</p>
                <strong>{{ selectedBacklogAsset.title || "Untitled draft" }}</strong>
                <p>{{ buildExcerpt(selectedBacklogAsset.textContent || "", 180) }}</p>
              </article>

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
                  :disabled="isScheduling"
                  @click="scheduleSelectedAsset"
                >
                  {{ isScheduling ? "Scheduling..." : "Schedule draft" }}
                </button>
              </div>
            </div>
          </template>
        </template>

        <p v-if="feedbackMessage" class="planner-feedback success">{{ feedbackMessage }}</p>
          </aside>
        </section>

        <section class="workspace-card planner-backlog-panel">
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
  grid-template-columns: minmax(0, 1.5fr) minmax(300px, 0.8fr);
  align-items: start;
}

.planner-grid-panel,
.planner-sidebar,
.planner-backlog-panel {
  padding: 1.45rem;
}

.planner-sidebar {
  position: sticky;
  top: 1.2rem;
  border: 1px solid rgba(60, 41, 30, 0.08);
  background:
    linear-gradient(180deg, rgba(255, 252, 247, 0.98), rgba(255, 248, 241, 0.96));
  box-shadow: 0 22px 52px rgba(145, 84, 39, 0.08);
}

.workspace-description.compact {
  margin: 0;
  font-size: 0.95rem;
}

.planner-grid-header {
  margin-bottom: 1rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid rgba(60, 41, 30, 0.08);
}

.planner-grid-header-copy {
  max-width: 34rem;
}

.planner-grid-header-copy h2 {
  margin: 0;
  font-size: 1.55rem;
  line-height: 1.1;
}

.planner-chip {
  width: fit-content;
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

.planner-card-action-row {
  display: inline-flex;
  gap: 0.55rem;
  align-items: center;
}

.planner-day-footer {
  margin-top: auto;
}

.planner-day-add-button {
  width: 100%;
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
  min-height: auto;
  padding: 0.7rem 1rem;
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
  grid-template-columns: repeat(7, minmax(12.5rem, 1fr));
  gap: 1rem;
  overflow-x: auto;
  padding: 0.25rem 0.1rem 0.7rem;
  align-items: stretch;
  scrollbar-width: thin;
}

.planner-day-card {
  position: relative;
  isolation: isolate;
  display: grid;
  grid-template-rows: auto auto 1fr auto;
  gap: 0.72rem;
  align-content: start;
  min-height: 14.25rem;
  border: 1px solid rgba(60, 41, 30, 0.1);
  border-radius: 1.35rem;
  background:
    linear-gradient(165deg, rgba(255, 255, 255, 0.97), rgba(255, 247, 238, 0.94) 62%, rgba(253, 238, 223, 0.9));
  padding: 0.95rem 0.95rem 0.9rem;
  text-align: left;
  color: inherit;
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
  transform: translateY(-5px) scale(1.01);
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
  font-size: 0.76rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.planner-day-header strong {
  font-size: 1.9rem;
  line-height: 0.9;
}

.planner-day-label {
  margin: 0;
  font-size: 0.92rem;
  font-weight: 600;
  color: rgba(64, 42, 28, 0.82);
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

.planner-gap-state {
  margin-top: auto;
  border: 1px dashed rgba(204, 102, 45, 0.22);
  border-radius: 1rem;
  padding: 0.85rem 0.9rem;
  background: rgba(255, 244, 232, 0.84);
  min-height: 5rem;
  display: grid;
  align-content: start;
  gap: 0.28rem;
}

.planner-gap-state strong {
  display: block;
}

.planner-day-posts {
  display: grid;
  gap: 0.7rem;
  align-content: start;
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

.planner-post-overflow {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px dashed rgba(60, 41, 30, 0.16);
  border-radius: 0.95rem;
  min-height: 2.8rem;
  background: rgba(255, 252, 248, 0.8);
  font-weight: 600;
}

.planner-post-time.secondary {
  font-size: 0.82rem;
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
  gap: 0.8rem;
  border: 1px solid rgba(60, 41, 30, 0.1);
  border-radius: 1.1rem;
  background: rgba(255, 255, 255, 0.82);
  padding: 1rem;
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

.planner-danger-button {
  border-color: rgba(180, 78, 60, 0.24);
  color: #a24430;
}

.link-button {
  text-decoration: none;
}

@media (max-width: 1180px) {
  .planner-command-bar,
  .planner-main-grid {
    grid-template-columns: 1fr;
  }

  .planner-sidebar {
    position: static;
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
  .planner-day-header,
  .planner-backlog-card-footer {
    flex-direction: column;
    align-items: flex-start;
  }

  .planner-command-summary,
  .planner-week-grid,
  .planner-backlog-grid {
    grid-template-columns: 1fr;
  }

  .planner-day-card {
    min-height: auto;
  }
}
</style>
