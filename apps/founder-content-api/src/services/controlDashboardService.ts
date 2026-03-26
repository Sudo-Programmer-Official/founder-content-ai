import type { QueryResultRow } from "pg";
import type {
  ContentAsset,
  ContentAssetStatus,
  ControlDashboardResponse,
  ConvertIdeaToContentRequest,
  ConvertIdeaToContentResponse,
  CreateIdeaInboxRequest,
  CreateIdeaInboxResponse,
  DashboardSuggestion,
  IdeaInboxItem,
  UpdateContentPipelineItemRequest,
  UpdateContentPipelineItemResponse,
} from "../../../../packages/shared-types/index.ts";
import type { AuthenticatedPrincipal } from "../middleware/auth.ts";
import { requireBusinessMembership } from "./authBusinessService.ts";
import { generatePostsWithAI } from "./aiService.ts";
import {
  logEvent,
} from "./analytics/eventLoggingService.ts";
import { recommendPostTimes } from "./growthIntelligenceService.ts";
import { queryDb, withDbTransaction } from "./db/client.ts";
import {
  enforceWorkspaceReadAccess,
  enforceWorkspaceWriteAccess,
} from "./governanceService.ts";
import { recordStyleSignal } from "./styleProfileService.ts";
import { HttpError } from "../utils/http.ts";

interface IdeaInboxRow extends QueryResultRow {
  id: string;
  business_id: string;
  user_id: string | null;
  body: string;
  status: IdeaInboxItem["status"];
  created_at: Date | string;
  updated_at: Date | string;
}

interface ContentAssetRow extends QueryResultRow {
  id: string;
  business_id: string | null;
  user_id: string | null;
  content_type: ContentAsset["contentType"];
  title: string | null;
  content_body: unknown;
  status: ContentAssetStatus;
  pipeline_stage: NonNullable<ContentAsset["pipelineStage"]> | null;
  source_kind: NonNullable<ContentAsset["sourceKind"]> | null;
  source_idea_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface ActivityRow extends QueryResultRow {
  created_at: Date | string;
}

interface ActivityDateRow extends QueryResultRow {
  activity_date: Date | string;
}

const PIPELINE_STAGES = [
  { stage: "draft", label: "Draft" },
  { stage: "review", label: "Review" },
  { stage: "scheduled", label: "Scheduled" },
  { stage: "posted", label: "Posted" },
] as const;

function toIsoString(value: Date | string): string {
  return new Date(value).toISOString();
}

function normalizeText(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function extractTextContent(value: unknown): string {
  if (typeof value === "string" && value.trim() !== "") {
    return value.trim();
  }

  if (!value || typeof value !== "object") {
    return "";
  }

  const candidate = value as Record<string, unknown>;

  if (typeof candidate.content === "string" && candidate.content.trim() !== "") {
    return candidate.content.trim();
  }

  if (typeof candidate.post === "string" && candidate.post.trim() !== "") {
    return candidate.post.trim();
  }

  if (Array.isArray(candidate.variations)) {
    const firstVariation = candidate.variations.find(
      (variation) =>
        variation &&
        typeof variation === "object" &&
        typeof (variation as Record<string, unknown>).content === "string",
    ) as Record<string, unknown> | undefined;

    if (typeof firstVariation?.content === "string" && firstVariation.content.trim() !== "") {
      return firstVariation.content.trim();
    }
  }

  return "";
}

function mapIdeaInboxItem(row: IdeaInboxRow): IdeaInboxItem {
  return {
    id: row.id,
    businessId: row.business_id,
    userId: row.user_id ?? undefined,
    text: row.body,
    status: row.status,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function mapContentAsset(row: ContentAssetRow): ContentAsset {
  return {
    id: row.id,
    businessId: row.business_id ?? undefined,
    userId: row.user_id ?? undefined,
    contentType: row.content_type,
    title: row.title ?? undefined,
    contentBody: row.content_body,
    status: row.status,
    pipelineStage: row.pipeline_stage ?? undefined,
    sourceKind: row.source_kind ?? undefined,
    sourceIdeaId: row.source_idea_id ?? undefined,
    textContent: extractTextContent(row.content_body),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function buildDateLabel(): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(new Date());
}

async function loadPipelineItems(businessId: string): Promise<ContentAsset[]> {
  const result = await queryDb<ContentAssetRow>(
    `
      select
        id,
        business_id,
        user_id,
        content_type,
        title,
        content_body,
        status,
        pipeline_stage,
        source_kind,
        source_idea_id,
        created_at,
        updated_at
      from content_assets
      where business_id = $1
      order by updated_at desc, created_at desc
      limit 40
    `,
    [businessId],
  );

  return result.rows.map(mapContentAsset);
}

async function loadIdeaInbox(businessId: string): Promise<IdeaInboxItem[]> {
  const result = await queryDb<IdeaInboxRow>(
    `
      select
        id,
        business_id,
        user_id,
        body,
        status,
        created_at,
        updated_at
      from idea_inbox_items
      where business_id = $1
        and status <> 'archived'
      order by created_at desc
      limit 12
    `,
    [businessId],
  );

  return result.rows.map(mapIdeaInboxItem);
}

async function loadLastActivityAt(businessId: string): Promise<string | undefined> {
  const result = await queryDb<ActivityRow>(
    `
      select created_at
      from usage_events
      where business_id = $1
      order by created_at desc
      limit 1
    `,
    [businessId],
  );

  const createdAt = result.rows[0]?.created_at;
  return createdAt ? toIsoString(createdAt) : undefined;
}

async function loadActivityDates(businessId: string): Promise<string[]> {
  const result = await queryDb<ActivityDateRow>(
    `
      select distinct date_trunc('day', created_at) as activity_date
      from usage_events
      where business_id = $1
      order by activity_date desc
      limit 30
    `,
    [businessId],
  );

  return result.rows.map((row) => new Date(row.activity_date).toISOString().slice(0, 10));
}

function calculateStreakDays(activityDates: string[]): number {
  if (activityDates.length === 0) {
    return 0;
  }

  const uniqueDates = [...new Set(activityDates)];
  const latestDate = uniqueDates[0];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const latest = new Date(`${latestDate}T00:00:00.000Z`);
  const daysFromToday = Math.round((today.getTime() - latest.getTime()) / (24 * 60 * 60 * 1000));

  if (daysFromToday > 1) {
    return 0;
  }

  let streakDays = 0;
  let cursor = latest;

  for (const activityDate of uniqueDates) {
    const normalizedActivityDate = new Date(`${activityDate}T00:00:00.000Z`);

    if (normalizedActivityDate.getTime() !== cursor.getTime()) {
      break;
    }

    streakDays += 1;
    cursor = new Date(cursor.getTime() - 24 * 60 * 60 * 1000);
  }

  return streakDays;
}

function buildSuggestions(input: {
  pipelineItems: ContentAsset[];
  ideaInbox: IdeaInboxItem[];
  lastActivityAt?: string;
  bestTimeSlots: ControlDashboardResponse["today"]["bestTimeSlots"];
}): DashboardSuggestion[] {
  const suggestions: DashboardSuggestion[] = [];
  const nowMs = Date.now();
  const draftItems = input.pipelineItems.filter((item) => item.pipelineStage === "draft");
  const reviewItems = input.pipelineItems.filter((item) => item.pipelineStage === "review");
  const postedItems = input.pipelineItems.filter((item) => item.pipelineStage === "posted");

  if (!input.lastActivityAt || nowMs - new Date(input.lastActivityAt).getTime() > 72 * 60 * 60 * 1000) {
    suggestions.push({
      id: "activity-restart",
      type: "activity",
      title: "Activity has cooled off",
      description:
        "It has been a few days since the last content action. Capture one fresh idea or move one draft forward today.",
      actionLabel: "Process ideas",
      actionTarget: "idea-inbox",
    });
  }

  if (input.bestTimeSlots[0]) {
    suggestions.push({
      id: "timing-window",
      type: "timing",
      title: "Use the next strong posting window",
      description: `A solid next slot is ${input.bestTimeSlots[0].localLabel}. That keeps the workflow controlled without guessing.`,
      actionLabel: "Use suggestion",
      actionTarget: "today",
      metadata: {
        scheduledAt: input.bestTimeSlots[0].scheduledAt,
      },
    });
  }

  const draftToImprove = draftItems.find((item) => (item.textContent?.length ?? 0) < 280);

  if (draftToImprove) {
    suggestions.push({
      id: "quality-depth",
      type: "quality",
      title: "One draft needs more specificity",
      description:
        "The shortest draft in your pipeline would be stronger with one concrete example, lesson, or outcome.",
      actionLabel: "Edit draft",
      actionTarget: draftToImprove.id,
    });
  } else if (reviewItems.length > 0 && postedItems.length === 0) {
    suggestions.push({
      id: "move-review-forward",
      type: "quality",
      title: "Review is piling up",
      description:
        "You already have reviewed content. Move one item to scheduled or posted instead of generating more.",
      actionLabel: "Open review",
      actionTarget: reviewItems[0].id,
    });
  } else if (input.ideaInbox.length > 4) {
    suggestions.push({
      id: "inbox-triage",
      type: "quality",
      title: "Idea inbox is filling up",
      description:
        "Convert one saved idea into a draft before the inbox turns into another backlog.",
      actionLabel: "Convert idea",
      actionTarget: "idea-inbox",
    });
  }

  return suggestions.slice(0, 3);
}

export async function getControlDashboard(
  principal: AuthenticatedPrincipal,
  businessId: string,
): Promise<ControlDashboardResponse> {
  await enforceWorkspaceReadAccess(principal, businessId, "control_dashboard");
  await requireBusinessMembership(principal, businessId);

  const [pipelineItems, ideaInbox, lastActivityAt, activityDates, recommendation] = await Promise.all([
    loadPipelineItems(businessId),
    loadIdeaInbox(businessId),
    loadLastActivityAt(businessId),
    loadActivityDates(businessId),
    recommendPostTimes({
      businessId,
      userId: principal.userId ?? "",
      contentType: "text",
    }),
  ]);

  const today = {
    businessId,
    dateLabel: buildDateLabel(),
    draftCount: pipelineItems.filter((item) => item.pipelineStage === "draft").length,
    reviewCount: pipelineItems.filter((item) => item.pipelineStage === "review").length,
    scheduledCount: pipelineItems.filter((item) => item.pipelineStage === "scheduled").length,
    postedCount: pipelineItems.filter((item) => item.pipelineStage === "posted").length,
    ideaInboxCount: ideaInbox.filter((item) => item.status === "new").length,
    streakDays: calculateStreakDays(activityDates),
    lastActivityAt,
    bestTimeSlots: recommendation.slots,
  };

  return {
    businessId,
    today,
    pipeline: PIPELINE_STAGES.map((stage) => ({
      stage: stage.stage,
      label: stage.label,
      items: pipelineItems.filter((item) => item.pipelineStage === stage.stage),
    })),
    ideaInbox,
    suggestions: buildSuggestions({
      pipelineItems,
      ideaInbox,
      lastActivityAt,
      bestTimeSlots: recommendation.slots,
    }),
  };
}

export async function createIdeaInboxItem(
  principal: AuthenticatedPrincipal,
  input: CreateIdeaInboxRequest,
): Promise<CreateIdeaInboxResponse> {
  await enforceWorkspaceWriteAccess({
    principal,
    businessId: input.businessId,
    featureKey: "control_dashboard",
  });
  await requireBusinessMembership(principal, input.businessId);
  const text = normalizeText(input.text);

  if (!text) {
    throw new HttpError(400, "bad_request", "Idea text is required.");
  }

  const result = await queryDb<IdeaInboxRow>(
    `
      insert into idea_inbox_items (
        business_id,
        user_id,
        body,
        status
      ) values (
        $1,
        $2,
        $3,
        'new'
      )
      returning
        id,
        business_id,
        user_id,
        body,
        status,
        created_at,
        updated_at
    `,
    [input.businessId, principal.userId ?? null, text],
  );

  const idea = mapIdeaInboxItem(result.rows[0]);
  await logEvent("idea_saved", principal.userId, input.businessId, {
    ideaId: idea.id,
    length: text.length,
  });

  return { idea };
}

export async function convertIdeaInboxItemToContent(
  principal: AuthenticatedPrincipal,
  businessId: string,
  ideaId: string,
  input: ConvertIdeaToContentRequest,
): Promise<ConvertIdeaToContentResponse> {
  await enforceWorkspaceWriteAccess({
    principal,
    businessId,
    featureKey: "control_dashboard",
    usageMetric: "posts",
  });
  await requireBusinessMembership(principal, businessId);

  const result = await withDbTransaction(async (client) => {
    const ideaResult = await client.query<IdeaInboxRow>(
      `
        select
          id,
          business_id,
          user_id,
          body,
          status,
          created_at,
          updated_at
        from idea_inbox_items
        where id = $1
          and business_id = $2
        limit 1
      `,
      [ideaId, businessId],
    );

    const row = ideaResult.rows[0];

    if (!row) {
      throw new HttpError(404, "idea_not_found", "Idea inbox item was not found.");
    }

    const generatedPosts = await generatePostsWithAI({
      topic: row.body,
      tone: normalizeText(input.tone) ?? "storytelling",
      length: normalizeText(input.length) ?? "medium",
      businessId,
    });

    const primaryVariation = generatedPosts.variations[0];
    const primaryContent = primaryVariation?.content ?? row.body;
    const title = primaryVariation?.angle
      ? `${primaryVariation.angle.replace(/(^|-)(\w)/g, (_value, dash, letter) => `${dash ? " " : ""}${String(letter).toUpperCase()}`)} draft`
      : row.body.slice(0, 64);

    const assetResult = await client.query<ContentAssetRow>(
      `
        insert into content_assets (
          business_id,
          user_id,
          content_type,
          title,
          content_body,
          status,
          pipeline_stage,
          source_kind,
          source_idea_id
        ) values (
          $1,
          $2,
          'post',
          $3,
          $4::jsonb,
          'draft',
          'draft',
          'idea',
          $5
        )
        returning
          id,
          business_id,
          user_id,
          content_type,
          title,
          content_body,
          status,
          pipeline_stage,
          source_kind,
          source_idea_id,
          created_at,
          updated_at
      `,
      [
        businessId,
        principal.userId ?? null,
        title,
        JSON.stringify({
          content: primaryContent,
          idea: row.body,
          variations: generatedPosts.variations,
        }),
        row.id,
      ],
    );

    const updatedIdeaResult = await client.query<IdeaInboxRow>(
      `
        update idea_inbox_items
        set
          status = 'converted',
          updated_at = now()
        where id = $1
        returning
          id,
          business_id,
          user_id,
          body,
          status,
          created_at,
          updated_at
      `,
      [row.id],
    );

    return {
      idea: mapIdeaInboxItem(updatedIdeaResult.rows[0]),
      asset: mapContentAsset(assetResult.rows[0]),
    };
  });

  await Promise.all([
    logEvent("idea_converted", principal.userId, businessId, {
      ideaId: result.idea.id,
    }),
    logEvent("post_generated", principal.userId, businessId, {
      route: "idea_inbox_convert",
      ideaId: result.idea.id,
    }),
    logEvent("content_type_selected", principal.userId, businessId, {
      contentType: "post",
      source: "idea_inbox",
    }),
    recordStyleSignal({
      userId: principal.userId,
      businessId,
      tone: normalizeText(input.tone) ?? "storytelling",
      contentType: "post",
    }),
  ]);

  return result;
}

export async function updateContentPipelineItem(
  principal: AuthenticatedPrincipal,
  businessId: string,
  assetId: string,
  input: UpdateContentPipelineItemRequest,
): Promise<UpdateContentPipelineItemResponse> {
  await enforceWorkspaceWriteAccess({
    principal,
    businessId,
    featureKey: "control_dashboard",
  });
  await requireBusinessMembership(principal, businessId);

  const existingResult = await queryDb<ContentAssetRow>(
    `
      select
        id,
        business_id,
        user_id,
        content_type,
        title,
        content_body,
        status,
        pipeline_stage,
        source_kind,
        source_idea_id,
        created_at,
        updated_at
      from content_assets
      where id = $1
        and business_id = $2
      limit 1
    `,
    [assetId, businessId],
  );

  const existing = existingResult.rows[0];

  if (!existing) {
    throw new HttpError(404, "content_asset_not_found", "Pipeline item was not found.");
  }

  const nextTitle = normalizeText(input.title) ?? existing.title ?? null;
  const existingText = extractTextContent(existing.content_body);
  const nextText = normalizeText(input.textContent) ?? existingText;
  const nextStage = input.status ?? existing.pipeline_stage ?? "draft";

  const nextBody =
    nextText !== existingText || typeof existing.content_body !== "object" || !existing.content_body
      ? { content: nextText }
      : existing.content_body;

  const result = await queryDb<ContentAssetRow>(
    `
      update content_assets
      set
        title = $3,
        content_body = $4::jsonb,
        status = case when $5 = 'posted' then 'published' else content_assets.status end,
        pipeline_stage = $5,
        updated_at = now()
      where id = $1
        and business_id = $2
      returning
        id,
        business_id,
        user_id,
        content_type,
        title,
        content_body,
        status,
        pipeline_stage,
        source_kind,
        source_idea_id,
        created_at,
        updated_at
    `,
    [assetId, businessId, nextTitle, JSON.stringify(nextBody), nextStage],
  );

  if (nextText !== existingText || nextTitle !== existing.title) {
    await Promise.all([
      logEvent("content_edited", principal.userId, businessId, {
        assetId,
        stage: nextStage,
      }),
      recordStyleSignal({
        userId: principal.userId,
        businessId,
        contentType: existing.content_type,
        edited: true,
      }),
    ]);
  }

  if (nextStage !== existing.pipeline_stage) {
    await logEvent("content_stage_changed", principal.userId, businessId, {
      assetId,
      from: existing.pipeline_stage ?? "draft",
      to: nextStage,
    });

    if (nextStage === "posted") {
      await logEvent("publish_marked", principal.userId, businessId, {
        assetId,
        source: "control_dashboard",
      });
    }
  }

  return {
    asset: mapContentAsset(result.rows[0]),
  };
}
