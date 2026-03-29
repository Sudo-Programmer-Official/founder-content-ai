import type {
  CreateGrowthLeadRequest,
  CreateGrowthLeadResponse,
  GrowthAutomationFlow,
  GrowthAutomationFlowListResponse,
  GrowthAutomationRunStatus,
  GrowthAutomationStep,
  GrowthLeadEvent,
  GrowthLeadEventListResponse,
  GrowthLeadEventType,
  GrowthLead,
  GrowthLeadListResponse,
  GrowthLeadStatus,
  UpdateGrowthLeadStatusRequest,
  UpdateGrowthLeadStatusResponse,
} from "../../../../../packages/shared-types/index.ts";
import type { PoolClient, QueryResultRow } from "pg";
import { incrementBusinessDailyUsage } from "../adminControlService.ts";
import { queryDb, withDbTransaction } from "../db/client.ts";
import { sendPlatformEmail } from "../email/emailTransportService.ts";
import { HttpError } from "../../utils/http.ts";

const DEFAULT_FLOW_NAME = "SaaS trial nurture";
const DEFAULT_FLOW_SLUG = "saas_trial_nurture";
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/i;
const WORKER_BATCH_SIZE = Number.parseInt(
  process.env.GROWTH_AUTOMATION_WORKER_BATCH_SIZE?.trim() || "25",
  10,
);
const WORKER_MAX_ATTEMPTS = Number.parseInt(
  process.env.GROWTH_AUTOMATION_MAX_ATTEMPTS?.trim() || "3",
  10,
);
const WORKER_RETRY_DELAY_MINUTES = Number.parseInt(
  process.env.GROWTH_AUTOMATION_RETRY_DELAY_MINUTES?.trim() || "15",
  10,
);

const DEFAULT_FLOW_STEPS: Array<{
  dayOffset: number;
  templateKey: string;
  subject: string;
  bodyText: string;
}> = [
  {
    dayOffset: 0,
    templateKey: "welcome_email",
    subject: "Thanks for checking out {{workspace_name}}",
    bodyText: [
      "Hi {{first_name}},",
      "",
      "Thanks for checking out {{workspace_name}}.",
      "{{lead_source_line}}",
      "You already have access to the fastest path to value: bring one idea, generate a post, and ship something useful today.",
      "",
      "If you want a quick walkthrough or have a question, just reply to this email.",
      "",
      "- {{workspace_name}}",
    ].join("\n"),
  },
  {
    dayOffset: 3,
    templateKey: "value_email",
    subject: "A quick win you can get from {{workspace_name}} this week",
    bodyText: [
      "Hi {{first_name}},",
      "",
      "A simple way to get value from {{workspace_name}} is to reuse what you already have.",
      "{{use_case_line}}",
      "Drop in a recent post, note, landing page, or customer insight and turn it into a cleaner publishable asset instead of starting from zero.",
      "",
      "That usually removes the blank-page problem faster than trying to brainstorm from scratch.",
      "",
      "- {{workspace_name}}",
    ].join("\n"),
  },
  {
    dayOffset: 7,
    templateKey: "trial_followup",
    subject: "Still evaluating {{workspace_name}}?",
    bodyText: [
      "Hi {{first_name}},",
      "",
      "If you are still evaluating {{workspace_name}}, the best next move is to run one real workflow end to end.",
      "Take one idea, generate the draft, tighten the hook, and publish or send it. One shipped result usually tells you more than another tour ever will.",
      "",
      "If you want help setting that up, reply and we can point you in the right direction.",
      "",
      "- {{workspace_name}}",
    ].join("\n"),
  },
];

interface GrowthLeadRow extends QueryResultRow {
  id: string;
  business_id: string;
  name: string;
  email: string;
  phone: string | null;
  source: GrowthLead["source"];
  status: GrowthLeadStatus;
  notes: string | null;
  first_email_sent_at: Date | string | null;
  last_contacted_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface GrowthAutomationFlowRow extends QueryResultRow {
  id: string;
  business_id: string;
  name: string;
  slug: string;
  trigger: GrowthAutomationFlow["trigger"];
  status: GrowthAutomationFlow["status"];
  created_at: Date | string;
  updated_at: Date | string;
}

interface GrowthAutomationStepRow extends QueryResultRow {
  id: string;
  flow_id: string;
  day_offset: number;
  channel: GrowthAutomationStep["channel"];
  template_key: string;
  subject: string;
  body_text: string;
  body_html: string;
  is_active: boolean;
  created_at: Date | string;
  updated_at: Date | string;
}

interface EnrollmentRow extends QueryResultRow {
  id: string;
  flow_id: string;
}

interface GrowthLeadEventRow extends QueryResultRow {
  id: string;
  business_id: string;
  lead_id: string;
  step_run_id: string | null;
  provider_message_id: string | null;
  event_type: GrowthLeadEventType;
  metadata_json: unknown;
  occurred_at: Date | string;
  created_at: Date | string;
}

interface ClaimedRunRow extends QueryResultRow {
  run_id: string;
  business_id: string;
  enrollment_id: string;
  lead_id: string;
  step_id: string;
  scheduled_for: Date | string;
  flow_name: string;
  flow_slug: string;
  step_template_key: string;
  step_subject: string;
  step_body_text: string;
  step_body_html: string;
  lead_name: string;
  lead_email: string;
  lead_status: GrowthLeadStatus;
  lead_source: GrowthLead["source"];
  business_name: string;
  business_brand_name: string;
  business_website_url: string | null;
  onboarding_use_case: string | null;
  brand_industry: string | null;
  retry_count: string | number;
}

function toIsoString(value: Date | string | null | undefined): string | undefined {
  return value ? new Date(value).toISOString() : undefined;
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeOptionalString(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function assertValidEmail(value: string): void {
  if (!EMAIL_PATTERN.test(value)) {
    throw new HttpError(400, "growth_lead_email_invalid", "A valid lead email is required.");
  }
}

function mapLead(row: GrowthLeadRow): GrowthLead {
  return {
    id: row.id,
    businessId: row.business_id,
    name: row.name,
    email: row.email,
    phone: row.phone ?? undefined,
    source: row.source,
    status: row.status,
    notes: row.notes ?? undefined,
    firstEmailSentAt: toIsoString(row.first_email_sent_at),
    lastContactedAt: toIsoString(row.last_contacted_at),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function mapStep(row: GrowthAutomationStepRow): GrowthAutomationStep {
  return {
    id: row.id,
    flowId: row.flow_id,
    dayOffset: Number(row.day_offset),
    channel: row.channel,
    templateKey: row.template_key,
    subject: row.subject,
    bodyText: row.body_text,
    bodyHtml: row.body_html,
    isActive: row.is_active,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }

  return {};
}

function mapLeadEvent(row: GrowthLeadEventRow): GrowthLeadEvent {
  return {
    id: row.id,
    businessId: row.business_id,
    leadId: row.lead_id,
    stepRunId: row.step_run_id ?? undefined,
    providerMessageId: row.provider_message_id ?? undefined,
    eventType: row.event_type,
    metadata: parseJsonObject(row.metadata_json),
    occurredAt: new Date(row.occurred_at).toISOString(),
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function convertTextTemplateToHtml(value: string): string {
  return value
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br />")}</p>`)
    .join("");
}

function renderTemplate(template: string, tokens: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_match, key: string) => tokens[key] ?? "");
}

function compactRenderedTemplate(value: string): string {
  return value
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function formatLeadSourceLabel(source: GrowthLead["source"]): string {
  switch (source) {
    case "landing_page":
      return "your landing page";
    case "demo_request":
      return "a demo request";
    case "csv_import":
      return "an import";
    case "system":
      return "an internal workflow";
    default:
      return "a direct signup";
  }
}

function formatUseCaseLabel(value: string | null): string {
  switch (value) {
    case "personal_brand":
      return "personal brand growth";
    case "business_marketing":
      return "business marketing";
    case "agency_clients":
      return "agency client delivery";
    default:
      return "";
  }
}

function buildLeadTemplateTokens(input: {
  leadName: string;
  workspaceName: string;
  businessName?: string;
  websiteUrl?: string | null;
  leadSource: GrowthLead["source"];
  useCase?: string | null;
  industry?: string | null;
}): Record<string, string> {
  const trimmedLeadName = input.leadName.trim();
  const firstName = trimmedLeadName.split(/\s+/)[0] || "there";
  const leadSourceLabel = formatLeadSourceLabel(input.leadSource);
  const useCaseLabel = formatUseCaseLabel(input.useCase ?? null);
  const workspaceName = input.workspaceName.trim();
  const businessName = input.businessName?.trim() || workspaceName;

  return {
    first_name: firstName,
    lead_name: trimmedLeadName,
    workspace_name: workspaceName,
    business_name: businessName,
    website_url: input.websiteUrl?.trim() ?? "",
    lead_source: input.leadSource,
    lead_source_label: leadSourceLabel,
    lead_source_line: leadSourceLabel
      ? `You came in through ${leadSourceLabel}, so this sequence will stay practical and short.`
      : "",
    use_case: useCaseLabel,
    use_case_line: useCaseLabel
      ? `${businessName} is set up for ${useCaseLabel}, so each step is meant to move you to one shipped result quickly.`
      : "",
    industry: input.industry?.trim() ?? "",
  };
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

async function recordGrowthLeadEvent(
  input: {
    businessId: string;
    leadId: string;
    eventType: GrowthLeadEventType;
    stepRunId?: string;
    providerMessageId?: string;
    metadata?: Record<string, unknown>;
    occurredAt?: string;
  },
  client?: PoolClient,
): Promise<void> {
  await executeQuery(
    `
      insert into growth_lead_events (
        business_id,
        lead_id,
        step_run_id,
        provider_message_id,
        event_type,
        metadata_json,
        occurred_at
      ) values (
        $1::uuid,
        $2::uuid,
        $3::uuid,
        $4,
        $5,
        $6::jsonb,
        coalesce($7::timestamptz, now())
      )
      on conflict do nothing
    `,
    [
      input.businessId,
      input.leadId,
      input.stepRunId ?? null,
      input.providerMessageId ?? null,
      input.eventType,
      JSON.stringify(input.metadata ?? {}),
      input.occurredAt ?? null,
    ],
    client,
  );
}

async function findGrowthLeadByEmail(
  businessId: string,
  email: string,
  client?: PoolClient,
): Promise<GrowthLeadRow | null> {
  const result = await executeQuery<GrowthLeadRow>(
    `
      select
        id,
        business_id,
        name,
        email,
        phone,
        source,
        status,
        notes,
        first_email_sent_at,
        last_contacted_at,
        created_at,
        updated_at
      from growth_leads
      where business_id = $1
        and lower(email) = lower($2)
      limit 1
    `,
    [businessId, email],
    client,
  );

  return result.rows[0] ?? null;
}

async function ensureEmailContactForLead(input: {
  businessId: string;
  email: string;
  fullName: string;
  client: PoolClient;
}): Promise<void> {
  const firstName = input.fullName.trim().split(/\s+/)[0] || null;

  await input.client.query(
    `
      insert into email_contacts (
        business_id,
        email,
        first_name
      )
      values ($1, $2, $3)
      on conflict do nothing
    `,
    [input.businessId, normalizeEmail(input.email), firstName],
  );
}

async function ensureDefaultGrowthFlow(
  businessId: string,
  client: PoolClient,
): Promise<{ flowId: string; stepIds: string[] }> {
  const existingFlowResult = await client.query<GrowthAutomationFlowRow>(
    `
      select
        id,
        business_id,
        name,
        slug,
        trigger,
        status,
        created_at,
        updated_at
      from growth_automation_flows
      where business_id = $1
        and slug = $2
      limit 1
    `,
    [businessId, DEFAULT_FLOW_SLUG],
  );

  let flowId = existingFlowResult.rows[0]?.id;

  if (!flowId) {
    const insertedFlowResult = await client.query<{ id: string }>(
      `
        insert into growth_automation_flows (
          business_id,
          name,
          slug,
          trigger,
          status
        )
        values ($1, $2, $3, 'lead_created', 'active')
        returning id
      `,
      [businessId, DEFAULT_FLOW_NAME, DEFAULT_FLOW_SLUG],
    );

    flowId = insertedFlowResult.rows[0].id;
  }

  for (const step of DEFAULT_FLOW_STEPS) {
    await client.query(
      `
        insert into growth_automation_steps (
          flow_id,
          day_offset,
          channel,
          template_key,
          subject,
          body_text,
          body_html,
          is_active
        )
        values ($1, $2, 'email', $3, $4, $5, $6, true)
        on conflict (flow_id, template_key)
        do update set
          day_offset = excluded.day_offset,
          subject = excluded.subject,
          body_text = excluded.body_text,
          body_html = excluded.body_html,
          is_active = true,
          updated_at = now()
      `,
      [
        flowId,
        step.dayOffset,
        step.templateKey,
        step.subject,
        step.bodyText,
        convertTextTemplateToHtml(step.bodyText),
      ],
    );
  }

  const stepResult = await client.query<{ id: string }>(
    `
      select id
      from growth_automation_steps
      where flow_id = $1
      order by day_offset asc, created_at asc
    `,
    [flowId],
  );

  return {
    flowId,
    stepIds: stepResult.rows.map((row) => row.id),
  };
}

async function enrollLeadInDefaultFlow(
  leadId: string,
  businessId: string,
  client: PoolClient,
): Promise<string[]> {
  const { flowId } = await ensureDefaultGrowthFlow(businessId, client);

  const enrollmentResult = await client.query<EnrollmentRow>(
    `
      insert into growth_automation_enrollments (
        business_id,
        lead_id,
        flow_id,
        status
      )
      values ($1, $2, $3, 'active')
      on conflict (lead_id, flow_id)
      do nothing
      returning id, flow_id
    `,
    [businessId, leadId, flowId],
  );

  let enrollmentId = enrollmentResult.rows[0]?.id;
  const insertedEnrollment = Boolean(enrollmentId);

  if (!enrollmentId) {
    const existingEnrollmentResult = await client.query<EnrollmentRow>(
      `
        select id, flow_id
        from growth_automation_enrollments
        where lead_id = $1
          and flow_id = $2
        limit 1
      `,
      [leadId, flowId],
    );
    enrollmentId = existingEnrollmentResult.rows[0]?.id;
  }

  if (!enrollmentId) {
    throw new HttpError(
      500,
      "growth_enrollment_create_failed",
      "Unable to create or load the growth enrollment.",
    );
  }

  await client.query(
    `
      insert into growth_automation_step_runs (
        business_id,
        enrollment_id,
        lead_id,
        step_id,
        scheduled_for,
        status
      )
      select
        $1,
        $2,
        $3,
        s.id,
        now() + make_interval(days => s.day_offset),
        'pending'
      from growth_automation_steps s
      where s.flow_id = $4
        and s.is_active = true
      on conflict (enrollment_id, step_id)
      do nothing
    `,
    [businessId, enrollmentId, leadId, flowId],
  );

  if (insertedEnrollment) {
    await recordGrowthLeadEvent(
      {
        businessId,
        leadId,
        eventType: "enrolled",
        metadata: {
          flowId,
          flowSlug: DEFAULT_FLOW_SLUG,
        },
      },
      client,
    );
  }

  return [flowId];
}

async function completeEnrollmentIfFinished(enrollmentId: string): Promise<void> {
  const remainingResult = await queryDb<{ total: string | number }>(
    `
      select count(*) as total
      from growth_automation_step_runs
      where enrollment_id = $1
        and status in ('pending', 'processing')
    `,
    [enrollmentId],
  );

  const remaining = Number(remainingResult.rows[0]?.total ?? 0);

  if (remaining > 0) {
    return;
  }

  await queryDb(
    `
      update growth_automation_enrollments
      set
        status = case when status = 'failed' then status else 'completed' end,
        completed_at = coalesce(completed_at, now()),
        updated_at = now()
      where id = $1
    `,
    [enrollmentId],
  );
}

export async function listGrowthLeads(
  businessId: string,
): Promise<GrowthLeadListResponse> {
  const result = await queryDb<GrowthLeadRow>(
    `
      select
        id,
        business_id,
        name,
        email,
        phone,
        source,
        status,
        notes,
        first_email_sent_at,
        last_contacted_at,
        created_at,
        updated_at
      from growth_leads
      where business_id = $1
      order by created_at desc
    `,
    [businessId],
  );

  return {
    leads: result.rows.map(mapLead),
  };
}

export async function listGrowthLeadEvents(
  businessId: string,
  leadId: string,
): Promise<GrowthLeadEventListResponse> {
  const leadCheckResult = await queryDb<{ id: string }>(
    `
      select id
      from growth_leads
      where id = $1
        and business_id = $2
      limit 1
    `,
    [leadId, businessId],
  );

  if (!leadCheckResult.rows[0]?.id) {
    throw new HttpError(404, "growth_lead_not_found", "Lead was not found.");
  }

  const result = await queryDb<GrowthLeadEventRow>(
    `
      select
        id,
        business_id,
        lead_id,
        step_run_id,
        provider_message_id,
        event_type,
        metadata_json,
        occurred_at,
        created_at
      from growth_lead_events
      where business_id = $1
        and lead_id = $2
      order by occurred_at desc, created_at desc
    `,
    [businessId, leadId],
  );

  return {
    events: result.rows.map(mapLeadEvent),
  };
}

export async function listGrowthAutomationFlows(
  businessId: string,
): Promise<GrowthAutomationFlowListResponse> {
  await withDbTransaction(async (client) => {
    await ensureDefaultGrowthFlow(businessId, client);
  });

  const [flowResult, stepResult] = await Promise.all([
    queryDb<GrowthAutomationFlowRow>(
      `
        select
          id,
          business_id,
          name,
          slug,
          trigger,
          status,
          created_at,
          updated_at
        from growth_automation_flows
        where business_id = $1
        order by created_at asc
      `,
      [businessId],
    ),
    queryDb<GrowthAutomationStepRow>(
      `
        select
          s.id,
          s.flow_id,
          s.day_offset,
          s.channel,
          s.template_key,
          s.subject,
          s.body_text,
          s.body_html,
          s.is_active,
          s.created_at,
          s.updated_at
        from growth_automation_steps s
        join growth_automation_flows f on f.id = s.flow_id
        where f.business_id = $1
        order by s.day_offset asc, s.created_at asc
      `,
      [businessId],
    ),
  ]);

  const stepsByFlowId = new Map<string, GrowthAutomationStep[]>();

  for (const row of stepResult.rows) {
    const nextSteps = stepsByFlowId.get(row.flow_id) ?? [];
    nextSteps.push(mapStep(row));
    stepsByFlowId.set(row.flow_id, nextSteps);
  }

  return {
    flows: flowResult.rows.map((row) => ({
      id: row.id,
      businessId: row.business_id,
      name: row.name,
      slug: row.slug,
      trigger: row.trigger,
      status: row.status,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
      steps: stepsByFlowId.get(row.id) ?? [],
    })),
  };
}

export async function createGrowthLead(
  input: CreateGrowthLeadRequest,
): Promise<CreateGrowthLeadResponse> {
  const normalizedName = input.name.trim();
  const normalizedEmail = normalizeEmail(input.email);

  if (!normalizedName) {
    throw new HttpError(400, "growth_lead_name_required", "Lead name is required.");
  }

  assertValidEmail(normalizedEmail);

  return withDbTransaction(async (client) => {
    const existingLead = await findGrowthLeadByEmail(input.businessId, normalizedEmail, client);
    let leadRow: GrowthLeadRow;
    let createdLead = false;

    if (existingLead) {
      const updatedLeadResult = await client.query<GrowthLeadRow>(
        `
          update growth_leads
          set
            name = $3,
            phone = coalesce($4, growth_leads.phone),
            source = coalesce($5, growth_leads.source),
            notes = coalesce($6, growth_leads.notes),
            updated_at = now()
          where id = $1
            and business_id = $2
          returning
            id,
            business_id,
            name,
            email,
            phone,
            source,
            status,
            notes,
            first_email_sent_at,
            last_contacted_at,
            created_at,
            updated_at
        `,
        [
          existingLead.id,
          input.businessId,
          normalizedName,
          normalizeOptionalString(input.phone),
          input.source ?? null,
          normalizeOptionalString(input.notes),
        ],
      );

      leadRow = updatedLeadResult.rows[0];
    } else {
      const insertedLeadResult = await client.query<GrowthLeadRow>(
        `
          insert into growth_leads (
            business_id,
            name,
            email,
            phone,
            source,
            notes
          )
          values ($1, $2, $3, $4, $5, $6)
          returning
            id,
            business_id,
            name,
            email,
            phone,
            source,
            status,
            notes,
            first_email_sent_at,
            last_contacted_at,
            created_at,
            updated_at
        `,
        [
          input.businessId,
          normalizedName,
          normalizedEmail,
          normalizeOptionalString(input.phone),
          input.source ?? "manual",
          normalizeOptionalString(input.notes),
        ],
      );

      leadRow = insertedLeadResult.rows[0];
      createdLead = true;
    }

    await ensureEmailContactForLead({
      businessId: input.businessId,
      email: normalizedEmail,
      fullName: normalizedName,
      client,
    });

    if (createdLead) {
      await recordGrowthLeadEvent(
        {
          businessId: input.businessId,
          leadId: leadRow.id,
          eventType: "captured",
          metadata: {
            source: leadRow.source,
          },
        },
        client,
      );
    }

    const enrolledFlowIds = await enrollLeadInDefaultFlow(leadRow.id, input.businessId, client);

    return {
      lead: mapLead(leadRow),
      enrolledFlowIds,
    };
  });
}

export async function updateGrowthLeadStatus(
  leadId: string,
  input: UpdateGrowthLeadStatusRequest,
): Promise<UpdateGrowthLeadStatusResponse> {
  return withDbTransaction(async (client) => {
    const existingResult = await client.query<GrowthLeadRow>(
      `
        select
          id,
          business_id,
          name,
          email,
          phone,
          source,
          status,
          notes,
          first_email_sent_at,
          last_contacted_at,
          created_at,
          updated_at
        from growth_leads
        where id = $1
          and business_id = $2
        limit 1
      `,
      [leadId, input.businessId],
    );

    const existing = existingResult.rows[0];

    if (!existing) {
      throw new HttpError(404, "growth_lead_not_found", "Lead was not found.");
    }

    const result = await client.query<GrowthLeadRow>(
      `
        update growth_leads
        set
          status = $3,
          updated_at = now()
        where id = $1
          and business_id = $2
        returning
          id,
          business_id,
          name,
          email,
          phone,
          source,
          status,
          notes,
          first_email_sent_at,
          last_contacted_at,
          created_at,
          updated_at
      `,
      [leadId, input.businessId, input.status],
    );

    const row = result.rows[0];

    if (existing.status !== row.status) {
      await recordGrowthLeadEvent(
        {
          businessId: input.businessId,
          leadId,
          eventType: "status_changed",
          metadata: {
            fromStatus: existing.status,
            toStatus: row.status,
          },
        },
        client,
      );
    }

    return {
      lead: mapLead(row),
    };
  });
}

async function claimDueStepRuns(limit: number): Promise<ClaimedRunRow[]> {
  return withDbTransaction(async (client) => {
    const dueIdsResult = await client.query<{ id: string }>(
      `
        select r.id
        from growth_automation_step_runs r
        join growth_automation_enrollments e on e.id = r.enrollment_id
        join growth_automation_flows f on f.id = e.flow_id
        where r.status = 'pending'
          and r.scheduled_for <= now()
          and r.retry_count < $2
          and e.status = 'active'
          and f.status = 'active'
        order by r.scheduled_for asc
        limit $1
        for update skip locked
      `,
      [limit, Number.isFinite(WORKER_MAX_ATTEMPTS) && WORKER_MAX_ATTEMPTS > 0 ? WORKER_MAX_ATTEMPTS : 3],
    );

    const dueIds = dueIdsResult.rows.map((row) => row.id);

    if (dueIds.length === 0) {
      return [];
    }

    await client.query(
      `
        update growth_automation_step_runs
        set
          status = 'processing',
          retry_count = retry_count + 1,
          last_attempted_at = now(),
          updated_at = now()
        where id = any($1::uuid[])
      `,
      [dueIds],
    );

    const claimedRowsResult = await client.query<ClaimedRunRow>(
      `
        select
          r.id as run_id,
          r.business_id,
          r.enrollment_id,
          r.lead_id,
          r.step_id,
          r.scheduled_for,
          f.name as flow_name,
          f.slug as flow_slug,
          s.template_key as step_template_key,
          s.subject as step_subject,
          s.body_text as step_body_text,
          s.body_html as step_body_html,
          l.name as lead_name,
          l.email as lead_email,
          l.status as lead_status,
          l.source as lead_source,
          b.name as business_name,
          b.brand_name as business_brand_name,
          b.website_url as business_website_url,
          op.use_case as onboarding_use_case,
          bp.industry as brand_industry,
          r.retry_count
        from growth_automation_step_runs r
        join growth_automation_enrollments e on e.id = r.enrollment_id
        join growth_automation_flows f on f.id = e.flow_id
        join growth_automation_steps s on s.id = r.step_id
        join growth_leads l on l.id = r.lead_id
        join businesses b on b.id = r.business_id
        left join onboarding_profiles op on op.business_id = r.business_id
        left join brand_profiles bp on bp.business_id = r.business_id
        where r.id = any($1::uuid[])
        order by r.scheduled_for asc
      `,
      [dueIds],
    );

    return claimedRowsResult.rows;
  });
}

async function markRunStatus(
  runId: string,
  status: GrowthAutomationRunStatus,
  input: {
    businessId: string;
    enrollmentId: string;
    leadId: string;
    providerMessageId?: string;
    failureReason?: string;
    stepTemplateKey?: string;
    flowSlug?: string;
  },
): Promise<void> {
  await queryDb(
    `
      update growth_automation_step_runs
      set
        status = $2,
        provider_message_id = coalesce($3, provider_message_id),
        sent_at = case when $2 = 'sent' then now() else sent_at end,
        failed_at = case when $2 = 'failed' then now() else failed_at end,
        failure_reason = $4,
        updated_at = now()
      where id = $1
    `,
    [runId, status, input.providerMessageId ?? null, input.failureReason ?? null],
  );

  await queryDb(
    `
      update growth_automation_enrollments
      set
        last_run_at = now(),
        status = case when $2 = 'failed' then 'failed' else status end,
        updated_at = now()
      where id = $1
    `,
    [input.enrollmentId, status],
  );

  if (status === "sent") {
    await queryDb(
      `
        update growth_leads
        set
          status = case when status = 'new' then 'engaged' else status end,
          first_email_sent_at = coalesce(first_email_sent_at, now()),
          last_contacted_at = now(),
          updated_at = now()
        where id = $1
      `,
      [input.leadId],
    );
    await incrementBusinessDailyUsage(input.businessId, "emails");

    await recordGrowthLeadEvent({
      businessId: input.businessId,
      leadId: input.leadId,
      stepRunId: runId,
      providerMessageId: input.providerMessageId,
      eventType: "email_sent",
      metadata: {
        flowSlug: input.flowSlug,
        templateKey: input.stepTemplateKey,
      },
    });
  }

  if (status === "failed") {
    await recordGrowthLeadEvent({
      businessId: input.businessId,
      leadId: input.leadId,
      stepRunId: runId,
      providerMessageId: input.providerMessageId,
      eventType: "email_failed",
      metadata: {
        flowSlug: input.flowSlug,
        templateKey: input.stepTemplateKey,
        reason: input.failureReason ?? null,
      },
    });
  }

  if (status === "skipped") {
    await recordGrowthLeadEvent({
      businessId: input.businessId,
      leadId: input.leadId,
      stepRunId: runId,
      eventType: "step_skipped",
      metadata: {
        flowSlug: input.flowSlug,
        templateKey: input.stepTemplateKey,
        reason: input.failureReason ?? null,
      },
    });
  }

  await completeEnrollmentIfFinished(input.enrollmentId);
}

async function rescheduleRunAfterFailure(row: ClaimedRunRow, failureReason: string): Promise<void> {
  const maxAttempts = Number.isFinite(WORKER_MAX_ATTEMPTS) && WORKER_MAX_ATTEMPTS > 0 ? WORKER_MAX_ATTEMPTS : 3;
  const retryDelayMinutes =
    Number.isFinite(WORKER_RETRY_DELAY_MINUTES) && WORKER_RETRY_DELAY_MINUTES > 0
      ? WORKER_RETRY_DELAY_MINUTES
      : 15;

  if (Number(row.retry_count) >= maxAttempts) {
    await markRunStatus(row.run_id, "failed", {
      businessId: row.business_id,
      enrollmentId: row.enrollment_id,
      leadId: row.lead_id,
      failureReason,
      stepTemplateKey: row.step_template_key,
      flowSlug: row.flow_slug,
    });
    return;
  }

  await queryDb(
    `
      update growth_automation_step_runs
      set
        status = 'pending',
        scheduled_for = now() + make_interval(mins => $2),
        failure_reason = $3,
        updated_at = now()
      where id = $1
    `,
    [row.run_id, retryDelayMinutes, failureReason],
  );
}

async function processClaimedRun(row: ClaimedRunRow): Promise<void> {
  if (row.lead_status === "converted" || row.lead_status === "churned") {
    await markRunStatus(row.run_id, "skipped", {
      businessId: row.business_id,
      enrollmentId: row.enrollment_id,
      leadId: row.lead_id,
      failureReason: `Lead is ${row.lead_status}.`,
      stepTemplateKey: row.step_template_key,
      flowSlug: row.flow_slug,
    });
    return;
  }

  const workspaceName = row.business_brand_name || row.business_name;
  const tokens = buildLeadTemplateTokens({
    leadName: row.lead_name,
    workspaceName,
    businessName: row.business_brand_name || row.business_name,
    websiteUrl: row.business_website_url,
    leadSource: row.lead_source,
    useCase: row.onboarding_use_case,
    industry: row.brand_industry,
  });
  const subject = compactRenderedTemplate(renderTemplate(row.step_subject, tokens));
  const textBody = compactRenderedTemplate(renderTemplate(row.step_body_text, tokens));
  const htmlBody = convertTextTemplateToHtml(textBody);

  if (!subject || !textBody || !htmlBody) {
    await markRunStatus(row.run_id, "failed", {
      businessId: row.business_id,
      enrollmentId: row.enrollment_id,
      leadId: row.lead_id,
      failureReason: "Automation step rendered an empty email.",
      stepTemplateKey: row.step_template_key,
      flowSlug: row.flow_slug,
    });
    return;
  }

  const fromEmail = process.env.SYSTEM_FROM_EMAIL?.trim();

  if (!fromEmail) {
    await markRunStatus(row.run_id, "failed", {
      businessId: row.business_id,
      enrollmentId: row.enrollment_id,
      leadId: row.lead_id,
      failureReason: "SYSTEM_FROM_EMAIL is not configured.",
      stepTemplateKey: row.step_template_key,
      flowSlug: row.flow_slug,
    });
    return;
  }

  const sent = await sendPlatformEmail({
    fromEmail,
    fromName: workspaceName || process.env.SYSTEM_FROM_NAME?.trim() || undefined,
    toEmail: row.lead_email,
    subject,
    htmlBody,
    textBody,
    tags: {
      category: "growth_automation",
      business_id: row.business_id,
      flow: row.flow_slug,
      template: row.step_template_key,
      lead_id: row.lead_id,
      run_id: row.run_id,
    },
  });

  await markRunStatus(row.run_id, "sent", {
    businessId: row.business_id,
    enrollmentId: row.enrollment_id,
    leadId: row.lead_id,
    providerMessageId: sent.messageId,
    stepTemplateKey: row.step_template_key,
    flowSlug: row.flow_slug,
  });
}

export async function recordGrowthProviderFeedbackEvent(input: {
  providerMessageId: string;
  eventType: "email_delivered" | "email_bounced" | "email_complained";
  occurredAt: string;
  leadIdTag?: string;
  runIdTag?: string;
  metadata?: Record<string, unknown>;
}, client?: PoolClient): Promise<void> {
  const execute = async (dbClient: PoolClient): Promise<void> => {
    const runLookupResult = input.runIdTag
      ? await dbClient.query<{ run_id: string; business_id: string; lead_id: string }>(
          `
            select
              id as run_id,
              business_id,
              lead_id
            from growth_automation_step_runs
            where id::text = $1
            limit 1
          `,
          [input.runIdTag],
        )
      : { rows: [] as Array<{ run_id: string; business_id: string; lead_id: string }> };

    let resolved = runLookupResult.rows[0];

    if (!resolved) {
      const messageLookupResult = await dbClient.query<{ run_id: string; business_id: string; lead_id: string }>(
        `
          select
            id as run_id,
            business_id,
            lead_id
          from growth_automation_step_runs
          where provider_message_id = $1
          limit 1
        `,
        [input.providerMessageId],
      );
      resolved = messageLookupResult.rows[0];
    }

    if (!resolved && input.leadIdTag) {
      const leadLookupResult = await dbClient.query<{ business_id: string; lead_id: string }>(
        `
          select
            business_id,
            id as lead_id
          from growth_leads
          where id::text = $1
          limit 1
        `,
        [input.leadIdTag],
      );

      const leadMatch = leadLookupResult.rows[0];
      if (leadMatch) {
        resolved = {
          run_id: input.runIdTag ?? "",
          business_id: leadMatch.business_id,
          lead_id: leadMatch.lead_id,
        };
      }
    }

    if (!resolved) {
      return;
    }

    await recordGrowthLeadEvent(
      {
        businessId: resolved.business_id,
        leadId: resolved.lead_id,
        stepRunId: resolved.run_id || undefined,
        providerMessageId: input.providerMessageId,
        eventType: input.eventType,
        occurredAt: input.occurredAt,
        metadata: input.metadata,
      },
      dbClient,
    );
  };

  if (client) {
    await execute(client);
    return;
  }

  await withDbTransaction(execute);
}

export async function processGrowthAutomationDueRuns(
  limit = Number.isFinite(WORKER_BATCH_SIZE) && WORKER_BATCH_SIZE > 0 ? WORKER_BATCH_SIZE : 25,
): Promise<{ processedCount: number; sentCount: number; failedCount: number; skippedCount: number }> {
  const claimedRuns = await claimDueStepRuns(limit);
  let sentCount = 0;
  let failedCount = 0;
  let skippedCount = 0;

  for (const row of claimedRuns) {
    try {
      await processClaimedRun(row);
      const refreshedStatusResult = await queryDb<{ status: GrowthAutomationRunStatus }>(
        `
          select status
          from growth_automation_step_runs
          where id = $1
          limit 1
        `,
        [row.run_id],
      );
      const status = refreshedStatusResult.rows[0]?.status;

      if (status === "sent") {
        sentCount += 1;
      } else if (status === "skipped") {
        skippedCount += 1;
      } else if (status === "failed") {
        failedCount += 1;
      }
    } catch (error) {
      await rescheduleRunAfterFailure(
        row,
        error instanceof Error ? error.message : "Unknown automation failure.",
      );

      const refreshedStatusResult = await queryDb<{ status: GrowthAutomationRunStatus }>(
        `
          select status
          from growth_automation_step_runs
          where id = $1
          limit 1
        `,
        [row.run_id],
      );

      if (refreshedStatusResult.rows[0]?.status === "failed") {
        failedCount += 1;
      }
    }
  }

  return {
    processedCount: claimedRuns.length,
    sentCount,
    failedCount,
    skippedCount,
  };
}
