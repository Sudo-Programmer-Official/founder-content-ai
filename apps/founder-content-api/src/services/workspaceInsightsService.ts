import type { PoolClient, QueryResultRow } from "pg";
import type {
  ContentAssetIntelligence,
  WorkspaceChannelPerformance,
  WorkspaceContentPatternRollup,
  WorkspaceInsightAngleType,
  WorkspaceInsightPatternType,
  WorkspaceInsightSuggestion,
  WorkspaceInsightsResponse,
  WorkspaceTopicInsight,
} from "../../../../packages/shared-types/index.ts";
import type { AuthenticatedPrincipal } from "../middleware/auth.ts";
import { resolveStoredContentAssetIntelligence } from "./contentIntelligenceService.ts";
import { withDbTransaction } from "./db/client.ts";
import { enforceWorkspaceReadAccess } from "./governanceService.ts";

interface BusinessRow extends QueryResultRow {
  timezone: string | null;
}

interface IdeaInsightRow extends QueryResultRow {
  id: string;
  body: string;
  understanding_json: unknown | null;
  status: string;
  created_at: Date | string;
  updated_at: Date | string;
}

interface AssetInsightRow extends QueryResultRow {
  id: string;
  source_idea_id: string | null;
  title: string | null;
  content_body: unknown;
  content_metadata: unknown;
  pipeline_stage: string | null;
  status: string;
  created_at: Date | string;
  updated_at: Date | string;
}

interface ScheduledPostSignalRow extends QueryResultRow {
  scheduled_post_id: string;
  asset_group_id: string | null;
  published_at: Date | string | null;
  audience_timezone: string | null;
  performance_label: "low" | "medium" | "high" | null;
  engagement_score: string | number | null;
}

interface EmailCampaignSignalRow extends QueryResultRow {
  campaign_id: string;
  activity_at: Date | string | null;
  sent_count: string | number;
  delivered_count: string | number;
  failed_count: string | number;
  open_count: string | number;
  click_count: string | number;
  source_asset_id: string | null;
  source_idea_id: string | null;
  source_title: string | null;
}

interface StoredTopicInsightRow extends QueryResultRow {
  topic_key: string;
  topic_label: string;
  idea_count: string | number;
  post_count: string | number;
  published_count: string | number;
  high_signal_count: string | number;
  medium_signal_count: string | number;
  low_signal_count: string | number;
  avg_engagement_score: string | number;
  email_support_score: string | number;
  reuse_score: string | number;
  last_used_at: Date | string | null;
  metadata_json: unknown;
}

interface StoredPatternRollupRow extends QueryResultRow {
  pattern_type: WorkspaceInsightPatternType;
  pattern_key: string;
  label: string;
  support_count: string | number;
  published_count: string | number;
  high_signal_count: string | number;
  low_signal_count: string | number;
  avg_engagement_score: string | number;
  performance_score: string | number;
}

interface TopicAggregate {
  topicKey: string;
  topicLabel: string;
  representativeIdeaId?: string;
  ideaCount: number;
  postCount: number;
  publishedCount: number;
  highSignalCount: number;
  mediumSignalCount: number;
  lowSignalCount: number;
  engagementTotal: number;
  engagementCount: number;
  emailSupportScore: number;
  reuseScore: number;
  lastUsedAt?: string;
  exploredAngles: Set<WorkspaceInsightAngleType>;
  missingAngles: Set<WorkspaceInsightAngleType>;
}

interface PatternAggregate {
  patternType: WorkspaceInsightPatternType;
  patternKey: string;
  label: string;
  supportCount: number;
  publishedCount: number;
  highSignalCount: number;
  lowSignalCount: number;
  engagementTotal: number;
  engagementCount: number;
  performanceScore: number;
}

interface WorkspaceInsightRefreshResult {
  generatedAt: string;
  topicToIdeaId: Map<string, string>;
  channelPerformance: WorkspaceChannelPerformance;
  topContentTags: string[];
}

const ANGLE_TYPES: WorkspaceInsightAngleType[] = ["contrarian", "story", "tactical"];

function toIsoString(value: Date | string): string {
  return new Date(value).toISOString();
}

function toOptionalIsoString(value: Date | string | null | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  return toIsoString(value);
}

function toNumber(value: string | number | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeText(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function normalizeTopicKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
}

function humanizeLabel(value: string): string {
  return value
    .split(/[\s-_]+/g)
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

function extractIdeaTopic(row: IdeaInsightRow): string {
  if (row.understanding_json && typeof row.understanding_json === "object" && !Array.isArray(row.understanding_json)) {
    const topic = normalizeText((row.understanding_json as Record<string, unknown>).topic as string | undefined);

    if (topic) {
      return topic;
    }
  }

  const firstLine = row.body
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  return firstLine?.slice(0, 80) || "Untitled idea";
}

function extractTextContent(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "";
  }

  const candidate = value as Record<string, unknown>;

  const directText =
    normalizeText(typeof candidate.text === "string" ? candidate.text : undefined)
    ?? normalizeText(typeof candidate.textContent === "string" ? candidate.textContent : undefined)
    ?? normalizeText(typeof candidate.body === "string" ? candidate.body : undefined)
    ?? normalizeText(typeof candidate.content === "string" ? candidate.content : undefined);

  if (directText) {
    return directText;
  }

  const paragraphs = Array.isArray(candidate.paragraphs)
    ? candidate.paragraphs
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter(Boolean)
    : [];

  if (paragraphs.length > 0) {
    return paragraphs.join("\n\n");
  }

  return "";
}

function deriveAngleType(intelligence: ContentAssetIntelligence | undefined): WorkspaceInsightAngleType {
  if (intelligence?.format === "story") {
    return "story";
  }

  if (intelligence?.format === "list") {
    return "tactical";
  }

  if (intelligence?.hookType === "bold_statement") {
    return "contrarian";
  }

  if (intelligence?.hookType === "curiosity") {
    return "story";
  }

  return "tactical";
}

function resolveSendWindow(
  value: Date | string,
  timeZone: string,
): { key: string; label: string } {
  const hourFormatter = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    hour12: false,
    timeZone,
  });
  const rawHour = Number(hourFormatter.format(new Date(value)));

  if (rawHour >= 8 && rawHour < 11) {
    return { key: "morning", label: "Morning (8-11 AM)" };
  }

  if (rawHour >= 11 && rawHour < 14) {
    return { key: "midday", label: "Midday (11 AM-2 PM)" };
  }

  if (rawHour >= 14 && rawHour < 18) {
    return { key: "afternoon", label: "Afternoon (2-6 PM)" };
  }

  if (rawHour >= 18 && rawHour < 21) {
    return { key: "evening", label: "Evening (6-9 PM)" };
  }

  return { key: "off_hours", label: "Off hours" };
}

function setLatestValue(currentValue: string | undefined, nextValue: string | undefined): string | undefined {
  if (!nextValue) {
    return currentValue;
  }

  if (!currentValue) {
    return nextValue;
  }

  return new Date(nextValue).getTime() > new Date(currentValue).getTime() ? nextValue : currentValue;
}

function buildTopicReuseScore(topic: TopicAggregate): number {
  const engagementLift = topic.engagementCount > 0 ? topic.engagementTotal / topic.engagementCount : 0;
  return Number(
    (
      topic.postCount
      + topic.publishedCount * 0.75
      + topic.highSignalCount * 2
      + topic.mediumSignalCount * 0.9
      - topic.lowSignalCount * 1.25
      + topic.emailSupportScore * 2
      + engagementLift * 4
    ).toFixed(4),
  );
}

function buildPatternPerformanceScore(pattern: PatternAggregate): number {
  const engagementLift = pattern.engagementCount > 0 ? pattern.engagementTotal / pattern.engagementCount : 0;
  return Number(
    (
      pattern.supportCount
      + pattern.publishedCount * 0.75
      + pattern.highSignalCount * 2
      - pattern.lowSignalCount * 1.1
      + engagementLift * 4
    ).toFixed(4),
  );
}

async function loadBusinessTimezone(client: PoolClient, businessId: string): Promise<string> {
  const result = await client.query<BusinessRow>(
    `
      select timezone
      from businesses
      where id = $1
      limit 1
    `,
    [businessId],
  );

  return result.rows[0]?.timezone?.trim() || "UTC";
}

async function loadIdeas(client: PoolClient, businessId: string): Promise<IdeaInsightRow[]> {
  const result = await client.query<IdeaInsightRow>(
    `
      select
        id,
        body,
        understanding_json,
        status,
        created_at,
        updated_at
      from idea_inbox_items
      where business_id = $1
        and status <> 'archived'
      order by updated_at desc
    `,
    [businessId],
  );

  return result.rows;
}

async function loadAssets(client: PoolClient, businessId: string): Promise<AssetInsightRow[]> {
  const result = await client.query<AssetInsightRow>(
    `
      select
        id,
        source_idea_id,
        title,
        content_body,
        content_metadata,
        pipeline_stage,
        status,
        created_at,
        updated_at
      from content_assets
      where business_id = $1
      order by updated_at desc
    `,
    [businessId],
  );

  return result.rows;
}

async function loadScheduledPostSignals(
  client: PoolClient,
  businessId: string,
): Promise<ScheduledPostSignalRow[]> {
  const result = await client.query<ScheduledPostSignalRow>(
    `
      select
        sp.id as scheduled_post_id,
        sp.asset_group_id,
        sp.published_at,
        sp.audience_timezone,
        pm.performance_label,
        pm.engagement_score
      from scheduled_posts sp
      left join post_metrics pm on pm.scheduled_post_id = sp.id
      where sp.business_id = $1
        and sp.asset_group_id is not null
    `,
    [businessId],
  );

  return result.rows;
}

async function loadEmailCampaignSignals(
  client: PoolClient,
  businessId: string,
): Promise<EmailCampaignSignalRow[]> {
  const result = await client.query<EmailCampaignSignalRow>(
    `
      select
        c.id as campaign_id,
        coalesce(c.send_completed_at, c.send_started_at, c.scheduled_at, c.created_at) as activity_at,
        count(r.id) filter (where r.status in ('sent', 'delivered'))::int as sent_count,
        count(r.id) filter (where r.status = 'delivered')::int as delivered_count,
        count(r.id) filter (where r.status = 'failed')::int as failed_count,
        count(e.id) filter (where e.event_type = 'open')::int as open_count,
        count(e.id) filter (where e.event_type = 'click')::int as click_count,
        c.source_asset_id,
        c.source_idea_id,
        c.source_title
      from email_campaigns c
      left join email_campaign_recipients r on r.campaign_id = c.id
      left join email_events e
        on e.campaign_recipient_id = r.id
       and e.event_type = 'open'
      where c.business_id = $1
      group by
        c.id,
        c.source_asset_id,
        c.source_idea_id,
        c.source_title,
        coalesce(c.send_completed_at, c.send_started_at, c.scheduled_at, c.created_at)
    `,
    [businessId],
  );

  return result.rows;
}

function ensureTopicAggregate(
  map: Map<string, TopicAggregate>,
  topicKey: string,
  topicLabel: string,
): TopicAggregate {
  const existing = map.get(topicKey);

  if (existing) {
    return existing;
  }

  const created: TopicAggregate = {
    topicKey,
    topicLabel,
    ideaCount: 0,
    postCount: 0,
    publishedCount: 0,
    highSignalCount: 0,
    mediumSignalCount: 0,
    lowSignalCount: 0,
    engagementTotal: 0,
    engagementCount: 0,
    emailSupportScore: 0,
    reuseScore: 0,
    exploredAngles: new Set(),
    missingAngles: new Set(ANGLE_TYPES),
  };

  map.set(topicKey, created);
  return created;
}

function ensurePatternAggregate(
  map: Map<string, PatternAggregate>,
  patternType: WorkspaceInsightPatternType,
  patternKey: string,
  label: string,
): PatternAggregate {
  const compositeKey = `${patternType}:${patternKey}`;
  const existing = map.get(compositeKey);

  if (existing) {
    return existing;
  }

  const created: PatternAggregate = {
    patternType,
    patternKey,
    label,
    supportCount: 0,
    publishedCount: 0,
    highSignalCount: 0,
    lowSignalCount: 0,
    engagementTotal: 0,
    engagementCount: 0,
    performanceScore: 0,
  };

  map.set(compositeKey, created);
  return created;
}

function mapStoredTopicInsight(row: StoredTopicInsightRow): WorkspaceTopicInsight {
  const metadata =
    row.metadata_json && typeof row.metadata_json === "object" && !Array.isArray(row.metadata_json)
      ? (row.metadata_json as Record<string, unknown>)
      : {};

  const exploredAngles = Array.isArray(metadata.exploredAngles)
    ? metadata.exploredAngles.filter((value): value is WorkspaceInsightAngleType =>
        value === "contrarian" || value === "story" || value === "tactical")
    : [];
  const missingAngles = Array.isArray(metadata.missingAngles)
    ? metadata.missingAngles.filter((value): value is WorkspaceInsightAngleType =>
        value === "contrarian" || value === "story" || value === "tactical")
    : [];

  return {
    topicKey: row.topic_key,
    topicLabel: row.topic_label,
    ideaCount: toNumber(row.idea_count),
    postCount: toNumber(row.post_count),
    publishedCount: toNumber(row.published_count),
    highSignalCount: toNumber(row.high_signal_count),
    mediumSignalCount: toNumber(row.medium_signal_count),
    lowSignalCount: toNumber(row.low_signal_count),
    avgEngagementScore: toNumber(row.avg_engagement_score),
    emailSupportScore: toNumber(row.email_support_score),
    reuseScore: toNumber(row.reuse_score),
    exploredAngles,
    missingAngles,
    lastUsedAt: toOptionalIsoString(row.last_used_at),
  };
}

function mapStoredPatternRollup(row: StoredPatternRollupRow): WorkspaceContentPatternRollup {
  return {
    patternType: row.pattern_type,
    patternKey: row.pattern_key,
    label: row.label,
    supportCount: toNumber(row.support_count),
    publishedCount: toNumber(row.published_count),
    highSignalCount: toNumber(row.high_signal_count),
    lowSignalCount: toNumber(row.low_signal_count),
    avgEngagementScore: toNumber(row.avg_engagement_score),
    performanceScore: toNumber(row.performance_score),
  };
}

function buildSuggestions(
  topics: WorkspaceTopicInsight[],
  patterns: WorkspaceContentPatternRollup[],
  topicToIdeaId: Map<string, string>,
): WorkspaceInsightSuggestion[] {
  const suggestions: WorkspaceInsightSuggestion[] = [];
  const bestAngle = patterns
    .filter((pattern) => pattern.patternType === "angle")
    .sort((left, right) => right.performanceScore - left.performanceScore)[0];
  const bestWindow = patterns
    .filter((pattern) => pattern.patternType === "send_window")
    .sort((left, right) => right.performanceScore - left.performanceScore)[0];

  const winningTopics = topics
    .filter((topic) => topic.postCount > 0)
    .sort((left, right) => right.reuseScore - left.reuseScore);
  const topTopic = winningTopics[0];
  const weakTopic = [...winningTopics]
    .filter((topic) => topic.lowSignalCount > topic.highSignalCount && topic.lowSignalCount > 0)
    .sort((left, right) => right.lowSignalCount - left.lowSignalCount)[0];
  const emailWinningTopic = [...topics]
    .filter((topic) => topic.emailSupportScore > 0)
    .sort((left, right) => right.emailSupportScore - left.emailSupportScore)[0];
  const missingAngleTopic = winningTopics.find((topic) => topic.missingAngles.length > 0);

  if (topTopic) {
    suggestions.push({
      id: `topic:${topTopic.topicKey}:double-down`,
      kind: "double_down",
      title: `Double down on ${topTopic.topicLabel}`,
      description: `${topTopic.postCount} post${topTopic.postCount === 1 ? "" : "s"} already came from this theme.`,
      reason:
        topTopic.highSignalCount > 0
          ? `${topTopic.highSignalCount} strong performance signal${topTopic.highSignalCount === 1 ? "" : "s"} make this your best reuse candidate right now.`
          : `It is the most reused topic in the workspace and still has room for sharper follow-ups.`,
      cta: "Generate more like this",
      ideaId: topicToIdeaId.get(topTopic.topicKey),
      topicKey: topTopic.topicKey,
      topicLabel: topTopic.topicLabel,
    });
  }

  if (missingAngleTopic) {
    const suggestedAngle =
      (bestAngle?.patternType === "angle" && missingAngleTopic.missingAngles.includes(bestAngle.patternKey as WorkspaceInsightAngleType)
        ? (bestAngle.patternKey as WorkspaceInsightAngleType)
        : missingAngleTopic.missingAngles[0]) ?? "story";
    const explored = missingAngleTopic.exploredAngles.length > 0
      ? missingAngleTopic.exploredAngles.join(" + ")
      : "no active angles yet";

    suggestions.push({
      id: `topic:${missingAngleTopic.topicKey}:missing-angle:${suggestedAngle}`,
      kind: "missing_angle",
      title: `Try a ${suggestedAngle} angle on ${missingAngleTopic.topicLabel}`,
      description: `${missingAngleTopic.topicLabel} is already active, but one useful angle is still missing.`,
      reason: `You have explored ${explored}, but not ${suggestedAngle}. That is the cleanest next variant to test.`,
      cta: `Generate ${suggestedAngle}`,
      ideaId: topicToIdeaId.get(missingAngleTopic.topicKey),
      topicKey: missingAngleTopic.topicKey,
      topicLabel: missingAngleTopic.topicLabel,
      angleType: suggestedAngle,
      patternType: "angle",
      patternKey: suggestedAngle,
    });
  }

  if (bestWindow) {
    suggestions.push({
      id: `pattern:send-window:${bestWindow.patternKey}`,
      kind: "timing",
      title: `Queue the next post in ${bestWindow.label}`,
      description: `Your current timing edge is leaning toward ${bestWindow.label.toLowerCase()}.`,
      reason: `${bestWindow.supportCount} recent publish/send event${bestWindow.supportCount === 1 ? "" : "s"} make this your strongest operating window so far.`,
      cta: "Open planner",
      patternType: "send_window",
      patternKey: bestWindow.patternKey,
    });
  }

  if (emailWinningTopic) {
    suggestions.push({
      id: `topic:${emailWinningTopic.topicKey}:reuse-email`,
      kind: "reuse",
      title: `${emailWinningTopic.topicLabel} is working in email too`,
      description: "This topic is carrying signal across both publishing and email distribution.",
      reason: `Recent email campaigns linked to this idea family are outperforming the baseline, so it is a strong candidate for another post or campaign variation.`,
      cta: "Generate more like this",
      ideaId: topicToIdeaId.get(emailWinningTopic.topicKey),
      topicKey: emailWinningTopic.topicKey,
      topicLabel: emailWinningTopic.topicLabel,
    });
  }

  if (weakTopic) {
    suggestions.push({
      id: `topic:${weakTopic.topicKey}:watchout`,
      kind: "watchout",
      title: `Rework ${weakTopic.topicLabel} before repeating it`,
      description: `${weakTopic.lowSignalCount} weak signal${weakTopic.lowSignalCount === 1 ? "" : "s"} suggest the current framing is not landing.`,
      reason: `Do not abandon the theme yet, but change the hook, format, or proof before publishing another near-copy.`,
      cta: "Open idea",
      ideaId: topicToIdeaId.get(weakTopic.topicKey),
      topicKey: weakTopic.topicKey,
      topicLabel: weakTopic.topicLabel,
    });
  }

  return suggestions.slice(0, 4);
}

function buildLearningInsights(input: {
  topics: WorkspaceTopicInsight[];
  patterns: WorkspaceContentPatternRollup[];
  channelPerformance: WorkspaceChannelPerformance;
  topContentTags: string[];
}): string[] {
  const bestAngle = input.patterns
    .filter((pattern) => pattern.patternType === "angle")
    .sort((left, right) => right.performanceScore - left.performanceScore)[0];
  const bestFormat = input.patterns
    .filter((pattern) => pattern.patternType === "format")
    .sort((left, right) => right.performanceScore - left.performanceScore)[0];
  const bestWindow = input.patterns
    .filter((pattern) => pattern.patternType === "send_window")
    .sort((left, right) => right.performanceScore - left.performanceScore)[0];
  const topTopic = input.topics[0];
  const crossChannelTopic = [...input.topics]
    .filter((topic) => topic.emailSupportScore > 0)
    .sort((left, right) => right.emailSupportScore - left.emailSupportScore)[0];
  const weakTopic = [...input.topics]
    .filter((topic) => topic.lowSignalCount > topic.highSignalCount && topic.lowSignalCount > 0)
    .sort((left, right) => right.lowSignalCount - left.lowSignalCount)[0];
  const lines = [
    topTopic
      ? `${topTopic.topicLabel} is the strongest topic to reuse right now.`
      : undefined,
    crossChannelTopic
      ? `${crossChannelTopic.topicLabel} is carrying signal across email and social.`
      : undefined,
    bestAngle && bestFormat
      ? `${bestAngle.label} paired with ${bestFormat.label.toLowerCase()} content is the most repeatable combination so far.`
      : bestAngle
        ? `${bestAngle.label} is the strongest angle to keep testing.`
        : bestFormat
          ? `${bestFormat.label} is the strongest content format so far.`
          : undefined,
    bestWindow
      ? `Your current timing edge is ${bestWindow.label.toLowerCase()}.`
      : undefined,
    input.topContentTags.length > 0
      ? `High-signal themes include ${input.topContentTags.slice(0, 3).join(", ")}.`
      : undefined,
    input.channelPerformance.email.campaigns > 0
      ? `Email is averaging ${input.channelPerformance.email.avgOpenRate.toFixed(1)}% opens and ${input.channelPerformance.email.avgClickRate.toFixed(1)}% clicks.`
      : undefined,
    input.channelPerformance.social.trackedPosts > 0
      ? `Tracked social posts are averaging ${input.channelPerformance.social.avgEngagementScore.toFixed(1)} engagement points.`
      : undefined,
    weakTopic
      ? `Rework ${weakTopic.topicLabel} before repeating it. The current framing is underperforming.`
      : undefined,
  ].filter((entry): entry is string => Boolean(entry));

  return [...new Set(lines)].slice(0, 5);
}

async function persistInsights(
  client: PoolClient,
  businessId: string,
  topics: TopicAggregate[],
  patterns: PatternAggregate[],
): Promise<void> {
  await client.query(`delete from workspace_topic_insights where business_id = $1`, [businessId]);

  for (const topic of topics) {
    await client.query(
      `
        insert into workspace_topic_insights (
          business_id,
          topic_key,
          topic_label,
          idea_count,
          post_count,
          published_count,
          high_signal_count,
          medium_signal_count,
          low_signal_count,
          avg_engagement_score,
          email_support_score,
          reuse_score,
          last_used_at,
          metadata_json,
          updated_at
        ) values (
          $1,
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
          $13,
          $14::jsonb,
          now()
        )
      `,
      [
        businessId,
        topic.topicKey,
        topic.topicLabel,
        topic.ideaCount,
        topic.postCount,
        topic.publishedCount,
        topic.highSignalCount,
        topic.mediumSignalCount,
        topic.lowSignalCount,
        topic.engagementCount > 0 ? Number((topic.engagementTotal / topic.engagementCount).toFixed(4)) : 0,
        Number(topic.emailSupportScore.toFixed(4)),
        Number(topic.reuseScore.toFixed(4)),
        topic.lastUsedAt ?? null,
        JSON.stringify({
          representativeIdeaId: topic.representativeIdeaId ?? null,
          exploredAngles: [...topic.exploredAngles],
          missingAngles: [...topic.missingAngles],
        }),
      ],
    );
  }

  await client.query(`delete from workspace_content_pattern_rollups where business_id = $1`, [businessId]);

  for (const pattern of patterns) {
    await client.query(
      `
        insert into workspace_content_pattern_rollups (
          business_id,
          pattern_type,
          pattern_key,
          label,
          support_count,
          published_count,
          high_signal_count,
          low_signal_count,
          avg_engagement_score,
          performance_score,
          metadata_json,
          updated_at
        ) values (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9,
          $10,
          '{}'::jsonb,
          now()
        )
      `,
      [
        businessId,
        pattern.patternType,
        pattern.patternKey,
        pattern.label,
        pattern.supportCount,
        pattern.publishedCount,
        pattern.highSignalCount,
        pattern.lowSignalCount,
        pattern.engagementCount > 0
          ? Number((pattern.engagementTotal / pattern.engagementCount).toFixed(4))
          : 0,
        Number(pattern.performanceScore.toFixed(4)),
      ],
    );
  }
}

async function buildAndPersistWorkspaceInsights(
  client: PoolClient,
  businessId: string,
): Promise<WorkspaceInsightRefreshResult> {
  const [businessTimeZone, ideas, assets, scheduledSignals, emailSignals] = await Promise.all([
    loadBusinessTimezone(client, businessId),
    loadIdeas(client, businessId),
    loadAssets(client, businessId),
    loadScheduledPostSignals(client, businessId),
    loadEmailCampaignSignals(client, businessId),
  ]);

  const topicMap = new Map<string, TopicAggregate>();
  const patternMap = new Map<string, PatternAggregate>();
  const ideaTopicById = new Map<string, string>();
  const topicToIdeaId = new Map<string, string>();
  const emailChannel = {
    campaigns: 0,
    sent: 0,
    delivered: 0,
    opens: 0,
    clicks: 0,
    openRateTotal: 0,
    clickRateTotal: 0,
    rateCount: 0,
  };
  const socialChannel = {
    trackedPosts: 0,
    publishedPosts: 0,
    highSignalPosts: 0,
    mediumSignalPosts: 0,
    lowSignalPosts: 0,
    engagementTotal: 0,
    engagementCount: 0,
  };
  const assetById = new Map<
    string,
    {
      sourceIdeaId?: string;
      topicKey?: string;
      intelligence?: ContentAssetIntelligence;
      tags: string[];
      publishedViaAsset: boolean;
      updatedAt?: string;
    }
  >();

  for (const idea of ideas) {
    const topicLabel = extractIdeaTopic(idea);
    const topicKey = normalizeTopicKey(topicLabel) || `idea-${idea.id}`;
    const aggregate = ensureTopicAggregate(topicMap, topicKey, topicLabel);

    aggregate.ideaCount += 1;
    aggregate.representativeIdeaId = aggregate.representativeIdeaId ?? idea.id;
    ideaTopicById.set(idea.id, topicKey);
    topicToIdeaId.set(topicKey, topicToIdeaId.get(topicKey) ?? idea.id);
  }

  for (const asset of assets) {
    const textContent = extractTextContent(asset.content_body) || asset.title || "";
    const intelligence = resolveStoredContentAssetIntelligence(asset.content_metadata, textContent);
    const angleType = deriveAngleType(intelligence);
    const formatKey = intelligence?.format ?? "insight";
    const tags = intelligence?.tags ?? [];
    const publishedViaAsset = asset.pipeline_stage === "posted" || asset.status === "published";
    const topicKey = asset.source_idea_id ? ideaTopicById.get(asset.source_idea_id) : undefined;
    const topic = topicKey ? topicMap.get(topicKey) : undefined;

    if (topic) {
      topic.postCount += 1;
      topic.exploredAngles.add(angleType);
      topic.missingAngles.delete(angleType);
      topic.lastUsedAt = setLatestValue(topic.lastUsedAt, toOptionalIsoString(asset.updated_at));

      if (publishedViaAsset) {
        topic.publishedCount += 1;
      }
    }

    assetById.set(asset.id, {
      sourceIdeaId: asset.source_idea_id ?? undefined,
      topicKey,
      intelligence,
      tags,
      publishedViaAsset,
      updatedAt: toOptionalIsoString(asset.updated_at),
    });

    const anglePattern = ensurePatternAggregate(patternMap, "angle", angleType, `${angleType[0].toUpperCase()}${angleType.slice(1)} angle`);
    anglePattern.supportCount += 1;

    const formatPattern = ensurePatternAggregate(
      patternMap,
      "format",
      formatKey,
      formatKey[0].toUpperCase() + formatKey.slice(1),
    );
    formatPattern.supportCount += 1;

    for (const tag of tags) {
      const normalizedTagKey = normalizeTopicKey(tag);

      if (!normalizedTagKey) {
        continue;
      }

      const tagPattern = ensurePatternAggregate(patternMap, "tag", normalizedTagKey, humanizeLabel(tag));
      tagPattern.supportCount += 1;
    }
  }

  for (const signal of scheduledSignals) {
    if (!signal.asset_group_id) {
      continue;
    }

    const asset = assetById.get(signal.asset_group_id);

    if (!asset) {
      continue;
    }

    socialChannel.trackedPosts += 1;
    const topic = asset.topicKey ? topicMap.get(asset.topicKey) : undefined;

    if (signal.published_at) {
      socialChannel.publishedPosts += 1;
      if (topic) {
        topic.publishedCount += asset.publishedViaAsset ? 0 : 1;
        topic.lastUsedAt = setLatestValue(topic.lastUsedAt, toOptionalIsoString(signal.published_at));
      }

      const window = resolveSendWindow(signal.published_at, signal.audience_timezone?.trim() || businessTimeZone);
      const sendWindowPattern = ensurePatternAggregate(patternMap, "send_window", window.key, window.label);
      sendWindowPattern.supportCount += 1;
      sendWindowPattern.publishedCount += 1;

      if (signal.performance_label === "high") {
        sendWindowPattern.highSignalCount += 1;
      }

      if (signal.performance_label === "low") {
        sendWindowPattern.lowSignalCount += 1;
      }

      const sendEngagement = toNumber(signal.engagement_score);

      if (sendEngagement > 0) {
        sendWindowPattern.engagementTotal += sendEngagement;
        sendWindowPattern.engagementCount += 1;
      }
    }

    if (signal.performance_label === "high") {
      if (topic) {
        topic.highSignalCount += 1;
      }
      socialChannel.highSignalPosts += 1;
    } else if (signal.performance_label === "medium") {
      if (topic) {
        topic.mediumSignalCount += 1;
      }
      socialChannel.mediumSignalPosts += 1;
    } else if (signal.performance_label === "low") {
      if (topic) {
        topic.lowSignalCount += 1;
      }
      socialChannel.lowSignalPosts += 1;
    }

    const engagementScore = toNumber(signal.engagement_score);

    if (engagementScore > 0) {
      if (topic) {
        topic.engagementTotal += engagementScore;
        topic.engagementCount += 1;
      }
      socialChannel.engagementTotal += engagementScore;
      socialChannel.engagementCount += 1;
    }

    const angleType = deriveAngleType(asset.intelligence);
    const formatKey = asset.intelligence?.format ?? "insight";
    const anglePattern = ensurePatternAggregate(patternMap, "angle", angleType, `${angleType[0].toUpperCase()}${angleType.slice(1)} angle`);
    const formatPattern = ensurePatternAggregate(
      patternMap,
      "format",
      formatKey,
      formatKey[0].toUpperCase() + formatKey.slice(1),
    );

    anglePattern.publishedCount += signal.published_at ? 1 : 0;
    formatPattern.publishedCount += signal.published_at ? 1 : 0;

    if (signal.performance_label === "high") {
      anglePattern.highSignalCount += 1;
      formatPattern.highSignalCount += 1;
    }

    if (signal.performance_label === "low") {
      anglePattern.lowSignalCount += 1;
      formatPattern.lowSignalCount += 1;
    }

    if (engagementScore > 0) {
      anglePattern.engagementTotal += engagementScore;
      anglePattern.engagementCount += 1;
      formatPattern.engagementTotal += engagementScore;
      formatPattern.engagementCount += 1;
    }

    for (const tag of asset.tags) {
      const normalizedTagKey = normalizeTopicKey(tag);

      if (!normalizedTagKey) {
        continue;
      }

      const tagPattern = ensurePatternAggregate(patternMap, "tag", normalizedTagKey, humanizeLabel(tag));
      tagPattern.publishedCount += signal.published_at ? 1 : 0;

      if (signal.performance_label === "high") {
        tagPattern.highSignalCount += 1;
      }

      if (signal.performance_label === "low") {
        tagPattern.lowSignalCount += 1;
      }

      if (engagementScore > 0) {
        tagPattern.engagementTotal += engagementScore;
        tagPattern.engagementCount += 1;
      }
    }
  }

  for (const emailSignal of emailSignals) {
    if (!emailSignal.activity_at) {
      continue;
    }

    const sentCount = toNumber(emailSignal.sent_count);
    const deliveredCount = toNumber(emailSignal.delivered_count);
    const openCount = toNumber(emailSignal.open_count);
    const clickCount = toNumber(emailSignal.click_count);

    if (sentCount <= 0 && deliveredCount <= 0 && openCount <= 0 && clickCount <= 0) {
      continue;
    }

    emailChannel.campaigns += 1;
    emailChannel.sent += sentCount;
    emailChannel.delivered += deliveredCount;
    emailChannel.opens += openCount;
    emailChannel.clicks += clickCount;

    const window = resolveSendWindow(emailSignal.activity_at, businessTimeZone);
    const sendWindowPattern = ensurePatternAggregate(patternMap, "send_window", window.key, window.label);
    sendWindowPattern.supportCount += 1;

    const deliveryRate = sentCount > 0 ? deliveredCount / sentCount : 0;
    const openRate = deliveredCount > 0 ? openCount / deliveredCount : 0;
    const clickRate = deliveredCount > 0 ? clickCount / deliveredCount : 0;
    const syntheticScore = Number((deliveryRate + openRate * 1.1 + clickRate * 1.6).toFixed(4));

    if (deliveredCount > 0) {
      emailChannel.openRateTotal += openRate * 100;
      emailChannel.clickRateTotal += clickRate * 100;
      emailChannel.rateCount += 1;
    }
    const linkedTopicKey =
      (emailSignal.source_asset_id ? assetById.get(emailSignal.source_asset_id)?.topicKey : undefined)
      ?? (emailSignal.source_idea_id ? ideaTopicById.get(emailSignal.source_idea_id) : undefined);

    if (syntheticScore > 0) {
      sendWindowPattern.engagementTotal += syntheticScore;
      sendWindowPattern.engagementCount += 1;
    }

    if (emailSignal.source_asset_id) {
      const sourceAsset = assetById.get(emailSignal.source_asset_id);

      if (sourceAsset) {
        const angleType = deriveAngleType(sourceAsset.intelligence);
        const formatKey = sourceAsset.intelligence?.format ?? "insight";
        const anglePattern = ensurePatternAggregate(
          patternMap,
          "angle",
          angleType,
          `${angleType[0].toUpperCase()}${angleType.slice(1)} angle`,
        );
        const formatPattern = ensurePatternAggregate(
          patternMap,
          "format",
          formatKey,
          formatKey[0].toUpperCase() + formatKey.slice(1),
        );

        if (syntheticScore > 0) {
          anglePattern.engagementTotal += syntheticScore;
          anglePattern.engagementCount += 1;
          formatPattern.engagementTotal += syntheticScore;
          formatPattern.engagementCount += 1;
        }

        for (const tag of sourceAsset.tags) {
          const normalizedTagKey = normalizeTopicKey(tag);

          if (!normalizedTagKey) {
            continue;
          }

          const tagPattern = ensurePatternAggregate(patternMap, "tag", normalizedTagKey, humanizeLabel(tag));

          if (syntheticScore > 0) {
            tagPattern.engagementTotal += syntheticScore;
            tagPattern.engagementCount += 1;
          }
        }
      }
    }

    if (!linkedTopicKey) {
      continue;
    }

    const topic = topicMap.get(linkedTopicKey);

    if (!topic) {
      continue;
    }

    topic.emailSupportScore += syntheticScore;
    topic.lastUsedAt = setLatestValue(topic.lastUsedAt, toOptionalIsoString(emailSignal.activity_at));
  }

  const topics = [...topicMap.values()].map((topic) => {
    topic.reuseScore = buildTopicReuseScore(topic);
    return topic;
  });
  const patterns = [...patternMap.values()].map((pattern) => {
    pattern.performanceScore = buildPatternPerformanceScore(pattern);
    return pattern;
  });

  await persistInsights(client, businessId, topics, patterns);

  const topContentTags = patterns
    .filter((pattern) => pattern.patternType === "tag")
    .sort((left, right) => right.performanceScore - left.performanceScore)
    .map((pattern) => pattern.label)
    .slice(0, 6);

  return {
    generatedAt: new Date().toISOString(),
    topicToIdeaId,
    channelPerformance: {
      email: {
        campaigns: emailChannel.campaigns,
        sent: emailChannel.sent,
        delivered: emailChannel.delivered,
        opens: emailChannel.opens,
        clicks: emailChannel.clicks,
        avgOpenRate: emailChannel.rateCount > 0 ? Number((emailChannel.openRateTotal / emailChannel.rateCount).toFixed(2)) : 0,
        avgClickRate: emailChannel.rateCount > 0 ? Number((emailChannel.clickRateTotal / emailChannel.rateCount).toFixed(2)) : 0,
      },
      social: {
        trackedPosts: socialChannel.trackedPosts,
        publishedPosts: socialChannel.publishedPosts,
        highSignalPosts: socialChannel.highSignalPosts,
        mediumSignalPosts: socialChannel.mediumSignalPosts,
        lowSignalPosts: socialChannel.lowSignalPosts,
        avgEngagementScore: socialChannel.engagementCount > 0
          ? Number((socialChannel.engagementTotal / socialChannel.engagementCount).toFixed(2))
          : 0,
      },
    },
    topContentTags,
  };
}

async function buildWorkspaceInsightsResponse(
  client: PoolClient,
  businessId: string,
): Promise<WorkspaceInsightsResponse> {
    const refresh = await buildAndPersistWorkspaceInsights(client, businessId);
    const [topicsResult, patternsResult] = await Promise.all([
      client.query<StoredTopicInsightRow>(
        `
          select
            topic_key,
            topic_label,
            idea_count,
            post_count,
            published_count,
            high_signal_count,
            medium_signal_count,
            low_signal_count,
            avg_engagement_score,
            email_support_score,
            reuse_score,
            last_used_at,
            metadata_json
          from workspace_topic_insights
          where business_id = $1
          order by reuse_score desc, updated_at desc
        `,
        [businessId],
      ),
      client.query<StoredPatternRollupRow>(
        `
          select
            pattern_type,
            pattern_key,
            label,
            support_count,
            published_count,
            high_signal_count,
            low_signal_count,
            avg_engagement_score,
            performance_score
          from workspace_content_pattern_rollups
          where business_id = $1
          order by pattern_type asc, performance_score desc, updated_at desc
        `,
        [businessId],
      ),
    ]);

    const topics = topicsResult.rows.map(mapStoredTopicInsight);
    const patterns = patternsResult.rows.map(mapStoredPatternRollup);
    const topTopic = topics[0];
    const weakTopic = [...topics]
      .filter((topic) => topic.lowSignalCount > topic.highSignalCount && topic.lowSignalCount > 0)
      .sort((left, right) => right.lowSignalCount - left.lowSignalCount)[0];
    const crossChannelTopic = [...topics]
      .filter((topic) => topic.emailSupportScore > 0)
      .sort((left, right) => right.emailSupportScore - left.emailSupportScore)[0];
    const bestAngle = patterns
      .filter((pattern) => pattern.patternType === "angle")
      .sort((left, right) => right.performanceScore - left.performanceScore)[0];
    const bestFormat = patterns
      .filter((pattern) => pattern.patternType === "format")
      .sort((left, right) => right.performanceScore - left.performanceScore)[0];
    const bestSendWindow = patterns
      .filter((pattern) => pattern.patternType === "send_window")
      .sort((left, right) => right.performanceScore - left.performanceScore)[0];

    return {
      businessId,
      generatedAt: refresh.generatedAt,
      summary: {
        topTopicLabel: topTopic?.topicLabel,
        topTopicKey: topTopic?.topicKey,
        crossChannelTopicLabel: crossChannelTopic?.topicLabel,
        weakTopicLabel: weakTopic?.topicLabel,
        bestAngleLabel: bestAngle?.label,
        bestFormatLabel: bestFormat?.label,
        bestSendWindowLabel: bestSendWindow?.label,
      },
      channelPerformance: refresh.channelPerformance,
      learningInsights: buildLearningInsights({
        topics,
        patterns,
        channelPerformance: refresh.channelPerformance,
        topContentTags: refresh.topContentTags,
      }),
      topContentTags: refresh.topContentTags,
      topics,
      patterns,
      suggestions: buildSuggestions(topics, patterns, refresh.topicToIdeaId),
    };
}

export async function getWorkspaceInsightsSnapshotForBusiness(
  businessId: string,
): Promise<WorkspaceInsightsResponse> {
  return withDbTransaction(async (client) => buildWorkspaceInsightsResponse(client, businessId));
}

export async function getWorkspaceInsights(
  principal: AuthenticatedPrincipal | undefined,
  businessId: string,
): Promise<WorkspaceInsightsResponse> {
  await enforceWorkspaceReadAccess(principal, businessId, "control_dashboard");
  return getWorkspaceInsightsSnapshotForBusiness(businessId);
}
