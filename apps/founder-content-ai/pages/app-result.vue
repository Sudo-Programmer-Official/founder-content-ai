<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import type {
  ContentAiEditPreview,
  ContentAsset,
  MediaRecommendationSuggestion,
  PostAsset,
  RecommendedPostTimeSlot,
  RepurposeContentResponse,
  SchedulingSafetyWarning,
  SocialAccount,
  WorkspaceAsset,
} from "../../../packages/shared-types";
import WorkspaceAssetPickerModal from "../components/WorkspaceAssetPickerModal.vue";
import { useProductAccessContext } from "../access/product-access-context";
import { calculateContentScore } from "../composables/useContentScore";
import { ApiRequestError } from "../services/api-client";
import {
  getActivationDraft,
  replaceActivationDraft,
  type ActivationDraftRecord,
} from "../services/activation-flow-service";
import {
  requestCreatePipelineItem,
  requestContentAiEditPreview,
  requestPipelineItem,
  requestUpdatePipelineItem,
} from "../services/control-dashboard-service";
import { requestVisualGeneration } from "../services/generation-service";
import { requestMediaRecommendations } from "../services/media-intelligence-service";
import {
  requestLinkedInSocialAuthStart,
  requestPublishPost,
  requestRecommendedPostTimes,
  requestSchedulePost,
  requestSocialAccounts,
} from "../services/publishing-service";
import {
  requestCreatePostAsset,
  requestDeletePostAsset,
  requestMediaUploadUrl,
  requestPostAssets,
} from "../services/post-assets-service";
import { appRoutes } from "../utils/routes";
import {
  convertZonedDateTimeToUtcIso,
  detectUserTimezone,
  formatDateInTimezone,
  formatTimeWithZone,
  toDateKeyInTimezone,
  toTimeValueInTimezone,
} from "../utils/timezone";
import { saveRepurposeSeed } from "../utils/repurpose-loop";

const route = useRoute();
const router = useRouter();
const { bootstrap, isFeatureEnabled } = useProductAccessContext();

const draft = ref<ActivationDraftRecord | null>(null);
const feedbackMessage = ref("");
const socialAccounts = ref<SocialAccount[]>([]);
const isLoadingChannels = ref(false);
const isConnectingLinkedIn = ref(false);
const isPublishingToLinkedIn = ref(false);
const isLoadingPostAssets = ref(false);
const isUploadingPostAssets = ref(false);
const removingPostAssetId = ref("");
const mediaFeedback = ref("");
const postAssets = ref<PostAsset[]>([]);
const isWorkspaceAssetPickerOpen = ref(false);
const mediaRecommendations = ref<MediaRecommendationSuggestion[]>([]);
const isLoadingMediaRecommendations = ref(false);
const isGeneratingRecommendationId = ref("");
const mediaRecommendationPanelRef = ref<HTMLElement | null>(null);
const aiEditInstruction = ref("");
const aiEditPreview = ref<ContentAiEditPreview | null>(null);
const aiEditFeedback = ref("");
const isPreviewingAiEdit = ref(false);
const isApplyingAiEdit = ref(false);
const isSchedulePanelOpen = ref(false);
const isLoadingRecommendedSlots = ref(false);
const isSchedulingDraft = ref(false);
const scheduleFeedback = ref("");
const scheduleDateKey = ref("");
const scheduleTime = ref("09:00");
const audienceTimezone = ref("");
const recommendedTimezone = ref("UTC");
const recommendedSlots = ref<RecommendedPostTimeSlot[]>([]);

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

const AI_QUICK_COMMANDS = [
  { label: "Stop the scroll", value: "Rewrite the opening so the first line stops the scroll and creates tension." },
  { label: "Make sharper", value: "Make this sharper and more punchy." },
  { label: "Add specificity", value: "Make this more specific with concrete founder realities and cleaner language. Do not invent facts." },
  { label: "Shorten", value: "Shorten this without changing the core message." },
  { label: "Founder voice", value: "Make this sound like a founder talking to another founder, not a consultant or AI assistant." },
  { label: "Punchier close", value: "Tighten the ending and land on a stronger punchline." },
] as const;

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

function splitPostParagraphs(value: string): string[] {
  return value
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== "");
}

function extractPreviewLead(paragraphs: string[]): string[] {
  const firstParagraph = paragraphs[0] ?? "";

  if (!firstParagraph) {
    return [];
  }

  const explicitLines = firstParagraph
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line !== "");

  if (explicitLines.length >= 2 && explicitLines[0].length <= 72 && explicitLines[1].length <= 72) {
    return explicitLines.slice(0, 2);
  }

  const normalized = firstParagraph.replace(/\s+/g, " ").trim();
  const firstSentenceMatch = normalized.match(/^[^.!?]+[.!?](?=\s|$)/);
  const firstSentence = firstSentenceMatch?.[0]?.trim() ?? normalized;

  if (!firstSentence) {
    return [];
  }

  if (firstSentence.length <= 96) {
    const remaining = normalized.slice(firstSentence.length).trim();
    const secondSentenceMatch = remaining.match(/^[^.!?]+[.!?](?=\s|$)/);
    const secondSentence = secondSentenceMatch?.[0]?.trim() ?? "";

    if (secondSentence && secondSentence.length <= 72) {
      return [firstSentence, secondSentence];
    }
  }

  return [firstSentence.length > 110 ? `${firstSentence.slice(0, 107).trimEnd()}...` : firstSentence];
}

function extractPreviewBody(paragraphs: string[], leadLines: string[]): string[] {
  if (paragraphs.length === 0) {
    return [];
  }

  let firstParagraph = paragraphs[0] ?? "";

  for (const leadLine of leadLines) {
    if (!leadLine) {
      continue;
    }

    if (firstParagraph.startsWith(leadLine)) {
      firstParagraph = firstParagraph.slice(leadLine.length).trimStart();
      continue;
    }

    firstParagraph = firstParagraph.replace(leadLine, "").trim();
  }

  return [firstParagraph, ...paragraphs.slice(1)]
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== "");
}

const postScore = computed(() =>
  draft.value
    ? calculateContentScore({
        id: draft.value.id,
        contentType: "post",
        contentBody: draft.value.result.post,
        status: "draft",
        pipelineStage: "review",
        sourceKind: draft.value.mode === "improve" ? "remix" : "capture",
        textContent: draft.value.result.post,
        createdAt: draft.value.createdAt,
      } satisfies ContentAsset).score
    : 0,
);

const quickSignals = computed(() => draft.value?.result.quickSignals);
const postContent = computed(() => draft.value?.result.post ?? "");
const postParagraphs = computed(() => splitPostParagraphs(postContent.value));
const previewLeadLines = computed(() => extractPreviewLead(postParagraphs.value));
const previewBodyParagraphs = computed(() =>
  extractPreviewBody(postParagraphs.value, previewLeadLines.value),
);
const hooks = computed(() => draft.value?.result.hooks ?? []);
const povSummary = computed(() => draft.value?.result.pov?.summary ?? "");
const qualitySummary = computed(() => draft.value?.result.quality);
const hasPersistedAsset = computed(() => Boolean(draft.value?.result.asset?.id));
const persistedPostId = computed(() => draft.value?.result.asset?.id ?? "");
const activeBusinessId = computed(() => bootstrap.value?.activeBusinessId ?? "");
const canPersistDraft = computed(() => Boolean(activeBusinessId.value && draft.value));
const schedulerEnabled = computed(
  () =>
    Boolean(activeBusinessId.value) &&
    (!bootstrap.value?.activeBusinessId || isFeatureEnabled("scheduler")),
);
const canScheduleDraft = computed(
  () => schedulerEnabled.value && canPersistDraft.value,
);
const audienceTimezoneOptions = computed(() => {
  const unique = new Set<string>([
    audienceTimezone.value || recommendedTimezone.value || userTimezone,
    userTimezone,
    ...COMMON_AUDIENCE_TIMEZONES,
  ]);

  return [...unique].map((value) => ({
    value,
    label:
      value === userTimezone
        ? `${value} · your time`
        : value === recommendedTimezone.value
          ? `${value} · recommended`
          : value,
  }));
});
const connectedLinkedInAccount = computed(() =>
  socialAccounts.value.find(
    (account) => account.platform === "linkedin" && account.status === "connected",
  ),
);
const connectedLinkedInLabel = computed(() => {
  const account = connectedLinkedInAccount.value;

  if (!account) {
    return "";
  }

  if (account.selectedIdentity?.displayName) {
    return account.selectedIdentity.displayName;
  }

  const linkedInName =
    typeof account.metadata?.linkedInName === "string" ? account.metadata.linkedInName.trim() : "";

  return linkedInName || account.accountEmail || account.platformUserId;
});
const connectedLinkedInDescriptor = computed(() => {
  const account = connectedLinkedInAccount.value;

  if (!account) {
    return "LinkedIn not connected";
  }

  const typeLabel =
    account.selectedIdentity?.type === "organization" ? "Company page" : "Personal profile";

  return connectedLinkedInLabel.value
    ? `${connectedLinkedInLabel.value} · ${typeLabel}`
    : typeLabel;
});
const linkedInPublishingStatus = computed(() => {
  if (!activeBusinessId.value) {
    return "Select a workspace to publish.";
  }

  if (connectedLinkedInAccount.value) {
    return connectedLinkedInLabel.value
      ? `Posting as ${connectedLinkedInLabel.value}`
      : "Posting optimized for LinkedIn";
  }

  return "Connect LinkedIn to publish directly.";
});

function getPublishFailureMessage(error: unknown): string {
  const rawMessage =
    error instanceof Error && error.message.trim() !== ""
      ? error.message.trim()
      : "Unable to publish to LinkedIn right now.";

  if (rawMessage.includes("status 404")) {
    return "Direct LinkedIn publishing is not live on the backend yet. Redeploy the API and try again.";
  }

  return rawMessage;
}

const attentionSignal = computed(() => {
  if (postScore.value >= 84) {
    return {
      label: "High",
      copy: "Strong feed readability with a clean publishing structure.",
      tone: "strong",
    } as const;
  }

  if (postScore.value >= 72) {
    return {
      label: "Promising",
      copy: "Good foundation. The main unlock is a sharper opening or tighter close.",
      tone: "steady",
    } as const;
  }

  return {
    label: "Needs punch",
    copy: "The idea is there, but the hook or paragraph rhythm still needs more tension.",
    tone: "warning",
  } as const;
});

const structureSignal = computed(() => {
  if (previewLeadLines.value[0] && previewLeadLines.value[0].length <= 72 && postParagraphs.value.length >= 4) {
    return "Scroll-friendly";
  }

  if (postParagraphs.value.length >= 3) {
    return "Readable";
  }

  return "Dense";
});

const actionPriorityLabel = computed(() =>
  canScheduleDraft.value ? "Schedule next" : connectedLinkedInAccount.value ? "Publish now" : "Connect channel",
);
const recommendedContentType = computed(() => (postAssets.value.length > 0 ? "image" : "text"));
const visibleMediaRecommendations = computed(() =>
  mediaRecommendations.value.filter((suggestion) => suggestion.actionType !== "skip"),
);
const fallbackMediaRecommendations = computed<MediaRecommendationSuggestion[]>(() => [
  {
    id: "fallback-quote-card",
    actionType: "generate_visual",
    title: "Generate quote card",
    description: "Turn the strongest line into a clean quote-style visual.",
    reason: "Safe default for text-first founder posts when no stronger match is available yet.",
    suggestedMediaType: "quote_card",
    visualTemplateType: "quote",
    recommendedAssetIds: [],
  },
  {
    id: "fallback-stat-card",
    actionType: "generate_visual",
    title: "Generate stat card",
    description: "Package the main idea into a compact insight or proof-style card.",
    reason: "Useful when the post has a clear takeaway but not enough structure for a carousel.",
    suggestedMediaType: "stat_card",
    visualTemplateType: "insight",
    recommendedAssetIds: [],
  },
  {
    id: "fallback-framework-card",
    actionType: "generate_visual",
    title: "Generate framework card",
    description: "Lay out the idea as a scan-friendly multi-step framework.",
    reason: "Best for tactical posts where the reader should absorb a short sequence.",
    suggestedMediaType: "framework_card",
    visualTemplateType: "carousel",
    recommendedAssetIds: [],
  },
]);
const displayedMediaRecommendations = computed(() =>
  visibleMediaRecommendations.value.length > 0
    ? visibleMediaRecommendations.value
    : fallbackMediaRecommendations.value,
);
const isUsingFallbackMediaRecommendations = computed(
  () => !isLoadingMediaRecommendations.value && visibleMediaRecommendations.value.length === 0,
);
const selectedAudienceTimeLabel = computed(() => {
  if (!scheduleDateKey.value || !scheduleTime.value || !audienceTimezone.value) {
    return "";
  }

  const scheduledAt = convertZonedDateTimeToUtcIso(
    scheduleDateKey.value,
    scheduleTime.value,
    audienceTimezone.value,
  );

  return formatTimeWithZone(scheduledAt, audienceTimezone.value);
});
const selectedAudienceDateLabel = computed(() => {
  if (!scheduleDateKey.value) {
    return "";
  }

  return formatDateInTimezone(`${scheduleDateKey.value}T12:00:00.000Z`, "UTC", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
});
const selectedLocalTimeLabel = computed(() => {
  if (!scheduleDateKey.value || !scheduleTime.value || !audienceTimezone.value) {
    return "";
  }

  const scheduledAt = convertZonedDateTimeToUtcIso(
    scheduleDateKey.value,
    scheduleTime.value,
    audienceTimezone.value,
  );

  return formatTimeWithZone(scheduledAt, userTimezone);
});
const bestRecommendedSlot = computed(() => recommendedSlots.value[0] ?? null);
const selectedScheduledAtIso = computed(() => {
  if (!scheduleDateKey.value || !scheduleTime.value || !audienceTimezone.value) {
    return "";
  }

  return convertZonedDateTimeToUtcIso(
    scheduleDateKey.value,
    scheduleTime.value,
    audienceTimezone.value,
  );
});
const selectedDispatchWindowLabel = computed(() => {
  if (!selectedScheduledAtIso.value || !audienceTimezone.value) {
    return "";
  }

  const end = new Date(selectedScheduledAtIso.value);
  end.setMinutes(end.getMinutes() + 20);

  const startLabel = formatTimeWithZone(selectedScheduledAtIso.value, audienceTimezone.value);
  const endLabel = formatTimeWithZone(end.toISOString(), audienceTimezone.value);

  return `${startLabel}–${endLabel}`;
});

const signalPills = computed(() => [
  `${attentionSignal.value.label} attention signal`,
  `${structureSignal.value} structure`,
  `${hooks.value.length} alternate hook${hooks.value.length === 1 ? "" : "s"}`,
]);

const feedbackTone = computed(() => {
  const message = feedbackMessage.value.trim().toLowerCase();

  if (!message) {
    return "neutral" as const;
  }

  if (
    message.includes("unable") ||
    message.includes("failed") ||
    message.includes("select a workspace") ||
    message.includes("connect linkedin") ||
    message.includes("not live") ||
    message.includes("error")
  ) {
    return "warning" as const;
  }

  return "success" as const;
});

const executionStatus = computed(() => {
  if (isPublishingToLinkedIn.value) {
    return {
      tone: "live",
      label: "Publishing",
      title: "Sending this post to LinkedIn now",
      description: linkedInPublishingStatus.value,
      detail: "If LinkedIn rejects the call, the draft stays in the workspace so you can retry cleanly.",
    } as const;
  }

  if (feedbackMessage.value.startsWith("Posted to LinkedIn")) {
    return {
      tone: "live",
      label: "Published",
      title: "This post is already live",
      description: "The draft has cleared direct publishing and LinkedIn returned a live post URL.",
      detail: "Use planner for the next slot, or repurpose this post into email and outreach.",
    } as const;
  }

  if (feedbackMessage.value.startsWith("Queued for dispatch")) {
    return {
      tone: "queued",
      label: "Scheduled",
      title: `${selectedAudienceDateLabel.value} • ${selectedAudienceTimeLabel.value}`,
      description: selectedDispatchWindowLabel.value
        ? `Dispatch window: ${selectedDispatchWindowLabel.value}`
        : "The worker will dispatch this draft inside the selected delivery window.",
      detail: "Queued jobs are picked in ~5 second worker cycles and retried automatically on transient failures.",
    } as const;
  }

  if (canScheduleDraft.value) {
    return {
      tone: "ready",
      label: "Ready to schedule",
      title: bestRecommendedSlot.value
        ? `Best time: ${bestRecommendedSlot.value.localLabel}`
        : "Choose a delivery window",
      description: bestRecommendedSlot.value?.reason
        ?? "Pick a time once and let the queue handle dispatch instead of posting manually.",
      detail: "Scheduling keeps the draft attached to the workspace loop and makes execution visible in planner.",
    } as const;
  }

  if (connectedLinkedInAccount.value) {
    return {
      tone: "ready",
      label: "Ready to publish",
      title: "This draft can go live immediately",
      description: linkedInPublishingStatus.value,
      detail: "Publish now for instant delivery, or route it through planner when timing matters.",
    } as const;
  }

  return {
    tone: "warning",
    label: "Connection needed",
    title: "Connect LinkedIn before direct publishing",
    description: linkedInPublishingStatus.value,
    detail: "You can still refine the copy, attach media, and queue the next slot while the channel is being connected.",
  } as const;
});

const executionPanelFacts = computed(() => [
  {
    label: "Status",
    value: executionStatus.value.label,
  },
  {
    label: "Publish as",
    value: connectedLinkedInDescriptor.value,
  },
  {
    label: "Best time",
    value: bestRecommendedSlot.value?.localLabel ?? "9:00–11:00 AM",
  },
  {
    label: "Dispatch",
    value:
      feedbackMessage.value.startsWith("Queued for dispatch") && selectedDispatchWindowLabel.value
        ? selectedDispatchWindowLabel.value
        : "~5s worker polling",
  },
  {
    label: "Worker",
    value: feedbackMessage.value.startsWith("Queued for dispatch")
      ? "Active · polls ~5s"
      : "Ready · polls ~5s",
  },
  {
    label: "Attention",
    value: attentionSignal.value.label,
  },
]);

const executionTimeline = computed(() => {
  if (feedbackMessage.value.startsWith("Posted to LinkedIn")) {
    return [
      "The post is already live on LinkedIn.",
      "History will track the publish result and let you repurpose it later.",
      "Use planner to lock the next execution slot while momentum is fresh.",
    ];
  }

  if (feedbackMessage.value.startsWith("Queued for dispatch")) {
    return [
      "The draft is saved and linked to a real planner slot.",
      selectedDispatchWindowLabel.value
        ? `The worker will dispatch it inside ${selectedDispatchWindowLabel.value}.`
        : "The worker will dispatch it inside the selected window.",
      "If a transient delivery issue happens, the queue retries without losing the draft.",
    ];
  }

  if (connectedLinkedInAccount.value) {
    return [
      "Publish now sends the draft to LinkedIn immediately.",
      "Choose time hands execution to the scheduler and worker loop.",
      "Open planner if you want the draft inside the weekly queue instead of publishing blind.",
    ];
  }

  return [
    "Connect LinkedIn once to unlock direct publishing.",
    "Choose time to route this draft into the safer planner flow.",
    "Keep refining the copy until the timing and hook feel strong enough to push live.",
  ];
});

const aiPreviewActions = computed(() =>
  (aiEditPreview.value?.interpretedActions ?? []).map((action) =>
    action
      .split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" "),
  ),
);

function buildDraftFromAsset(asset: ContentAsset): ActivationDraftRecord | null {
  if (!asset.contentBody || typeof asset.contentBody !== "object") {
    return null;
  }

  const body = asset.contentBody as Partial<RepurposeContentResponse> & {
    idea?: { title?: string; angle?: string };
    quickSignals?: RepurposeContentResponse["quickSignals"];
  };
  const post =
    typeof body.post === "string" && body.post.trim() !== ""
      ? body.post.trim()
      : asset.textContent?.trim() || "";

  if (!post) {
    return null;
  }

  return {
    id: asset.id,
    input: post,
    mode: asset.sourceKind === "remix" ? "improve" : "generate",
    createdAt: asset.updatedAt ?? asset.createdAt,
    result: {
      inputType: body.inputType ?? "text",
      intent: body.intent ?? (asset.sourceKind === "remix" ? "reference" : "capture"),
      sourceText: typeof body.sourceText === "string" ? body.sourceText : post,
      idea: {
        title:
          typeof body.idea?.title === "string" && body.idea.title.trim() !== ""
            ? body.idea.title
            : asset.title || "Saved draft",
        angle:
          typeof body.idea?.angle === "string" && body.idea.angle.trim() !== ""
            ? body.idea.angle
            : "Refine and publish this workspace draft.",
      },
      hooks: Array.isArray(body.hooks) ? body.hooks.filter((hook): hook is string => typeof hook === "string") : [],
      post,
      variations: Array.isArray(body.variations) ? body.variations : [],
      carouselDraft:
        body.carouselDraft && typeof body.carouselDraft === "object"
          ? body.carouselDraft
          : {
              title: asset.title || "Saved draft",
              subtitle: "Refine and publish this workspace draft.",
              slides: [],
            },
      quickSignals:
        body.quickSignals && typeof body.quickSignals === "object"
          ? body.quickSignals
          : {
              readyLabel: "Saved as draft",
              formatLabel: "This post is persisted and ready for the next action.",
            },
      captionFooterCredit:
        typeof body.captionFooterCredit === "string" ? body.captionFooterCredit : "",
      asset,
    },
  };
}

async function loadDraft(): Promise<void> {
  const draftId = typeof route.query.id === "string" ? route.query.id : "";

  if (!draftId) {
    draft.value = null;
    return;
  }

  const storedDraft = getActivationDraft(draftId);

  if (storedDraft) {
    draft.value = storedDraft;
    return;
  }

  if (!activeBusinessId.value) {
    draft.value = null;
    return;
  }

  try {
    const response = await requestPipelineItem(activeBusinessId.value, draftId);
    draft.value = buildDraftFromAsset(response.asset);
  } catch {
    draft.value = null;
  }
}

async function copyPost(options?: { silent?: boolean }): Promise<boolean> {
  if (!postContent.value.trim() || typeof navigator === "undefined" || !navigator.clipboard) {
    return false;
  }

  try {
    await navigator.clipboard.writeText(postContent.value);

    if (!options?.silent) {
      feedbackMessage.value = "Ready to post. Copied to clipboard.";
    }

    return true;
  } catch {
    if (!options?.silent) {
      feedbackMessage.value = "The post is ready. Copy it manually if needed.";
    }

    return false;
  }
}

function clearAiEditPreview(): void {
  aiEditPreview.value = null;
  aiEditFeedback.value = "";
}

function buildDraftContentBody(): Record<string, unknown> {
  if (!draft.value) {
    return { content: postContent.value };
  }

  const { asset: _ignoredAsset, ...resultWithoutAsset } = draft.value.result;

  return {
    ...resultWithoutAsset,
    post: postContent.value,
  };
}

function buildPersistedDraftRecord(nextAsset: ContentAsset): ActivationDraftRecord | null {
  if (!draft.value) {
    return null;
  }

  return {
    ...draft.value,
    id: nextAsset.id,
    result: {
      ...draft.value.result,
      post: postContent.value,
      asset: nextAsset,
    },
  };
}

async function ensurePersistedDraft(): Promise<string | null> {
  if (!draft.value) {
    feedbackMessage.value = "Generate a post first.";
    return null;
  }

  if (!activeBusinessId.value) {
    feedbackMessage.value = "Select a workspace before saving this draft.";
    return null;
  }

  if (persistedPostId.value) {
    return persistedPostId.value;
  }

  const response = await requestCreatePipelineItem({
    businessId: activeBusinessId.value,
    title: draft.value.result.idea.title,
    textContent: postContent.value,
    contentBody: buildDraftContentBody(),
    sourceKind: draft.value.mode === "improve" ? "remix" : "capture",
  });

  const nextDraft = buildPersistedDraftRecord(response.asset);

  if (!nextDraft) {
    return response.asset.id;
  }

  draft.value = replaceActivationDraft(nextDraft);
  await router.replace({
    path: route.path,
    query: {
      ...route.query,
      id: response.asset.id,
    },
  });

  return response.asset.id;
}

async function previewAiEdit(commandOverride?: string): Promise<void> {
  if (!draft.value) {
    return;
  }

  if (!activeBusinessId.value) {
    aiEditFeedback.value = "Select a workspace before requesting AI edits.";
    return;
  }

  const instruction = (commandOverride ?? aiEditInstruction.value).trim();

  if (!instruction) {
    aiEditFeedback.value = "Describe the change you want first.";
    return;
  }

  aiEditInstruction.value = instruction;
  aiEditFeedback.value = "";
  aiEditPreview.value = null;
  isPreviewingAiEdit.value = true;

  try {
    const response = await requestContentAiEditPreview({
      businessId: activeBusinessId.value,
      assetId: draft.value.result.asset?.id,
      textContent: postContent.value,
      instruction,
    });

    aiEditPreview.value = response.preview;
  } catch (error) {
    aiEditFeedback.value =
      error instanceof Error ? error.message : "Unable to preview AI edits right now.";
  } finally {
    isPreviewingAiEdit.value = false;
  }
}

async function applyAiEditPreview(): Promise<void> {
  if (!draft.value || !aiEditPreview.value) {
    return;
  }

  const suggestedText = aiEditPreview.value.suggestedText.trim();

  if (!suggestedText) {
    aiEditFeedback.value = "The suggested edit did not contain usable content.";
    return;
  }

  isApplyingAiEdit.value = true;
  aiEditFeedback.value = "";

  try {
    let nextAsset = draft.value.result.asset;

    if (activeBusinessId.value && draft.value.result.asset?.id) {
      const response = await requestUpdatePipelineItem({
        businessId: activeBusinessId.value,
        assetId: draft.value.result.asset.id,
        textContent: suggestedText,
      });

      nextAsset = response.asset;
    }

    const nextDraft = replaceActivationDraft({
      ...draft.value,
      result: {
        ...draft.value.result,
        post: suggestedText,
        asset: nextAsset,
      },
    });

    draft.value = nextDraft;
    aiEditPreview.value = null;
    feedbackMessage.value = "Changes applied and saved to this draft.";
  } catch (error) {
    aiEditFeedback.value =
      error instanceof Error ? error.message : "Unable to apply AI changes right now.";
  } finally {
    isApplyingAiEdit.value = false;
  }
}

async function loadWorkspaceChannels(): Promise<void> {
  if (!activeBusinessId.value) {
    socialAccounts.value = [];
    return;
  }

  isLoadingChannels.value = true;

  try {
    const response = await requestSocialAccounts(activeBusinessId.value);
    socialAccounts.value = response.accounts;
  } catch {
    socialAccounts.value = [];
  } finally {
    isLoadingChannels.value = false;
  }
}

async function loadPostAssets(): Promise<void> {
  if (!activeBusinessId.value || !persistedPostId.value) {
    postAssets.value = [];
    return;
  }

  isLoadingPostAssets.value = true;

  try {
    const response = await requestPostAssets(activeBusinessId.value, persistedPostId.value);
    postAssets.value = response.assets;
  } catch (error) {
    postAssets.value = [];
    mediaFeedback.value =
      error instanceof Error ? error.message : "Unable to load attached media.";
  } finally {
    isLoadingPostAssets.value = false;
  }
}

function buildVisualBulletPoints(): string[] {
  return previewBodyParagraphs.value
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter((paragraph) => paragraph.length > 0)
    .slice(0, 3)
    .map((paragraph) =>
      paragraph.length > 96 ? `${paragraph.slice(0, 93).trimEnd()}...` : paragraph,
    );
}

function buildGeneratedMediaFileName(suggestion: MediaRecommendationSuggestion): string {
  const base =
    (draft.value?.result.idea.title || "generated-visual")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "generated-visual";
  const suffix = suggestion.suggestedMediaType || suggestion.visualTemplateType || "visual";

  return `${base}-${suffix}.png`;
}

async function loadMediaRecommendations(): Promise<void> {
  if (!activeBusinessId.value || !postContent.value.trim()) {
    mediaRecommendations.value = [];
    return;
  }

  isLoadingMediaRecommendations.value = true;

  try {
    const response = await requestMediaRecommendations({
      businessId: activeBusinessId.value,
      contentText: postContent.value,
      contentType: "post",
      goal: "authority",
      sourceAssetIds: postAssets.value.map((asset) => asset.id),
    });

    mediaRecommendations.value = response.suggestions;
    if (response.suggestions.filter((suggestion) => suggestion.actionType !== "skip").length === 0) {
      mediaFeedback.value = "No strong visual match yet. You can still generate media manually.";
    }
  } catch (error) {
    mediaRecommendations.value = [];
    mediaFeedback.value =
      error instanceof Error && error.message.trim() !== ""
        ? `${error.message} You can still generate media manually.`
        : "No strong visual match yet. You can still generate media manually.";
  } finally {
    isLoadingMediaRecommendations.value = false;
  }
}

async function openGenerateMediaOptions(): Promise<void> {
  await nextTick();
  mediaRecommendationPanelRef.value?.scrollIntoView({
    behavior: "smooth",
    block: "nearest",
  });

  if (isUsingFallbackMediaRecommendations.value) {
    mediaFeedback.value = "No strong visual match yet. You can still generate media manually.";
  }
}

async function handleMediaSelection(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);

  if (!files.length) {
    return;
  }

  if (!activeBusinessId.value) {
    mediaFeedback.value = "Select a workspace before attaching media.";
    input.value = "";
    return;
  }

  isUploadingPostAssets.value = true;
  mediaFeedback.value = "";

  try {
    const persistedId = await ensurePersistedDraft();

    if (!persistedId) {
      mediaFeedback.value = "Save this draft first, then attach media.";
      return;
    }

    for (const file of files) {
      const uploadTarget = await requestMediaUploadUrl({
        businessId: activeBusinessId.value,
        postId: persistedId,
        fileType: file.type,
        fileName: file.name,
        sizeBytes: file.size,
      });

      const uploadResponse = await fetch(uploadTarget.uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": file.type,
        },
        body: file,
      });

      if (!uploadResponse.ok) {
        throw new Error("Upload to storage failed. Check bucket CORS and try again.");
      }

      await requestCreatePostAsset({
        businessId: activeBusinessId.value,
        postId: persistedId,
        storageKey: uploadTarget.storageKey,
        storageUrl: uploadTarget.storageUrl,
        mimeType: file.type,
        sizeBytes: file.size,
        source: "upload",
      });
    }

    await loadPostAssets();
    mediaFeedback.value = `${files.length} image${files.length === 1 ? "" : "s"} attached to this draft.`;
  } catch (error) {
    mediaFeedback.value =
      error instanceof Error ? error.message : "Unable to attach media right now.";
  } finally {
    isUploadingPostAssets.value = false;
    input.value = "";
  }
}

async function attachWorkspaceAssets(assets: WorkspaceAsset[]): Promise<void> {
  if (!activeBusinessId.value) {
    mediaFeedback.value = "Select a workspace before attaching workspace assets.";
    return;
  }

  isUploadingPostAssets.value = true;
  mediaFeedback.value = "";

  try {
    const persistedId = await ensurePersistedDraft();

    if (!persistedId) {
      mediaFeedback.value = "Save this draft first, then attach workspace assets.";
      return;
    }

    for (const asset of assets) {
      if (!asset.storageKey) {
        continue;
      }

      await requestCreatePostAsset({
        businessId: activeBusinessId.value,
        postId: persistedId,
        storageKey: asset.storageKey,
        storageUrl: asset.storageUrl,
        mimeType: asset.mimeType,
        sizeBytes: asset.sizeBytes,
        source: asset.sourceType === "generated" ? "generated" : "upload",
      });
    }

    await loadPostAssets();
    mediaFeedback.value = `${assets.length} workspace asset${assets.length === 1 ? "" : "s"} attached to this draft.`;
    isWorkspaceAssetPickerOpen.value = false;
  } catch (error) {
    mediaFeedback.value =
      error instanceof Error ? error.message : "Unable to attach workspace assets right now.";
  } finally {
    isUploadingPostAssets.value = false;
  }
}

async function generateRecommendedMedia(
  suggestion: MediaRecommendationSuggestion,
): Promise<void> {
  if (!activeBusinessId.value || !suggestion.visualTemplateType) {
    return;
  }

  isGeneratingRecommendationId.value = suggestion.id;
  mediaFeedback.value = "";

  try {
    const persistedId = await ensurePersistedDraft();

    if (!persistedId) {
      mediaFeedback.value = "Save this draft first, then generate media.";
      return;
    }

    const generatedVisual = await requestVisualGeneration({
      businessId: activeBusinessId.value,
      templateType: suggestion.visualTemplateType,
      content: {
        headline: previewLeadLines.value[0] || draft.value?.result.idea.title || "Founder insight",
        supportingText:
          previewLeadLines.value[1] ||
          previewBodyParagraphs.value[0]?.replace(/\s+/g, " ").trim().slice(0, 140) ||
          undefined,
        bulletPoints: buildVisualBulletPoints(),
      },
      mediaPresetId: suggestion.mediaPresetId,
      promptTemplateId: suggestion.promptTemplateId,
      generatedMediaType: suggestion.suggestedMediaType,
      contentAssetId: persistedId,
      sourceAssetIds: suggestion.recommendedAssetIds,
    });

    const blob = await fetch(generatedVisual.imageDataUrl).then(async (response) => {
      if (!response.ok) {
        throw new Error("Unable to convert the generated visual into an uploadable file.");
      }

      return response.blob();
    });

    const fileName = buildGeneratedMediaFileName(suggestion);
    const uploadTarget = await requestMediaUploadUrl({
      businessId: activeBusinessId.value,
      postId: persistedId,
      fileType: blob.type || generatedVisual.mimeType,
      fileName,
      sizeBytes: blob.size,
    });

    const uploadResponse = await fetch(uploadTarget.uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": blob.type || generatedVisual.mimeType,
      },
      body: blob,
    });

    if (!uploadResponse.ok) {
      throw new Error("Unable to upload the generated visual to storage.");
    }

    await requestCreatePostAsset({
      businessId: activeBusinessId.value,
      postId: persistedId,
      storageKey: uploadTarget.storageKey,
      storageUrl: uploadTarget.storageUrl,
      mimeType: blob.type || generatedVisual.mimeType,
      sizeBytes: blob.size,
      source: "generated",
    });

    await loadPostAssets();
    mediaFeedback.value = `${suggestion.title} attached to this draft.`;
  } catch (error) {
    mediaFeedback.value =
      error instanceof Error ? error.message : "Unable to generate media right now.";
  } finally {
    isGeneratingRecommendationId.value = "";
  }
}

async function applyMediaRecommendation(
  suggestion: MediaRecommendationSuggestion,
): Promise<void> {
  if (suggestion.actionType === "use_existing_asset") {
    isWorkspaceAssetPickerOpen.value = true;
    mediaFeedback.value = "Pick an existing workspace asset to use for this post.";
    return;
  }

  if (suggestion.actionType === "skip") {
    mediaFeedback.value = "Kept this draft text-first for now.";
    return;
  }

  await generateRecommendedMedia(suggestion);
}

async function removePostAsset(assetId: string): Promise<void> {
  if (!activeBusinessId.value) {
    return;
  }

  removingPostAssetId.value = assetId;
  mediaFeedback.value = "";

  try {
    await requestDeletePostAsset(activeBusinessId.value, assetId);
    postAssets.value = postAssets.value.filter((asset) => asset.id !== assetId);
    mediaFeedback.value = "Media removed from this draft.";
  } catch (error) {
    mediaFeedback.value =
      error instanceof Error ? error.message : "Unable to remove this asset.";
  } finally {
    removingPostAssetId.value = "";
  }
}

function syncScheduleFormFromSlot(scheduledAt: string, timezone: string): void {
  scheduleDateKey.value = toDateKeyInTimezone(scheduledAt, timezone);
  scheduleTime.value = toTimeValueInTimezone(scheduledAt, timezone);
}

function seedScheduleForm(): void {
  const timezone = audienceTimezone.value || userTimezone;
  const next = new Date();
  next.setMinutes(0, 0, 0);
  next.setHours(next.getHours() + 1);
  audienceTimezone.value = timezone;
  scheduleDateKey.value = toDateKeyInTimezone(next, timezone);
  scheduleTime.value = toTimeValueInTimezone(next, timezone);
}

async function loadRecommendedScheduleSlots(preferredTimezone?: string): Promise<void> {
  if (!activeBusinessId.value) {
    recommendedSlots.value = [];
    return;
  }

  isLoadingRecommendedSlots.value = true;
  scheduleFeedback.value = "";

  try {
    const response = await requestRecommendedPostTimes(
      activeBusinessId.value,
      recommendedContentType.value,
      preferredTimezone,
    );

    recommendedSlots.value = response.slots;
    recommendedTimezone.value = response.timezone;

    if (!audienceTimezone.value || preferredTimezone) {
      audienceTimezone.value = preferredTimezone || response.timezone;
    }

    if (response.slots[0]) {
      syncScheduleFormFromSlot(response.slots[0].scheduledAt, audienceTimezone.value || response.timezone);
    }
  } catch (error) {
    recommendedSlots.value = [];
    scheduleFeedback.value =
      error instanceof Error ? error.message : "Unable to load the best posting window.";
  } finally {
    isLoadingRecommendedSlots.value = false;
  }
}

async function openSchedulePanel(): Promise<void> {
  if (!schedulerEnabled.value) {
    feedbackMessage.value = "Scheduling is not enabled for this workspace.";
    return;
  }

  try {
    const persistedId = await ensurePersistedDraft();

    if (!persistedId) {
      return;
    }
  } catch (error) {
    feedbackMessage.value =
      error instanceof Error ? error.message : "Unable to save this draft right now.";
    return;
  }

  isSchedulePanelOpen.value = true;
  scheduleFeedback.value = "";

  if (!scheduleDateKey.value || !scheduleTime.value || !audienceTimezone.value) {
    seedScheduleForm();
  }

  await loadRecommendedScheduleSlots(audienceTimezone.value || undefined);
}

function closeSchedulePanel(): void {
  isSchedulePanelOpen.value = false;
  scheduleFeedback.value = "";
}

function applyRecommendedSchedule(): void {
  if (!bestRecommendedSlot.value) {
    return;
  }

  const timezone = audienceTimezone.value || recommendedTimezone.value || userTimezone;
  syncScheduleFormFromSlot(bestRecommendedSlot.value.scheduledAt, timezone);
  scheduleFeedback.value = `Best time applied for ${timezone}.`;
}

async function scheduleDraft(): Promise<void> {
  if (!draft.value) {
    scheduleFeedback.value = "Generate a post first.";
    return;
  }

  if (!activeBusinessId.value) {
    scheduleFeedback.value = "Select a workspace before scheduling.";
    return;
  }

  if (!scheduleDateKey.value || !scheduleTime.value || !audienceTimezone.value) {
    scheduleFeedback.value = "Pick a date, time, and audience timezone first.";
    return;
  }

  isSchedulingDraft.value = true;
  scheduleFeedback.value = "";
  feedbackMessage.value = "";

  const scheduleRequest = {
    businessId: activeBusinessId.value,
    platform: "linkedin" as const,
    contentText: postContent.value,
    assetGroupId: draft.value.id,
    slides: [],
    scheduledAt: convertZonedDateTimeToUtcIso(
      scheduleDateKey.value,
      scheduleTime.value,
      audienceTimezone.value,
    ),
    audienceTimezone: audienceTimezone.value,
  };

  try {
    const ensuredPostId = await ensurePersistedDraft();

    if (!ensuredPostId) {
      scheduleFeedback.value = "Unable to save this draft before scheduling it.";
      return;
    }

    let response;

    try {
      response = await requestSchedulePost({
        ...scheduleRequest,
        assetGroupId: ensuredPostId,
      });
    } catch (error) {
      const warnings = extractSchedulingWarnings(error);

      if (warnings.length === 0 || !confirmSchedulingWarnings(warnings)) {
        throw error;
      }

      response = await requestSchedulePost({
        ...scheduleRequest,
        assetGroupId: ensuredPostId,
        ignoreSafetyWarnings: true,
      });
      feedbackMessage.value = selectedDispatchWindowLabel.value
        ? `Queued for dispatch with a manual safety override. Dispatch window: ${selectedDispatchWindowLabel.value}.`
        : "Queued for dispatch with a manual safety override.";
    }

    isSchedulePanelOpen.value = false;
    if (!feedbackMessage.value) {
      feedbackMessage.value = selectedDispatchWindowLabel.value
        ? `Queued for dispatch on ${selectedAudienceDateLabel.value} at ${selectedAudienceTimeLabel.value}. Dispatch window: ${selectedDispatchWindowLabel.value}.`
        : `Queued for dispatch on ${selectedAudienceDateLabel.value} at ${selectedAudienceTimeLabel.value}. Open planner to manage it.`;
    }
  } catch (error) {
    scheduleFeedback.value =
      error instanceof Error ? error.message : "Unable to schedule this draft right now.";
  } finally {
    isSchedulingDraft.value = false;
  }
}

async function goToImprove(): Promise<void> {
  if (!draft.value) {
    return;
  }

  await router.push({
    path: appRoutes.appGenerate,
    query: {
      postId: draft.value.id,
    },
  });
}

async function goToOutreach(): Promise<void> {
  if (!draft.value) {
    return;
  }

  await router.push({
    path: appRoutes.appOutreach,
    query: {
      draftId: draft.value.id,
      prefill: postContent.value,
    },
  });
}

async function goToPlanner(): Promise<void> {
  try {
    const ensuredPostId = await ensurePersistedDraft();

    if (!ensuredPostId) {
      return;
    }

    await router.push({
      path: appRoutes.appPlanner,
      query: {
        draftId: ensuredPostId,
      },
    });
  } catch (error) {
    feedbackMessage.value =
      error instanceof Error ? error.message : "Unable to save this draft right now.";
    return;
  }
}

async function goToEmail(): Promise<void> {
  if (!draft.value) {
    return;
  }

  await router.push({
    path: appRoutes.appEmail,
    query: {
      draftId: draft.value.id,
      prefill: postContent.value,
    },
  });
}

async function goToGrowth(): Promise<void> {
  if (!draft.value) {
    return;
  }

  try {
    const ensuredPostId = await ensurePersistedDraft();

    if (!ensuredPostId) {
      return;
    }

    await router.push({
      path: appRoutes.appGrowth,
      query: {
        businessId: activeBusinessId.value,
        sourcePlatform: "linkedin",
        sourceAssetId: ensuredPostId,
        sourceAssetTitle: draft.value.result.idea.title,
        prefillNotes: `Engaged from post: ${draft.value.result.idea.title}`,
      },
    });
  } catch (error) {
    feedbackMessage.value =
      error instanceof Error ? error.message : "Unable to open lead capture right now.";
  }
}

async function goToRepurpose(): Promise<void> {
  if (!draft.value) {
    return;
  }

  saveRepurposeSeed({
    text: postContent.value,
    title: draft.value.result.idea.title,
    source: "result",
  });

  await router.push({
    path: appRoutes.appCreate,
    query: {
      mode: "repurpose",
    },
    hash: "#repurpose-panel",
  });
}

async function connectLinkedIn(): Promise<void> {
  if (!activeBusinessId.value) {
    feedbackMessage.value = "Select a workspace before connecting LinkedIn.";
    return;
  }

  isConnectingLinkedIn.value = true;
  feedbackMessage.value = "";

  try {
    const response = await requestLinkedInSocialAuthStart({
      businessId: activeBusinessId.value,
      returnPath: route.fullPath,
    });
    window.location.assign(response.authorizationUrl);
  } catch (error) {
    isConnectingLinkedIn.value = false;
    feedbackMessage.value =
      error instanceof Error ? error.message : "Unable to start LinkedIn connection.";
  }
}

async function publishToLinkedIn(): Promise<void> {
  if (!draft.value) {
    return;
  }

  if (!activeBusinessId.value) {
    feedbackMessage.value = "Select a workspace before publishing.";
    return;
  }

  if (!connectedLinkedInAccount.value) {
    await connectLinkedIn();
    return;
  }

  isPublishingToLinkedIn.value = true;
  feedbackMessage.value = "";

  try {
    const response = await requestPublishPost({
      businessId: activeBusinessId.value,
      platform: "linkedin",
      contentText: postContent.value,
      assetId: draft.value.result.asset?.id,
      title: draft.value.result.idea.title,
    });

    feedbackMessage.value = `Posted to LinkedIn. ${response.externalPostUrl}`;
  } catch (error) {
    const copied = await copyPost({ silent: true });
    const baseMessage = getPublishFailureMessage(error);

    feedbackMessage.value = copied
      ? `${baseMessage} Optimized caption copied instead.`
      : baseMessage;
  } finally {
    isPublishingToLinkedIn.value = false;
  }
}

function handleKeydown(event: KeyboardEvent): void {
  if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || !draft.value) {
    return;
  }

  const normalizedKey = event.key.toLowerCase();

  if (normalizedKey === "e") {
    event.preventDefault();
    void goToEmail();
    return;
  }

  if (normalizedKey === "o") {
    event.preventDefault();
    void goToOutreach();
  }
}

watch(
  () => [route.query.id, activeBusinessId.value],
  () => {
    void loadDraft();
  },
  { immediate: true },
);

watch(
  () => activeBusinessId.value,
  () => {
    void loadWorkspaceChannels();
  },
  { immediate: true },
);

watch(
  () => [activeBusinessId.value, persistedPostId.value],
  () => {
    void loadPostAssets();
  },
  { immediate: true },
);

watch(
  () => [activeBusinessId.value, postContent.value, postAssets.value.length],
  () => {
    void loadMediaRecommendations();
  },
  { immediate: true },
);

watch(
  () => audienceTimezone.value,
  (nextTimezone, previousTimezone) => {
    if (!isSchedulePanelOpen.value || !nextTimezone || nextTimezone === previousTimezone) {
      return;
    }

    void loadRecommendedScheduleSlots(nextTimezone);
  },
);

watch(
  () => [route.query.linkedin, route.query.message],
  async ([status, message]) => {
    if (typeof status !== "string" && typeof message !== "string") {
      return;
    }

    if (status === "connected") {
      feedbackMessage.value = "LinkedIn connected. Your post is ready to publish.";
      await loadWorkspaceChannels();
    } else if (status === "error") {
      feedbackMessage.value =
        typeof message === "string" && message.trim() !== ""
          ? message
          : "LinkedIn connection failed.";
    }

    const nextQuery = { ...route.query };
    delete nextQuery.linkedin;
    delete nextQuery.message;
    void router.replace({ query: nextQuery });
    isConnectingLinkedIn.value = false;
  },
  { immediate: true },
);

onMounted(() => {
  window.addEventListener("keydown", handleKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleKeydown);
});
</script>

<template>
  <main class="result-shell">
    <template v-if="draft">
      <section class="result-hero">
        <p class="result-eyebrow">/app/result</p>
        <h1>Your post is ready.</h1>
        <p class="result-description">
          This is the activation moment: improve the draft, send it into outreach, or turn it into
          an email without rewriting from scratch.
        </p>
        <p v-if="hasPersistedAsset" class="result-persistence-note">
          Saved as a draft in this workspace. Improve it, send it, or publish it without creating a
          duplicate post.
        </p>
      </section>

      <section class="result-grid">
        <article class="result-post-card">
          <div class="result-card-header">
            <div>
              <p class="panel-meta">Generated post</p>
              <h2>{{ draft.result.idea.title }}</h2>
            </div>
            <div class="score-badge" :data-tone="attentionSignal.tone">
              Attention {{ attentionSignal.label }} · {{ postScore }}/100
            </div>
          </div>

          <p v-if="quickSignals" class="signal-line">
            <span>{{ quickSignals.readyLabel }}</span>
            <span>{{ quickSignals.formatLabel }}</span>
          </p>
          <p v-if="povSummary" class="signal-line">
            <span>{{ povSummary }}</span>
            <span v-if="qualitySummary">POV quality {{ qualitySummary.overall }}/100</span>
          </p>

          <section class="result-signal-grid">
            <article class="result-signal-card" :data-tone="attentionSignal.tone">
              <p class="panel-meta">Attention signal</p>
              <strong>{{ attentionSignal.label }}</strong>
              <span>{{ attentionSignal.copy }}</span>
            </article>
            <article class="result-signal-card">
              <p class="panel-meta">Structure</p>
              <strong>{{ structureSignal }}</strong>
              <span>{{ postParagraphs.length }} paragraph{{ postParagraphs.length === 1 ? "" : "s" }} ready for feed reading.</span>
            </article>
            <article v-if="qualitySummary" class="result-signal-card">
              <p class="panel-meta">POV profile</p>
              <strong>{{ draft.result.pov?.boldness || "balanced" }}</strong>
              <span>
                Hook {{ qualitySummary.hookStrength }}/100 · Clarity {{ qualitySummary.clarity }}/100 · Alignment {{ qualitySummary.businessAlignment }}/100
              </span>
            </article>
            <article class="result-signal-card">
              <p class="panel-meta">Best next move</p>
              <strong>{{ actionPriorityLabel }}</strong>
              <span>
                {{
                  canScheduleDraft
                    ? "Lock a slot in planner before the draft loses momentum."
                    : connectedLinkedInAccount
                      ? "This draft can publish directly from the workspace."
                      : "Connect LinkedIn first, or keep refining before publishing."
                }}
              </span>
            </article>
          </section>

          <section class="linkedin-feed-preview">
            <div class="linkedin-feed-header">
              <div class="linkedin-feed-avatar">{{ connectedLinkedInLabel ? connectedLinkedInLabel.charAt(0).toUpperCase() : "Y" }}</div>
              <div class="linkedin-feed-identity">
                <strong>{{ connectedLinkedInLabel || "Your LinkedIn profile" }}</strong>
                <p>{{ connectedLinkedInAccount ? "Founder post preview" : "Workspace preview before publishing" }}</p>
              </div>
            </div>

            <div class="linkedin-preview-pills">
              <span v-for="pill in signalPills" :key="pill">{{ pill }}</span>
            </div>

            <div class="linkedin-status-card" :data-connected="Boolean(connectedLinkedInAccount)">
              <div>
                <p class="panel-meta">LinkedIn publishing</p>
                <strong>
                  {{
                    connectedLinkedInAccount
                      ? "Execution channel is ready"
                      : "Direct publishing not connected"
                  }}
                </strong>
                <p class="linkedin-status-copy">
                  {{
                    isLoadingChannels
                      ? "Checking workspace channel..."
                      : connectedLinkedInAccount
                        ? connectedLinkedInDescriptor
                        : linkedInPublishingStatus
                  }}
                </p>
              </div>
            </div>

            <div class="linkedin-feed-body">
              <p
                v-for="(line, index) in previewLeadLines"
                :key="`${line}-${index}`"
                class="linkedin-feed-hook"
                :class="{ companion: index > 0 }"
              >
                {{ line }}
              </p>
              <p v-for="paragraph in previewBodyParagraphs" :key="paragraph" class="linkedin-feed-paragraph">
                {{ paragraph }}
              </p>
            </div>
          </section>

          <section class="execution-status-card" :data-tone="executionStatus.tone">
            <div class="execution-status-header">
              <div>
                <p class="panel-meta">{{ executionStatus.label }}</p>
                <strong>{{ executionStatus.title }}</strong>
                <p class="execution-status-description">{{ executionStatus.description }}</p>
              </div>
              <button
                v-if="canScheduleDraft"
                type="button"
                class="secondary-action execution-status-button"
                :disabled="isUploadingPostAssets"
                @click="goToPlanner"
              >
                View in planner
              </button>
            </div>

            <div class="execution-chip-row">
              <article
                v-for="fact in executionPanelFacts"
                :key="`status-${fact.label}`"
                class="execution-chip"
              >
                <span>{{ fact.label }}</span>
                <strong>{{ fact.value }}</strong>
              </article>
            </div>

            <div class="execution-status-grid">
              <article class="execution-status-block">
                <p class="panel-meta">Preview outcome</p>
                <ul class="execution-timeline-list">
                  <li v-for="step in executionTimeline" :key="step">{{ step }}</li>
                </ul>
              </article>

              <article class="execution-status-block">
                <p class="panel-meta">Delivery confidence</p>
                <strong>{{ actionPriorityLabel }}</strong>
                <p class="execution-status-description">{{ executionStatus.detail }}</p>
              </article>
            </div>

            <p
              v-if="feedbackMessage && feedbackTone === 'success'"
              class="result-feedback execution-feedback"
              data-tone="success"
            >
              {{ feedbackMessage }}
            </p>
          </section>

          <div class="result-primary-actions">
            <button
              type="button"
              class="primary-action"
              :disabled="
                isPublishingToLinkedIn ||
                isConnectingLinkedIn ||
                isUploadingPostAssets ||
                !activeBusinessId
              "
              @click="connectedLinkedInAccount ? publishToLinkedIn() : connectLinkedIn()"
            >
              {{
                connectedLinkedInAccount
                  ? isPublishingToLinkedIn
                    ? "Publishing..."
                    : "Publish now"
                  : isConnectingLinkedIn
                    ? "Redirecting..."
                    : "Connect LinkedIn"
              }}
            </button>

            <button
              v-if="canScheduleDraft"
              type="button"
              class="secondary-action"
              :disabled="isSchedulingDraft || isUploadingPostAssets"
              @click="void openSchedulePanel()"
            >
              Choose time
            </button>

            <button
              v-if="canScheduleDraft"
              type="button"
              class="secondary-action"
              :disabled="isUploadingPostAssets"
              @click="goToPlanner"
            >
              Open planner
            </button>

            <button type="button" class="secondary-action" @click="goToImprove">
              Improve
            </button>
            <button type="button" class="secondary-action" @click="goToRepurpose">
              Repurpose
            </button>

            <button
              v-if="!canScheduleDraft"
              type="button"
              class="secondary-action"
              :disabled="
                isPublishingToLinkedIn ||
                isConnectingLinkedIn ||
                isUploadingPostAssets ||
                !activeBusinessId
              "
              @click="connectedLinkedInAccount ? publishToLinkedIn() : connectLinkedIn()"
            >
              {{
                connectedLinkedInAccount
                  ? isPublishingToLinkedIn
                    ? "Publishing..."
                    : "Publish now"
                  : isConnectingLinkedIn
                    ? "Redirecting..."
                    : "Connect LinkedIn"
              }}
            </button>
          </div>

          <p
            v-if="feedbackMessage && feedbackTone === 'warning'"
            class="result-feedback"
            data-tone="warning"
          >
            {{ feedbackMessage }}
          </p>

          <section v-if="isSchedulePanelOpen && canScheduleDraft" class="schedule-panel">
            <div class="schedule-panel-header">
              <div>
                <p class="panel-meta">Choose a delivery window</p>
                <strong>Lock the post into a real publishing slot</strong>
                <p class="ai-command-copy">
                  Pick the audience time once, then let planner and the worker handle execution.
                </p>
              </div>
              <button type="button" class="secondary-action schedule-close-button" @click="closeSchedulePanel">
                Close
              </button>
            </div>

            <div v-if="bestRecommendedSlot" class="schedule-best-slot">
              <div>
                <p class="panel-meta">Best time</p>
                <strong>{{ bestRecommendedSlot.localLabel }} in {{ recommendedTimezone }}</strong>
                <p class="ai-command-copy">{{ bestRecommendedSlot.reason }}</p>
              </div>
              <button
                type="button"
                class="secondary-action"
                :disabled="isLoadingRecommendedSlots || isSchedulingDraft"
                @click="applyRecommendedSchedule"
              >
                Use best time
              </button>
            </div>

            <div class="schedule-form-grid">
              <label>
                <span>Date</span>
                <input v-model="scheduleDateKey" type="date" />
              </label>
              <label>
                <span>Time</span>
                <input v-model="scheduleTime" type="time" />
              </label>
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
            </div>

            <p class="schedule-helper-copy">
              Audience time: {{ selectedAudienceDateLabel }} at {{ selectedAudienceTimeLabel }}
              <span v-if="selectedLocalTimeLabel"> · Your time: {{ selectedLocalTimeLabel }}</span>
            </p>

            <p v-if="isLoadingRecommendedSlots" class="result-feedback subtle">
              Loading best posting windows...
            </p>
            <p v-if="scheduleFeedback" class="result-feedback">{{ scheduleFeedback }}</p>

            <div class="schedule-panel-actions">
              <button
                type="button"
                class="primary-action"
                :disabled="isSchedulingDraft"
                @click="void scheduleDraft()"
              >
                {{ isSchedulingDraft ? "Adding to queue..." : "Add to queue" }}
              </button>
              <button type="button" class="secondary-action" @click="goToPlanner">
                Open planner
              </button>
            </div>
          </section>

          <section v-if="draft" class="media-panel">
            <div class="media-panel-header">
              <div>
                <p class="panel-meta">Media</p>
                <strong>Attach images for LinkedIn</strong>
                <p class="ai-command-copy">
                  Keep the workflow text-first. Add up to 10 images only when the post needs visual support.
                </p>
              </div>

              <div class="media-panel-actions">
                <button
                  type="button"
                  class="primary-action media-generate-button"
                  :disabled="isLoadingMediaRecommendations || isUploadingPostAssets"
                  @click="void openGenerateMediaOptions()"
                >
                  {{ isLoadingMediaRecommendations ? "Loading options..." : "Generate media" }}
                </button>
                <button
                  type="button"
                  class="secondary-action"
                  @click="isWorkspaceAssetPickerOpen = true"
                >
                  Use existing
                </button>
                <label class="media-upload-button">
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/gif"
                    multiple
                    :disabled="isUploadingPostAssets"
                    @change="void handleMediaSelection($event)"
                  />
                  {{ isUploadingPostAssets ? "Uploading..." : "Upload" }}
                </label>
              </div>
            </div>

            <div
              v-if="displayedMediaRecommendations.length > 0 || isLoadingMediaRecommendations"
              ref="mediaRecommendationPanelRef"
              class="media-recommendation-panel"
            >
              <div class="media-recommendation-header">
                <div>
                  <p class="panel-meta">Recommended next move</p>
                  <strong>{{ isUsingFallbackMediaRecommendations ? "Generate media for this post" : "Choose the safest visual path for this post" }}</strong>
                </div>
                <span class="workspace-chip">
                  {{ isUsingFallbackMediaRecommendations ? "Manual generation" : recommendedContentType === "image" ? "Assets already attached" : "Text-first draft" }}
                </span>
              </div>

              <p v-if="isLoadingMediaRecommendations" class="result-feedback subtle">
                Loading media recommendations...
              </p>
              <p v-else-if="isUsingFallbackMediaRecommendations" class="result-feedback subtle">
                No strong visual match yet. You can still generate media manually.
              </p>

              <div v-else class="media-recommendation-grid">
                <article
                  v-for="suggestion in displayedMediaRecommendations"
                  :key="suggestion.id"
                  class="media-recommendation-card"
                >
                  <div>
                    <p class="panel-meta">{{ suggestion.actionType.replace(/_/g, " ") }}</p>
                    <strong>{{ suggestion.title }}</strong>
                    <p>{{ suggestion.description }}</p>
                    <small>{{ suggestion.reason }}</small>
                  </div>
                  <button
                    type="button"
                    class="secondary-action"
                    :disabled="isGeneratingRecommendationId === suggestion.id || isUploadingPostAssets"
                    @click="void applyMediaRecommendation(suggestion)"
                  >
                    {{
                      suggestion.actionType === "generate_visual"
                        ? isGeneratingRecommendationId === suggestion.id
                          ? "Generating..."
                          : "Generate visual"
                        : suggestion.actionType === "use_existing_asset"
                          ? "Use existing"
                          : "Skip media"
                    }}
                  </button>
                </article>
              </div>
            </div>

            <p v-if="mediaFeedback" class="result-feedback">{{ mediaFeedback }}</p>
            <p v-else-if="isLoadingPostAssets" class="result-feedback">Loading attached media...</p>

            <div v-if="postAssets.length > 0" class="media-grid">
              <article v-for="asset in postAssets" :key="asset.id" class="media-card">
                <img
                  v-if="asset.previewUrl"
                  :src="asset.previewUrl"
                  :alt="`Attached media ${asset.orderIndex + 1}`"
                  class="media-preview"
                />
                <div class="media-meta">
                  <span>{{ asset.mimeType }}</span>
                  <strong>{{ Math.max(1, Math.round(asset.sizeBytes / 1024)) }} KB</strong>
                </div>
                <button
                  type="button"
                  class="secondary-action media-remove-button"
                  :disabled="removingPostAssetId === asset.id"
                  @click="void removePostAsset(asset.id)"
                >
                  {{ removingPostAssetId === asset.id ? "Removing..." : "Remove" }}
                </button>
              </article>
            </div>

            <p v-else class="result-feedback subtle">
              No media attached yet. This post will publish as text until you add images.
            </p>
          </section>

          <WorkspaceAssetPickerModal
            :open="isWorkspaceAssetPickerOpen"
            :business-id="activeBusinessId"
            asset-type="image"
            multiple
            title="Attach existing workspace media"
            @close="isWorkspaceAssetPickerOpen = false"
            @select="void attachWorkspaceAssets($event)"
          />

          <section class="ai-command-panel">
            <div class="ai-command-header">
              <div>
                <p class="panel-meta">AI editor</p>
                <strong>Ask AI to improve this draft</strong>
                <p class="ai-command-copy">
                  Preview the change first. Nothing overwrites the post until you apply it.
                </p>
              </div>
            </div>

            <div class="ai-suggestion-callout">
              <p class="panel-meta">Suggested improvements</p>
              <p class="ai-command-copy">
                Start with a stronger hook, a tighter ending, or a more specific founder example.
              </p>
            </div>

            <div class="ai-command-row">
              <input
                v-model="aiEditInstruction"
                type="text"
                class="ai-command-input"
                placeholder="Try: make this sharper, remove emojis, or shorten the ending"
                @keydown.enter.prevent="void previewAiEdit()"
              />
              <button
                type="button"
                class="secondary-action ai-command-submit"
                :disabled="isPreviewingAiEdit || isApplyingAiEdit || !activeBusinessId"
                @click="void previewAiEdit()"
              >
                {{ isPreviewingAiEdit ? "Thinking..." : "Preview change" }}
              </button>
            </div>

            <div class="ai-command-chips">
              <button
                v-for="command in AI_QUICK_COMMANDS"
                :key="command.value"
                type="button"
                class="ai-command-chip"
                :disabled="isPreviewingAiEdit || isApplyingAiEdit || !activeBusinessId"
                @click="void previewAiEdit(command.value)"
              >
                {{ command.label }}
              </button>
            </div>

            <p v-if="aiEditFeedback" class="result-feedback">{{ aiEditFeedback }}</p>

            <div v-if="isPreviewingAiEdit" class="ai-edit-preview-card loading">
              Generating a scoped suggestion...
            </div>

            <div v-else-if="aiEditPreview" class="ai-edit-preview-card">
              <div class="ai-edit-preview-header">
                <div>
                  <p class="panel-meta">Change preview</p>
                  <p class="ai-edit-summary">{{ aiEditPreview.summary }}</p>
                  <p class="ai-edit-scope">{{ aiEditPreview.scopeHint }}</p>
                </div>
                <div v-if="aiPreviewActions.length > 0" class="ai-edit-action-pills">
                  <span v-for="action in aiPreviewActions" :key="action">{{ action }}</span>
                </div>
              </div>

              <div class="ai-edit-diff">
                <article class="ai-edit-diff-card">
                  <p class="panel-meta">Before</p>
                  <pre>{{ aiEditPreview.beforeExcerpt }}</pre>
                </article>
                <article class="ai-edit-diff-card updated">
                  <p class="panel-meta">After</p>
                  <pre>{{ aiEditPreview.afterExcerpt }}</pre>
                </article>
              </div>

              <div class="ai-edit-actions">
                <button
                  type="button"
                  class="primary-action"
                  :disabled="isApplyingAiEdit"
                  @click="void applyAiEditPreview()"
                >
                  {{ isApplyingAiEdit ? "Applying..." : "Apply changes" }}
                </button>
                <button type="button" class="secondary-action" @click="clearAiEditPreview">
                  Keep original
                </button>
              </div>
            </div>
          </section>
        </article>

        <aside class="result-side-rail">
          <article class="side-card">
            <p class="panel-meta">Hook bank</p>
            <h3>Backup openings</h3>
            <ul class="hook-list">
              <li v-for="hook in hooks" :key="hook">{{ hook }}</li>
            </ul>
          </article>

          <article class="side-card">
            <p class="panel-meta">Execution panel</p>
            <h3>What happens next</h3>
            <div class="execution-fact-grid">
              <article v-for="fact in executionPanelFacts" :key="fact.label" class="execution-fact-card">
                <span>{{ fact.label }}</span>
                <strong>{{ fact.value }}</strong>
              </article>
            </div>
            <div class="execution-delivery-note">
              <p class="panel-meta">Delivery</p>
              <p class="shortcut-note">
                Scheduling hands this draft to the worker loop. Publish now skips the queue and
                goes directly to LinkedIn.
              </p>
            </div>

            <p class="panel-meta secondary-panel-meta">Use this draft elsewhere</p>
            <div class="side-action-stack">
              <button type="button" class="secondary-action side-action-button" @click="void copyPost()">
                Copy for LinkedIn
              </button>
              <button type="button" class="secondary-action side-action-button" @click="goToOutreach">
                Send via Outreach
              </button>
              <button type="button" class="secondary-action side-action-button" @click="goToEmail">
                Convert to Email
              </button>
              <button type="button" class="secondary-action side-action-button" @click="goToGrowth">
                Capture engaged lead
              </button>
            </div>
            <p class="shortcut-note">Shortcuts: Cmd/Ctrl + Shift + O for outreach, + E for email.</p>
          </article>
        </aside>
      </section>
    </template>

    <section v-else class="result-empty-card">
      <p class="result-eyebrow">/app/result</p>
      <h1>No generated result found.</h1>
      <p class="result-description">
        Generate a post first, then this screen becomes the handoff into the rest of the product.
      </p>
      <router-link class="primary-action" :to="appRoutes.appGenerate">Generate your first post</router-link>
    </section>
  </main>
</template>

<style scoped>
.result-shell {
  width: min(100%, 1120px);
  margin: 0 auto;
  padding: 48px 20px 80px;
}

.result-hero {
  margin-bottom: 24px;
}

.result-persistence-note {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 12px 0 0;
  padding: 10px 14px;
  border: 1px solid color-mix(in srgb, var(--fc-accent) 18%, var(--fc-border));
  border-radius: 999px;
  background: color-mix(in srgb, var(--fc-accent-soft) 72%, white 28%);
  color: var(--fc-text-muted);
  font-size: 0.95rem;
}

.result-eyebrow,
.panel-meta {
  margin: 0 0 10px;
  color: var(--fc-text-muted);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.result-hero h1,
.result-empty-card h1 {
  margin: 0;
  font-size: clamp(2.1rem, 4vw, 3.4rem);
  line-height: 1.02;
}

.result-description {
  max-width: 760px;
  margin: 16px 0 0;
  color: var(--fc-text-muted);
  line-height: 1.7;
}

.result-grid {
  display: grid;
  gap: 20px;
  grid-template-columns: minmax(0, 1.4fr) minmax(280px, 0.8fr);
}

.result-post-card,
.side-card,
.result-empty-card {
  border: 1px solid var(--fc-border);
  border-radius: 28px;
  background: linear-gradient(180deg, var(--fc-surface) 0%, var(--fc-surface-subtle) 100%);
  box-shadow: var(--fc-card-shadow);
}

.result-post-card,
.side-card {
  padding: clamp(22px, 3vw, 32px);
}

.result-empty-card {
  width: min(100%, 760px);
  margin: 0 auto;
  padding: clamp(24px, 4vw, 40px);
}

.result-card-header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
}

.result-card-header h2 {
  margin: 0;
  line-height: 1.1;
}

.score-badge {
  display: inline-flex;
  align-items: center;
  min-height: 38px;
  padding: 0 14px;
  border-radius: 999px;
  background: var(--fc-surface-subtle);
  border: 1px solid var(--fc-border);
  font-weight: 800;
}

.score-badge[data-tone="strong"] {
  background: color-mix(in srgb, var(--fc-success-bg, rgba(56, 142, 60, 0.12)) 88%, white 12%);
  border-color: color-mix(in srgb, var(--fc-success-text, #2c6b35) 18%, var(--fc-border));
  color: var(--fc-success-text, #2c6b35);
}

.score-badge[data-tone="warning"] {
  background: color-mix(in srgb, #f8b84e 16%, white 84%);
  border-color: color-mix(in srgb, #b46a00 20%, var(--fc-border));
  color: #8a5200;
}

.signal-line {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin: 18px 0 0;
}

.signal-line span {
  display: inline-flex;
  align-items: center;
  min-height: 34px;
  padding: 0 12px;
  border-radius: 999px;
  background: var(--fc-success-bg, rgba(56, 142, 60, 0.12));
  color: var(--fc-success-text, #2c6b35);
  font-size: 0.84rem;
  font-weight: 700;
}

.result-signal-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin-top: 18px;
}

.result-signal-card {
  display: grid;
  gap: 6px;
  padding: 16px 18px;
  border-radius: 20px;
  border: 1px solid var(--fc-border);
  background: rgba(255, 255, 255, 0.6);
}

.result-signal-card strong {
  font-size: 1.04rem;
  line-height: 1.2;
}

.result-signal-card span {
  color: var(--fc-text-muted);
  line-height: 1.55;
  font-size: 0.93rem;
}

.result-signal-card[data-tone="strong"] {
  border-color: color-mix(in srgb, var(--fc-success-text, #2c6b35) 18%, var(--fc-border));
  background: color-mix(in srgb, var(--fc-success-bg, rgba(56, 142, 60, 0.12)) 80%, white 20%);
}

.result-signal-card[data-tone="warning"] {
  border-color: color-mix(in srgb, #b46a00 22%, var(--fc-border));
  background: color-mix(in srgb, #f8b84e 10%, white 90%);
}

.linkedin-feed-preview {
  display: grid;
  gap: 16px;
  margin-top: 20px;
  padding: clamp(20px, 3vw, 28px);
  border: 1px solid color-mix(in srgb, var(--fc-border) 82%, transparent);
  border-radius: 28px;
  background:
    radial-gradient(circle at top left, color-mix(in srgb, var(--fc-accent-soft) 38%, transparent) 0%, transparent 34%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.92) 0%, rgba(255, 255, 255, 0.72) 100%);
}

.linkedin-feed-header {
  display: flex;
  align-items: center;
  gap: 12px;
}

.linkedin-feed-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--fc-accent-soft) 0%, color-mix(in srgb, var(--fc-accent-soft) 55%, white 45%) 100%);
  border: 1px solid color-mix(in srgb, var(--fc-accent) 18%, var(--fc-border));
  font-weight: 800;
}

.linkedin-feed-identity strong {
  display: block;
  line-height: 1.2;
}

.linkedin-feed-identity p {
  margin: 4px 0 0;
  color: var(--fc-text-muted);
  font-size: 0.93rem;
}

.linkedin-preview-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.linkedin-preview-pills span {
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  padding: 0 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid var(--fc-border);
  color: var(--fc-text-muted);
  font-size: 0.82rem;
  font-weight: 700;
}

.linkedin-status-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 18px;
  border: 1px solid var(--fc-border);
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.55);
}

.linkedin-status-card[data-connected="true"] {
  background: rgba(56, 142, 60, 0.08);
  border-color: rgba(56, 142, 60, 0.18);
}

.linkedin-status-card strong {
  display: block;
  line-height: 1.25;
}

.linkedin-status-copy {
  margin: 6px 0 0;
  color: var(--fc-text-muted);
  line-height: 1.5;
}

.linkedin-feed-body {
  display: grid;
  gap: 16px;
}

.linkedin-feed-hook,
.linkedin-feed-paragraph {
  margin: 0;
  white-space: pre-wrap;
}

.linkedin-feed-hook {
  max-width: 14ch;
  font-size: clamp(2rem, 5vw, 3.8rem);
  line-height: 0.95;
  letter-spacing: -0.04em;
  font-weight: 800;
  text-wrap: balance;
}

.linkedin-feed-hook.companion {
  color: color-mix(in srgb, var(--fc-text) 78%, var(--fc-accent-dark));
}

.linkedin-feed-paragraph {
  max-width: 62ch;
  color: var(--fc-text);
  font-size: 1.02rem;
  line-height: 1.8;
}

.result-primary-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 20px;
}

.execution-status-card {
  display: grid;
  gap: 16px;
  margin-top: 18px;
  padding: 20px;
  border-radius: 22px;
  border: 1px solid var(--fc-border);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.78) 0%, rgba(255, 255, 255, 0.58) 100%);
  box-shadow: 0 18px 36px rgba(35, 21, 13, 0.08);
}

.execution-status-card[data-tone="queued"] {
  border-color: color-mix(in srgb, var(--fc-accent) 28%, var(--fc-border));
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--fc-accent-soft) 44%, white 56%) 0%,
    rgba(255, 255, 255, 0.72) 100%
  );
}

.execution-status-card[data-tone="live"] {
  border-color: color-mix(in srgb, var(--fc-success-text, #2c6b35) 22%, var(--fc-border));
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--fc-success-bg, rgba(56, 142, 60, 0.12)) 72%, white 28%) 0%,
    rgba(255, 255, 255, 0.76) 100%
  );
}

.execution-status-card[data-tone="warning"] {
  border-color: color-mix(in srgb, #b46a00 24%, var(--fc-border));
  background: linear-gradient(180deg, color-mix(in srgb, #f8b84e 12%, white 88%) 0%, rgba(255, 255, 255, 0.76) 100%);
}

.execution-status-header {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  align-items: flex-start;
  justify-content: space-between;
}

.execution-status-header strong,
.execution-status-block strong {
  display: block;
  font-size: 1.08rem;
  line-height: 1.25;
}

.execution-status-description {
  margin: 6px 0 0;
  color: var(--fc-text-muted);
  line-height: 1.6;
}

.execution-status-grid {
  display: grid;
  gap: 14px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.execution-chip-row {
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.execution-chip {
  display: grid;
  gap: 6px;
  padding: 14px 15px;
  border-radius: 18px;
  border: 1px solid color-mix(in srgb, var(--fc-border) 88%, transparent);
  background: rgba(255, 255, 255, 0.76);
}

.execution-chip span {
  color: var(--fc-text-muted);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.execution-chip strong {
  line-height: 1.35;
}

.execution-status-block {
  padding: 16px 18px;
  border-radius: 18px;
  border: 1px solid color-mix(in srgb, var(--fc-border) 88%, transparent);
  background: rgba(255, 255, 255, 0.72);
}

.execution-timeline-list {
  display: grid;
  gap: 10px;
  padding-left: 18px;
  margin: 10px 0 0;
  color: var(--fc-text-muted);
  line-height: 1.55;
}

.execution-feedback {
  margin-top: 0;
}

.schedule-panel {
  display: grid;
  gap: 16px;
  margin-top: 20px;
  padding: 20px;
  border-radius: 22px;
  border: 1px solid var(--fc-border);
  background: rgba(255, 255, 255, 0.6);
}

.schedule-panel-header,
.schedule-best-slot,
.schedule-panel-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 14px;
  align-items: flex-start;
}

.schedule-close-button {
  min-height: 40px;
}

.schedule-best-slot {
  padding: 16px 18px;
  border-radius: 18px;
  border: 1px solid color-mix(in srgb, var(--fc-accent) 16%, var(--fc-border));
  background: color-mix(in srgb, var(--fc-accent-soft) 28%, white 72%);
}

.schedule-best-slot strong {
  display: block;
}

.schedule-form-grid {
  display: grid;
  gap: 14px;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.schedule-form-grid label {
  display: grid;
  gap: 8px;
  color: var(--fc-text-muted);
  font-size: 0.92rem;
}

.schedule-form-grid input,
.schedule-form-grid select {
  min-height: 48px;
  width: 100%;
  padding: 0 14px;
  border-radius: 14px;
  border: 1px solid var(--fc-border);
  background: var(--fc-surface);
  color: var(--fc-text);
  font: inherit;
}

.schedule-helper-copy {
  margin: 0;
  color: var(--fc-text-muted);
  line-height: 1.6;
}

.ai-command-panel {
  margin-top: 20px;
  padding: 18px;
  border-radius: 22px;
  border: 1px solid var(--fc-border);
  background: rgba(255, 255, 255, 0.6);
}

.ai-suggestion-callout {
  margin-top: 14px;
  padding: 14px 16px;
  border-radius: 18px;
  border: 1px solid color-mix(in srgb, var(--fc-accent) 16%, var(--fc-border));
  background: color-mix(in srgb, var(--fc-accent-soft) 22%, white 78%);
}

.ai-command-copy,
.ai-edit-scope {
  margin: 6px 0 0;
  color: var(--fc-text-muted);
  line-height: 1.55;
}

.ai-command-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  margin-top: 14px;
}

.ai-command-input {
  min-height: 48px;
  width: 100%;
  padding: 0 16px;
  border-radius: 16px;
  border: 1px solid var(--fc-border);
  background: var(--fc-surface);
  color: var(--fc-text);
  font: inherit;
}

.media-panel {
  display: grid;
  gap: 16px;
  margin-top: 20px;
  padding: 18px;
  border: 1px solid var(--fc-border);
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.52);
}

.media-panel-header {
  display: flex;
  flex-wrap: wrap;
  align-items: start;
  justify-content: space-between;
  gap: 14px;
}

.media-panel-header strong {
  display: block;
}

.media-panel-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
}

.media-generate-button {
  min-width: 170px;
  justify-content: center;
}

.workspace-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-radius: 999px;
  background: rgba(245, 232, 219, 0.82);
  color: var(--fc-text);
  font-size: 0.8rem;
  font-weight: 700;
}

.media-recommendation-panel {
  display: grid;
  gap: 12px;
  padding: 14px;
  border-radius: 18px;
  border: 1px solid color-mix(in srgb, var(--fc-border) 90%, transparent);
  background: rgba(255, 249, 243, 0.94);
}

.media-recommendation-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.media-recommendation-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
}

.media-recommendation-card {
  display: grid;
  gap: 12px;
  align-content: space-between;
  padding: 14px;
  border-radius: 18px;
  border: 1px solid color-mix(in srgb, var(--fc-border) 90%, transparent);
  background: rgba(255, 255, 255, 0.88);
}

.media-recommendation-card p,
.media-recommendation-card small {
  display: block;
  margin-top: 6px;
  color: var(--fc-text-muted);
}

.media-upload-button {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 42px;
  padding: 0 18px;
  border-radius: 999px;
  border: 1px solid var(--fc-border);
  background: var(--fc-surface);
  font-weight: 700;
  cursor: pointer;
}

.media-upload-button input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

.media-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 14px;
}

.media-card {
  display: grid;
  gap: 10px;
  padding: 12px;
  border-radius: 18px;
  border: 1px solid var(--fc-border);
  background: var(--fc-surface);
}

.media-preview {
  width: 100%;
  aspect-ratio: 1 / 1;
  object-fit: cover;
  border-radius: 14px;
  border: 1px solid color-mix(in srgb, var(--fc-border) 90%, transparent);
}

.media-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 0.84rem;
  color: var(--fc-text-muted);
}

.media-remove-button {
  justify-self: start;
}

.ai-command-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 14px;
}

.ai-command-chip {
  min-height: 38px;
  padding: 0 14px;
  border-radius: 999px;
  border: 1px solid var(--fc-border);
  background: transparent;
  color: var(--fc-text);
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}

.ai-command-submit {
  min-width: 160px;
}

.ai-edit-preview-card {
  margin-top: 16px;
  padding: 18px;
  border-radius: 20px;
  border: 1px solid var(--fc-border);
  background: var(--fc-surface);
}

.ai-edit-preview-card.loading {
  color: var(--fc-text-muted);
}

.ai-edit-summary {
  margin: 0;
  font-weight: 800;
  line-height: 1.5;
}

.ai-edit-preview-header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 14px;
  align-items: flex-start;
}

.ai-edit-action-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.ai-edit-action-pills span {
  display: inline-flex;
  align-items: center;
  min-height: 30px;
  padding: 0 10px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--fc-accent-soft) 38%, white 62%);
  border: 1px solid color-mix(in srgb, var(--fc-accent) 18%, var(--fc-border));
  font-size: 0.8rem;
  font-weight: 700;
}

.ai-edit-diff {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  margin-top: 16px;
}

.ai-edit-diff-card {
  padding: 16px;
  border-radius: 18px;
  border: 1px solid var(--fc-border);
  background: var(--fc-surface-subtle);
}

.ai-edit-diff-card.updated {
  border-color: color-mix(in srgb, var(--fc-accent) 18%, var(--fc-border));
  background: color-mix(in srgb, var(--fc-accent-soft) 44%, white 56%);
}

.ai-edit-diff-card pre {
  margin: 0;
  white-space: pre-wrap;
  font: inherit;
  line-height: 1.7;
}

.ai-edit-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 18px;
}

.primary-action,
.secondary-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 48px;
  padding: 0 18px;
  border-radius: 999px;
  font-weight: 800;
  text-decoration: none;
}

.primary-action {
  border: none;
  background: linear-gradient(135deg, var(--fc-accent) 0%, var(--fc-accent-dark) 100%);
  box-shadow: var(--fc-accent-shadow);
  color: var(--fc-accent-contrast);
  cursor: pointer;
}

.secondary-action {
  border: 1px solid var(--fc-border);
  background: transparent;
  color: var(--fc-text);
  cursor: pointer;
}

.primary-action:disabled,
.secondary-action:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.result-feedback,
.shortcut-note {
  margin: 16px 0 0;
  color: var(--fc-text-muted);
  line-height: 1.6;
}

.result-feedback[data-tone="warning"] {
  padding: 12px 14px;
  border-radius: 16px;
  border: 1px solid color-mix(in srgb, #b46a00 22%, var(--fc-border));
  background: color-mix(in srgb, #f8b84e 10%, white 90%);
  color: #8a5200;
}

.result-feedback[data-tone="success"] {
  padding: 12px 14px;
  border-radius: 16px;
  border: 1px solid color-mix(in srgb, var(--fc-success-text, #2c6b35) 18%, var(--fc-border));
  background: color-mix(in srgb, var(--fc-success-bg, rgba(56, 142, 60, 0.12)) 82%, white 18%);
  color: var(--fc-success-text, #2c6b35);
}

.result-feedback.subtle {
  margin-top: 0;
}

.result-side-rail {
  display: grid;
  gap: 20px;
}

.side-card h3 {
  margin: 0;
  font-size: 1.15rem;
  line-height: 1.2;
}

.execution-fact-grid {
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin-top: 18px;
}

.execution-fact-card {
  display: grid;
  gap: 6px;
  padding: 14px 15px;
  border-radius: 18px;
  border: 1px solid var(--fc-border);
  background: rgba(255, 255, 255, 0.72);
}

.execution-fact-card span {
  color: var(--fc-text-muted);
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.execution-fact-card strong {
  line-height: 1.35;
}

.execution-delivery-note {
  margin-top: 18px;
  padding: 16px 18px;
  border-radius: 18px;
  border: 1px solid color-mix(in srgb, var(--fc-accent) 14%, var(--fc-border));
  background: color-mix(in srgb, var(--fc-accent-soft) 16%, white 84%);
}

.secondary-panel-meta {
  margin-top: 20px;
}

.hook-list,
.next-action-list {
  display: grid;
  gap: 12px;
  padding-left: 18px;
  margin: 18px 0 0;
  color: var(--fc-text-muted);
  line-height: 1.6;
}

.side-action-stack {
  display: grid;
  gap: 10px;
  margin-top: 18px;
}

.side-action-button {
  width: 100%;
}

@media (max-width: 900px) {
  .result-grid {
    grid-template-columns: 1fr;
  }

  .result-signal-grid,
  .execution-chip-row,
  .execution-status-grid,
  .execution-fact-grid,
  .schedule-form-grid,
  .ai-command-row,
  .ai-edit-diff {
    grid-template-columns: 1fr;
  }

  .linkedin-feed-hook {
    max-width: none;
  }
}
</style>
