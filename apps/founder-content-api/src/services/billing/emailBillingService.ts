import type { PoolClient, QueryResultRow } from "pg";
import type {
  BillingEmailAddonSource,
  BillingEmailAddonSummary,
  BillingEmailAddonTierCode,
  BillingUsageState,
  BusinessPlanCode,
} from "../../../../../packages/shared-types/index.ts";
import { queryDb } from "../db/client.ts";
import { HttpError } from "../../utils/http.ts";

interface EmailBillingConfigRow extends QueryResultRow {
  business_id: string;
  tier_code: BillingEmailAddonTierCode;
  billing_source: BillingEmailAddonSource;
  subscriber_limit: string | number | null;
  monthly_email_limit: string | number | null;
  provider_customer_id: string | null;
  provider_subscription_id: string | null;
  provider_price_id: string | null;
  subscription_status: string | null;
  current_period_start: Date | string | null;
  current_period_end: Date | string | null;
  cancel_at_period_end: boolean;
}

interface CountRow extends QueryResultRow {
  total: string | number;
}

interface BusinessPlanCodeRow extends QueryResultRow {
  plan_code: BusinessPlanCode;
}

interface EmailBillingBlueprint {
  label: string;
  description: string;
  defaultSource: BillingEmailAddonSource;
  defaultSubscriberLimit: number | null;
  defaultMonthlyEmailLimit: number | null;
}

const EMAIL_BILLING_BLUEPRINTS: Record<BillingEmailAddonTierCode, EmailBillingBlueprint> = {
  none: {
    label: "No email add-on",
    description: "Email usage is tracked, but this workspace does not have a metered email allowance attached yet.",
    defaultSource: "manual",
    defaultSubscriberLimit: 0,
    defaultMonthlyEmailLimit: 0,
  },
  starter_email: {
    label: "Starter Email",
    description: "Up to 20K active subscribers and roughly 5 full-list campaigns per month.",
    defaultSource: "bundled",
    defaultSubscriberLimit: 20000,
    defaultMonthlyEmailLimit: 100000,
  },
  growth_email: {
    label: "Growth Email",
    description: "More monthly send room for frequent campaigns without changing the active audience cap.",
    defaultSource: "bundled",
    defaultSubscriberLimit: 20000,
    defaultMonthlyEmailLimit: 300000,
  },
  scale_email: {
    label: "Scale Email",
    description: "High-volume monthly sending for the same active audience cap.",
    defaultSource: "bundled",
    defaultSubscriberLimit: 20000,
    defaultMonthlyEmailLimit: 600000,
  },
  custom: {
    label: "Custom Email",
    description: "Email billing is managed manually for this workspace.",
    defaultSource: "custom",
    defaultSubscriberLimit: null,
    defaultMonthlyEmailLimit: null,
  },
};

const DEFAULT_EMAIL_TIER_BY_PLAN: Record<BusinessPlanCode, BillingEmailAddonTierCode> = {
  free: "none",
  pro: "starter_email",
  growth: "growth_email",
  custom: "custom",
};

function toNumber(value: string | number | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toNullableNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toIsoString(value: Date): string {
  return value.toISOString();
}

async function executeQuery<TRow extends QueryResultRow>(
  text: string,
  values: unknown[],
  client?: PoolClient,
): Promise<{ rows: TRow[] }> {
  if (client) {
    return client.query<TRow>(text, values);
  }

  return queryDb<TRow>(text, values);
}

function buildCalendarMonthWindow(now = new Date()): {
  periodStart: Date;
  periodEnd: Date;
} {
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return {
    periodStart,
    periodEnd,
  };
}

function resolveBillingWindow(
  inputStart?: string,
  inputEnd?: string,
): {
  periodStart: Date;
  periodEnd: Date;
} {
  const parsedStart = inputStart ? new Date(inputStart) : null;
  const parsedEnd = inputEnd ? new Date(inputEnd) : null;

  if (
    parsedStart instanceof Date &&
    parsedEnd instanceof Date &&
    Number.isFinite(parsedStart.getTime()) &&
    Number.isFinite(parsedEnd.getTime()) &&
    parsedEnd.getTime() > parsedStart.getTime()
  ) {
    return {
      periodStart: parsedStart,
      periodEnd: parsedEnd,
    };
  }

  return buildCalendarMonthWindow();
}

async function loadEmailBillingConfig(
  businessId: string,
  client?: PoolClient,
): Promise<EmailBillingConfigRow | null> {
  const result = await executeQuery<EmailBillingConfigRow>(
    `
      select
        business_id,
        tier_code,
        billing_source,
        subscriber_limit,
        monthly_email_limit,
        provider_customer_id,
        provider_subscription_id,
        provider_price_id,
        subscription_status,
        current_period_start,
        current_period_end,
        cancel_at_period_end
      from email_billing_configs
      where business_id = $1::uuid
      limit 1
    `,
    [businessId],
    client,
  );

  return result.rows[0] ?? null;
}

async function ensureEmailBillingConfig(
  businessId: string,
  currentPlanCode: BusinessPlanCode,
  client?: PoolClient,
): Promise<EmailBillingConfigRow> {
  const existing = await loadEmailBillingConfig(businessId, client);

  if (existing) {
    return existing;
  }

  const defaultTier = DEFAULT_EMAIL_TIER_BY_PLAN[currentPlanCode] ?? "none";
  const blueprint = EMAIL_BILLING_BLUEPRINTS[defaultTier];
  const inserted = await executeQuery<EmailBillingConfigRow>(
    `
      insert into email_billing_configs (
        business_id,
        tier_code,
        billing_source,
        subscriber_limit,
        monthly_email_limit,
        provider_customer_id,
        provider_subscription_id,
        provider_price_id,
        subscription_status,
        current_period_start,
        current_period_end,
        cancel_at_period_end
      ) values (
        $1::uuid,
        $2,
        $3,
        $4,
        $5,
        null,
        null,
        null,
        null,
        null,
        null,
        false
      )
      on conflict (business_id) do update
      set updated_at = now()
      returning
        business_id,
        tier_code,
        billing_source,
        subscriber_limit,
        monthly_email_limit,
        provider_customer_id,
        provider_subscription_id,
        provider_price_id,
        subscription_status,
        current_period_start,
        current_period_end,
        cancel_at_period_end
    `,
    [
      businessId,
      defaultTier,
      blueprint.defaultSource,
      blueprint.defaultSubscriberLimit,
      blueprint.defaultMonthlyEmailLimit,
    ],
    client,
  );

  return inserted.rows[0];
}

async function countActiveMailableSubscribers(businessId: string): Promise<number> {
  const result = await executeQuery<CountRow>(
    `
      select count(*)::int as total
      from email_contacts
      where business_id = $1::uuid
        and trim(coalesce(email, '')) <> ''
        and status = 'active'
    `,
    [businessId],
  );

  return toNumber(result.rows[0]?.total);
}

async function countSentRecipientsInPeriod(
  businessId: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<number> {
  const result = await executeQuery<CountRow>(
    `
      select count(*)::int as total
      from email_campaign_recipients r
      inner join email_campaigns c on c.id = r.campaign_id
      where c.business_id = $1::uuid
        and r.sent_at is not null
        and r.sent_at >= $2::timestamptz
        and r.sent_at < $3::timestamptz
    `,
    [businessId, toIsoString(periodStart), toIsoString(periodEnd)],
  );

  return toNumber(result.rows[0]?.total);
}

function resolveUsageState(input: {
  subscriberLimit: number | null;
  currentSubscriberCount: number;
  monthlyEmailLimit: number | null;
  currentPeriodEmailUsage: number;
}): BillingUsageState {
  const { subscriberLimit, currentSubscriberCount, monthlyEmailLimit, currentPeriodEmailUsage } = input;

  const subscriberRatio =
    subscriberLimit && subscriberLimit > 0 ? currentSubscriberCount / subscriberLimit : 0;
  const monthlyRatio =
    monthlyEmailLimit && monthlyEmailLimit > 0 ? currentPeriodEmailUsage / monthlyEmailLimit : 0;

  if (
    (subscriberLimit && subscriberLimit > 0 && currentSubscriberCount > subscriberLimit) ||
    (monthlyEmailLimit && monthlyEmailLimit > 0 && currentPeriodEmailUsage > monthlyEmailLimit)
  ) {
    return "over_limit";
  }

  if (subscriberLimit === 0 && monthlyEmailLimit === 0) {
    return "inactive";
  }

  if (Math.max(subscriberRatio, monthlyRatio) >= 0.8) {
    return "warning";
  }

  return "healthy";
}

export function resolveEmailBillingBlueprint(
  tierCode: BillingEmailAddonTierCode,
): EmailBillingBlueprint {
  return EMAIL_BILLING_BLUEPRINTS[tierCode] ?? EMAIL_BILLING_BLUEPRINTS.none;
}

export function resolveDefaultEmailBillingTierForPlan(
  planCode: BusinessPlanCode,
): BillingEmailAddonTierCode {
  return DEFAULT_EMAIL_TIER_BY_PLAN[planCode] ?? "none";
}

export async function resolveBusinessPlanCode(
  businessId: string,
  client?: PoolClient,
): Promise<BusinessPlanCode> {
  const result = await executeQuery<BusinessPlanCodeRow>(
    `
      select plan_code
      from businesses
      where id = $1::uuid
      limit 1
    `,
    [businessId],
    client,
  );
  const row = result.rows[0];

  if (!row) {
    throw new HttpError(404, "business_not_found", "Workspace not found.");
  }

  return row.plan_code;
}

export async function upsertBillingEmailAddonConfig(
  businessId: string,
  input: {
    tierCode: BillingEmailAddonTierCode;
    source?: BillingEmailAddonSource;
    subscriberLimit?: number;
    monthlyEmailLimit?: number;
    providerCustomerId?: string | null;
    providerSubscriptionId?: string | null;
    providerPriceId?: string | null;
    subscriptionStatus?: string | null;
    currentPeriodStart?: string | null;
    currentPeriodEnd?: string | null;
    cancelAtPeriodEnd?: boolean | null;
    preserveStripeState?: boolean;
  },
  client?: PoolClient,
): Promise<EmailBillingConfigRow> {
  const blueprint = resolveEmailBillingBlueprint(input.tierCode);
  const subscriberLimit =
    input.tierCode === "custom"
      ? input.subscriberLimit ?? null
      : blueprint.defaultSubscriberLimit;
  const monthlyEmailLimit =
    input.tierCode === "custom"
      ? input.monthlyEmailLimit ?? null
      : blueprint.defaultMonthlyEmailLimit;
  const billingSource = input.source ?? blueprint.defaultSource;
  const preserveStripeState = input.preserveStripeState ?? false;

  const result = await executeQuery<EmailBillingConfigRow>(
    `
      insert into email_billing_configs (
        business_id,
        tier_code,
        billing_source,
        subscriber_limit,
        monthly_email_limit,
        provider_customer_id,
        provider_subscription_id,
        provider_price_id,
        subscription_status,
        current_period_start,
        current_period_end,
        cancel_at_period_end,
        created_at,
        updated_at
      ) values (
        $1::uuid,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        $11,
        $12,
        now(),
        now()
      )
      on conflict (business_id) do update
      set
        tier_code = excluded.tier_code,
        billing_source = excluded.billing_source,
        subscriber_limit = excluded.subscriber_limit,
        monthly_email_limit = excluded.monthly_email_limit,
        provider_customer_id = case
          when $13::boolean then email_billing_configs.provider_customer_id
          else excluded.provider_customer_id
        end,
        provider_subscription_id = case
          when $13::boolean then email_billing_configs.provider_subscription_id
          else excluded.provider_subscription_id
        end,
        provider_price_id = case
          when $13::boolean then email_billing_configs.provider_price_id
          else excluded.provider_price_id
        end,
        subscription_status = case
          when $13::boolean then email_billing_configs.subscription_status
          else excluded.subscription_status
        end,
        current_period_start = case
          when $13::boolean then email_billing_configs.current_period_start
          else excluded.current_period_start
        end,
        current_period_end = case
          when $13::boolean then email_billing_configs.current_period_end
          else excluded.current_period_end
        end,
        cancel_at_period_end = case
          when $13::boolean then email_billing_configs.cancel_at_period_end
          else excluded.cancel_at_period_end
        end,
        updated_at = now()
      returning
        business_id,
        tier_code,
        billing_source,
        subscriber_limit,
        monthly_email_limit,
        provider_customer_id,
        provider_subscription_id,
        provider_price_id,
        subscription_status,
        current_period_start,
        current_period_end,
        cancel_at_period_end
    `,
    [
      businessId,
      input.tierCode,
      billingSource,
      subscriberLimit,
      monthlyEmailLimit,
      input.providerCustomerId ?? null,
      input.providerSubscriptionId ?? null,
      input.providerPriceId ?? null,
      input.subscriptionStatus ?? null,
      input.currentPeriodStart ?? null,
      input.currentPeriodEnd ?? null,
      input.cancelAtPeriodEnd ?? false,
      preserveStripeState,
    ],
    client,
  );

  return result.rows[0];
}

export function buildEmailBillingSendWarnings(
  summary: BillingEmailAddonSummary,
  projectedRecipientCount: number,
): string[] {
  const warnings: string[] = [];

  if (summary.subscriberLimit && summary.currentSubscriberCount > summary.subscriberLimit) {
    warnings.push(
      `Active subscribers exceed the ${summary.label} cap (${summary.currentSubscriberCount.toLocaleString()} / ${summary.subscriberLimit.toLocaleString()}). Upgrade before sending more campaigns at scale.`,
    );
  }

  if (summary.monthlyEmailLimit && summary.monthlyEmailLimit > 0) {
    const projectedUsage = summary.currentPeriodEmailUsage + projectedRecipientCount;

    if (projectedUsage > summary.monthlyEmailLimit) {
      warnings.push(
        `This send pushes monthly email usage above the ${summary.label} allowance (${projectedUsage.toLocaleString()} / ${summary.monthlyEmailLimit.toLocaleString()}). Founder Content will still queue it, but billing should be upgraded.`,
      );
    } else if (projectedUsage >= Math.ceil(summary.monthlyEmailLimit * 0.8)) {
      warnings.push(
        `This send brings the workspace close to its monthly email allowance (${projectedUsage.toLocaleString()} / ${summary.monthlyEmailLimit.toLocaleString()}).`,
      );
    }
  }

  return warnings;
}

export async function getBillingEmailAddonSummary(
  businessId: string,
  options: {
    currentPlanCode: BusinessPlanCode;
    currentPeriodStart?: string;
    currentPeriodEnd?: string;
  },
): Promise<BillingEmailAddonSummary> {
  const config = await ensureEmailBillingConfig(businessId, options.currentPlanCode);
  const { periodStart, periodEnd } = resolveBillingWindow(
    config.current_period_start
      ? new Date(config.current_period_start).toISOString()
      : options.currentPeriodStart,
    config.current_period_end
      ? new Date(config.current_period_end).toISOString()
      : options.currentPeriodEnd,
  );
  const counts = await (async () => {
      const [currentSubscriberCount, currentPeriodEmailUsage] = await Promise.all([
        countActiveMailableSubscribers(businessId),
        countSentRecipientsInPeriod(businessId, periodStart, periodEnd),
      ]);

      return {
        periodStart,
        periodEnd,
        currentSubscriberCount,
        currentPeriodEmailUsage,
      };
    })();

  const blueprint = EMAIL_BILLING_BLUEPRINTS[config.tier_code] ?? EMAIL_BILLING_BLUEPRINTS.none;
  const subscriberLimit = toNullableNumber(config.subscriber_limit);
  const monthlyEmailLimit = toNullableNumber(config.monthly_email_limit);
  const fullListCampaignCapacity =
    subscriberLimit && subscriberLimit > 0 && monthlyEmailLimit && monthlyEmailLimit > 0
      ? Math.floor(monthlyEmailLimit / subscriberLimit)
      : null;

  return {
    tierCode: config.tier_code,
    source: config.billing_source,
    label: blueprint.label,
    description: blueprint.description,
    subscriberLimit,
    currentSubscriberCount: counts.currentSubscriberCount,
    subscriberRemaining:
      subscriberLimit && subscriberLimit > 0
        ? Math.max(0, subscriberLimit - counts.currentSubscriberCount)
        : null,
    monthlyEmailLimit,
    currentPeriodEmailUsage: counts.currentPeriodEmailUsage,
    monthlyEmailRemaining:
      monthlyEmailLimit && monthlyEmailLimit > 0
        ? Math.max(0, monthlyEmailLimit - counts.currentPeriodEmailUsage)
        : null,
    fullListCampaignCapacity,
    usageState: resolveUsageState({
      subscriberLimit,
      currentSubscriberCount: counts.currentSubscriberCount,
      monthlyEmailLimit,
      currentPeriodEmailUsage: counts.currentPeriodEmailUsage,
    }),
    billingPeriodStart: toIsoString(counts.periodStart),
    billingPeriodEnd: toIsoString(counts.periodEnd),
    subscriptionStatus: config.subscription_status ?? undefined,
    cancelAtPeriodEnd: Boolean(config.cancel_at_period_end),
    portalAvailable: Boolean(config.provider_customer_id),
  };
}
