import type {
  AdminRiskyEmailDomain,
  BusinessEmailSettings,
  EmailDeliverabilityBand,
  EmailDeliverabilityDmarcStatus,
  EmailDeliverabilityIssue,
  EmailDeliverabilitySnapshot,
  EmailDomainConflictFlag,
  EmailSpfValidationState,
} from "../../../../../packages/shared-types/index.ts";
import type { PoolClient, QueryResultRow } from "pg";
import { queryDb } from "../db/client.ts";
import { logWarn } from "../../utils/logger.ts";

interface EmailProviderEventMetricsRow extends QueryResultRow {
  total_messages: string | number;
  delivered_messages: string | number;
  hard_bounce_messages: string | number;
  soft_bounce_messages: string | number;
  complaint_messages: string | number;
}

interface EmailDomainReputationRow extends QueryResultRow {
  business_id: string;
  domain_name: string;
  deliverability_score: string | number;
  score_band: EmailDeliverabilityBand;
  blockers_json: unknown;
  ses_verified: boolean;
  dkim_verified: boolean;
  spf_status: EmailSpfValidationState;
  dmarc_status: EmailDeliverabilityDmarcStatus;
  bounce_rate_7d: string | number;
  complaint_rate_7d: string | number;
  delivery_rate_7d: string | number;
  recent_deliveries_7d: string | number;
  recent_hard_bounces_7d: string | number;
  recent_soft_bounces_7d: string | number;
  recent_complaints_7d: string | number;
  last_evaluated_at: Date | string | null;
}

interface StoredEmailSettingsRow extends QueryResultRow {
  business_id: string;
  domain_name: string | null;
  domain_status: string;
  dkim_status: string;
  existing_dmarc_value: string | null;
  existing_spf_value: string | null;
  conflict_flags_json: unknown;
}

interface RiskyEmailDomainRow extends EmailDomainReputationRow {
  business_name: string;
}

interface ResolvedDeliverabilityState {
  businessId: string;
  domainName: string;
  sesVerified: boolean;
  dkimVerified: boolean;
  spfStatus: EmailSpfValidationState;
  dmarcStatus: EmailDeliverabilityDmarcStatus;
}

interface DomainOutcomeMetrics {
  totalMessages: number;
  deliveryRate7d: number;
  bounceRate7d: number;
  complaintRate7d: number;
  recentDeliveries7d: number;
  recentHardBounces7d: number;
  recentSoftBounces7d: number;
  recentComplaints7d: number;
}

const DOMAIN_STATUS_VERIFIED = "verified";

function toNumber(value: string | number | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toIsoString(value: Date | string | null | undefined): string | undefined {
  return value ? new Date(value).toISOString() : undefined;
}

function parseJsonArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function isMissingOptionalDeliverabilityRelation(error: unknown): boolean {
  const candidate = error as { code?: string };
  return candidate?.code === "42P01" || candidate?.code === "42703";
}

function includesAmazonSes(value: string | undefined | null): boolean {
  return typeof value === "string" && /\binclude:amazonses\.com\b/i.test(value);
}

function getSpfValidationState(
  spfValue: string | null | undefined,
  conflictFlags: EmailDomainConflictFlag[],
): EmailSpfValidationState {
  if (conflictFlags.some((flag) => flag.code === "multiple_spf_records")) {
    return "multiple_records";
  }

  if (conflictFlags.some((flag) => flag.code === "spf_malformed")) {
    return "malformed";
  }

  if (conflictFlags.some((flag) => flag.code === "spf_include_missing")) {
    return "missing_ses_include";
  }

  if (conflictFlags.some((flag) => flag.code === "spf_record_missing")) {
    return "missing";
  }

  return includesAmazonSes(spfValue) ? "valid" : "missing";
}

function resolveDmarcStatus(input: {
  existingDmarcValue?: string | null;
  conflictFlags: EmailDomainConflictFlag[];
}): EmailDeliverabilityDmarcStatus {
  if (input.conflictFlags.some((flag) => flag.code === "malformed_dmarc")) {
    return "invalid";
  }

  return input.existingDmarcValue ? "present" : "missing";
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

function resolveStateFromSettings(settings: BusinessEmailSettings): ResolvedDeliverabilityState | null {
  if (!settings.domainName) {
    return null;
  }

  return {
    businessId: settings.businessId,
    domainName: settings.domainName,
    sesVerified: settings.domainStatus === DOMAIN_STATUS_VERIFIED,
    dkimVerified: settings.dkimStatus === DOMAIN_STATUS_VERIFIED,
    spfStatus: settings.domainSetupAnalysis?.spfValidationState ?? "missing",
    dmarcStatus: settings.domainSetupAnalysis?.existingDmarcValue
      ? "present"
      : settings.domainSetupAnalysis?.conflictFlags.some((flag) => flag.code === "malformed_dmarc")
        ? "invalid"
        : "missing",
  };
}

async function loadStoredDeliverabilityState(
  businessId: string,
  domainName: string,
  client?: PoolClient,
): Promise<ResolvedDeliverabilityState | null> {
  const result = await executeQuery<StoredEmailSettingsRow>(
    `
      select
        business_id,
        domain_name,
        domain_status,
        dkim_status,
        existing_dmarc_value,
        existing_spf_value,
        conflict_flags_json
      from business_email_settings
      where business_id = $1::uuid
        and lower(domain_name) = lower($2)
      limit 1
    `,
    [businessId, domainName],
    client,
  );

  const row = result.rows[0];

  if (!row?.domain_name) {
    return null;
  }

  const conflictFlags = parseJsonArray<EmailDomainConflictFlag>(row.conflict_flags_json);

  return {
    businessId: row.business_id,
    domainName: row.domain_name,
    sesVerified: row.domain_status === DOMAIN_STATUS_VERIFIED,
    dkimVerified: row.dkim_status === DOMAIN_STATUS_VERIFIED,
    spfStatus: getSpfValidationState(row.existing_spf_value, conflictFlags),
    dmarcStatus: resolveDmarcStatus({
      existingDmarcValue: row.existing_dmarc_value,
      conflictFlags,
    }),
  };
}

async function loadDomainOutcomeMetrics(
  businessId: string,
  domainName: string,
  client?: PoolClient,
): Promise<DomainOutcomeMetrics> {
  const result = await executeQuery<EmailProviderEventMetricsRow>(
    `
      with message_rollup as (
        select
          provider_message_id,
          bool_or(event_type = 'delivered') as delivered,
          bool_or(event_type = 'bounce_hard') as hard_bounce,
          bool_or(event_type = 'bounce_soft') as soft_bounce,
          bool_or(event_type = 'complaint') as complaint
        from email_provider_events
        where business_id = $1::uuid
          and lower(domain_name) = lower($2)
          and occurred_at >= now() - interval '7 days'
        group by provider_message_id
      )
      select
        count(*)::int as total_messages,
        count(*) filter (where delivered)::int as delivered_messages,
        count(*) filter (where hard_bounce)::int as hard_bounce_messages,
        count(*) filter (where soft_bounce)::int as soft_bounce_messages,
        count(*) filter (where complaint)::int as complaint_messages
      from message_rollup
    `,
    [businessId, domainName],
    client,
  );

  const row = result.rows[0];
  const totalMessages = toNumber(row?.total_messages);
  const recentDeliveries7d = toNumber(row?.delivered_messages);
  const recentHardBounces7d = toNumber(row?.hard_bounce_messages);
  const recentSoftBounces7d = toNumber(row?.soft_bounce_messages);
  const recentComplaints7d = toNumber(row?.complaint_messages);
  const denominator = totalMessages > 0 ? totalMessages : 1;

  return {
    totalMessages,
    deliveryRate7d: totalMessages > 0 ? recentDeliveries7d / denominator : 1,
    bounceRate7d: totalMessages > 0 ? recentHardBounces7d / denominator : 0,
    complaintRate7d: totalMessages > 0 ? recentComplaints7d / denominator : 0,
    recentDeliveries7d,
    recentHardBounces7d,
    recentSoftBounces7d,
    recentComplaints7d,
  };
}

function buildDeliverabilityIssues(input: {
  state: ResolvedDeliverabilityState;
  metrics: DomainOutcomeMetrics;
}): EmailDeliverabilityIssue[] {
  const issues: EmailDeliverabilityIssue[] = [];

  if (!input.state.sesVerified) {
    issues.push({
      code: "ses_unverified",
      severity: "error",
      message: "SES still has not verified this domain for sending.",
    });
  }

  if (!input.state.dkimVerified) {
    issues.push({
      code: "dkim_unverified",
      severity: "error",
      message: "DKIM is not verified yet. Branded sends stay blocked until the SES DKIM records pass.",
    });
  }

  if (input.state.spfStatus !== "valid") {
    const message =
      input.state.spfStatus === "multiple_records"
        ? "This domain has multiple SPF records. Consolidate them into one valid SPF record."
        : input.state.spfStatus === "malformed"
          ? "The SPF record is malformed. Fix it so it starts with v=spf1 and ends with ~all or -all."
          : input.state.spfStatus === "missing_ses_include"
            ? "The current SPF record is missing include:amazonses.com."
            : "This domain does not have a valid SPF record yet.";

    issues.push({
      code: "spf_unready",
      severity: "error",
      message,
    });
  }

  if (input.state.dmarcStatus === "invalid") {
    issues.push({
      code: "dmarc_invalid",
      severity: "error",
      message: "The existing DMARC record is malformed and should be fixed by your DNS admin or IT team.",
    });
  } else if (input.state.dmarcStatus === "missing") {
    issues.push({
      code: "dmarc_missing",
      severity: "warning",
      message: "DMARC is missing. Delivery can still work, but adding a DMARC policy improves sender trust.",
    });
  }

  if (input.metrics.complaintRate7d > 0.003) {
    issues.push({
      code: "complaint_rate_blocked",
      severity: "error",
      message: "Complaint rate is above 0.3% over the last 7 days. Pause sending and clean up targeting before resuming.",
    });
  } else if (input.metrics.complaintRate7d >= 0.001) {
    issues.push({
      code: "complaint_rate_elevated",
      severity: "warning",
      message: "Complaint rate is elevated over the last 7 days. Tighten targeting before scaling volume.",
    });
  }

  if (input.metrics.bounceRate7d > 0.05) {
    issues.push({
      code: "bounce_rate_blocked",
      severity: "error",
      message: "Hard bounce rate is above 5% over the last 7 days. Clean the audience before sending again.",
    });
  } else if (input.metrics.bounceRate7d >= 0.02) {
    issues.push({
      code: "bounce_rate_elevated",
      severity: "warning",
      message: "Hard bounce rate is elevated over the last 7 days. Review list quality before the next send.",
    });
  }

  return issues;
}

function calculateDeliverabilityScore(input: {
  state: ResolvedDeliverabilityState;
  metrics: DomainOutcomeMetrics;
}): number {
  let score = 0;

  score += input.state.sesVerified ? 20 : 0;
  score += input.state.dkimVerified ? 20 : 0;
  score += input.state.spfStatus === "valid" ? 20 : 0;
  score += input.state.dmarcStatus === "present" ? 10 : 0;

  if (input.metrics.bounceRate7d < 0.02) {
    score += 15;
  } else if (input.metrics.bounceRate7d <= 0.05) {
    score += 7;
  }

  if (input.metrics.complaintRate7d < 0.001) {
    score += 15;
  } else if (input.metrics.complaintRate7d <= 0.003) {
    score += 7;
  }

  return Math.max(0, Math.min(100, score));
}

function resolveScoreBand(
  score: number,
  blockers: EmailDeliverabilityIssue[],
): EmailDeliverabilityBand {
  if (score < 70 || blockers.some((blocker) => blocker.severity === "error")) {
    return "at_risk";
  }

  if (score >= 90) {
    return "excellent";
  }

  return "needs_attention";
}

function mapReputationRow(row: EmailDomainReputationRow): EmailDeliverabilitySnapshot {
  const blockers = parseJsonArray<EmailDeliverabilityIssue>(row.blockers_json);
  const score = toNumber(row.deliverability_score);
  const scoreBand = row.score_band;

  return {
    score,
    scoreBand,
    blockers,
    sesVerified: Boolean(row.ses_verified),
    dkimVerified: Boolean(row.dkim_verified),
    spfStatus: row.spf_status,
    dmarcStatus: row.dmarc_status,
    bounceRate7d: toNumber(row.bounce_rate_7d),
    complaintRate7d: toNumber(row.complaint_rate_7d),
    deliveryRate7d: toNumber(row.delivery_rate_7d),
    recentDeliveries7d: toNumber(row.recent_deliveries_7d),
    recentHardBounces7d: toNumber(row.recent_hard_bounces_7d),
    recentSoftBounces7d: toNumber(row.recent_soft_bounces_7d),
    recentComplaints7d: toNumber(row.recent_complaints_7d),
    sendingBlocked: scoreBand === "at_risk" || blockers.some((blocker) => blocker.severity === "error"),
    lastEvaluatedAt: toIsoString(row.last_evaluated_at),
  };
}

async function upsertEmailDomainReputation(
  state: ResolvedDeliverabilityState,
  metrics: DomainOutcomeMetrics,
  snapshot: EmailDeliverabilitySnapshot,
  client?: PoolClient,
): Promise<EmailDeliverabilitySnapshot> {
  const values = [
    state.businessId,
    state.domainName,
    snapshot.score,
    snapshot.scoreBand,
    JSON.stringify(snapshot.blockers),
    state.sesVerified,
    state.dkimVerified,
    state.spfStatus,
    state.dmarcStatus,
    metrics.bounceRate7d,
    metrics.complaintRate7d,
    metrics.deliveryRate7d,
    metrics.recentDeliveries7d,
    metrics.recentHardBounces7d,
    metrics.recentSoftBounces7d,
    metrics.recentComplaints7d,
  ];

  const result = await executeQuery<EmailDomainReputationRow>(
    `
      insert into email_domain_reputation (
        business_id,
        domain_name,
        deliverability_score,
        score_band,
        blockers_json,
        ses_verified,
        dkim_verified,
        spf_status,
        dmarc_status,
        bounce_rate_7d,
        complaint_rate_7d,
        delivery_rate_7d,
        recent_deliveries_7d,
        recent_hard_bounces_7d,
        recent_soft_bounces_7d,
        recent_complaints_7d,
        last_evaluated_at
      ) values (
        $1::uuid,
        $2,
        $3::int,
        $4,
        $5::jsonb,
        $6,
        $7,
        $8,
        $9,
        $10::numeric,
        $11::numeric,
        $12::numeric,
        $13::int,
        $14::int,
        $15::int,
        $16::int,
        now()
      )
      on conflict (business_id, (lower(domain_name)))
      do update set
        deliverability_score = excluded.deliverability_score,
        score_band = excluded.score_band,
        blockers_json = excluded.blockers_json,
        ses_verified = excluded.ses_verified,
        dkim_verified = excluded.dkim_verified,
        spf_status = excluded.spf_status,
        dmarc_status = excluded.dmarc_status,
        bounce_rate_7d = excluded.bounce_rate_7d,
        complaint_rate_7d = excluded.complaint_rate_7d,
        delivery_rate_7d = excluded.delivery_rate_7d,
        recent_deliveries_7d = excluded.recent_deliveries_7d,
        recent_hard_bounces_7d = excluded.recent_hard_bounces_7d,
        recent_soft_bounces_7d = excluded.recent_soft_bounces_7d,
        recent_complaints_7d = excluded.recent_complaints_7d,
        last_evaluated_at = now(),
        updated_at = now()
      returning
        business_id,
        domain_name,
        deliverability_score,
        score_band,
        blockers_json,
        ses_verified,
        dkim_verified,
        spf_status,
        dmarc_status,
        bounce_rate_7d,
        complaint_rate_7d,
        delivery_rate_7d,
        recent_deliveries_7d,
        recent_hard_bounces_7d,
        recent_soft_bounces_7d,
        recent_complaints_7d,
        last_evaluated_at
    `,
    values,
    client,
  );

  return mapReputationRow(result.rows[0]);
}

export async function recalculateEmailDomainReputation(input: {
  businessId: string;
  domainName: string;
  settings?: BusinessEmailSettings;
  client?: PoolClient;
}): Promise<EmailDeliverabilitySnapshot | null> {
  const state =
    input.settings && input.settings.domainName?.toLowerCase() === input.domainName.toLowerCase()
      ? resolveStateFromSettings(input.settings)
      : await loadStoredDeliverabilityState(input.businessId, input.domainName, input.client);

  if (!state) {
    return null;
  }

  const metrics = await loadDomainOutcomeMetrics(state.businessId, state.domainName, input.client);
  const blockers = buildDeliverabilityIssues({ state, metrics });
  const score = calculateDeliverabilityScore({ state, metrics });
  const scoreBand = resolveScoreBand(score, blockers);

  return upsertEmailDomainReputation(
    state,
    metrics,
    {
      score,
      scoreBand,
      blockers,
      sesVerified: state.sesVerified,
      dkimVerified: state.dkimVerified,
      spfStatus: state.spfStatus,
      dmarcStatus: state.dmarcStatus,
      bounceRate7d: metrics.bounceRate7d,
      complaintRate7d: metrics.complaintRate7d,
      deliveryRate7d: metrics.deliveryRate7d,
      recentDeliveries7d: metrics.recentDeliveries7d,
      recentHardBounces7d: metrics.recentHardBounces7d,
      recentSoftBounces7d: metrics.recentSoftBounces7d,
      recentComplaints7d: metrics.recentComplaints7d,
      sendingBlocked: scoreBand === "at_risk" || blockers.some((blocker) => blocker.severity === "error"),
    },
    input.client,
  );
}

export async function listRiskyEmailDomains(limit = 6): Promise<AdminRiskyEmailDomain[]> {
  let result;

  try {
    result = await queryDb<RiskyEmailDomainRow>(
      `
        select
          r.business_id,
          b.name as business_name,
          r.domain_name,
          r.deliverability_score,
          r.score_band,
          r.blockers_json,
          r.ses_verified,
          r.dkim_verified,
          r.spf_status,
          r.dmarc_status,
          r.bounce_rate_7d,
          r.complaint_rate_7d,
          r.delivery_rate_7d,
          r.recent_deliveries_7d,
          r.recent_hard_bounces_7d,
          r.recent_soft_bounces_7d,
          r.recent_complaints_7d,
          r.last_evaluated_at
        from email_domain_reputation r
        inner join businesses b on b.id = r.business_id
        where r.score_band <> 'excellent'
           or jsonb_array_length(r.blockers_json) > 0
        order by
          case r.score_band
            when 'at_risk' then 0
            when 'needs_attention' then 1
            else 2
          end,
          r.deliverability_score asc,
          r.updated_at desc
        limit $1::int
      `,
      [limit],
    );
  } catch (error) {
    if (isMissingOptionalDeliverabilityRelation(error)) {
      logWarn("Skipping risky email domain lookup because deliverability schema is not available.", {
        code: (error as { code?: string }).code ?? "unknown",
      });
      return [];
    }

    throw error;
  }

  return result.rows.map((row) => {
    const snapshot = mapReputationRow(row);

    return {
      businessId: row.business_id,
      businessName: row.business_name,
      domainName: row.domain_name,
      score: snapshot.score,
      scoreBand: snapshot.scoreBand,
      bounceRate7d: snapshot.bounceRate7d,
      complaintRate7d: snapshot.complaintRate7d,
      blockers: snapshot.blockers,
      lastEvaluatedAt: snapshot.lastEvaluatedAt,
    };
  });
}

export async function recalculateAllEmailDomainReputations(): Promise<number> {
  const result = await queryDb<{ business_id: string; domain_name: string }>(
    `
      select business_id, domain_name
      from business_email_settings
      where domain_name is not null
      order by updated_at desc
    `,
    [],
  );

  let processed = 0;

  for (const row of result.rows) {
    const snapshot = await recalculateEmailDomainReputation({
      businessId: row.business_id,
      domainName: row.domain_name,
    });

    if (snapshot) {
      processed += 1;
    }
  }

  return processed;
}
