import type {
  ApproveContentPlanRequest,
  ApproveContentPlanResponse,
  BrandKit,
  BrandPromptContext,
  GenerateContentPlanRequest,
  GenerateContentPlanResponse,
  GetContentPlanResponse,
  SocialContentPlanDuration,
  SocialContentPlanEntry,
  SocialContentPlanEntryType,
  SocialContentPlanPlatform,
} from "../../../../packages/shared-types/index.ts";
import type { AuthenticatedPrincipal } from "../middleware/auth.ts";
import { getBrandKitForBusiness } from "./brandIntelligence/brandKitService.ts";
import { getBrandPromptContextForBusiness } from "./brandIntelligence/brandProfileService.ts";
import {
  confirmContentBatch,
  generateContentBatch,
  getContentBatch,
} from "./contentOrchestrationService.ts";
import { HttpError } from "../utils/http.ts";

const DEFAULT_SOCIAL_PLAN_PLATFORMS: SocialContentPlanPlatform[] = ["linkedin", "instagram", "facebook"];
const DEFAULT_SOCIAL_PLAN_TIME = "09:00";

function normalizeGoal(value: string | undefined): string {
  const normalized = value?.trim();

  if (!normalized) {
    throw new HttpError(400, "bad_request", "goal is required.");
  }

  return normalized;
}

function normalizeDuration(value: SocialContentPlanDuration | undefined): {
  duration: SocialContentPlanDuration;
  days: number;
} {
  switch (value) {
    case "14_days":
      return { duration: "14_days", days: 14 };
    case "30_days":
      return { duration: "30_days", days: 30 };
    case "7_days":
    default:
      return { duration: "7_days", days: 7 };
  }
}

function normalizePlatforms(value: SocialContentPlanPlatform[] | undefined): SocialContentPlanPlatform[] {
  const normalized = [...new Set(
    (value ?? []).filter((entry): entry is SocialContentPlanPlatform =>
      entry === "linkedin" || entry === "instagram" || entry === "facebook"
    ),
  )];

  if (normalized.length === 0) {
    throw new HttpError(400, "bad_request", "Select at least one social platform.");
  }

  return normalized;
}

function normalizeTime(value: string | undefined): string {
  const normalized = value?.trim() || DEFAULT_SOCIAL_PLAN_TIME;

  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(normalized)) {
    throw new HttpError(400, "bad_request", "defaultScheduledTime must use HH:MM format.");
  }

  return normalized;
}

function normalizeDateKey(value: string | undefined): string | undefined {
  const normalized = value?.trim();

  if (!normalized) {
    return undefined;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new HttpError(400, "bad_request", "startDate must use YYYY-MM-DD format.");
  }

  return normalized;
}

function normalizeTimezone(value: string | undefined | null): string | undefined {
  const normalized = value?.trim();

  if (!normalized) {
    return undefined;
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: normalized });
    return normalized;
  } catch {
    throw new HttpError(400, "bad_request", "audienceTimezone must be a valid IANA timezone.");
  }
}

function todayDateKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateKey: string, offset: number): string {
  const cursor = new Date(`${dateKey}T12:00:00.000Z`);
  cursor.setUTCDate(cursor.getUTCDate() + offset);
  return cursor.toISOString().slice(0, 10);
}

function buildScheduleDateKeys(startDate: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => addDays(startDate, index));
}

function buildGoalPrompt(input: {
  goal: string;
  days: number;
  platforms: SocialContentPlanPlatform[];
  brandContext?: BrandPromptContext;
  brandKit?: BrandKit;
}): string {
  const businessName = input.brandKit?.brandName?.trim();
  const industry = input.brandKit?.industry?.trim() || input.brandContext?.audience?.trim();
  const tone = input.brandKit?.toneKeywords?.slice(0, 4).join(", ")
    || input.brandContext?.tone?.trim()
    || input.brandKit?.tone;
  const topics = input.brandContext?.topics?.slice(0, 4).join(", ");
  const positioning = input.brandContext?.positioning?.trim();
  const voice = input.brandContext?.voiceSummary?.trim();
  const topTags = input.brandContext?.topContentTags?.slice(0, 4).join(", ");
  const performanceInsights = input.brandContext?.performanceInsights?.slice(0, 3).join(" | ");
  const platformLabel = input.platforms.map((platform) =>
    platform === "linkedin" ? "LinkedIn" : platform === "instagram" ? "Instagram" : "Facebook"
  ).join(", ");

  return [
    `Build a ${input.days}-day social plan focused on this business goal: ${input.goal}.`,
    businessName ? `Business: ${businessName}.` : undefined,
    industry ? `Industry or audience context: ${industry}.` : undefined,
    tone ? `Brand tone: ${tone}.` : undefined,
    positioning ? `Positioning: ${positioning}.` : undefined,
    voice ? `Voice guidance: ${voice}.` : undefined,
    topics ? `Use these recurring topics when they fit: ${topics}.` : undefined,
    topTags ? `Winning content tags: ${topTags}.` : undefined,
    performanceInsights ? `Recent performance insights: ${performanceInsights}.` : undefined,
    `The plan will be adapted for ${platformLabel}.`,
    "Make each day meaningfully different with a mix of education, proof, story, community, and conversion angles.",
    "Favor clear hooks, useful takeaways, and CTAs that support the stated goal.",
    "Do not repeat the same opening or the same offer across the whole batch.",
  ].filter((entry): entry is string => Boolean(entry)).join("\n");
}

function inferPlanType(dayIndex: number, goal: string): SocialContentPlanEntryType {
  const normalizedGoal = goal.toLowerCase();
  const conversionPattern: SocialContentPlanEntryType[] = [
    "educational",
    "social_proof",
    "promotional",
    "story",
    "educational",
    "community",
    "promotional",
  ];
  const awarenessPattern: SocialContentPlanEntryType[] = [
    "educational",
    "story",
    "community",
    "social_proof",
    "educational",
    "story",
    "promotional",
  ];
  const pattern = normalizedGoal.includes("book")
    || normalizedGoal.includes("lead")
    || normalizedGoal.includes("sale")
    || normalizedGoal.includes("conversion")
    || normalizedGoal.includes("booking")
    ? conversionPattern
    : awarenessPattern;

  return pattern[(dayIndex - 1) % pattern.length];
}

function inferCta(goal: string, type: SocialContentPlanEntryType): string {
  const normalizedGoal = goal.toLowerCase();

  if (normalizedGoal.includes("book") || normalizedGoal.includes("booking") || normalizedGoal.includes("reservation")) {
    return type === "educational" || type === "story" ? "Book a tour" : "Book now";
  }

  if (normalizedGoal.includes("lead") || normalizedGoal.includes("consult")) {
    return type === "community" ? "Send a message" : "Book a consultation";
  }

  if (normalizedGoal.includes("trial") || normalizedGoal.includes("demo")) {
    return "Start your trial";
  }

  return type === "community" ? "Join the conversation" : "Learn more";
}

function buildImagePrompt(input: {
  brandKit?: BrandKit;
  brandContext?: BrandPromptContext;
  goal: string;
  type: SocialContentPlanEntryType;
  platform: SocialContentPlanPlatform;
  content: string;
  cta: string;
}): string {
  const lines = [
    `Create a branded ${input.platform} social visual for a ${input.type.replace(/_/g, " ")} post.`,
    input.brandKit?.brandName ? `Brand: ${input.brandKit.brandName}` : undefined,
    input.brandKit?.industry ? `Industry: ${input.brandKit.industry}` : undefined,
    input.brandKit?.primaryColor && input.brandKit?.secondaryColor
      ? `Colors: ${input.brandKit.primaryColor}, ${input.brandKit.secondaryColor}`
      : undefined,
    input.brandKit?.style ? `Style: ${input.brandKit.style}` : undefined,
    input.brandKit?.iconStyle ? `Icon style: ${input.brandKit.iconStyle}` : undefined,
    input.brandKit?.imageGuidelines ? `Image rules: ${input.brandKit.imageGuidelines}` : undefined,
    input.brandContext?.visualStyle ? `Visual direction: ${input.brandContext.visualStyle}` : undefined,
    input.brandContext?.audience ? `Audience: ${input.brandContext.audience}` : undefined,
    input.brandContext?.topContentTags?.length
      ? `High-signal themes: ${input.brandContext.topContentTags.slice(0, 4).join(", ")}`
      : undefined,
    input.brandContext?.performanceInsights?.length
      ? `Performance guidance: ${input.brandContext.performanceInsights.slice(0, 2).join(" | ")}`
      : undefined,
    `Goal: ${input.goal}`,
    `Post summary: ${input.content.slice(0, 180)}`,
    `CTA: ${input.cta}`,
    input.platform === "instagram"
      ? "Use a square composition with one clear focal point and minimal text overlays."
      : "Leave enough clean space for headline overlays and readable CTA treatment.",
  ];

  return lines.filter((entry): entry is string => Boolean(entry)).join("\n");
}

function extractAngle(metadata: unknown): string | undefined {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return undefined;
  }

  const candidate = metadata as Record<string, unknown>;
  return typeof candidate.angle === "string" && candidate.angle.trim() ? candidate.angle.trim() : undefined;
}

function buildPlanEntries(input: {
  batchId: string;
  items: GenerateContentPlanResponse["items"];
  variants: GenerateContentPlanResponse["variants"];
  selectedPlatforms: SocialContentPlanPlatform[];
  goal: string;
  dateKeys: string[];
  scheduledTime: string;
  brandKit?: BrandKit;
  brandContext?: BrandPromptContext;
}): SocialContentPlanEntry[] {
  const variantLookup = new Map(
    input.variants.map((variant) => [`${variant.contentItemId}:${variant.channel}`, variant] as const),
  );

  return input.items.flatMap((item, index) => {
    const day = index + 1;
    const dateKey = input.dateKeys[index] ?? input.dateKeys[input.dateKeys.length - 1];
    const type = inferPlanType(day, input.goal);
    const cta = inferCta(input.goal, type);

    return input.selectedPlatforms.flatMap((platform) => {
      const variant = variantLookup.get(`${item.id}:${platform}`);

      if (!variant) {
        return [];
      }

      return [{
        batchId: input.batchId,
        contentItemId: item.id,
        variantId: variant.id,
        day,
        dateKey,
        scheduledTime: input.scheduledTime,
        type,
        platform,
        title: variant.title,
        content: variant.text,
        imagePrompt: buildImagePrompt({
          brandKit: input.brandKit,
          brandContext: input.brandContext,
          goal: input.goal,
          type,
          platform,
          content: variant.text,
          cta,
        }),
        cta,
        angle: extractAngle(variant.metadata),
      }] satisfies SocialContentPlanEntry[];
    });
  });
}

function inferSelectedPlatformsFromVariants(
  variants: GetContentPlanResponse["variants"],
): SocialContentPlanPlatform[] {
  const normalized = [...new Set(
    variants.flatMap((variant) =>
      variant.channel === "linkedin" || variant.channel === "instagram" || variant.channel === "facebook"
        ? [variant.channel]
        : [],
    ),
  )];

  return normalized.length > 0 ? normalized : DEFAULT_SOCIAL_PLAN_PLATFORMS;
}

export async function generateSocialContentPlan(
  principal: AuthenticatedPrincipal,
  input: GenerateContentPlanRequest,
): Promise<GenerateContentPlanResponse> {
  const businessId = input.businessId.trim();
  const goal = normalizeGoal(input.goal);
  const { days } = normalizeDuration(input.duration);
  const selectedPlatforms = normalizePlatforms(input.platforms);
  const scheduledTime = normalizeTime(input.defaultScheduledTime);
  const startDate = normalizeDateKey(input.startDate) ?? todayDateKey();
  const audienceTimezone = normalizeTimezone(input.audienceTimezone);

  const [brandContext, brandKit] = await Promise.all([
    getBrandPromptContextForBusiness(businessId),
    getBrandKitForBusiness({ principal, businessId }).catch(() => undefined),
  ]);
  const batchResponse = await generateContentBatch(principal, {
    businessId,
    lane: "social",
    primaryChannel: "linkedin",
    days,
    title: input.title?.trim() || `Social autopilot · ${days} days`,
    prompt: buildGoalPrompt({
      goal,
      days,
      platforms: selectedPlatforms,
      brandContext,
      brandKit,
    }),
    tone: input.tone?.trim(),
    audienceTimezone,
    defaultScheduledTime: scheduledTime,
  });

  const plan = buildPlanEntries({
    batchId: batchResponse.batch.id,
    items: batchResponse.items,
    variants: batchResponse.variants,
    selectedPlatforms,
    goal,
    dateKeys: buildScheduleDateKeys(startDate, batchResponse.items.length),
    scheduledTime,
    brandKit,
    brandContext,
  });

  return {
    ...batchResponse,
    selectedPlatforms,
    plan,
  };
}

export async function getSocialContentPlan(
  principal: AuthenticatedPrincipal,
  input: {
    businessId: string;
    batchId: string;
    goal?: string;
    platforms?: SocialContentPlanPlatform[];
    startDate?: string;
    defaultScheduledTime?: string;
  },
): Promise<GetContentPlanResponse> {
  const businessId = input.businessId.trim();
  const detail = await getContentBatch(principal, businessId, input.batchId.trim());
  const selectedPlatforms = input.platforms && input.platforms.length > 0
    ? normalizePlatforms(input.platforms)
    : inferSelectedPlatformsFromVariants(detail.variants);
  const scheduledTime = normalizeTime(input.defaultScheduledTime);
  const startDate = normalizeDateKey(input.startDate) ?? todayDateKey();
  const goal = input.goal?.trim() || "grow the business";
  const [brandContext, brandKit] = await Promise.all([
    getBrandPromptContextForBusiness(businessId),
    getBrandKitForBusiness({ principal, businessId }).catch(() => undefined),
  ]);

  return {
    ...detail,
    selectedPlatforms,
    plan: buildPlanEntries({
      batchId: detail.batch.id,
      items: detail.items,
      variants: detail.variants,
      selectedPlatforms,
      goal,
      dateKeys: buildScheduleDateKeys(startDate, detail.items.length),
      scheduledTime,
      brandKit,
      brandContext,
    }),
  };
}

export async function approveSocialContentPlan(
  principal: AuthenticatedPrincipal,
  input: ApproveContentPlanRequest,
): Promise<ApproveContentPlanResponse> {
  const selectedPlatforms = input.platforms && input.platforms.length > 0
    ? normalizePlatforms(input.platforms)
    : DEFAULT_SOCIAL_PLAN_PLATFORMS;
  const response = await confirmContentBatch(principal, {
    businessId: input.businessId,
    batchId: input.batchId,
    startDate: input.startDate,
    defaultScheduledTime: normalizeTime(input.defaultScheduledTime),
    audienceTimezone: normalizeTimezone(input.audienceTimezone),
    spacing: input.spacing,
    channels: selectedPlatforms,
  });

  return {
    ...response,
    selectedPlatforms,
  };
}
