import type { QueryResultRow } from "pg";
import {
  resolveBusinessGenerationGoal,
  resolveBusinessGenerationOutputKind,
  type BrandPromptContext,
  type BusinessCampaignGenerationIntent,
  type BusinessContentOutput,
  type BusinessGenerationChannel,
  type BusinessGenerationRequest,
  type BusinessGenerationResponse,
  type BusinessWeeklyPlanDay,
} from "../../../../packages/shared-types/index.ts";
import { generateCompletion } from "../../../../packages/ai-core/src/generateCompletion.ts";
import { getBrandPromptContextForBusiness } from "./brandIntelligence/brandProfileService.ts";
import { loadWorkspaceKnowledgeProfileForBusiness } from "./brandIntelligence/workspaceKnowledgeService.ts";
import { queryDb } from "./db/client.ts";

interface BrandProfileContextRow extends QueryResultRow {
  website_url: string | null;
  location: string | null;
}

interface WeeklyPlanPromptResponse {
  output: {
    days: BusinessWeeklyPlanDay[];
  };
}

function normalizeStringList(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (typeof item === "string" ? normalizeOptionalString(item) : undefined))
    .filter((item): item is string => Boolean(item))
    .slice(0, maxItems);
}

function normalizeOptionalString(value: string | undefined | null): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function isDirectBusinessTone(tone: BusinessGenerationRequest["tone"] | undefined): boolean {
  return tone === "direct";
}

function normalizeSourceIdeaSegments(
  value: string | undefined | null,
  maxItems: number,
): string[] {
  const normalized = normalizeOptionalString(value);

  if (!normalized) {
    return [];
  }

  return normalized
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((segment) => segment.trim())
    .filter((segment) => segment !== "")
    .slice(0, maxItems);
}

function extractPrimarySourceLine(value: string | undefined | null): string | undefined {
  const primary = normalizeSourceIdeaSegments(value, 1)[0];

  if (!primary) {
    return undefined;
  }

  return primary.length > 88 ? `${primary.slice(0, 85).trimEnd()}...` : primary;
}

function stripCodeFences(value: string): string {
  return value
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function parseJsonObject<T>(value: string): T {
  const stripped = stripCodeFences(value);
  const firstObjectIndex = stripped.indexOf("{");
  const lastObjectIndex = stripped.lastIndexOf("}");
  const json =
    firstObjectIndex >= 0 && lastObjectIndex > firstObjectIndex
      ? stripped.slice(firstObjectIndex, lastObjectIndex + 1)
      : stripped;

  return JSON.parse(json) as T;
}

function dedupeChannels(channels: BusinessGenerationChannel[]): BusinessGenerationChannel[] {
  return [...new Set(channels)];
}

async function loadBusinessProfileContext(businessId: string | undefined): Promise<{
  websiteUrl?: string;
  location?: string;
}> {
  const normalizedBusinessId = normalizeOptionalString(businessId);

  if (!normalizedBusinessId) {
    return {};
  }

  const result = await queryDb<BrandProfileContextRow>(
    `
      select website_url, location
      from brand_profiles
      where business_id = $1
      limit 1
    `,
    [normalizedBusinessId],
  );

  return {
    websiteUrl: normalizeOptionalString(result.rows[0]?.website_url),
    location: normalizeOptionalString(result.rows[0]?.location),
  };
}

function buildPromptRequestContext(input: {
  request: BusinessGenerationRequest;
  brandContext?: BrandPromptContext;
  websiteUrl?: string;
  audienceSummary?: string;
  positioningSummary?: string;
}): string {
  return JSON.stringify(
    {
      goal: input.request.goal,
      generationIntent: input.request.generationIntent,
      businessType: input.request.businessType,
      tone: input.request.tone ?? "friendly",
      channels: input.request.channels,
      location: input.request.location,
      offer: input.request.offer,
      sourceIdea: input.request.sourceIdea,
      preferredVisualDirection:
        input.request.businessType === "daycare"
          ? "realistic lifestyle image with warm, trustworthy daycare environment and headline-safe negative space"
          : "branded conversion visual with clear promotional focus",
      websiteUrl: input.websiteUrl,
      writingStyle: input.brandContext?.writingStyle,
      visualStyle: input.brandContext?.visualStyle,
      audience: input.audienceSummary ?? input.brandContext?.audience,
      positioning: input.positioningSummary ?? input.brandContext?.positioning,
      topics: input.brandContext?.topics ?? [],
      patterns: input.brandContext?.patterns ?? [],
    },
    null,
    2,
  );
}

function buildCampaignPrompt(input: {
  request: BusinessGenerationRequest;
  brandContext?: BrandPromptContext;
  websiteUrl?: string;
  audienceSummary?: string;
  positioningSummary?: string;
}): string {
  const preserveSourceWording = isDirectBusinessTone(input.request.tone);

  return [
    preserveSourceWording
      ? "You are a practical copy editor for local businesses."
      : "You are a direct-response marketing operator for local businesses.",
    preserveSourceWording
      ? "Tighten the source idea into channel-ready business copy while keeping the original wording and message as intact as possible."
      : "Create campaign-ready content, not founder storytelling and not carousel slides.",
    preserveSourceWording
      ? "Keep the output practical, clear, and recognizably close to the user's language."
      : "Keep the output practical, clear, and conversion-oriented.",
    "Return only one valid JSON object.",
    "",
    "OUTPUT JSON SHAPE",
    JSON.stringify(
      {
        output: {
          hooks: ["string", "string", "string"],
          visual: {
            headline: "string",
            subheadline: "string",
            imagePrompt: "string",
            visualDirection: "string",
          },
          captions: {
            instagram: "string",
            facebook: "string",
          },
          cta: {
            label: "string",
            url: "string",
            alternatives: ["string", "string"],
          },
          hashtags: ["string", "string", "string"],
          email: {
            subject: "string",
            body: "string",
          },
        },
      },
      null,
      2,
    ),
    "",
    "RULES",
    "- Do not mention LinkedIn.",
    "- Do not return slides, stories, or multi-step carousels.",
    "- Optimize for short-form social and business conversion.",
    "- Return 3 to 5 hooks that could lead this campaign.",
    "- Use the requested channels only; omit email when email is not requested.",
    "- Keep captions platform-native: Instagram shorter, Facebook slightly fuller.",
    "- Keep hashtags out of captions; put them only in the hashtags array.",
    "- Make the CTA concrete and aligned to the offer.",
    "- Make the visual direction specific enough to generate a usable image.",
    "- For daycare, prefer realistic, trustworthy local-business imagery over founder quote cards.",
    preserveSourceWording
      ? "- Preserve the core phrasing and structure from sourceIdea whenever it is already usable."
      : "",
    preserveSourceWording
      ? "- Tighten, clarify, and lightly adapt for channels; do not invent a completely new campaign angle."
      : "",
    preserveSourceWording
      ? "- Avoid hype, heavy ad language, and new claims that are not already supported by sourceIdea or the offer."
      : "",
    "",
    "REQUEST",
    buildPromptRequestContext(input),
  ].filter(Boolean).join("\n");
}

function buildFallbackHooks(
  request: BusinessGenerationRequest,
  headline: string,
  subheadline: string,
): string[] {
  const directSourceSegments = isDirectBusinessTone(request.tone)
    ? normalizeSourceIdeaSegments(request.sourceIdea, 3)
    : [];

  if (directSourceSegments.length > 0) {
    return [...directSourceSegments, headline, subheadline].filter(
      (value, index, list) => value && list.indexOf(value) === index,
    );
  }

  if (request.businessType === "daycare") {
    return [
      "Struggling to fill your daycare spots?",
      headline,
      request.location
        ? `${request.location} parents are already searching for care options`
        : "Parents decide faster when your daycare is easy to discover",
      subheadline,
    ].filter((value, index, list) => value && list.indexOf(value) === index);
  }

  return [
    headline,
    subheadline,
    request.offer ? `Promote ${request.offer}` : "Turn attention into clear next steps",
  ].filter((value, index, list) => value && list.indexOf(value) === index);
}

function buildFallbackCtaAlternatives(
  request: BusinessGenerationRequest,
  primaryLabel: string,
): string[] {
  if (request.businessType === "daycare") {
    return [
      primaryLabel,
      "Get discovered by more parents",
      "Fill your open spots",
    ].filter((value, index, list) => list.indexOf(value) === index);
  }

  if (request.goal === "bookings") {
    return [primaryLabel, "Check availability", "Reserve your spot"].filter(
      (value, index, list) => list.indexOf(value) === index,
    );
  }

  return [primaryLabel, "Learn more", "See how it works"].filter(
    (value, index, list) => list.indexOf(value) === index,
  );
}

function buildFallbackHashtags(request: BusinessGenerationRequest): string[] {
  const locationTag = request.location
    ? `#${request.location.replace(/[^a-z0-9]+/gi, "")}`
    : "";

  if (request.businessType === "daycare") {
    return [
      "#DaycareSpots",
      "#ChildCare",
      "#DaycareMarketing",
      "#ParentSearch",
      locationTag,
    ].filter(Boolean);
  }

  if (request.businessType === "salon") {
    return ["#SalonMarketing", "#BookNow", "#LocalBusiness", locationTag].filter(Boolean);
  }

  if (request.businessType === "fitness") {
    return ["#FitnessMarketing", "#MemberGrowth", "#LocalBusiness", locationTag].filter(Boolean);
  }

  return ["#LocalBusiness", "#GrowthMarketing", "#CustomerAcquisition", locationTag].filter(Boolean);
}

function buildFallbackBusinessImagePrompt(
  request: BusinessGenerationRequest,
  headline: string,
  subheadline: string,
): { imagePrompt: string; visualDirection: string } {
  if (request.businessType === "daycare") {
    return {
      imagePrompt: [
        "Realistic lifestyle photo for daycare marketing",
        "bright welcoming daycare classroom or reception area",
        "warm natural light",
        "clean safe environment",
        "trustworthy childcare brand tone",
        "authentic parent-decision moment",
        "headline-safe negative space for promotional text overlay",
        `message focus: ${headline}`,
        subheadline ? `supporting line: ${subheadline}` : "",
        "no dark SaaS styling, no uncanny faces, no generic stock-business look",
      ]
        .filter(Boolean)
        .join(", "),
      visualDirection:
        "Photo-led creative with a realistic daycare environment, warm trust-building tone, and clean room for a bold headline overlay.",
    };
  }

  return {
    imagePrompt: [
      "Realistic branded marketing image",
      "local-business lifestyle scene",
      "clean promotional composition",
      "natural lighting",
      "clear headline-safe negative space",
      `message focus: ${headline}`,
    ].join(", "),
    visualDirection:
      "Single-image promotional creative with realistic photography, readable overlay space, and clear CTA support.",
  };
}

function buildWeeklyPlanPrompt(input: {
  request: BusinessGenerationRequest;
  brandContext?: BrandPromptContext;
  websiteUrl?: string;
  audienceSummary?: string;
  positioningSummary?: string;
}): string {
  return [
    "You are a direct-response marketing operator for local businesses.",
    "Build a practical 7-day business marketing plan, not a founder story arc.",
    "Return only one valid JSON object.",
    "",
    "OUTPUT JSON SHAPE",
    JSON.stringify(
      {
        output: {
          days: [
            {
              dayNumber: 1,
              theme: "offer",
              headline: "string",
              summary: "string",
              cta: "string",
            },
          ],
        },
      },
      null,
      2,
    ),
    "",
    "RULES",
    "- Return exactly 7 days.",
    "- Use this pattern somewhere across the week: offer, problem, proof, local, reminder, educational.",
    "- Keep each day actionable and channel-ready.",
    "- Do not return slides or long-form storytelling.",
    "",
    "REQUEST",
    buildPromptRequestContext(input),
  ].join("\n");
}

function buildFallbackHeadline(input: BusinessGenerationRequest): string {
  const locationPrefix = normalizeOptionalString(input.location);
  const offer = normalizeOptionalString(input.offer);
  const directHeadline = isDirectBusinessTone(input.tone)
    ? extractPrimarySourceLine(input.sourceIdea)
    : undefined;

  if (directHeadline) {
    return directHeadline;
  }

  if (input.businessType === "daycare" && input.goal === "leads") {
    return locationPrefix
      ? `${locationPrefix} daycare owners: get discovered faster`
      : "Daycare owners: get discovered faster";
  }

  if (offer) {
    return offer;
  }

  switch (input.goal) {
    case "bookings":
      return "Turn local attention into new bookings";
    case "traffic":
      return "Drive more local traffic to your offer";
    case "awareness":
      return "Help local customers discover your business";
    case "leads":
    default:
      return "Generate more qualified leads this week";
  }
}

function buildFallbackCampaignContent(
  request: BusinessGenerationRequest,
  websiteUrl?: string,
): BusinessContentOutput {
  const headline = buildFallbackHeadline(request);
  const sourceIdea = normalizeOptionalString(request.sourceIdea);
  const directSourceSegments = normalizeSourceIdeaSegments(request.sourceIdea, 3);
  const subheadline =
    isDirectBusinessTone(request.tone)
      ? directSourceSegments[1]
        ?? normalizeOptionalString(request.offer)
        ?? (request.businessType === "daycare"
          ? "Keep the message grounded in trust, clarity, and local parent demand."
          : "Keep the message clear, useful, and easy to act on.")
      : request.businessType === "daycare"
        ? "Parents are already searching nearby. Make sure your business shows up with a clear offer."
        : "Put a simple offer in front of the right local audience with clear next steps.";
  const ctaLabel =
    request.businessType === "daycare"
      ? "Claim your listing"
      : request.goal === "bookings"
        ? "Book now"
        : "Learn more";
  const ctaUrl = websiteUrl ?? "https://foundercontent.ai";
  const imageBrief = buildFallbackBusinessImagePrompt(request, headline, subheadline);
  const instagramCaption =
    isDirectBusinessTone(request.tone) && sourceIdea
      ? sourceIdea
      : [
          headline,
          subheadline,
          request.offer ? `Offer: ${request.offer}` : "",
          `CTA: ${ctaLabel}`,
        ]
          .filter(Boolean)
          .join("\n\n");
  const facebookCaption =
    isDirectBusinessTone(request.tone) && sourceIdea
      ? sourceIdea
      : [
          headline,
          subheadline,
          request.location ? `Local focus: ${request.location}` : "",
          request.offer ? `Offer: ${request.offer}` : "",
          `Tap to ${ctaLabel.toLowerCase()}.`,
        ]
          .filter(Boolean)
          .join("\n\n");

  return {
    hooks: buildFallbackHooks(request, headline, subheadline),
    visual: {
      headline,
      subheadline,
      imagePrompt: imageBrief.imagePrompt,
      visualDirection: imageBrief.visualDirection,
    },
    captions: {
      ...(request.channels.includes("instagram") ? { instagram: instagramCaption } : {}),
      ...(request.channels.includes("facebook") ? { facebook: facebookCaption } : {}),
    },
    cta: {
      label: ctaLabel,
      url: ctaUrl,
      alternatives: buildFallbackCtaAlternatives(request, ctaLabel),
    },
    hashtags: buildFallbackHashtags(request),
    ...(request.channels.includes("email")
      ? {
          email: {
            subject: headline,
            body:
              isDirectBusinessTone(request.tone) && sourceIdea
                ? [
                    sourceIdea,
                    request.offer && !sourceIdea.includes(request.offer) ? request.offer : "",
                    `${ctaLabel}: ${ctaUrl}`,
                  ]
                    .filter(Boolean)
                    .join("\n\n")
                : `${headline}\n\n${subheadline}\n\n${request.offer ? `${request.offer}\n\n` : ""}${ctaLabel}: ${ctaUrl}`,
          },
        }
      : {}),
  };
}

function resolveBusinessCampaignIntent(
  request: BusinessGenerationRequest,
): BusinessCampaignGenerationIntent {
  if (request.generationIntent && request.generationIntent !== "weekly_plan") {
    return request.generationIntent;
  }

  if (request.goal === "leads") {
    return "get_leads";
  }

  if (request.goal === "bookings") {
    return "get_bookings";
  }

  return "promote_offer";
}

function normalizeCampaignContent(
  output: BusinessContentOutput,
  input: BusinessGenerationRequest,
  websiteUrl?: string,
): BusinessContentOutput {
  const fallback = buildFallbackCampaignContent(input, websiteUrl);

  return {
    hooks:
      normalizeStringList((output as { hooks?: unknown }).hooks, 5).length > 0
        ? normalizeStringList((output as { hooks?: unknown }).hooks, 5)
        : fallback.hooks,
    visual: {
      headline: normalizeOptionalString(output.visual?.headline) ?? fallback.visual.headline,
      subheadline:
        normalizeOptionalString(output.visual?.subheadline) ?? fallback.visual.subheadline,
      imagePrompt:
        normalizeOptionalString(output.visual?.imagePrompt) ?? fallback.visual.imagePrompt,
      visualDirection:
        normalizeOptionalString(output.visual?.visualDirection) ?? fallback.visual.visualDirection,
    },
    captions: {
      ...(input.channels.includes("instagram")
        ? {
            instagram:
              normalizeOptionalString(output.captions?.instagram) ?? fallback.captions.instagram,
          }
        : {}),
      ...(input.channels.includes("facebook")
        ? {
            facebook:
              normalizeOptionalString(output.captions?.facebook) ?? fallback.captions.facebook,
          }
        : {}),
    },
    cta: {
      label: normalizeOptionalString(output.cta?.label) ?? fallback.cta.label,
      url: normalizeOptionalString(output.cta?.url) ?? websiteUrl ?? fallback.cta.url,
      alternatives:
        normalizeStringList(output.cta?.alternatives, 4).length > 0
          ? normalizeStringList(output.cta?.alternatives, 4)
          : fallback.cta.alternatives,
    },
    hashtags:
      normalizeStringList((output as { hashtags?: unknown }).hashtags, 8).length > 0
        ? normalizeStringList((output as { hashtags?: unknown }).hashtags, 8)
        : fallback.hashtags,
    ...(input.channels.includes("email")
      ? {
          email: {
            subject:
              normalizeOptionalString(output.email?.subject)
              ?? fallback.email?.subject
              ?? fallback.visual.headline,
            body:
              normalizeOptionalString(output.email?.body)
              ?? fallback.email?.body
              ?? fallback.captions.facebook
              ?? fallback.captions.instagram
              ?? fallback.visual.headline,
          },
        }
      : {}),
  };
}

function wrapCampaignOutput(
  request: BusinessGenerationRequest,
  content: BusinessContentOutput,
): BusinessGenerationResponse {
  return {
    kind: "business_campaign",
    intent: resolveBusinessCampaignIntent(request),
    goal: request.goal,
    channels: dedupeChannels(request.channels),
    content,
  };
}

function buildFallbackCampaignResponse(
  request: BusinessGenerationRequest,
  websiteUrl?: string,
): BusinessGenerationResponse {
  return wrapCampaignOutput(request, buildFallbackCampaignContent(request, websiteUrl));
}

const WEEKLY_PLAN_THEMES: BusinessWeeklyPlanDay["theme"][] = [
  "offer",
  "problem",
  "proof",
  "local",
  "reminder",
  "educational",
  "offer",
];

function buildWeeklyPlanDayHeadline(
  request: BusinessGenerationRequest,
  theme: BusinessWeeklyPlanDay["theme"],
  fallbackHeadline: string,
): string {
  if (theme === "local" && request.location) {
    return `${request.location}: ${fallbackHeadline}`;
  }

  if (theme === "proof") {
    return request.businessType === "daycare"
      ? "Why parents trust local daycare listings"
      : "Why local customers choose businesses they recognize";
  }

  if (theme === "problem") {
    return request.businessType === "daycare"
      ? "Still have open daycare spots?"
      : "Still missing local demand you should already be capturing?";
  }

  if (theme === "educational") {
    return request.businessType === "daycare"
      ? "What helps parents pick a daycare faster"
      : "What makes local marketing convert instead of just getting attention";
  }

  if (theme === "reminder") {
    return `Reminder: ${fallbackHeadline}`;
  }

  return fallbackHeadline;
}

function buildWeeklyPlanDaySummary(
  request: BusinessGenerationRequest,
  theme: BusinessWeeklyPlanDay["theme"],
  headline: string,
  ctaLabel: string,
): string {
  const locationSuffix = request.location ? ` in ${request.location}` : "";

  switch (theme) {
    case "offer":
      return `Lead with one clear offer${locationSuffix}, keep the headline obvious, and point every channel toward ${ctaLabel.toLowerCase()}.`;
    case "problem":
      return `Call out the core customer problem${locationSuffix}, explain why visibility is the issue, and move the reader toward ${ctaLabel.toLowerCase()}.`;
    case "proof":
      return `Use proof, trust, or recognition to support "${headline}" and give prospects one reason to trust the next step.`;
    case "local":
      return `Anchor this message in local demand${locationSuffix} so the campaign feels specific instead of generic.`;
    case "reminder":
      return `Repackage the core CTA as a lower-friction reminder and keep the ask simple.`;
    case "educational":
      return `Teach one useful thing tied to the offer, then close with ${ctaLabel.toLowerCase()} as the next action.`;
    default:
      return `Keep the message focused on ${headline} and route people toward ${ctaLabel.toLowerCase()}.`;
  }
}

function buildFallbackWeeklyPlanDays(
  request: BusinessGenerationRequest,
  websiteUrl?: string,
): BusinessWeeklyPlanDay[] {
  const fallbackCampaign = buildFallbackCampaignContent(request, websiteUrl);

  return WEEKLY_PLAN_THEMES.map((theme, index) => {
    const headline = buildWeeklyPlanDayHeadline(
      request,
      theme,
      fallbackCampaign.visual.headline,
    );

    return {
      dayNumber: index + 1,
      theme,
      headline,
      summary: buildWeeklyPlanDaySummary(request, theme, headline, fallbackCampaign.cta.label),
      cta: fallbackCampaign.cta.label,
    };
  });
}

function isValidWeeklyPlanTheme(
  value: unknown,
): value is BusinessWeeklyPlanDay["theme"] {
  return value === "offer"
    || value === "problem"
    || value === "proof"
    || value === "local"
    || value === "reminder"
    || value === "educational";
}

function normalizeWeeklyPlanDays(
  days: BusinessWeeklyPlanDay[] | undefined,
  request: BusinessGenerationRequest,
  websiteUrl?: string,
): BusinessWeeklyPlanDay[] {
  const fallbackDays = buildFallbackWeeklyPlanDays(request, websiteUrl);
  const candidates = Array.isArray(days) ? days : [];

  return fallbackDays.map((fallbackDay, index) => {
    const candidate = candidates[index];

    return {
      dayNumber: index + 1,
      theme: isValidWeeklyPlanTheme(candidate?.theme) ? candidate.theme : fallbackDay.theme,
      headline: normalizeOptionalString(candidate?.headline) ?? fallbackDay.headline,
      summary: normalizeOptionalString(candidate?.summary) ?? fallbackDay.summary,
      cta: normalizeOptionalString(candidate?.cta) ?? fallbackDay.cta,
    };
  });
}

function wrapWeeklyPlanOutput(
  request: BusinessGenerationRequest,
  days: BusinessWeeklyPlanDay[],
): BusinessGenerationResponse {
  return {
    kind: "weekly_plan",
    intent: "weekly_plan",
    goal: request.goal,
    channels: dedupeChannels(request.channels),
    days,
  };
}

function buildFallbackWeeklyPlanResponse(
  request: BusinessGenerationRequest,
  websiteUrl?: string,
): BusinessGenerationResponse {
  return wrapWeeklyPlanOutput(request, buildFallbackWeeklyPlanDays(request, websiteUrl));
}

export async function generateBusinessContent(
  request: BusinessGenerationRequest,
): Promise<BusinessGenerationResponse> {
  const businessId = normalizeOptionalString(request.businessId);
  const [brandContext, knowledgeProfile, profileContext] = await Promise.all([
    getBrandPromptContextForBusiness(businessId),
    businessId ? loadWorkspaceKnowledgeProfileForBusiness(businessId) : Promise.resolve(null),
    loadBusinessProfileContext(businessId),
  ]);
  const websiteUrl = profileContext.websiteUrl;
  const requestWithDefaults: BusinessGenerationRequest = {
    ...request,
    goal: resolveBusinessGenerationGoal(request.generationIntent, request.goal),
    location: normalizeOptionalString(request.location) ?? profileContext.location,
    channels: dedupeChannels(request.channels),
  };
  const outputKind = resolveBusinessGenerationOutputKind(requestWithDefaults.generationIntent);

  if (!process.env.OPENAI_API_KEY) {
    return outputKind === "weekly_plan"
      ? buildFallbackWeeklyPlanResponse(requestWithDefaults, websiteUrl)
      : buildFallbackCampaignResponse(requestWithDefaults, websiteUrl);
  }

  try {
    const completion = await generateCompletion(
      outputKind === "weekly_plan"
        ? buildWeeklyPlanPrompt({
            request: requestWithDefaults,
            brandContext,
            websiteUrl,
            audienceSummary: knowledgeProfile?.audienceSummary,
            positioningSummary: knowledgeProfile?.positioningSummary,
          })
        : buildCampaignPrompt({
            request: requestWithDefaults,
            brandContext,
            websiteUrl,
            audienceSummary: knowledgeProfile?.audienceSummary,
            positioningSummary: knowledgeProfile?.positioningSummary,
          }),
      {
        jsonMode: true,
      },
    );

    if (outputKind === "weekly_plan") {
      const parsed = parseJsonObject<WeeklyPlanPromptResponse>(completion);

      if (!Array.isArray(parsed?.output?.days) || parsed.output.days.length === 0) {
        throw new Error("Business generation returned an empty weekly plan.");
      }

      return wrapWeeklyPlanOutput(
        requestWithDefaults,
        normalizeWeeklyPlanDays(parsed.output.days, requestWithDefaults, websiteUrl),
      );
    }

    const parsed = parseJsonObject<{ output: BusinessContentOutput }>(completion);

    if (!parsed?.output) {
      throw new Error("Business generation returned an empty campaign output.");
    }

    return wrapCampaignOutput(
      requestWithDefaults,
      normalizeCampaignContent(parsed.output, requestWithDefaults, websiteUrl),
    );
  } catch {
    return outputKind === "weekly_plan"
      ? buildFallbackWeeklyPlanResponse(requestWithDefaults, websiteUrl)
      : buildFallbackCampaignResponse(requestWithDefaults, websiteUrl);
  }
}
