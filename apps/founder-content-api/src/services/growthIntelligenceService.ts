import type { QueryResultRow } from "pg";
import type {
  GenerateHashtagsRequest,
  GenerateHashtagsResponse,
  RecommendPostTimeContentType,
  RecommendPostTimeResponse,
  RecommendedPostTimeSlot,
} from "../../../../packages/shared-types/index.ts";
import { getBrandPromptContextForBusiness } from "./brandIntelligence/brandProfileService.ts";
import { queryDb } from "./db/client.ts";
import { HttpError } from "../utils/http.ts";

interface BusinessTimezoneRow extends QueryResultRow {
  timezone: string;
}

interface ScheduledHistoryRow extends QueryResultRow {
  scheduled_at: Date | string;
  published_at: Date | string | null;
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
}

interface SlotBlueprint {
  weekday: number;
  hour: number;
  minute: number;
  reason: string;
  source: "global" | "history" | "hybrid";
}

const WEEKDAY_SHORT_TO_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "also",
  "another",
  "because",
  "before",
  "being",
  "build",
  "building",
  "from",
  "have",
  "into",
  "just",
  "lessons",
  "more",
  "most",
  "need",
  "never",
  "people",
  "post",
  "posts",
  "really",
  "should",
  "some",
  "that",
  "their",
  "them",
  "there",
  "these",
  "they",
  "think",
  "this",
  "those",
  "what",
  "when",
  "where",
  "which",
  "with",
  "your",
]);

const KEYWORD_HASHTAG_MAP: Record<string, string[]> = {
  ai: ["#ArtificialIntelligence", "#AIAutomation"],
  audience: ["#AudienceGrowth", "#CommunityBuilding"],
  brand: ["#BrandBuilding", "#PersonalBrand"],
  business: ["#BusinessGrowth", "#B2BMarketing"],
  carousel: ["#LinkedInCarousel", "#CarouselPost"],
  client: ["#ClientAcquisition", "#LeadGeneration"],
  clients: ["#ClientAcquisition", "#LeadGeneration"],
  content: ["#ContentMarketing", "#ContentStrategy"],
  founder: ["#Founders", "#FounderJourney"],
  founders: ["#Founders", "#FounderJourney"],
  growth: ["#GrowthStrategy", "#BusinessGrowth"],
  leadership: ["#Leadership", "#FounderLeadership"],
  linkedin: ["#LinkedInMarketing", "#LinkedInGrowth"],
  marketing: ["#MarketingStrategy", "#B2BMarketing"],
  product: ["#ProductStrategy", "#BuildInPublic"],
  saas: ["#SaaS", "#B2BSaaS"],
  sales: ["#B2BSales", "#RevenueGrowth"],
  startup: ["#Startups", "#StartupGrowth"],
  startups: ["#Startups", "#StartupGrowth"],
  storytelling: ["#Storytelling", "#CreatorStrategy"],
};

const GLOBAL_SLOT_BLUEPRINTS: Record<RecommendPostTimeContentType, SlotBlueprint[]> = {
  carousel: [
    {
      weekday: 2,
      hour: 8,
      minute: 40,
      reason: "Midweek morning gives multi-image LinkedIn posts a strong first-feed window.",
      source: "global",
    },
    {
      weekday: 3,
      hour: 11,
      minute: 50,
      reason: "Carousel explainers often hold attention well around midday professional check-ins.",
      source: "global",
    },
    {
      weekday: 4,
      hour: 9,
      minute: 10,
      reason: "Late-week morning is a stable slot for thought-leadership carousels.",
      source: "global",
    },
  ],
  image: [
    {
      weekday: 2,
      hour: 9,
      minute: 15,
      reason: "Single-image posts usually benefit from early-workday attention.",
      source: "global",
    },
    {
      weekday: 3,
      hour: 12,
      minute: 5,
      reason: "Midday windows often work well for quick visual insights.",
      source: "global",
    },
    {
      weekday: 4,
      hour: 14,
      minute: 0,
      reason: "Afternoon image posts can pick up a second feed session.",
      source: "global",
    },
  ],
  text: [
    {
      weekday: 1,
      hour: 8,
      minute: 30,
      reason: "Text-led founder posts often perform well at the start of the week.",
      source: "global",
    },
    {
      weekday: 3,
      hour: 9,
      minute: 35,
      reason: "Midweek mornings are a reliable slot for practical text posts.",
      source: "global",
    },
    {
      weekday: 4,
      hour: 12,
      minute: 20,
      reason: "Midday can work well for reflective or educational text content.",
      source: "global",
    },
  ],
};

function resolveContentType(value: string | undefined): RecommendPostTimeContentType {
  return value === "image" || value === "text" || value === "carousel" ? value : "carousel";
}

function toHashtag(value: string): string {
  const words = value
    .split(/[^a-zA-Z0-9]+/)
    .map((word) => word.trim())
    .filter(Boolean)
    .slice(0, 3)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());

  return words.length > 0 ? `#${words.join("")}` : "";
}

function normalizeKeyword(value: string): string {
  return value.replace(/[^a-z0-9]+/gi, "").toLowerCase();
}

function uniqueHashtags(values: string[]): string[] {
  return [...new Set(values.filter((value) => /^#[A-Za-z0-9]+$/.test(value)))];
}

function extractKeywordCandidates(text: string): string[] {
  return text
    .split(/[^a-zA-Z0-9]+/)
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const values = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  ) as Record<string, string>;

  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
    weekday: WEEKDAY_SHORT_TO_INDEX[values.weekday] ?? 0,
  };
}

function getTimeZoneOffsetMinutes(date: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset",
  });
  const timeZoneName = formatter
    .formatToParts(date)
    .find((part) => part.type === "timeZoneName")?.value;
  const match = /^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/i.exec(timeZoneName ?? "");

  if (!match) {
    return 0;
  }

  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number(match[2]);
  const minutes = Number(match[3] ?? "0");
  return sign * (hours * 60 + minutes);
}

function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  let utcMs = Date.UTC(year, month - 1, day, hour, minute, 0);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const offsetMinutes = getTimeZoneOffsetMinutes(new Date(utcMs), timeZone);
    utcMs = Date.UTC(year, month - 1, day, hour, minute, 0) - offsetMinutes * 60_000;
  }

  return new Date(utcMs);
}

function formatLocalLabel(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function nextSlotForBlueprint(
  blueprint: SlotBlueprint,
  now: Date,
  timeZone: string,
): RecommendedPostTimeSlot | null {
  for (let dayOffset = 0; dayOffset < 14; dayOffset += 1) {
    const probe = new Date(now.getTime() + dayOffset * 24 * 60 * 60 * 1000);
    const localParts = getZonedParts(probe, timeZone);

    if (localParts.weekday !== blueprint.weekday) {
      continue;
    }

    const candidate = zonedTimeToUtc(
      localParts.year,
      localParts.month,
      localParts.day,
      blueprint.hour,
      blueprint.minute,
      timeZone,
    );

    if (candidate.getTime() <= now.getTime() + 5 * 60 * 1000) {
      continue;
    }

    return {
      scheduledAt: candidate.toISOString(),
      localLabel: formatLocalLabel(candidate, timeZone),
      reason: blueprint.reason,
      source: blueprint.source,
    };
  }

  return null;
}

function uniqueRecommendedSlots(slots: RecommendedPostTimeSlot[]): RecommendedPostTimeSlot[] {
  const seen = new Set<string>();
  const unique: RecommendedPostTimeSlot[] = [];

  for (const slot of slots) {
    if (seen.has(slot.scheduledAt)) {
      continue;
    }

    seen.add(slot.scheduledAt);
    unique.push(slot);
  }

  return unique;
}

async function resolveBusinessTimezone(businessId: string): Promise<string> {
  const result = await queryDb<BusinessTimezoneRow>(
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

async function loadUserSchedulingHistory(businessId: string, userId: string): Promise<Date[]> {
  const result = await queryDb<ScheduledHistoryRow>(
    `
      select
        scheduled_at,
        published_at
      from scheduled_posts
      where business_id = $1
        and user_id = $2
        and status in ('scheduled', 'processing', 'published')
      order by coalesce(published_at, scheduled_at) desc
      limit 24
    `,
    [businessId, userId],
  );

  return result.rows
    .map((row) => new Date(row.published_at ?? row.scheduled_at))
    .filter((value) => !Number.isNaN(value.getTime()));
}

function deriveHistoryBlueprint(
  history: Date[],
  timeZone: string,
  contentType: RecommendPostTimeContentType,
): SlotBlueprint | null {
  if (history.length < 3) {
    return null;
  }

  const bucketCounts = new Map<string, number>();

  for (const timestamp of history) {
    const parts = getZonedParts(timestamp, timeZone);
    const key = `${parts.weekday}:${parts.hour}`;
    bucketCounts.set(key, (bucketCounts.get(key) ?? 0) + 1);
  }

  const [bestBucket] = [...bucketCounts.entries()].sort((left, right) => right[1] - left[1]);

  if (!bestBucket) {
    return null;
  }

  const [weekdayText, hourText] = bestBucket[0].split(":");
  const weekday = Number(weekdayText);
  const hour = Number(hourText);

  if (!Number.isFinite(weekday) || !Number.isFinite(hour)) {
    return null;
  }

  return {
    weekday,
    hour,
    minute: contentType === "carousel" ? 12 : 5,
    reason:
      "This slot lines up with the posting window you have used most often recently.",
    source: "history",
  };
}

export async function recommendPostTimes(input: {
  businessId: string;
  userId: string;
  contentType?: string;
}): Promise<RecommendPostTimeResponse> {
  const contentType = resolveContentType(input.contentType);
  const timezone = await resolveBusinessTimezone(input.businessId);
  const history = await loadUserSchedulingHistory(input.businessId, input.userId);
  const historyBlueprint = deriveHistoryBlueprint(history, timezone, contentType);
  const blueprints = [...GLOBAL_SLOT_BLUEPRINTS[contentType]];

  if (historyBlueprint) {
    blueprints.unshift({
      ...historyBlueprint,
      source: "hybrid",
      reason:
        "This slot matches your recent posting rhythm while staying inside a strong professional-feed window.",
    });
  }

  const now = new Date();
  const slots = uniqueRecommendedSlots(
    blueprints
      .map((blueprint) => nextSlotForBlueprint(blueprint, now, timezone))
      .filter((slot): slot is RecommendedPostTimeSlot => Boolean(slot)),
  ).slice(0, 3);

  return {
    timezone,
    slots,
    usedHistory: Boolean(historyBlueprint),
  };
}

export async function generateHashtags(
  input: GenerateHashtagsRequest,
): Promise<GenerateHashtagsResponse> {
  const contentText = input.contentText.trim();

  if (!contentText) {
    throw new HttpError(400, "bad_request", "contentText is required.");
  }

  const contentType = resolveContentType(input.contentType);
  const targetCount = Math.min(12, Math.max(8, Number(input.targetCount ?? 10)));
  const keywordCandidates = extractKeywordCandidates(contentText);
  const brandContext = input.businessId
    ? await getBrandPromptContextForBusiness(input.businessId)
    : undefined;

  const broadPool =
    contentType === "carousel"
      ? ["#LinkedInCarousel", "#ThoughtLeadership", "#ContentMarketing", "#PersonalBrand"]
      : ["#LinkedInMarketing", "#ContentStrategy", "#BusinessGrowth", "#CreatorStrategy"];
  const nichePool = uniqueHashtags([
    ...(brandContext?.topics ?? []).map(toHashtag),
    ...keywordCandidates.flatMap((keyword) => KEYWORD_HASHTAG_MAP[normalizeKeyword(keyword)] ?? []),
    ...keywordCandidates.slice(0, 6).map(toHashtag),
  ]);
  const intentPool = uniqueHashtags([
    "#AudienceGrowth",
    "#BrandBuilding",
    "#ConsistencyWins",
    "#ClientAcquisition",
    "#FounderMarketing",
    "#DemandGeneration",
    ...(contentText.toLowerCase().includes("startup") ? ["#StartupGrowth"] : []),
    ...(contentText.toLowerCase().includes("ai") ? ["#AIAutomation"] : []),
    ...(contentText.toLowerCase().includes("founder") ? ["#FounderJourney"] : []),
  ]);

  const hashtags = uniqueHashtags([
    ...broadPool.slice(0, 4),
    ...nichePool.slice(0, 5),
    ...intentPool.slice(0, 4),
  ]).slice(0, targetCount);

  while (hashtags.length < 8) {
    const fallback = toHashtag(keywordCandidates[hashtags.length] ?? `growth focus ${hashtags.length + 1}`);

    if (fallback && !hashtags.includes(fallback)) {
      hashtags.push(fallback);
    } else {
      break;
    }
  }

  return {
    hashtags,
    captionWithHashtags: `${contentText}\n\n${hashtags.join(" ")}`.trim(),
  };
}
