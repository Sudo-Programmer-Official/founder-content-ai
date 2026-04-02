import type {
  AuthenticatedPrincipal,
} from "../middleware/auth.ts";
import type {
  BusinessMembership,
  MyFeaturesResponse,
  ProductAccessLimits,
  ProductAccessState,
  ProductFeatureKey,
  ProductFeatureMap,
} from "../../../../packages/shared-types/index.ts";
import { getAppSession } from "./authBusinessService.ts";
import {
  getBusinessAccessState,
  getBusinessGenerationUsageSnapshot,
  isFeatureEnabled,
  resolveScheduledQueueLimit,
} from "./adminControlService.ts";
import { queryDb } from "./db/client.ts";

const PRODUCT_FEATURE_KEYS: ProductFeatureKey[] = [
  "content_generation",
  "capture_remix",
  "visual_generation",
  "scheduler",
  "control_dashboard",
  "brand_intelligence",
  "outreach",
  "email_campaigns",
  "system_read_only",
];

function buildDisabledFeatureMap(): ProductFeatureMap {
  return PRODUCT_FEATURE_KEYS.reduce<ProductFeatureMap>(
    (accumulator, key) => {
      accumulator[key] = false;
      return accumulator;
    },
    {
      content_generation: false,
      capture_remix: false,
      visual_generation: false,
      scheduler: false,
      control_dashboard: false,
      brand_intelligence: false,
      outreach: false,
      email_campaigns: false,
      system_read_only: false,
    },
  );
}

async function loadScheduledQueueUsage(businessId: string): Promise<number> {
  const result = await queryDb<{ total: string | number }>(
    `
      select count(*)::int as total
      from scheduled_posts
      where business_id = $1
        and platform in ('linkedin', 'instagram')
        and status in ('scheduled', 'processing', 'paused', 'failed')
    `,
    [businessId],
  );

  const parsed = Number(result.rows[0]?.total ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function mapLimits(
  access: ProductAccessState,
  scheduledQueueUsed: number,
  generationUsage: { generationsLimit: number | null; generationsUsed: number },
): ProductAccessLimits {
  const scheduledQueueLimit = resolveScheduledQueueLimit(access.planCode);

  return {
    generationDailyLimit: access.dailyLimits.generationsLimit,
    generationDailyUsed: access.dailyLimits.generationsUsed,
    generationDailyRemaining: Math.max(
      0,
      access.dailyLimits.generationsLimit - access.dailyLimits.generationsUsed,
    ),
    generationMonthlyLimit: generationUsage.generationsLimit,
    generationMonthlyUsed: generationUsage.generationsUsed,
    generationMonthlyRemaining:
      generationUsage.generationsLimit === null
        ? null
        : Math.max(0, generationUsage.generationsLimit - generationUsage.generationsUsed),
    postsLimit: access.dailyLimits.postsLimit,
    postsUsed: access.dailyLimits.postsUsed,
    postsRemaining: Math.max(0, access.dailyLimits.postsLimit - access.dailyLimits.postsUsed),
    scheduledQueueLimit,
    scheduledQueueUsed,
    scheduledQueueRemaining:
      scheduledQueueLimit === null
        ? null
        : Math.max(0, scheduledQueueLimit - scheduledQueueUsed),
    emailsLimit: access.dailyLimits.emailsLimit,
    emailsUsed: access.dailyLimits.emailsUsed,
    emailsRemaining: Math.max(0, access.dailyLimits.emailsLimit - access.dailyLimits.emailsUsed),
    outreachLimit: access.dailyLimits.outreachLimit,
    outreachUsed: access.dailyLimits.outreachUsed,
    outreachRemaining: Math.max(0, access.dailyLimits.outreachLimit - access.dailyLimits.outreachUsed),
  };
}

function resolveMembership(
  memberships: BusinessMembership[],
  requestedBusinessId?: string,
): BusinessMembership | null {
  const normalizedBusinessId = requestedBusinessId?.trim();

  if (normalizedBusinessId) {
    const matchingMembership = memberships.find(
      (membership) => membership.businessId === normalizedBusinessId,
    );

    if (matchingMembership) {
      return matchingMembership;
    }
  }

  return memberships[0] ?? null;
}

export async function getProductAccessBootstrap(
  principal: AuthenticatedPrincipal,
  requestedBusinessId?: string,
): Promise<MyFeaturesResponse> {
  const session = await getAppSession(principal);
  const membership = resolveMembership(session.businesses, requestedBusinessId);

  if (!membership) {
    return {
      businessId: null,
      activeBusinessId: null,
      isPlatformAdmin: principal.isSuperAdmin,
      features: buildDisabledFeatureMap(),
    };
  }

  const businessId = membership.businessId;
  const featureEntries = await Promise.all(
    PRODUCT_FEATURE_KEYS.map(async (key) => [
      key,
      await isFeatureEnabled({
        key,
        businessId,
        userId: session.user.id,
      }),
    ] as const),
  );
  const readOnly = featureEntries.find(([key]) => key === "system_read_only")?.[1] ?? false;
  const featureMap = Object.fromEntries(featureEntries) as ProductFeatureMap;
  const [workspaceAccess, scheduledQueueUsed, generationUsage] = await Promise.all([
    getBusinessAccessState(businessId),
    loadScheduledQueueUsage(businessId),
    getBusinessGenerationUsageSnapshot(businessId),
  ]);
  const access: ProductAccessState = {
    ...workspaceAccess,
    readOnly,
  };

  return {
    businessId,
    activeBusinessId: businessId,
    isPlatformAdmin: principal.isSuperAdmin,
    features: featureMap,
    limits: mapLimits(access, scheduledQueueUsed, generationUsage),
    access,
  };
}
