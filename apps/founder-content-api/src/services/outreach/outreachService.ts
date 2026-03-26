import { randomUUID } from "node:crypto";
import type {
  CreateOutreachMessageRequest,
  CreateOutreachMessageResponse,
  ImportOutreachLeadsRequest,
  ImportOutreachLeadsResponse,
  OutreachLead,
  OutreachLeadFilters,
  OutreachLeadHistoryResponse,
  OutreachLeadStatus,
  OutreachMessage,
  OutreachMessageDraftRequest,
  OutreachMessageDraftResponse,
  OutreachMessageTone,
  OutreachOverview,
  OutreachPriority,
  OutreachReplyDraftRequest,
  OutreachReplyDraftResponse,
  OutreachReplySentiment,
  UpdateOutreachLeadStatusRequest,
} from "../../../../../packages/shared-types/index.ts";
import type { PoolClient, QueryResultRow } from "pg";
import { safeLogEvent } from "../analytics/eventLoggingService.ts";
import { queryDb, withDbTransaction } from "../db/client.ts";
import { HttpError } from "../../utils/http.ts";

const FOLLOWUP_WINDOW_MS = 48 * 60 * 60 * 1000;

interface OutreachLeadRow extends QueryResultRow {
  id: string;
  business_id: string;
  name: string;
  role: string;
  platform: "linkedin" | "reddit" | "x";
  profile_url: string;
  bio: string;
  recent_post: string;
  engagement_label: "low" | "medium" | "high";
  posts_frequently: boolean;
  low_engagement: boolean;
  founder_keyword: boolean;
  priority_score: string | number;
  status: OutreachLeadStatus;
  contacted_at: Date | string | null;
  replied_at: Date | string | null;
  last_post_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface OutreachMessageRow extends QueryResultRow {
  id: string;
  lead_id: string;
  business_id: string;
  type: OutreachMessage["type"];
  author: OutreachMessage["author"];
  content: string;
  tone: OutreachMessageTone | null;
  created_at: Date | string;
  sent_at: Date | string | null;
}

interface OutreachReplyRow extends QueryResultRow {
  id: string;
  lead_id: string;
  business_id: string;
  content: string;
  sentiment: OutreachReplySentiment;
  detected_at: Date | string;
}

function toIsoString(value: Date | string | null | undefined): string | undefined {
  return value ? new Date(value).toISOString() : undefined;
}

function toNumber(value: string | number | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function scoreLead(lead: Pick<OutreachLead, "postsFrequently" | "lowEngagement" | "founderKeyword">): number {
  let score = 0;

  if (lead.postsFrequently) {
    score += 30;
  }

  if (lead.lowEngagement) {
    score += 40;
  }

  if (lead.founderKeyword) {
    score += 30;
  }

  return score;
}

function priorityFromScore(score: number): OutreachPriority {
  if (score >= 85) {
    return "high";
  }

  if (score >= 55) {
    return "medium";
  }

  return "low";
}

function isFollowupDue(lead: OutreachLead): boolean {
  if (lead.status !== "contacted" || !lead.contactedAt || lead.repliedAt) {
    return false;
  }

  return Date.now() - new Date(lead.contactedAt).getTime() >= FOLLOWUP_WINDOW_MS;
}

function sortLeads(leads: OutreachLead[]): OutreachLead[] {
  return [...leads].sort((left, right) => {
    if (right.priorityScore !== left.priorityScore) {
      return right.priorityScore - left.priorityScore;
    }

    const leftTimestamp = new Date(left.lastPostAt ?? left.contactedAt ?? 0).getTime();
    const rightTimestamp = new Date(right.lastPostAt ?? right.contactedAt ?? 0).getTime();
    return rightTimestamp - leftTimestamp;
  });
}

function matchesFilterValue<T extends string>(
  actual: T,
  expected: T | "all" | undefined,
): boolean {
  return !expected || expected === "all" || actual === expected;
}

function mapOutreachMessage(row: OutreachMessageRow): OutreachMessage {
  return {
    id: row.id,
    leadId: row.lead_id,
    businessId: row.business_id,
    type: row.type,
    author: row.author,
    content: row.content,
    tone: row.tone ?? undefined,
    createdAt: new Date(row.created_at).toISOString(),
    sentAt: toIsoString(row.sent_at),
  };
}

function mapReplyAsMessage(row: OutreachReplyRow): OutreachMessage {
  return {
    id: row.id,
    leadId: row.lead_id,
    businessId: row.business_id,
    type: "reply",
    author: "lead",
    content: row.content,
    createdAt: new Date(row.detected_at).toISOString(),
  };
}

function mapLead(
  row: OutreachLeadRow,
  messageHistory: OutreachMessage[],
  latestReply?: OutreachReplyRow,
): OutreachLead {
  const priorityScore = toNumber(row.priority_score);

  return {
    id: row.id,
    businessId: row.business_id,
    name: row.name,
    role: row.role,
    platform: row.platform,
    profileUrl: row.profile_url,
    bio: row.bio,
    recentPost: row.recent_post,
    engagementLabel: row.engagement_label,
    postsFrequently: row.posts_frequently,
    lowEngagement: row.low_engagement,
    founderKeyword: row.founder_keyword,
    priorityScore,
    priority: priorityFromScore(priorityScore),
    status: row.status,
    contactedAt: toIsoString(row.contacted_at),
    repliedAt: toIsoString(row.replied_at),
    lastPostAt: toIsoString(row.last_post_at),
    replyContent: latestReply?.content,
    replySentiment: latestReply?.sentiment,
    messageHistory,
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

async function loadMessageHistory(
  leadIds: string[],
  client?: PoolClient,
): Promise<{
  messagesByLeadId: Map<string, OutreachMessage[]>;
  latestReplyByLeadId: Map<string, OutreachReplyRow>;
}> {
  if (leadIds.length === 0) {
    return {
      messagesByLeadId: new Map(),
      latestReplyByLeadId: new Map(),
    };
  }

  const [messageResult, replyResult] = await Promise.all([
    executeQuery<OutreachMessageRow>(
      `
        select
          id,
          lead_id,
          business_id,
          type,
          author,
          content,
          tone,
          created_at,
          sent_at
        from outreach_messages
        where lead_id = any($1::uuid[])
        order by coalesce(sent_at, created_at) asc, created_at asc
      `,
      [leadIds],
      client,
    ),
    executeQuery<OutreachReplyRow>(
      `
        select
          id,
          lead_id,
          business_id,
          content,
          sentiment,
          detected_at
        from outreach_replies
        where lead_id = any($1::uuid[])
        order by detected_at asc
      `,
      [leadIds],
      client,
    ),
  ]);

  const messagesByLeadId = new Map<string, OutreachMessage[]>();
  const latestReplyByLeadId = new Map<string, OutreachReplyRow>();

  for (const row of messageResult.rows) {
    const nextMessages = messagesByLeadId.get(row.lead_id) ?? [];
    nextMessages.push(mapOutreachMessage(row));
    messagesByLeadId.set(row.lead_id, nextMessages);
  }

  for (const row of replyResult.rows) {
    const nextMessages = messagesByLeadId.get(row.lead_id) ?? [];
    nextMessages.push(mapReplyAsMessage(row));
    messagesByLeadId.set(row.lead_id, nextMessages);
    latestReplyByLeadId.set(row.lead_id, row);
  }

  for (const [leadId, messages] of messagesByLeadId.entries()) {
    messages.sort(
      (left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
    );
    messagesByLeadId.set(leadId, messages);
  }

  return {
    messagesByLeadId,
    latestReplyByLeadId,
  };
}

async function hydrateLeads(rows: OutreachLeadRow[], client?: PoolClient): Promise<OutreachLead[]> {
  const leadIds = rows.map((row) => row.id);
  const { messagesByLeadId, latestReplyByLeadId } = await loadMessageHistory(leadIds, client);

  return rows.map((row) =>
    mapLead(
      row,
      messagesByLeadId.get(row.id) ?? [],
      latestReplyByLeadId.get(row.id),
    ),
  );
}

async function getLeadRowOrThrow(leadId: string, client?: PoolClient): Promise<OutreachLeadRow> {
  const result = await executeQuery<OutreachLeadRow>(
    `
      select
        id,
        business_id,
        name,
        role,
        platform,
        profile_url,
        bio,
        recent_post,
        engagement_label,
        posts_frequently,
        low_engagement,
        founder_keyword,
        priority_score,
        status,
        contacted_at,
        replied_at,
        last_post_at,
        created_at,
        updated_at
      from outreach_leads
      where id = $1::uuid
      limit 1
    `,
    [leadId],
    client,
  );

  const row = result.rows[0];

  if (!row) {
    throw new HttpError(404, "lead_not_found", "Outreach lead not found.");
  }

  return row;
}

async function getLeadOrThrow(leadId: string, client?: PoolClient): Promise<OutreachLead> {
  const row = await getLeadRowOrThrow(leadId, client);
  const [lead] = await hydrateLeads([row], client);
  return lead;
}

function extractRecentAngle(lead: OutreachLead): string {
  const sentence = lead.recentPost.split(/(?<=[.!?])\s+/)[0] ?? lead.recentPost;
  return sentence.trim().replace(/\s+/g, " ");
}

function buildInitialDraft(lead: OutreachLead, tone: OutreachMessageTone): string {
  const angle = extractRecentAngle(lead);

  if (tone === "direct") {
    return [
      `Hey ${lead.name.split(" ")[0]} - your post on "${angle}" landed.`,
      "Quick question: do you ever know what you want to say, but not what to improve or post next?",
      "I am building a system for founder consistency. Happy to share it if useful.",
    ].join("\n\n");
  }

  if (tone === "curious") {
    return [
      `Hey ${lead.name.split(" ")[0]} - saw your post on "${angle}" and liked the honesty.`,
      "Curious: do you ever feel the hard part is not ideas, but deciding what to turn into content next?",
      "I am building something around that exact gap. Happy to send it over if you want to see it.",
    ].join("\n\n");
  }

  return [
    `Hey ${lead.name.split(" ")[0]} - saw your post on "${angle}", liked the angle.`,
    "Curious if you ever feel stuck on what to improve or post next once the day gets busy?",
    "I am building a lightweight system for founder consistency. Happy to share if useful.",
  ].join("\n\n");
}

function buildFollowupDraft(lead: OutreachLead, tone: OutreachMessageTone): string {
  const firstName = lead.name.split(" ")[0];

  if (tone === "direct") {
    return [
      `Hey ${firstName} - quick follow-up in case this got buried.`,
      "If content consistency is still a priority, I can send you the product and let you try it on one of your recent posts.",
    ].join("\n\n");
  }

  if (tone === "curious") {
    return [
      `Hey ${firstName} - checking this did not get lost.`,
      "Would it be useful if I sent you a tool that tells you what to post next and what to fix before publishing?",
    ].join("\n\n");
  }

  return [
    `Hey ${firstName} - just checking this did not get lost.`,
    "Happy to share early access if you are still exploring ways to stay consistent with content.",
  ].join("\n\n");
}

function buildReplyDraft(lead: OutreachLead, tone: OutreachMessageTone): string {
  const firstName = lead.name.split(" ")[0];
  const reply = lead.replyContent?.trim() || "That sounds interesting.";

  if (tone === "direct") {
    return [
      `Thanks ${firstName} - ${reply}`,
      "The fastest way to judge it is to run one of your recent posts through it and see what it tells you to fix next.",
      "If you want, I can send over early access.",
    ].join("\n\n");
  }

  if (tone === "curious") {
    return [
      `Thanks ${firstName} - ${reply}`,
      "Would it help if I sent you early access and we used one of your recent posts as the test case?",
    ].join("\n\n");
  }

  return [
    `Thanks ${firstName} - appreciate the reply.`,
    "Happy to send early access if you want to test it on one of your recent posts and see what it improves.",
  ].join("\n\n");
}

function createDraftMessage(
  leadId: string,
  businessId: string | undefined,
  type: OutreachMessage["type"],
  content: string,
  tone?: OutreachMessageTone,
): OutreachMessage {
  return {
    id: randomUUID(),
    leadId,
    businessId,
    type,
    author: "ai",
    content,
    tone,
    createdAt: new Date().toISOString(),
  };
}

export async function getOutreachOverview(
  filters: Pick<OutreachLeadFilters, "businessId"> = {},
): Promise<OutreachOverview> {
  const leads = await listOutreachLeads(filters);

  return {
    metrics: {
      leads: leads.length,
      sent: leads.filter((lead) => lead.status !== "new").length,
      replies: leads.filter((lead) => lead.status === "replied" || lead.status === "activated").length,
      conversions: leads.filter((lead) => lead.status === "activated").length,
    },
    pipeline: [
      { key: "new", label: "New", count: leads.filter((lead) => lead.status === "new").length },
      {
        key: "contacted",
        label: "Contacted",
        count: leads.filter((lead) => lead.status === "contacted").length,
      },
      {
        key: "replied",
        label: "Replied",
        count: leads.filter((lead) => lead.status === "replied").length,
      },
      {
        key: "activated",
        label: "Converted",
        count: leads.filter((lead) => lead.status === "activated").length,
      },
    ],
    followupsDue: leads.filter(isFollowupDue).length,
  };
}

export async function listOutreachLeads(filters: OutreachLeadFilters = {}): Promise<OutreachLead[]> {
  const values: unknown[] = [];
  const conditions: string[] = [];

  if (filters.businessId) {
    values.push(filters.businessId);
    conditions.push(`business_id = $${values.length}::uuid`);
  }

  if (filters.platform && filters.platform !== "all") {
    values.push(filters.platform);
    conditions.push(`platform = $${values.length}`);
  }

  if (filters.status && filters.status !== "all") {
    values.push(filters.status);
    conditions.push(`status = $${values.length}`);
  }

  const whereClause = conditions.length > 0 ? `where ${conditions.join(" and ")}` : "";
  const result = await executeQuery<OutreachLeadRow>(
    `
      select
        id,
        business_id,
        name,
        role,
        platform,
        profile_url,
        bio,
        recent_post,
        engagement_label,
        posts_frequently,
        low_engagement,
        founder_keyword,
        priority_score,
        status,
        contacted_at,
        replied_at,
        last_post_at,
        created_at,
        updated_at
      from outreach_leads
      ${whereClause}
      order by priority_score desc, coalesce(last_post_at, contacted_at, created_at) desc
    `,
    values,
  );

  const hydrated = await hydrateLeads(result.rows);
  const filtered = hydrated.filter((lead) => {
    if (filters.queue === "followups" && !isFollowupDue(lead)) {
      return false;
    }

    if (filters.queue === "new" && lead.status !== "new") {
      return false;
    }

    if (!matchesFilterValue(lead.priority, filters.priority)) {
      return false;
    }

    return true;
  });

  return sortLeads(filtered);
}

export async function importOutreachLeads(
  input: ImportOutreachLeadsRequest,
): Promise<ImportOutreachLeadsResponse> {
  const normalizedItems = input.leads
    .map((lead) => ({
      name: lead.name.trim(),
      role: lead.role?.trim() || "Founder",
      platform: lead.platform,
      profileUrl: lead.profileUrl.trim(),
      bio: lead.bio?.trim() || "",
      recentPost: lead.recentPost?.trim() || "",
      engagementLabel: lead.engagementLabel ?? "low",
      postsFrequently: Boolean(lead.postsFrequently),
      lowEngagement: lead.lowEngagement ?? true,
      founderKeyword: lead.founderKeyword ?? true,
      lastPostAt: lead.lastPostAt ? new Date(lead.lastPostAt).toISOString() : null,
    }))
    .filter((lead) => lead.name !== "" && lead.profileUrl !== "");

  if (normalizedItems.length === 0) {
    throw new HttpError(400, "outreach_import_empty", "At least one valid outreach lead is required.");
  }

  const importedLeads = await withDbTransaction(async (client) => {
    const importedRows: OutreachLeadRow[] = [];

    for (const item of normalizedItems) {
      const priorityScore = scoreLead({
        postsFrequently: item.postsFrequently,
        lowEngagement: item.lowEngagement,
        founderKeyword: item.founderKeyword,
      });

      const result = await executeQuery<OutreachLeadRow>(
        `
          insert into outreach_leads (
            business_id,
            name,
            role,
            platform,
            profile_url,
            bio,
            recent_post,
            engagement_label,
            posts_frequently,
            low_engagement,
            founder_keyword,
            priority_score,
            status,
            last_post_at
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
            'new',
            $13
          )
          returning
            id,
            business_id,
            name,
            role,
            platform,
            profile_url,
            bio,
            recent_post,
            engagement_label,
            posts_frequently,
            low_engagement,
            founder_keyword,
            priority_score,
            status,
            contacted_at,
            replied_at,
            last_post_at,
            created_at,
            updated_at
        `,
        [
          input.businessId,
          item.name,
          item.role,
          item.platform,
          item.profileUrl,
          item.bio,
          item.recentPost,
          item.engagementLabel,
          item.postsFrequently,
          item.lowEngagement,
          item.founderKeyword,
          priorityScore,
          item.lastPostAt,
        ],
        client,
      );

      importedRows.push(result.rows[0]);
    }

    return hydrateLeads(importedRows, client);
  });

  return {
    leads: importedLeads,
    importedCount: importedLeads.length,
  };
}

export async function generateOutreachMessageDraft(
  input: OutreachMessageDraftRequest,
): Promise<OutreachMessageDraftResponse> {
  const lead = await getLeadOrThrow(input.leadId);
  const draftType = lead.status === "contacted" || isFollowupDue(lead) ? "followup" : "initial";
  const content =
    draftType === "followup"
      ? buildFollowupDraft(lead, input.tone)
      : buildInitialDraft(lead, input.tone);

  return {
    lead,
    message: createDraftMessage(lead.id, lead.businessId, draftType, content, input.tone),
  };
}

export async function generateOutreachReplyDraft(
  input: OutreachReplyDraftRequest,
): Promise<OutreachReplyDraftResponse> {
  const lead = await getLeadOrThrow(input.leadId);

  if (!lead.replyContent) {
    throw new HttpError(400, "reply_required", "A detected reply is required before drafting a response.");
  }

  return {
    lead,
    message: createDraftMessage(
      lead.id,
      lead.businessId,
      "draft",
      buildReplyDraft(lead, input.tone),
      input.tone,
    ),
  };
}

function resolveOutgoingMessageType(
  lead: OutreachLead,
  explicitType?: OutreachMessage["type"],
): Exclude<OutreachMessage["type"], "draft"> {
  if (explicitType && explicitType !== "draft") {
    return explicitType;
  }

  if (lead.replyContent || lead.status === "replied") {
    return "reply";
  }

  if (lead.status === "contacted" || isFollowupDue(lead)) {
    return "followup";
  }

  return "initial";
}

function resolveNextStatus(
  lead: OutreachLead,
  explicitStatus: OutreachLeadStatus | undefined,
  outgoingType: Exclude<OutreachMessage["type"], "draft">,
): OutreachLeadStatus {
  if (explicitStatus) {
    return explicitStatus;
  }

  if (outgoingType === "reply") {
    return "activated";
  }

  return "contacted";
}

export async function createOutreachMessage(
  input: CreateOutreachMessageRequest,
  actorUserId?: string,
): Promise<CreateOutreachMessageResponse> {
  const { lead, message } = await withDbTransaction(async (client) => {
    const lead = await getLeadOrThrow(input.leadId, client);

    if (lead.businessId !== input.businessId) {
      throw new HttpError(403, "lead_business_mismatch", "Lead does not belong to this workspace.");
    }

    const content = input.content.trim();

    if (content === "") {
      throw new HttpError(400, "outreach_message_required", "Message content is required.");
    }

    const outgoingType = resolveOutgoingMessageType(lead, input.type);
    const nextStatus = resolveNextStatus(lead, input.markStatus, outgoingType);
    const now = new Date().toISOString();

    const messageResult = await executeQuery<OutreachMessageRow>(
      `
        insert into outreach_messages (
          lead_id,
          business_id,
          type,
          author,
          content,
          tone,
          sent_at
        ) values (
          $1::uuid,
          $2::uuid,
          $3,
          'operator',
          $4,
          $5,
          $6::timestamptz
        )
        returning
          id,
          lead_id,
          business_id,
          type,
          author,
          content,
          tone,
          created_at,
          sent_at
      `,
      [lead.id, input.businessId, outgoingType, content, input.tone ?? null, now],
      client,
    );

    await executeQuery(
      `
        update outreach_leads
        set
          status = $2,
          contacted_at = case when $2 = 'contacted' and contacted_at is null then $3::timestamptz else contacted_at end,
          replied_at = case when $2 in ('replied', 'activated') and replied_at is null then $3::timestamptz else replied_at end,
          updated_at = now()
        where id = $1::uuid
      `,
      [lead.id, nextStatus, now],
      client,
    );

    const refreshedLead = await getLeadOrThrow(lead.id, client);
    return {
      lead: refreshedLead,
      message: mapOutreachMessage(messageResult.rows[0]),
    };
  });

  void safeLogEvent("content_selected", actorUserId, input.businessId, {
    source: "outreach",
    leadId: input.leadId,
    messageType: message.type,
  });

  return { lead, message };
}

export async function getOutreachLeadHistory(
  businessId: string,
  leadId: string,
): Promise<OutreachLeadHistoryResponse> {
  const lead = await getLeadOrThrow(leadId);

  if (lead.businessId !== businessId) {
    throw new HttpError(403, "lead_business_mismatch", "Lead does not belong to this workspace.");
  }

  return {
    lead,
    history: lead.messageHistory,
  };
}

export async function updateOutreachLeadStatus(
  leadId: string,
  input: UpdateOutreachLeadStatusRequest,
  businessId?: string,
): Promise<OutreachLead> {
  return withDbTransaction(async (client) => {
    const lead = await getLeadOrThrow(leadId, client);

    if (businessId && lead.businessId !== businessId) {
      throw new HttpError(403, "lead_business_mismatch", "Lead does not belong to this workspace.");
    }

    const now = new Date().toISOString();

    await executeQuery(
      `
        update outreach_leads
        set
          status = $2,
          contacted_at = case when $2 = 'contacted' and contacted_at is null then $3::timestamptz else contacted_at end,
          replied_at = case when $2 in ('replied', 'activated') and replied_at is null then $3::timestamptz else replied_at end,
          updated_at = now()
        where id = $1::uuid
      `,
      [leadId, input.status, now],
      client,
    );

    if (input.messageContent?.trim()) {
      const outgoingType = resolveOutgoingMessageType(lead);
      await executeQuery(
        `
          insert into outreach_messages (
            lead_id,
            business_id,
            type,
            author,
            content,
            tone,
            sent_at
          ) values (
            $1::uuid,
            $2::uuid,
            $3,
            'operator',
            $4,
            $5,
            $6::timestamptz
          )
        `,
        [leadId, lead.businessId, outgoingType, input.messageContent.trim(), input.tone ?? null, now],
        client,
      );
    }

    return getLeadOrThrow(leadId, client);
  });
}
