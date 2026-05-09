import type { AuthenticatedPrincipal } from "../middleware/auth.ts";
import { requireBusinessMembership } from "./authBusinessService.ts";
import {
  getBusinessAccessState,
  incrementBusinessGenerationUsage,
  incrementBusinessDailyUsage,
  isFeatureEnabled,
  trackBusinessGenerationUsage,
} from "./adminControlService.ts";
import { HttpError } from "../utils/http.ts";

export type WorkspaceFeatureKey =
  | "content_generation"
  | "capture_remix"
  | "visual_generation"
  | "scheduler"
  | "control_dashboard"
  | "brand_intelligence"
  | "outreach"
  | "email_campaigns"
  | "blog_publishing";

export type WorkspaceUsageMetric = "generations" | "posts" | "emails" | "outreach";

function isFutureTimestamp(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  return new Date(value).getTime() > Date.now();
}

export async function enforceWorkspaceReadAccess(
  principal: AuthenticatedPrincipal | undefined,
  businessId: string | undefined,
  featureKey?: WorkspaceFeatureKey,
): Promise<void> {
  if (!businessId) {
    return;
  }

  if (!principal) {
    throw new HttpError(401, "auth_required", "Authentication is required for workspace actions.");
  }

  if (principal.isSuperAdmin) {
    return;
  }

  await requireBusinessMembership(principal, businessId);
  const access = await getBusinessAccessState(businessId);

  if (
    !access.isActive &&
    !isFutureTimestamp(access.trialEndsAt) &&
    !isFutureTimestamp(access.graceUntil)
  ) {
    throw new HttpError(
      403,
      "workspace_access_disabled",
      "This workspace is currently disabled.",
    );
  }

  if (featureKey) {
    const enabled = await isFeatureEnabled({
      key: featureKey,
      businessId,
      userId: principal.userId,
    });

    if (!enabled) {
      throw new HttpError(
        403,
        "feature_not_enabled",
        `Feature ${featureKey} is not enabled for this workspace.`,
      );
    }
  }
}

export async function enforceWorkspaceWriteAccess(input: {
  principal: AuthenticatedPrincipal | undefined;
  businessId?: string;
  featureKey: WorkspaceFeatureKey;
  usageMetric?: WorkspaceUsageMetric;
  usageQuantity?: number;
}): Promise<void> {
  const { principal, businessId, featureKey, usageMetric, usageQuantity } = input;

  if (!businessId) {
    return;
  }

  await enforceWorkspaceReadAccess(principal, businessId, featureKey);

  if (principal?.isSuperAdmin) {
    return;
  }

  const readOnly = await isFeatureEnabled({
    key: "system_read_only",
    businessId,
    userId: principal?.userId,
  });

  if (readOnly) {
    throw new HttpError(
      503,
      "system_read_only",
      "The system is temporarily in read-only mode. Try again shortly.",
    );
  }

  if (usageMetric) {
    if (usageMetric === "generations") {
      const access = await getBusinessAccessState(businessId);

      if (access.unlimitedGenerations) {
        await trackBusinessGenerationUsage(businessId, usageQuantity);
        return;
      }

      await incrementBusinessGenerationUsage(businessId, usageQuantity);
      return;
    }

    await incrementBusinessDailyUsage(businessId, usageMetric, usageQuantity);
  }
}
