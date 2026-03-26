import type { QueryResultRow } from "pg";
import type {
  BrandProfile,
  BrandTone,
  BusinessMembership,
  CompleteOnboardingRequest,
  CompleteOnboardingResponse,
  CreateOnboardingWorkspaceRequest,
  CreateOnboardingWorkspaceResponse,
  OnboardingChannel,
  OnboardingGoal,
  OnboardingProfile,
  OnboardingRecommendation,
  OnboardingStatus,
  OnboardingStatusResponse,
  OnboardingStep,
  OnboardingUseCase,
  SaveOnboardingPreferencesRequest,
  SaveOnboardingPreferencesResponse,
  StartOnboardingRequest,
  StartOnboardingResponse,
} from "../../../../packages/shared-types/index.ts";
import type { AuthenticatedPrincipal } from "../middleware/auth.ts";
import { createBusinessForUser, getAppSession } from "./authBusinessService.ts";
import { queryDb } from "./db/client.ts";
import { safeLogEvent } from "./analytics/eventLoggingService.ts";
import { HttpError } from "../utils/http.ts";
import { logInfo } from "../utils/logger.ts";

interface OnboardingProfileRow extends QueryResultRow {
  id: string;
  user_id: string;
  business_id: string | null;
  status: OnboardingStatus;
  current_step: OnboardingStep;
  use_case: OnboardingUseCase | null;
  target_channels: unknown;
  goals: unknown;
  preferred_tone: BrandTone | null;
  first_content_generated_at: Date | string | null;
  first_content_copied_at: Date | string | null;
  first_channel_connected_at: Date | string | null;
  first_content_scheduled_at: Date | string | null;
  completed_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface BrandProfileRow extends QueryResultRow {
  id: string;
  business_id: string;
  industry: string | null;
  preferred_tone: BrandTone | null;
  target_channels: unknown;
  goals: unknown;
  tone: string | null;
  writing_style: string | null;
  visual_style: string | null;
  topics: unknown;
  patterns: unknown;
  created_at: Date | string;
  updated_at: Date | string;
}

function toIsoString(value: Date | string | null): string | undefined {
  return value ? new Date(value).toISOString() : undefined;
}

function parseStringArray<TValue extends string>(value: unknown): TValue[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is TValue => typeof entry === "string");
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed)
        ? parsed.filter((entry): entry is TValue => typeof entry === "string")
        : [];
    } catch {
      return [];
    }
  }

  return [];
}

function mapOnboardingProfile(row: OnboardingProfileRow): OnboardingProfile {
  return {
    id: row.id,
    userId: row.user_id,
    businessId: row.business_id ?? undefined,
    status: row.status,
    currentStep: row.current_step,
    useCase: row.use_case ?? undefined,
    targetChannels: parseStringArray<OnboardingChannel>(row.target_channels),
    goals: parseStringArray<OnboardingGoal>(row.goals),
    preferredTone: row.preferred_tone ?? undefined,
    firstContentGeneratedAt: toIsoString(row.first_content_generated_at),
    firstContentCopiedAt: toIsoString(row.first_content_copied_at),
    firstChannelConnectedAt: toIsoString(row.first_channel_connected_at),
    firstContentScheduledAt: toIsoString(row.first_content_scheduled_at),
    completedAt: toIsoString(row.completed_at),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function mapBrandProfile(row: BrandProfileRow): BrandProfile {
  return {
    id: row.id,
    businessId: row.business_id,
    industry: row.industry ?? undefined,
    preferredTone: row.preferred_tone ?? undefined,
    targetChannels: parseStringArray<OnboardingChannel>(row.target_channels),
    goals: parseStringArray<OnboardingGoal>(row.goals),
    tone: row.tone ?? undefined,
    writingStyle: row.writing_style ?? undefined,
    visualStyle: row.visual_style ?? undefined,
    topics: parseStringArray<string>(row.topics),
    patterns: parseStringArray<string>(row.patterns),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function defaultBrandTone(preferredTone: BrandTone | undefined): string | undefined {
  return preferredTone;
}

function defaultBrandWritingStyle(preferredTone: BrandTone | undefined): string {
  if (preferredTone === "bold") {
    return "short punchy lines with sharp contrast";
  }

  if (preferredTone === "friendly") {
    return "conversational paragraphs with warm clarity";
  }

  return "clear professional paragraphs with practical insight";
}

function defaultBrandVisualStyle(preferredTone: BrandTone | undefined): string {
  if (preferredTone === "bold") {
    return "dark minimal + bold typography";
  }

  if (preferredTone === "friendly") {
    return "warm minimal + editorial cards";
  }

  return "clean editorial + high contrast typography";
}

function defaultBrandTopics(
  industry: string | undefined,
  goals: OnboardingGoal[],
): string[] {
  const mappedGoals = goals.map((goal) => {
    switch (goal) {
      case "get_clients":
        return "client acquisition";
      case "build_audience":
        return "audience growth";
      case "stay_consistent":
        return "content consistency";
      case "promote_product_service":
        return "product education";
    }
  });

  return [...new Set([industry, ...mappedGoals].filter((value): value is string => Boolean(value)))];
}

function defaultBrandPatterns(preferredTone: BrandTone | undefined): string[] {
  if (preferredTone === "bold") {
    return ["contrarian statement -> lesson -> CTA", "hook -> insight -> CTA"];
  }

  if (preferredTone === "friendly") {
    return ["story hook -> insight -> CTA", "hook -> lesson -> CTA"];
  }

  return ["hook -> insight -> CTA", "framework -> takeaway -> CTA"];
}

function buildDefaultOnboardingProfile(userId: string): OnboardingProfile {
  const now = new Date().toISOString();

  return {
    id: `pending-${userId}`,
    userId,
    status: "not_started",
    currentStep: "intent",
    targetChannels: [],
    goals: [],
    createdAt: now,
    updatedAt: now,
  };
}

function buildRecommendation(profile: OnboardingProfile): OnboardingRecommendation {
  if (profile.status === "completed") {
    return {
      title: "Your marketing workspace is live.",
      description: "Review your dashboard, publish the first post, and keep momentum going this week.",
      nextStep: "dashboard",
    };
  }

  if (profile.currentStep === "workspace") {
    return {
      title: "Create the workspace before anything else.",
      description: "That gives the product a brand context and a place to store your first assets.",
      nextStep: "workspace",
    };
  }

  if (profile.currentStep === "generate") {
    return {
      title: "Generate the first post now.",
      description: "That first output is the activation point for the whole onboarding flow.",
      nextStep: "generate",
    };
  }

  if (profile.currentStep === "activate") {
    return {
      title: "Turn the first session into a habit.",
      description: "Choose a channel or a schedule preference, then move into the dashboard.",
      nextStep: "activate",
    };
  }

  return {
    title: "Tell the system what you want to grow.",
    description: "A few onboarding choices personalize the workspace and the first content session.",
    nextStep: "intent",
  };
}

function buildSuggestedRoute(profile: OnboardingProfile): string {
  return profile.status === "completed" ? "/dashboard" : "/onboarding";
}

function uniqueValues<TValue extends string>(values: TValue[]): TValue[] {
  return [...new Set(values)];
}

function parseOptionalDate(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    throw new HttpError(400, "bad_request", "scheduledFor must be a valid ISO date.");
  }

  return parsed.toISOString();
}

async function loadOnboardingProfile(userId: string): Promise<OnboardingProfile | null> {
  const result = await queryDb<OnboardingProfileRow>(
    `
      select
        id,
        user_id,
        business_id,
        status,
        current_step,
        use_case,
        target_channels,
        goals,
        preferred_tone,
        first_content_generated_at,
        first_content_copied_at,
        first_channel_connected_at,
        first_content_scheduled_at,
        completed_at,
        created_at,
        updated_at
      from onboarding_profiles
      where user_id = $1
      limit 1
    `,
    [userId],
  );

  return result.rows[0] ? mapOnboardingProfile(result.rows[0]) : null;
}

async function loadBrandProfile(businessId: string): Promise<BrandProfile | null> {
  const result = await queryDb<BrandProfileRow>(
    `
      select
        id,
        business_id,
        industry,
        preferred_tone,
        target_channels,
        goals,
        tone,
        writing_style,
        visual_style,
        topics,
        patterns,
        created_at,
        updated_at
      from brand_profiles
      where business_id = $1
      limit 1
    `,
    [businessId],
  );

  return result.rows[0] ? mapBrandProfile(result.rows[0]) : null;
}

async function persistOnboardingProfile(profile: OnboardingProfile): Promise<OnboardingProfile> {
  const result = await queryDb<OnboardingProfileRow>(
    `
      insert into onboarding_profiles (
        user_id,
        business_id,
        status,
        current_step,
        use_case,
        target_channels,
        goals,
        preferred_tone,
        first_content_generated_at,
        first_content_copied_at,
        first_channel_connected_at,
        first_content_scheduled_at,
        completed_at
      ) values (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6::jsonb,
        $7::jsonb,
        $8,
        $9,
        $10,
        $11,
        $12,
        $13
      )
      on conflict (user_id)
      do update set
        business_id = excluded.business_id,
        status = excluded.status,
        current_step = excluded.current_step,
        use_case = excluded.use_case,
        target_channels = excluded.target_channels,
        goals = excluded.goals,
        preferred_tone = excluded.preferred_tone,
        first_content_generated_at = excluded.first_content_generated_at,
        first_content_copied_at = excluded.first_content_copied_at,
        first_channel_connected_at = excluded.first_channel_connected_at,
        first_content_scheduled_at = excluded.first_content_scheduled_at,
        completed_at = excluded.completed_at,
        updated_at = now()
      returning
        id,
        user_id,
        business_id,
        status,
        current_step,
        use_case,
        target_channels,
        goals,
        preferred_tone,
        first_content_generated_at,
        first_content_copied_at,
        first_channel_connected_at,
        first_content_scheduled_at,
        completed_at,
        created_at,
        updated_at
    `,
    [
      profile.userId,
      profile.businessId ?? null,
      profile.status,
      profile.currentStep,
      profile.useCase ?? null,
      JSON.stringify(profile.targetChannels),
      JSON.stringify(profile.goals),
      profile.preferredTone ?? null,
      profile.firstContentGeneratedAt ?? null,
      profile.firstContentCopiedAt ?? null,
      profile.firstChannelConnectedAt ?? null,
      profile.firstContentScheduledAt ?? null,
      profile.completedAt ?? null,
    ],
  );

  return mapOnboardingProfile(result.rows[0]);
}

async function persistBrandProfile(input: {
  businessId: string;
  industry?: string;
  preferredTone?: BrandTone;
  targetChannels: OnboardingChannel[];
  goals: OnboardingGoal[];
}): Promise<BrandProfile> {
  const normalizedTopics = defaultBrandTopics(input.industry?.trim(), input.goals);
  const normalizedPatterns = defaultBrandPatterns(input.preferredTone);

  const result = await queryDb<BrandProfileRow>(
    `
      insert into brand_profiles (
        business_id,
        industry,
        preferred_tone,
        target_channels,
        goals,
        tone,
        writing_style,
        visual_style,
        topics,
        patterns
      ) values (
        $1,
        $2,
        $3,
        $4::jsonb,
        $5::jsonb,
        $6,
        $7,
        $8,
        $9::jsonb,
        $10::jsonb
      )
      on conflict (business_id)
      do update set
        industry = excluded.industry,
        preferred_tone = excluded.preferred_tone,
        target_channels = excluded.target_channels,
        goals = excluded.goals,
        tone = coalesce(brand_profiles.tone, excluded.tone),
        writing_style = coalesce(brand_profiles.writing_style, excluded.writing_style),
        visual_style = coalesce(brand_profiles.visual_style, excluded.visual_style),
        topics = case
          when jsonb_array_length(brand_profiles.topics) = 0 then excluded.topics
          else brand_profiles.topics
        end,
        patterns = case
          when jsonb_array_length(brand_profiles.patterns) = 0 then excluded.patterns
          else brand_profiles.patterns
        end,
        updated_at = now()
      returning
        id,
        business_id,
        industry,
        preferred_tone,
        target_channels,
        goals,
        tone,
        writing_style,
        visual_style,
        topics,
        patterns,
        created_at,
        updated_at
    `,
    [
      input.businessId,
      input.industry?.trim() || null,
      input.preferredTone ?? null,
      JSON.stringify(uniqueValues(input.targetChannels)),
      JSON.stringify(uniqueValues(input.goals)),
      defaultBrandTone(input.preferredTone) ?? null,
      defaultBrandWritingStyle(input.preferredTone),
      defaultBrandVisualStyle(input.preferredTone),
      JSON.stringify(normalizedTopics),
      JSON.stringify(normalizedPatterns),
    ],
  );

  return mapBrandProfile(result.rows[0]);
}

function mergeOnboardingProfile(
  existing: OnboardingProfile | null,
  input: Partial<OnboardingProfile> & { userId: string },
): OnboardingProfile {
  const base = existing ?? buildDefaultOnboardingProfile(input.userId);

  return {
    ...base,
    ...input,
    businessId: input.businessId ?? base.businessId,
    useCase: input.useCase ?? base.useCase,
    targetChannels: input.targetChannels ?? base.targetChannels,
    goals: input.goals ?? base.goals,
    preferredTone: input.preferredTone ?? base.preferredTone,
    firstContentGeneratedAt: input.firstContentGeneratedAt ?? base.firstContentGeneratedAt,
    firstContentCopiedAt: input.firstContentCopiedAt ?? base.firstContentCopiedAt,
    firstChannelConnectedAt: input.firstChannelConnectedAt ?? base.firstChannelConnectedAt,
    firstContentScheduledAt: input.firstContentScheduledAt ?? base.firstContentScheduledAt,
    completedAt: input.completedAt ?? base.completedAt,
  };
}

function assertPreferences(input: SaveOnboardingPreferencesRequest): void {
  if (!input.useCase) {
    throw new HttpError(400, "bad_request", "useCase is required.");
  }

  if (!input.targetChannels.length) {
    throw new HttpError(400, "bad_request", "Select at least one target channel.");
  }

  if (!input.goals.length) {
    throw new HttpError(400, "bad_request", "Select at least one growth goal.");
  }
}

export async function getOnboardingStatus(
  principal: AuthenticatedPrincipal,
): Promise<OnboardingStatusResponse> {
  const session = await getAppSession(principal);
  const userId = session.user.id;
  const onboarding = (await loadOnboardingProfile(userId)) ?? buildDefaultOnboardingProfile(userId);
  const membership = onboarding.businessId
    ? session.businesses.find((candidate) => candidate.businessId === onboarding.businessId)
    : undefined;
  const brandProfile = onboarding.businessId ? await loadBrandProfile(onboarding.businessId) : null;

  return {
    onboarding,
    membership,
    business: membership?.business,
    brandProfile: brandProfile ?? undefined,
    shouldShowOnboarding: onboarding.status !== "completed",
    suggestedRoute: buildSuggestedRoute(onboarding),
    recommendation: buildRecommendation(onboarding),
  };
}

export async function startOnboarding(
  principal: AuthenticatedPrincipal,
  input: StartOnboardingRequest,
): Promise<StartOnboardingResponse> {
  const session = await getAppSession(principal);
  const userId = session.user.id;
  const existing = await loadOnboardingProfile(userId);

  if (existing?.status === "completed") {
    return { onboarding: existing };
  }

  const onboarding = await persistOnboardingProfile(
    mergeOnboardingProfile(existing, {
      userId,
      status: "in_progress",
      currentStep: existing?.currentStep ?? "intent",
    }),
  );

  await safeLogEvent("onboarding_started", userId, onboarding.businessId, {
    route: "/api/onboarding/start",
    entryPoint: input.entryPoint?.trim() || "unknown",
  });

  logInfo("Started onboarding flow.", {
    userId,
    currentStep: onboarding.currentStep,
  });

  return { onboarding };
}

export async function saveOnboardingPreferences(
  principal: AuthenticatedPrincipal,
  input: SaveOnboardingPreferencesRequest,
): Promise<SaveOnboardingPreferencesResponse> {
  assertPreferences(input);

  const session = await getAppSession(principal);
  const userId = session.user.id;
  const existing = await loadOnboardingProfile(userId);

  const onboarding = await persistOnboardingProfile(
    mergeOnboardingProfile(existing, {
      userId,
      status: existing?.status === "completed" ? "completed" : "in_progress",
      currentStep:
        existing?.status === "completed" ? "completed" : existing?.businessId ? "generate" : "workspace",
      useCase: input.useCase,
      targetChannels: uniqueValues(input.targetChannels),
      goals: uniqueValues(input.goals),
      preferredTone: input.preferredTone,
    }),
  );

  if (onboarding.businessId) {
    await persistBrandProfile({
      businessId: onboarding.businessId,
      industry: (await loadBrandProfile(onboarding.businessId))?.industry,
      preferredTone: onboarding.preferredTone,
      targetChannels: onboarding.targetChannels,
      goals: onboarding.goals,
    });
  }

  return { onboarding };
}

export async function createOnboardingWorkspace(
  principal: AuthenticatedPrincipal,
  input: CreateOnboardingWorkspaceRequest,
): Promise<CreateOnboardingWorkspaceResponse> {
  const name = input.name?.trim();

  if (!name) {
    throw new HttpError(400, "bad_request", "name is required.");
  }

  const session = await getAppSession(principal);
  const userId = session.user.id;
  const existing = await loadOnboardingProfile(userId);
  const createdBusiness = await createBusinessForUser(principal, {
    name,
    brandName: name,
    websiteUrl: input.websiteUrl?.trim(),
    timezone: input.timezone?.trim(),
    niche: input.industry?.trim(),
  });

  const onboarding = await persistOnboardingProfile(
    mergeOnboardingProfile(existing, {
      userId,
      businessId: createdBusiness.business.id,
      status: existing?.status === "completed" ? "completed" : "in_progress",
      currentStep: existing?.status === "completed" ? "completed" : "generate",
      preferredTone: input.tone ?? existing?.preferredTone,
    }),
  );

  const brandProfile = await persistBrandProfile({
    businessId: createdBusiness.business.id,
    industry: input.industry?.trim(),
    preferredTone: input.tone ?? onboarding.preferredTone,
    targetChannels: onboarding.targetChannels,
    goals: onboarding.goals,
  });

  await safeLogEvent("workspace_created", userId, createdBusiness.business.id, {
    route: "/api/onboarding/workspace",
    source: "onboarding",
  });

  return {
    onboarding,
    brandProfile,
    business: createdBusiness.business,
    membership: createdBusiness.membership,
  };
}

export async function completeOnboarding(
  principal: AuthenticatedPrincipal,
  input: CompleteOnboardingRequest,
): Promise<CompleteOnboardingResponse> {
  const session = await getAppSession(principal);
  const userId = session.user.id;
  const existing = await loadOnboardingProfile(userId);

  if (!existing) {
    throw new HttpError(400, "bad_request", "Onboarding has not been started.");
  }

  const businessId = input.businessId?.trim() || existing.businessId;

  if (!businessId) {
    throw new HttpError(400, "bad_request", "businessId is required to complete onboarding.");
  }

  const scheduledFor = parseOptionalDate(input.scheduledFor?.trim());
  const now = new Date().toISOString();
  const firstContentGeneratedAt =
    existing.firstContentGeneratedAt ?? (input.firstContentGenerated ? now : undefined);
  const firstContentCopiedAt =
    existing.firstContentCopiedAt ?? (input.firstContentCopied ? now : undefined);
  const firstChannelConnectedAt =
    existing.firstChannelConnectedAt ?? (input.connectedChannel ? now : undefined);
  const firstContentScheduledAt =
    existing.firstContentScheduledAt ?? (scheduledFor ? now : undefined);

  const onboarding = await persistOnboardingProfile(
    mergeOnboardingProfile(existing, {
      userId,
      businessId,
      status: "completed",
      currentStep: "completed",
      firstContentGeneratedAt,
      firstContentCopiedAt,
      firstChannelConnectedAt,
      firstContentScheduledAt,
      completedAt: existing.completedAt ?? now,
    }),
  );

  const eventPromises: Promise<unknown>[] = [];

  if (input.firstContentGenerated && !existing.firstContentGeneratedAt) {
    eventPromises.push(
      safeLogEvent("first_content_generated", userId, businessId, {
        route: "/api/onboarding/complete",
      }),
    );
  }

  if (input.firstContentCopied && !existing.firstContentCopiedAt) {
    eventPromises.push(
      safeLogEvent("first_content_copied", userId, businessId, {
        route: "/api/onboarding/complete",
      }),
    );
  }

  if (input.connectedChannel && !existing.firstChannelConnectedAt) {
    eventPromises.push(
      safeLogEvent("first_channel_connected", userId, businessId, {
        route: "/api/onboarding/complete",
        channel: input.connectedChannel,
      }),
    );
  }

  if (scheduledFor && !existing.firstContentScheduledAt) {
    eventPromises.push(
      safeLogEvent("first_content_scheduled", userId, businessId, {
        route: "/api/onboarding/complete",
        scheduledFor,
      }),
    );
  }

  if (!existing.completedAt) {
    eventPromises.push(
      safeLogEvent("onboarding_completed", userId, businessId, {
        route: "/api/onboarding/complete",
      }),
    );
  }

  await Promise.all(eventPromises);

  return { onboarding };
}
