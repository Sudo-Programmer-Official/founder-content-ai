import crypto from "node:crypto";
import type { QueryResultRow } from "pg";
import type {
  BrandKit,
  BrandPromptContext,
  EmailAutopilotEvaluationMode,
  EmailAutopilotRun,
  EmailAutopilotRunStatus,
  EmailAutopilotStrategy,
  EmailCampaignAutopilotRequest,
  EmailCampaignAutopilotResponse,
  EmailCampaignVariant,
  EmailCampaignVariantMetrics,
  EmailCampaignVariantStatus,
} from "../../../../../packages/shared-types/index.ts";
import type { AuthenticatedPrincipal } from "../../middleware/auth.ts";
import { getBrandKitForBusiness } from "../brandIntelligence/brandKitService.ts";
import { getBrandPromptContextForBusiness } from "../brandIntelligence/brandProfileService.ts";
import { createContentAssetRecord } from "../analytics/eventLoggingService.ts";
import { queryDb } from "../db/client.ts";
import { HttpError } from "../../utils/http.ts";
import {
  createEmailCampaign,
  type EmailAudienceContact,
  getEmailCampaignAnalyticsResponse,
  listActiveEmailAudienceContacts,
  sendEmailCampaignToContactIds,
} from "./emailService.ts";

interface BusinessContextRow extends QueryResultRow {
  id: string;
  name: string;
  brand_name: string;
  website_url: string | null;
  niche: string | null;
}

interface EmailAutopilotRunRow extends QueryResultRow {
  id: string;
  business_id: string;
  audience_id: string;
  goal: string;
  strategy: EmailAutopilotStrategy;
  status: EmailAutopilotRunStatus;
  winner_variant_id: string | null;
  test_audience_size: string | number;
  remainder_audience_size: string | number;
  evaluation_mode: EmailAutopilotEvaluationMode;
  summary_json: unknown;
  created_at: Date | string;
  updated_at: Date | string;
  completed_at: Date | string | null;
}

interface CampaignVariantRow extends QueryResultRow {
  id: string;
  autopilot_run_id: string;
  business_id: string;
  campaign_id: string | null;
  rollout_campaign_id: string | null;
  asset_id: string | null;
  label: string;
  angle: string;
  subject: string;
  content: string;
  status: EmailCampaignVariantStatus;
  metrics_json: unknown;
  created_at: Date | string;
  updated_at: Date | string;
}

interface VariantDraft {
  label: string;
  angle: string;
  subject: string;
  bodyText: string;
}

interface VariantDraftContext {
  goal: string;
  strategy: EmailAutopilotStrategy;
  brandKit: BrandKit;
  brandContext?: BrandPromptContext;
  business: {
    name: string;
    brandName: string;
    websiteUrl?: string;
    niche?: string;
  };
}

function toIsoString(value: Date | string | null | undefined): string | undefined {
  return value ? new Date(value).toISOString() : undefined;
}

function toNumber(value: string | number | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toJsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalizeOptionalString(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function mapAutopilotRun(row: EmailAutopilotRunRow): EmailAutopilotRun {
  return {
    id: row.id,
    businessId: row.business_id,
    audienceId: row.audience_id,
    goal: row.goal,
    strategy: row.strategy,
    status: row.status,
    winnerVariantId: row.winner_variant_id ?? undefined,
    testAudienceSize: toNumber(row.test_audience_size),
    remainderAudienceSize: toNumber(row.remainder_audience_size),
    evaluationMode: row.evaluation_mode,
    summary: toJsonRecord(row.summary_json),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: toIsoString(row.updated_at),
    completedAt: toIsoString(row.completed_at),
  };
}

function parseVariantMetrics(value: unknown): EmailCampaignVariantMetrics | undefined {
  const record = toJsonRecord(value);
  const evaluationMode = record.evaluationMode === "live" ? "live" : record.evaluationMode === "simulated"
    ? "simulated"
    : undefined;

  if (!evaluationMode) {
    return undefined;
  }

  return {
    sent: toNumber(typeof record.sent === "number" || typeof record.sent === "string" ? record.sent : 0),
    delivered: toNumber(typeof record.delivered === "number" || typeof record.delivered === "string" ? record.delivered : 0),
    opens: toNumber(typeof record.opens === "number" || typeof record.opens === "string" ? record.opens : 0),
    clicks: toNumber(typeof record.clicks === "number" || typeof record.clicks === "string" ? record.clicks : 0),
    openRate: toNumber(typeof record.openRate === "number" || typeof record.openRate === "string" ? record.openRate : 0),
    clickRate: toNumber(typeof record.clickRate === "number" || typeof record.clickRate === "string" ? record.clickRate : 0),
    score: toNumber(typeof record.score === "number" || typeof record.score === "string" ? record.score : 0),
    evaluationMode,
  };
}

function mapCampaignVariant(row: CampaignVariantRow): EmailCampaignVariant {
  return {
    id: row.id,
    autopilotRunId: row.autopilot_run_id,
    businessId: row.business_id,
    campaignId: row.campaign_id ?? undefined,
    rolloutCampaignId: row.rollout_campaign_id ?? undefined,
    assetId: row.asset_id ?? undefined,
    label: row.label,
    angle: row.angle,
    subject: row.subject,
    content: row.content,
    status: row.status,
    metrics: parseVariantMetrics(row.metrics_json),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: toIsoString(row.updated_at),
  };
}

async function loadBusinessContextOrThrow(businessId: string): Promise<BusinessContextRow> {
  const result = await queryDb<BusinessContextRow>(
    `
      select
        id,
        name,
        brand_name,
        website_url,
        niche
      from businesses
      where id = $1::uuid
      limit 1
    `,
    [businessId],
  );

  const row = result.rows[0];

  if (!row) {
    throw new HttpError(404, "business_not_found", "Workspace not found.");
  }

  return row;
}

function buildGoalPhrase(goal: string): string {
  const normalized = goal.trim().replace(/\s+/g, " ");
  return normalized.length > 96 ? normalized.slice(0, 93).trimEnd() + "..." : normalized;
}

function buildAudienceLabel(brandContext: BrandPromptContext | undefined, fallbackNiche: string | undefined): string {
  const audience = normalizeOptionalString(brandContext?.audience);

  if (audience) {
    return audience;
  }

  if (fallbackNiche) {
    return `people looking for ${fallbackNiche}`;
  }

  return "the right customers";
}

function buildFocusPoint(brandContext: BrandPromptContext | undefined): string {
  const topic = brandContext?.topics?.find((value) => value.trim() !== "");
  return topic?.trim() || "a clear next step";
}

function buildPositioningLine(brandContext: BrandPromptContext | undefined, businessName: string): string {
  const positioning = normalizeOptionalString(brandContext?.positioning);
  if (positioning) {
    return positioning;
  }

  return `${businessName} keeps the message clear, practical, and easy to act on.`;
}

function buildStrategyCta(strategy: EmailAutopilotStrategy, businessName: string, websiteUrl?: string): string {
  const website = normalizeOptionalString(websiteUrl);

  if (strategy === "conversion") {
    return website
      ? `Take a look here and choose the best next step: ${website}`
      : `Reply to this email and we will help you map out the best next step.`;
  }

  if (strategy === "engagement") {
    return `Reply with the biggest question on your mind and ${businessName} will point you in the right direction.`;
  }

  return website
    ? `See how ${businessName} approaches it here: ${website}`
    : `Reply if you want a quick overview and we will send it over.`;
}

function buildToneDescriptor(brandKit: BrandKit): string {
  if (brandKit.tone === "friendly") {
    return "warm and approachable";
  }

  if (brandKit.tone === "bold") {
    return "confident and direct";
  }

  return "clear and professional";
}

function buildVariantDrafts(context: VariantDraftContext): VariantDraft[] {
  const businessName = context.brandKit.brandName || context.business.brandName || context.business.name;
  const goal = buildGoalPhrase(context.goal);
  const audienceLabel = buildAudienceLabel(context.brandContext, context.brandKit.industry || context.business.niche);
  const positioning = buildPositioningLine(context.brandContext, businessName);
  const focusPoint = buildFocusPoint(context.brandContext);
  const toneDescriptor = buildToneDescriptor(context.brandKit);
  const cta = buildStrategyCta(context.strategy, businessName, context.brandKit.websiteUrl || context.business.websiteUrl);

  return [
    {
      label: "Variant A",
      angle: "direct_offer",
      subject:
        context.strategy === "conversion"
          ? `Ready to ${goal}?`
          : context.strategy === "engagement"
            ? `Quick question about ${goal}`
            : `A sharper way to think about ${goal}`,
      bodyText: [
        "Hi {{first_name}},",
        "",
        `${goal} is usually easier when the next move is obvious.`,
        `${businessName} helps ${audienceLabel} move faster with ${focusPoint}.`,
        positioning,
        `This version keeps the tone ${toneDescriptor} and focused on action.`,
        "",
        cta,
        "",
        `Best,`,
        businessName,
      ].join("\n"),
    },
    {
      label: "Variant B",
      angle: "trust_builder",
      subject:
        context.strategy === "awareness"
          ? `Why ${businessName} stands out`
          : `Why people choose ${businessName} for ${goal}`,
      bodyText: [
        "Hi {{first_name}},",
        "",
        `When ${audienceLabel} want to ${goal}, they usually need clarity more than noise.`,
        `${businessName} is built around ${focusPoint}, consistent follow-through, and a message people can trust.`,
        positioning,
        `That is why this version leads with credibility before the ask.`,
        "",
        cta,
        "",
        `Thanks,`,
        businessName,
      ].join("\n"),
    },
    {
      label: "Variant C",
      angle: "problem_solution",
      subject:
        context.strategy === "engagement"
          ? `Still trying to ${goal}?`
          : `A simpler path to ${goal}`,
      bodyText: [
        "Hi {{first_name}},",
        "",
        `Most people stall because ${goal} feels heavier than it needs to be.`,
        `${businessName} removes that friction with ${focusPoint} and a clearer path forward.`,
        positioning,
        `This version turns the problem into an immediate next step.`,
        "",
        cta,
        "",
        `Best,`,
        businessName,
      ].join("\n"),
    },
  ];
}

function resolveTestAudienceSize(totalContacts: number): number {
  return Math.min(totalContacts, Math.max(3, Math.ceil(totalContacts * 0.1)));
}

function assignTestBuckets(
  contacts: EmailAudienceContact[],
  variantCount: number,
): Array<EmailAudienceContact[]> {
  const buckets = Array.from({ length: variantCount }, () => [] as EmailAudienceContact[]);

  contacts.forEach((contact, index) => {
    buckets[index % variantCount].push(contact);
  });

  return buckets;
}

function orderContactsForRun(runId: string, contacts: EmailAudienceContact[]): EmailAudienceContact[] {
  return [...contacts].sort((left, right) => {
    const leftWeight = hashToUnitInterval(`${runId}:${left.id}`);
    const rightWeight = hashToUnitInterval(`${runId}:${right.id}`);

    if (leftWeight !== rightWeight) {
      return leftWeight - rightWeight;
    }

    return left.id.localeCompare(right.id);
  });
}

function hashToUnitInterval(value: string): number {
  const digest = crypto.createHash("sha256").update(value, "utf8").digest();
  const integer = digest.readUInt32BE(0);
  return integer / 0xFFFFFFFF;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundRate(value: number): number {
  return Math.round(value * 10) / 10;
}

function buildSimulatedMetrics(input: {
  runId: string;
  label: string;
  strategy: EmailAutopilotStrategy;
  angle: string;
  audienceSize: number;
}): EmailCampaignVariantMetrics {
  const baseByStrategy: Record<EmailAutopilotStrategy, Record<string, { openRate: number; clickRate: number }>> = {
    conversion: {
      direct_offer: { openRate: 29, clickRate: 9.4 },
      trust_builder: { openRate: 25, clickRate: 7.8 },
      problem_solution: { openRate: 31, clickRate: 8.1 },
    },
    engagement: {
      direct_offer: { openRate: 24, clickRate: 4.5 },
      trust_builder: { openRate: 28, clickRate: 5.1 },
      problem_solution: { openRate: 30, clickRate: 4.8 },
    },
    awareness: {
      direct_offer: { openRate: 22, clickRate: 3.2 },
      trust_builder: { openRate: 27, clickRate: 4.1 },
      problem_solution: { openRate: 25, clickRate: 3.6 },
    },
  };

  const base = baseByStrategy[input.strategy][input.angle] ?? { openRate: 25, clickRate: 4 };
  const openJitter = (hashToUnitInterval(`${input.runId}:${input.label}:open`) - 0.5) * 6;
  const clickJitter = (hashToUnitInterval(`${input.runId}:${input.label}:click`) - 0.5) * 3;
  const deliveredRate = 0.92 + (hashToUnitInterval(`${input.runId}:${input.label}:deliver`) - 0.5) * 0.05;
  const delivered = Math.max(1, Math.round(input.audienceSize * clamp(deliveredRate, 0.84, 0.97)));
  const openRate = clamp(base.openRate + openJitter, 12, 48);
  const clickRate = clamp(base.clickRate + clickJitter, 1, Math.min(openRate - 1, 16));
  const opens = Math.round((delivered * openRate) / 100);
  const clicks = Math.round((delivered * clickRate) / 100);
  const score = roundRate((openRate * 0.4) + (clickRate * 0.6));

  return {
    sent: input.audienceSize,
    delivered,
    opens,
    clicks,
    openRate: roundRate(openRate),
    clickRate: roundRate(clickRate),
    score,
    evaluationMode: "simulated",
  };
}

function buildLiveMetrics(input: {
  sent: number;
  delivered: number;
  opens: number;
  clicks: number;
  openRate: number;
  clickRate: number;
}): EmailCampaignVariantMetrics {
  return {
    sent: input.sent,
    delivered: input.delivered,
    opens: input.opens,
    clicks: input.clicks,
    openRate: roundRate(input.openRate),
    clickRate: roundRate(input.clickRate),
    score: roundRate((input.openRate * 0.4) + (input.clickRate * 0.6)),
    evaluationMode: "live",
  };
}

async function createAutopilotRun(input: {
  businessId: string;
  audienceId: string;
  actorUserId?: string;
  goal: string;
  strategy: EmailAutopilotStrategy;
  testAudienceSize: number;
  remainderAudienceSize: number;
}): Promise<EmailAutopilotRun> {
  const result = await queryDb<EmailAutopilotRunRow>(
    `
      insert into email_autopilot_runs (
        business_id,
        created_by_user_id,
        audience_id,
        goal,
        strategy,
        status,
        test_audience_size,
        remainder_audience_size,
        evaluation_mode,
        summary_json
      ) values (
        $1::uuid,
        $2::uuid,
        $3::uuid,
        $4,
        $5,
        'processing',
        $6::int,
        $7::int,
        'simulated',
        '{}'::jsonb
      )
      returning
        id,
        business_id,
        audience_id,
        goal,
        strategy,
        status,
        winner_variant_id,
        test_audience_size,
        remainder_audience_size,
        evaluation_mode,
        summary_json,
        created_at,
        updated_at,
        completed_at
    `,
    [
      input.businessId,
      input.actorUserId ?? null,
      input.audienceId,
      input.goal,
      input.strategy,
      input.testAudienceSize,
      input.remainderAudienceSize,
    ],
  );

  return mapAutopilotRun(result.rows[0]);
}

async function insertCampaignVariant(input: {
  autopilotRunId: string;
  businessId: string;
  campaignId: string;
  assetId?: string;
  label: string;
  angle: string;
  subject: string;
  content: string;
}): Promise<EmailCampaignVariant> {
  const result = await queryDb<CampaignVariantRow>(
    `
      insert into campaign_variants (
        autopilot_run_id,
        business_id,
        campaign_id,
        asset_id,
        label,
        angle,
        subject,
        content,
        status,
        metrics_json
      ) values (
        $1::uuid,
        $2::uuid,
        $3::uuid,
        $4::uuid,
        $5,
        $6,
        $7,
        $8,
        'testing',
        '{}'::jsonb
      )
      returning
        id,
        autopilot_run_id,
        business_id,
        campaign_id,
        rollout_campaign_id,
        asset_id,
        label,
        angle,
        subject,
        content,
        status,
        metrics_json,
        created_at,
        updated_at
    `,
    [
      input.autopilotRunId,
      input.businessId,
      input.campaignId,
      input.assetId ?? null,
      input.label,
      input.angle,
      input.subject,
      input.content,
    ],
  );

  return mapCampaignVariant(result.rows[0]);
}

async function updateVariantMetrics(input: {
  variantId: string;
  status: EmailCampaignVariantStatus;
  metrics: EmailCampaignVariantMetrics;
  rolloutCampaignId?: string;
}): Promise<void> {
  await queryDb(
    `
      update campaign_variants
      set
        status = $2,
        metrics_json = $3::jsonb,
        rollout_campaign_id = coalesce($4::uuid, rollout_campaign_id),
        updated_at = now()
      where id = $1::uuid
    `,
    [
      input.variantId,
      input.status,
      JSON.stringify(input.metrics),
      input.rolloutCampaignId ?? null,
    ],
  );
}

async function updateAutopilotRunState(input: {
  runId: string;
  status: EmailAutopilotRunStatus;
  evaluationMode?: EmailAutopilotEvaluationMode;
  winnerVariantId?: string;
  summary: Record<string, unknown>;
  completed?: boolean;
}): Promise<void> {
  await queryDb(
    `
      update email_autopilot_runs
      set
        status = $2,
        evaluation_mode = coalesce($3, evaluation_mode),
        winner_variant_id = coalesce($4::uuid, winner_variant_id),
        summary_json = $5::jsonb,
        completed_at = case when $6::boolean then now() else completed_at end,
        updated_at = now()
      where id = $1::uuid
    `,
    [
      input.runId,
      input.status,
      input.evaluationMode ?? null,
      input.winnerVariantId ?? null,
      JSON.stringify(input.summary),
      input.completed ?? false,
    ],
  );
}

async function markAutopilotRunFailed(runId: string, message: string): Promise<void> {
  await queryDb(
    `
      update email_autopilot_runs
      set
        status = 'failed',
        summary_json = jsonb_build_object('error', $2),
        completed_at = now(),
        updated_at = now()
      where id = $1::uuid
    `,
    [runId, message],
  );
}

async function loadAutopilotRunOrThrow(runId: string): Promise<EmailAutopilotRun> {
  const result = await queryDb<EmailAutopilotRunRow>(
    `
      select
        id,
        business_id,
        audience_id,
        goal,
        strategy,
        status,
        winner_variant_id,
        test_audience_size,
        remainder_audience_size,
        evaluation_mode,
        summary_json,
        created_at,
        updated_at,
        completed_at
      from email_autopilot_runs
      where id = $1::uuid
      limit 1
    `,
    [runId],
  );

  const row = result.rows[0];

  if (!row) {
    throw new HttpError(404, "email_autopilot_run_not_found", "Autopilot run not found.");
  }

  return mapAutopilotRun(row);
}

async function listAutopilotVariants(runId: string): Promise<EmailCampaignVariant[]> {
  const result = await queryDb<CampaignVariantRow>(
    `
      select
        id,
        autopilot_run_id,
        business_id,
        campaign_id,
        rollout_campaign_id,
        asset_id,
        label,
        angle,
        subject,
        content,
        status,
        metrics_json,
        created_at,
        updated_at
      from campaign_variants
      where autopilot_run_id = $1::uuid
      order by created_at asc
    `,
    [runId],
  );

  return result.rows.map(mapCampaignVariant);
}

export async function runEmailCampaignAutopilot(
  input: EmailCampaignAutopilotRequest,
  principal: AuthenticatedPrincipal,
  actorUserId?: string,
): Promise<EmailCampaignAutopilotResponse> {
  const goal = input.goal.trim();
  const audienceId = input.audienceId.trim();
  const strategy = input.strategy;

  if (!goal) {
    throw new HttpError(400, "autopilot_goal_required", "goal is required.");
  }

  if (!audienceId) {
    throw new HttpError(400, "autopilot_audience_required", "audienceId is required.");
  }

  if (strategy !== "conversion" && strategy !== "engagement" && strategy !== "awareness") {
    throw new HttpError(400, "autopilot_strategy_invalid", "strategy is invalid.");
  }

  const [brandKit, brandContext, businessRow, contacts] = await Promise.all([
    getBrandKitForBusiness({
      principal,
      businessId: input.businessId,
    }),
    getBrandPromptContextForBusiness(input.businessId),
    loadBusinessContextOrThrow(input.businessId),
    listActiveEmailAudienceContacts(input.businessId, audienceId),
  ]);

  if (contacts.length < 3) {
    throw new HttpError(
      400,
      "autopilot_audience_too_small",
      "Autopilot needs at least 3 active contacts in the selected audience.",
    );
  }

  const testAudienceSize = resolveTestAudienceSize(contacts.length);
  const variantDrafts = buildVariantDrafts({
    goal,
    strategy,
    brandKit,
    brandContext,
    business: {
      name: businessRow.name,
      brandName: businessRow.brand_name,
      websiteUrl: normalizeOptionalString(businessRow.website_url),
      niche: normalizeOptionalString(businessRow.niche),
    },
  });

  const run = await createAutopilotRun({
    businessId: input.businessId,
    audienceId,
    actorUserId,
    goal,
    strategy,
    testAudienceSize,
    remainderAudienceSize: contacts.length - testAudienceSize,
  });

  try {
    const orderedContacts = orderContactsForRun(run.id, contacts);
    const testContacts = orderedContacts.slice(0, testAudienceSize);
    const remainingContacts = orderedContacts.slice(testAudienceSize);
    const testBuckets = assignTestBuckets(testContacts, variantDrafts.length);
    const variantsWithMetrics: Array<EmailCampaignVariant & { metrics: EmailCampaignVariantMetrics }> = [];

    for (const [index, draft] of variantDrafts.entries()) {
      const bucket = testBuckets[index];
      const contentAsset = await createContentAssetRecord({
        businessId: input.businessId,
        userId: actorUserId,
        contentType: "email",
        title: draft.subject,
        contentBody: {
          subject: draft.subject,
          content: draft.bodyText,
          goal,
          strategy,
          label: draft.label,
          angle: draft.angle,
          autopilotRunId: run.id,
        },
        sourceKind: "generated",
        pipelineStage: "review",
        brandContext,
      });
      const campaignResponse = await createEmailCampaign(input.businessId, actorUserId, {
        listId: audienceId,
        name: `Autopilot ${draft.label} · Test`,
        subject: draft.subject,
        bodyText: draft.bodyText,
        sourceAssetId: contentAsset.id,
        sourceTitle: `Autopilot ${goal}`,
      });

      const variant = await insertCampaignVariant({
        autopilotRunId: run.id,
        businessId: input.businessId,
        campaignId: campaignResponse.campaign.id,
        assetId: contentAsset.id,
        label: draft.label,
        angle: draft.angle,
        subject: draft.subject,
        content: draft.bodyText,
      });

      await sendEmailCampaignToContactIds({
        businessId: input.businessId,
        campaignId: campaignResponse.campaign.id,
        contactIds: bucket.map((contact) => contact.id),
        actorUserId,
      });

      const analyticsResponse = await getEmailCampaignAnalyticsResponse(input.businessId, campaignResponse.campaign.id);
      const liveMetricsAvailable = analyticsResponse.stats.uniqueOpens > 0 || analyticsResponse.stats.uniqueClicks > 0;
      const metrics = liveMetricsAvailable
        ? buildLiveMetrics({
          sent: bucket.length,
          delivered: analyticsResponse.analytics.delivered,
          opens: analyticsResponse.analytics.opens,
          clicks: analyticsResponse.analytics.clicks,
          openRate: analyticsResponse.analytics.openRate,
          clickRate: analyticsResponse.analytics.clickRate,
        })
        : buildSimulatedMetrics({
          runId: run.id,
          label: draft.label,
          strategy,
          angle: draft.angle,
          audienceSize: bucket.length,
        });

      await updateVariantMetrics({
        variantId: variant.id,
        status: "testing",
        metrics,
      });

      variantsWithMetrics.push({
        ...variant,
        metrics,
      });
    }

    await updateAutopilotRunState({
      runId: run.id,
      status: "testing",
      summary: {
        stage: "test_batch_sent",
        scoreFormula: "(open_rate * 0.4) + (click_rate * 0.6)",
        testAudienceSize: testContacts.length,
        remainderAudienceSize: remainingContacts.length,
      },
    });

    const winner = [...variantsWithMetrics]
      .sort((left, right) => {
        const scoreDelta = (right.metrics.score ?? 0) - (left.metrics.score ?? 0);

        if (scoreDelta !== 0) {
          return scoreDelta;
        }

        const clickDelta = (right.metrics.clickRate ?? 0) - (left.metrics.clickRate ?? 0);

        if (clickDelta !== 0) {
          return clickDelta;
        }

        return left.label.localeCompare(right.label);
      })[0];

    const evaluationMode: EmailAutopilotEvaluationMode =
      variantsWithMetrics.every((variant) => variant.metrics.evaluationMode === "live") ? "live" : "simulated";

    await updateAutopilotRunState({
      runId: run.id,
      status: "winner_selected",
      evaluationMode,
      winnerVariantId: winner.id,
      summary: {
        stage: "winner_selected",
        scoreFormula: "(open_rate * 0.4) + (click_rate * 0.6)",
        winnerLabel: winner.label,
        winnerAngle: winner.angle,
        winnerScore: winner.metrics.score,
        evaluationMode,
      },
    });

    let winnerRolloutCampaignId: string | undefined;

    if (remainingContacts.length > 0) {
      const rolloutCampaignResponse = await createEmailCampaign(input.businessId, actorUserId, {
        listId: audienceId,
        name: `Autopilot ${winner.label} · Winner rollout`,
        subject: winner.subject,
        bodyText: winner.content,
        sourceAssetId: winner.assetId,
        sourceTitle: `Autopilot winner · ${goal}`,
      });

      winnerRolloutCampaignId = rolloutCampaignResponse.campaign.id;
      await sendEmailCampaignToContactIds({
        businessId: input.businessId,
        campaignId: rolloutCampaignResponse.campaign.id,
        contactIds: remainingContacts.map((contact) => contact.id),
        actorUserId,
      });
    }

    for (const variant of variantsWithMetrics) {
      await updateVariantMetrics({
        variantId: variant.id,
        status: variant.id === winner.id ? "winner" : "discarded",
        metrics: variant.metrics,
        rolloutCampaignId: variant.id === winner.id ? winnerRolloutCampaignId : undefined,
      });
    }

    await updateAutopilotRunState({
      runId: run.id,
      status: "completed",
      evaluationMode,
      winnerVariantId: winner.id,
      completed: true,
      summary: {
        stage: "completed",
        scoreFormula: "(open_rate * 0.4) + (click_rate * 0.6)",
        winnerLabel: winner.label,
        winnerAngle: winner.angle,
        winnerScore: winner.metrics.score,
        evaluationMode,
        testAudienceSize: testContacts.length,
        remainderAudienceSize: remainingContacts.length,
        rolloutTriggered: remainingContacts.length > 0,
      },
    });

    const persistedRun = await loadAutopilotRunOrThrow(run.id);
    const persistedVariants = await listAutopilotVariants(run.id);

    return {
      run: persistedRun,
      variants: persistedVariants,
      winnerVariant: persistedVariants.find((variant) => variant.id === persistedRun.winnerVariantId),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to complete email autopilot.";
    await markAutopilotRunFailed(run.id, message);
    throw error;
  }
}
