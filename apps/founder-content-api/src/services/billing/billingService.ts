import type { QueryResultRow } from "pg";
import type {
  AuthenticatedPrincipal,
} from "../../middleware/auth.ts";
import type {
  BillingOverviewResponse,
  BillingPlanOption,
  BillingSubscriptionSummary,
  BusinessMembership,
  BusinessPlanCode,
  CreateBillingCheckoutSessionRequest,
  CreateBillingCheckoutSessionResponse,
  CreateBillingPortalSessionRequest,
  CreateBillingPortalSessionResponse,
} from "../../../../../packages/shared-types/index.ts";
import { getAppSession, requireBusinessMembership } from "../authBusinessService.ts";
import { getProductAccessBootstrap } from "../productAccessService.ts";
import { queryDb, withDbTransaction } from "../db/client.ts";
import { HttpError } from "../../utils/http.ts";
import { logInfo, logWarn } from "../../utils/logger.ts";
import {
  extractStripeSubscriptionPriceId,
  stripeApiRequest,
  type StripeCheckoutSession,
  type StripeEvent,
  type StripeSubscription,
  verifyStripeWebhookEvent,
} from "./stripe.ts";

interface BillingSubscriptionRow extends QueryResultRow {
  id: string;
  business_id: string;
  provider: string;
  provider_subscription_id: string;
  provider_customer_id: string | null;
  provider_price_id: string | null;
  provider_checkout_session_id: string | null;
  status: string;
  current_period_start: Date | string | null;
  current_period_end: Date | string | null;
  cancel_at_period_end: boolean;
  created_at: Date | string;
  updated_at: Date | string;
  plan_code: BusinessPlanCode | null;
}

interface BillingPlanRow extends QueryResultRow {
  id: string;
  code: BusinessPlanCode;
}

interface BillingBusinessRow extends QueryResultRow {
  plan_code: BusinessPlanCode;
}

interface StripeSubscriptionLookupRow extends QueryResultRow {
  business_id: string;
  provider_price_id: string | null;
  provider_customer_id: string | null;
  plan_code: BusinessPlanCode | null;
}

interface BillingPlanBlueprint {
  planCode: BusinessPlanCode;
  label: string;
  description: string;
  priceMonthlyCents: number;
  priceDisplay: string;
  ctaLabel: string;
  highlights: string[];
  envPriceKey?: "STRIPE_STARTER_PRICE_ID" | "STRIPE_PRO_PRICE_ID";
}

const BILLING_DEFAULT_RETURN_PATH = "/app/billing";

const BILLING_PLAN_BLUEPRINTS: BillingPlanBlueprint[] = [
  {
    planCode: "free",
    label: "Free",
    description: "Publish a little, test the workflow, and feel the scheduling loop.",
    priceMonthlyCents: 0,
    priceDisplay: "$0",
    ctaLabel: "Always included",
    highlights: [
      "2 posts per day",
      "1 scheduled post in queue",
      "Basic best-time preview",
    ],
  },
  {
    planCode: "pro",
    label: "Starter",
    description: "Unlock the weekly content system and keep the publishing queue moving.",
    priceMonthlyCents: 900,
    priceDisplay: "$9/mo",
    ctaLabel: "Upgrade to Starter",
    envPriceKey: "STRIPE_STARTER_PRICE_ID",
    highlights: [
      "5 posts per day",
      "Unlimited scheduling queue",
      "Smart timing guidance",
    ],
  },
  {
    planCode: "growth",
    label: "Pro",
    description: "Run the full engine with advanced timing and broader workspace capacity.",
    priceMonthlyCents: 1900,
    priceDisplay: "$19/mo",
    ctaLabel: "Upgrade to Pro",
    envPriceKey: "STRIPE_PRO_PRICE_ID",
    highlights: [
      "Unlimited posting rhythm",
      "Advanced scheduling windows",
      "Analytics-ready growth workflow",
    ],
  },
  {
    planCode: "custom",
    label: "Custom",
    description: "Operator-grade setup for larger teams, overrides, and white-glove support.",
    priceMonthlyCents: 0,
    priceDisplay: "Custom",
    ctaLabel: "Contact support",
    highlights: [
      "Custom limits and workflows",
      "Team access and overrides",
      "Priority support",
    ],
  },
];

function toIsoString(value: Date | string | null | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  return new Date(value).toISOString();
}

function normalizeBusinessId(value: string): string {
  const normalized = value.trim();

  if (!normalized) {
    throw new HttpError(400, "business_id_required", "Workspace id is required.");
  }

  return normalized;
}

function normalizeReturnPath(value: string | undefined): string {
  const normalized = value?.trim();

  if (
    normalized &&
    normalized.startsWith("/") &&
    !normalized.startsWith("//")
  ) {
    return normalized;
  }

  return BILLING_DEFAULT_RETURN_PATH;
}

function resolveFrontendOrigin(): string {
  const configuredOrigin = (process.env.FRONTEND_ORIGIN ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .find(Boolean);

  return configuredOrigin ?? "https://foundercontent.ai";
}

function buildReturnUrl(returnPath: string | undefined, state: "success" | "canceled" | "portal"): string {
  const url = new URL(resolveFrontendOrigin());
  url.pathname = normalizeReturnPath(returnPath);

  if (state === "success") {
    url.searchParams.set("checkout", "success");
  } else if (state === "canceled") {
    url.searchParams.set("checkout", "canceled");
  } else if (state === "portal") {
    url.searchParams.set("portal", "return");
  }

  return url.toString();
}

function resolveBillingPlanLabel(planCode: BusinessPlanCode): string {
  return (
    BILLING_PLAN_BLUEPRINTS.find((plan) => plan.planCode === planCode)?.label ??
    BILLING_PLAN_BLUEPRINTS[0].label
  );
}

function resolveStripePriceId(planCode: BusinessPlanCode): string | undefined {
  const blueprint = BILLING_PLAN_BLUEPRINTS.find((plan) => plan.planCode === planCode);

  if (!blueprint?.envPriceKey) {
    return undefined;
  }

  const priceId = process.env[blueprint.envPriceKey]?.trim();
  return priceId || undefined;
}

function resolvePlanCodeFromStripePriceId(priceId: string): BusinessPlanCode | null {
  const normalized = priceId.trim();

  if (!normalized) {
    return null;
  }

  for (const blueprint of BILLING_PLAN_BLUEPRINTS) {
    const candidatePriceId = blueprint.envPriceKey ? process.env[blueprint.envPriceKey]?.trim() : undefined;

    if (candidatePriceId && candidatePriceId === normalized) {
      return blueprint.planCode;
    }
  }

  return null;
}

function isStripeSubscriptionEntitled(status: string): boolean {
  return ["active", "trialing", "past_due"].includes(status);
}

function requireBillingManagerRole(membership: BusinessMembership): void {
  if (membership.role === "owner" || membership.role === "admin") {
    return;
  }

  throw new HttpError(
    403,
    "billing_forbidden",
    "Only workspace owners or admins can manage billing.",
  );
}

async function loadLatestStripeSubscription(
  businessId: string,
): Promise<BillingSubscriptionRow | null> {
  const result = await queryDb<BillingSubscriptionRow>(
    `
      select
        s.id,
        s.business_id,
        s.provider,
        s.provider_subscription_id,
        s.provider_customer_id,
        s.provider_price_id,
        s.provider_checkout_session_id,
        s.status,
        s.current_period_start,
        s.current_period_end,
        s.cancel_at_period_end,
        s.created_at,
        s.updated_at,
        p.code as plan_code
      from subscriptions s
      inner join plans p on p.id = s.plan_id
      where s.business_id = $1
        and s.provider = 'stripe'
      order by
        case
          when s.status in ('active', 'trialing', 'past_due') then 0
          when s.status in ('canceled') then 2
          else 1
        end,
        coalesce(s.current_period_end, s.updated_at, s.created_at) desc,
        s.updated_at desc,
        s.created_at desc
      limit 1
    `,
    [businessId],
  );

  return result.rows[0] ?? null;
}

async function loadBillingBusinessPlan(businessId: string): Promise<BusinessPlanCode> {
  const result = await queryDb<BillingBusinessRow>(
    `
      select plan_code
      from businesses
      where id = $1
      limit 1
    `,
    [businessId],
  );
  const row = result.rows[0];

  if (!row) {
    throw new HttpError(404, "business_not_found", "Workspace not found.");
  }

  return row.plan_code;
}

function mapSubscriptionSummary(
  subscription: BillingSubscriptionRow | null,
): BillingSubscriptionSummary | undefined {
  if (!subscription) {
    return undefined;
  }

  return {
    provider: "stripe",
    status: subscription.status,
    currentPeriodStart: toIsoString(subscription.current_period_start),
    currentPeriodEnd: toIsoString(subscription.current_period_end),
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    portalAvailable: Boolean(subscription.provider_customer_id),
  };
}

function buildBillingPlans(currentPlanCode: BusinessPlanCode): BillingPlanOption[] {
  return BILLING_PLAN_BLUEPRINTS.map((blueprint) => {
    const current = blueprint.planCode === currentPlanCode;
    let ctaLabel = blueprint.ctaLabel;

    if (current) {
      ctaLabel = "Current plan";
    } else if (currentPlanCode !== "free" && blueprint.planCode !== "custom" && blueprint.planCode !== "free") {
      ctaLabel = `Switch to ${blueprint.label} in billing`;
    }

    return {
      planCode: blueprint.planCode,
      label: blueprint.label,
      description: blueprint.description,
      priceMonthlyCents: blueprint.priceMonthlyCents,
      priceDisplay: blueprint.priceDisplay,
      priceId: resolveStripePriceId(blueprint.planCode),
      ctaLabel,
      highlights: blueprint.highlights,
      current,
    };
  });
}

async function resolvePlanId(planCode: BusinessPlanCode): Promise<string> {
  const result = await queryDb<BillingPlanRow>(
    `
      select id, code
      from plans
      where code = $1
      limit 1
    `,
    [planCode],
  );
  const row = result.rows[0];

  if (!row) {
    throw new HttpError(500, "billing_plan_missing", "Billing plan configuration is missing.");
  }

  return row.id;
}

function toStripeTimestampDate(value: number | null | undefined): string | null {
  if (!value || !Number.isFinite(value)) {
    return null;
  }

  return new Date(value * 1000).toISOString();
}

async function syncStripeSubscriptionRecord(
  subscription: StripeSubscription,
  options?: {
    businessId?: string;
    checkoutSessionId?: string;
  },
): Promise<void> {
  await withDbTransaction(async (client) => {
    const existingResult = await client.query<StripeSubscriptionLookupRow>(
      `
        select
          s.business_id,
          s.provider_price_id,
          s.provider_customer_id,
          p.code as plan_code
        from subscriptions s
        inner join plans p on p.id = s.plan_id
        where s.provider = 'stripe'
          and s.provider_subscription_id = $1
        limit 1
      `,
      [subscription.id],
    );
    const existing = existingResult.rows[0];
    const businessId =
      subscription.metadata?.businessId?.trim() ||
      options?.businessId?.trim() ||
      existing?.business_id?.trim();

    if (!businessId) {
      throw new HttpError(
        400,
        "stripe_business_missing",
        "Stripe subscription metadata does not include a workspace id.",
      );
    }

    const providerPriceId =
      extractStripeSubscriptionPriceId(subscription) ||
      existing?.provider_price_id?.trim() ||
      undefined;
    const subscribedPlanCode =
      (providerPriceId ? resolvePlanCodeFromStripePriceId(providerPriceId) : null) ||
      existing?.plan_code ||
      "free";

    if (isStripeSubscriptionEntitled(subscription.status) && subscribedPlanCode === "free") {
      throw new HttpError(
        500,
        "stripe_price_mapping_missing",
        "Stripe price id is not mapped to an internal billing plan.",
      );
    }

    const effectivePlanCode = isStripeSubscriptionEntitled(subscription.status)
      ? subscribedPlanCode
      : "free";
    const planId = await resolvePlanId(subscribedPlanCode);

    await client.query(
      `
        insert into subscriptions (
          business_id,
          plan_id,
          provider,
          provider_subscription_id,
          provider_customer_id,
          provider_price_id,
          provider_checkout_session_id,
          status,
          current_period_start,
          current_period_end,
          cancel_at_period_end,
          metadata_json,
          created_at,
          updated_at
        ) values (
          $1,
          $2,
          'stripe',
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9,
          $10,
          $11::jsonb,
          now(),
          now()
        )
        on conflict (provider_subscription_id)
        do update set
          business_id = excluded.business_id,
          plan_id = excluded.plan_id,
          provider_customer_id = excluded.provider_customer_id,
          provider_price_id = excluded.provider_price_id,
          provider_checkout_session_id = coalesce(excluded.provider_checkout_session_id, subscriptions.provider_checkout_session_id),
          status = excluded.status,
          current_period_start = excluded.current_period_start,
          current_period_end = excluded.current_period_end,
          cancel_at_period_end = excluded.cancel_at_period_end,
          metadata_json = excluded.metadata_json,
          updated_at = now()
      `,
      [
        businessId,
        planId,
        subscription.id,
        subscription.customer?.trim() || existing?.provider_customer_id || null,
        providerPriceId ?? null,
        options?.checkoutSessionId?.trim() || null,
        subscription.status,
        toStripeTimestampDate(subscription.current_period_start),
        toStripeTimestampDate(subscription.current_period_end),
        Boolean(subscription.cancel_at_period_end),
        JSON.stringify(subscription.metadata ?? {}),
      ],
    );

    await client.query(
      `
        update businesses
        set
          plan_code = $2,
          updated_at = now()
        where id = $1
      `,
      [businessId, effectivePlanCode],
    );
  });
}

export async function getBillingOverview(
  principal: AuthenticatedPrincipal,
  businessId: string,
): Promise<BillingOverviewResponse> {
  const normalizedBusinessId = normalizeBusinessId(businessId);
  const membership = await requireBusinessMembership(principal, normalizedBusinessId);
  const [accessBootstrap, subscription] = await Promise.all([
    getProductAccessBootstrap(principal, normalizedBusinessId),
    loadLatestStripeSubscription(normalizedBusinessId),
  ]);
  const currentPlanCode = accessBootstrap.access?.planCode ?? "free";

  return {
    businessId: normalizedBusinessId,
    workspaceName: membership.business.name,
    workspaceSlug: membership.business.slug,
    currentPlanCode,
    currentPlanLabel: resolveBillingPlanLabel(currentPlanCode),
    usage: accessBootstrap.limits ?? null,
    subscription: mapSubscriptionSummary(subscription),
    plans: buildBillingPlans(currentPlanCode),
  };
}

export async function createBillingCheckoutSession(
  principal: AuthenticatedPrincipal,
  input: CreateBillingCheckoutSessionRequest,
): Promise<CreateBillingCheckoutSessionResponse> {
  const businessId = normalizeBusinessId(input.businessId);
  const requestedPriceId = input.priceId?.trim();

  if (!requestedPriceId) {
    throw new HttpError(400, "price_id_required", "Stripe price id is required.");
  }

  const requestedPlanCode = resolvePlanCodeFromStripePriceId(requestedPriceId);

  if (!requestedPlanCode || requestedPlanCode === "free" || requestedPlanCode === "custom") {
    throw new HttpError(400, "price_id_invalid", "Selected billing plan is not available.");
  }

  const [membership, appSession, currentPlanCode, subscription] = await Promise.all([
    requireBusinessMembership(principal, businessId),
    getAppSession(principal),
    loadBillingBusinessPlan(businessId),
    loadLatestStripeSubscription(businessId),
  ]);
  requireBillingManagerRole(membership);

  if (currentPlanCode === requestedPlanCode) {
    throw new HttpError(
      409,
      "plan_already_active",
      `${resolveBillingPlanLabel(requestedPlanCode)} is already active for this workspace.`,
    );
  }

  if (currentPlanCode === "custom") {
    throw new HttpError(
      409,
      "billing_contact_support",
      "Custom workspaces are managed manually. Contact support to change billing.",
    );
  }

  if (subscription && isStripeSubscriptionEntitled(subscription.status)) {
    throw new HttpError(
      409,
      "billing_portal_required",
      "This workspace already has an active Stripe subscription. Use billing management to change plans.",
      {
        portalAvailable: Boolean(subscription.provider_customer_id),
      },
    );
  }

  const checkoutSession = await stripeApiRequest<StripeCheckoutSession>("/checkout/sessions", {
    body: {
      mode: "subscription",
      allow_promotion_codes: true,
      client_reference_id: businessId,
      success_url: buildReturnUrl(input.returnPath, "success"),
      cancel_url: buildReturnUrl(input.returnPath, "canceled"),
      "line_items[0][price]": requestedPriceId,
      "line_items[0][quantity]": 1,
      ...(subscription?.provider_customer_id
        ? {
            customer: subscription.provider_customer_id,
          }
        : {
            customer_email: appSession.user.email,
          }),
      "metadata[businessId]": businessId,
      "metadata[userId]": appSession.user.id,
      "metadata[planCode]": requestedPlanCode,
      "subscription_data[metadata][businessId]": businessId,
      "subscription_data[metadata][userId]": appSession.user.id,
      "subscription_data[metadata][planCode]": requestedPlanCode,
    },
  });

  if (!checkoutSession.url?.trim()) {
    throw new HttpError(
      502,
      "stripe_checkout_missing_url",
      "Stripe checkout did not return a redirect URL.",
    );
  }

  logInfo("Created Stripe checkout session.", {
    businessId,
    requestedPlanCode,
    stripeCheckoutSessionId: checkoutSession.id,
  });

  return {
    url: checkoutSession.url,
  };
}

export async function createBillingPortalSession(
  principal: AuthenticatedPrincipal,
  input: CreateBillingPortalSessionRequest,
): Promise<CreateBillingPortalSessionResponse> {
  const businessId = normalizeBusinessId(input.businessId);
  const [membership, subscription] = await Promise.all([
    requireBusinessMembership(principal, businessId),
    loadLatestStripeSubscription(businessId),
  ]);
  requireBillingManagerRole(membership);

  if (!subscription?.provider_customer_id?.trim()) {
    throw new HttpError(
      409,
      "billing_portal_unavailable",
      "This workspace does not have an active Stripe customer record yet.",
    );
  }

  const portalSession = await stripeApiRequest<{ url?: string | null }>("/billing_portal/sessions", {
    body: {
      customer: subscription.provider_customer_id,
      return_url: buildReturnUrl(input.returnPath, "portal"),
    },
  });

  if (!portalSession.url?.trim()) {
    throw new HttpError(
      502,
      "stripe_portal_missing_url",
      "Stripe billing portal did not return a redirect URL.",
    );
  }

  return {
    url: portalSession.url,
  };
}

async function handleCheckoutCompleted(event: StripeEvent<StripeCheckoutSession>): Promise<void> {
  const checkoutSession = event.data.object;
  const subscriptionId = checkoutSession.subscription?.trim();

  if (!subscriptionId) {
    return;
  }

  const subscription = await stripeApiRequest<StripeSubscription>(`/subscriptions/${subscriptionId}`, {
    method: "GET",
  });
  await syncStripeSubscriptionRecord(subscription, {
    businessId: checkoutSession.metadata?.businessId?.trim() || undefined,
    checkoutSessionId: checkoutSession.id,
  });
}

async function handleSubscriptionEvent(event: StripeEvent<StripeSubscription>): Promise<void> {
  await syncStripeSubscriptionRecord(event.data.object);
}

export async function handleStripeWebhook(payload: Buffer, signatureHeader: string | undefined): Promise<void> {
  const event = verifyStripeWebhookEvent(payload, signatureHeader);

  switch (event.type) {
    case "checkout.session.completed":
      await handleCheckoutCompleted(event as StripeEvent<StripeCheckoutSession>);
      return;
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await handleSubscriptionEvent(event as StripeEvent<StripeSubscription>);
      return;
    default:
      logWarn("Ignored Stripe webhook event.", {
        type: event.type,
      });
  }
}
