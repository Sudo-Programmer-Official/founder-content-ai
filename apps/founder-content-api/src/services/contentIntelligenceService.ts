import type {
  BrandPromptContext,
  ContentAsset,
  ContentAssetCtaType,
  ContentAssetFormat,
  ContentAssetHookType,
  ContentAssetIntelligence,
  ContentAssetIntent,
  ContentAssetLengthBucket,
  ContentPovBoldness,
  ContentPovProfile,
  ContentQualityScore,
  DashboardIntelligenceSummary,
  RecommendedPostTimeSlot,
} from "../../../../packages/shared-types/index.ts";

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

const TAG_STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "also",
  "always",
  "another",
  "around",
  "because",
  "before",
  "being",
  "between",
  "bring",
  "built",
  "could",
  "every",
  "first",
  "founder",
  "from",
  "have",
  "here",
  "just",
  "make",
  "more",
  "most",
  "much",
  "need",
  "next",
  "only",
  "over",
  "really",
  "should",
  "some",
  "still",
  "than",
  "that",
  "their",
  "them",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "through",
  "until",
  "very",
  "what",
  "when",
  "where",
  "which",
  "while",
  "with",
  "your",
]);

function extractLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

function getOpeningLine(text: string): string {
  return extractLines(text)[0] ?? "";
}

function countWords(text: string): number {
  const words = normalizeWhitespace(text).split(" ").filter(Boolean);
  return words.length;
}

function clampPercentage(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function inferLengthBucket(wordCount: number): ContentAssetLengthBucket {
  if (wordCount <= 80) {
    return "short";
  }

  if (wordCount <= 180) {
    return "medium";
  }

  return "long";
}

function inferContentFormat(text: string): ContentAssetFormat {
  const lines = extractLines(text);
  const bulletLines = lines.filter((line) => /^(\d+[\).\s]|[-*•])/.test(line)).length;

  if (bulletLines >= 3) {
    return "list";
  }

  if (
    /\b(i|we|my|our)\b/i.test(text) &&
    /\b(recently|last|when|after|before|learned|realized|saw|shipped|built|grew|lost)\b/i.test(text)
  ) {
    return "story";
  }

  return "insight";
}

function inferHookType(text: string): ContentAssetHookType {
  const openingLine = getOpeningLine(text);

  if (!openingLine) {
    return "direct";
  }

  if (openingLine.endsWith("?")) {
    return "question";
  }

  if (
    /^(what if|why |here'?s what|turns out|the moment|i thought|recently|most .* don't|almost no one|counterintuitive|the fastest way)/i.test(
      openingLine,
    ) ||
    /\b(until|but|mistake|surprising|unexpected|truth)\b/i.test(openingLine)
  ) {
    return "curiosity";
  }

  if (
    /^(stop|don't|never|most|your|the problem|the reason|ai isn't|consistency|founders)/i.test(
      openingLine,
    ) ||
    /\b(isn't|won't|never|always)\b/i.test(openingLine)
  ) {
    return "bold_statement";
  }

  return "direct";
}

function addTagScore(map: Map<string, number>, value: string | undefined, score: number): void {
  const normalized = normalizeTagValue(value);

  if (!normalized) {
    return;
  }

  map.set(normalized, (map.get(normalized) ?? 0) + score);
}

function normalizeTagValue(value: string | undefined): string | undefined {
  const normalized = value
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized || normalized.length < 4 || normalized.length > 36) {
    return undefined;
  }

  if (TAG_STOP_WORDS.has(normalized)) {
    return undefined;
  }

  return normalized;
}

function inferContentTags(text: string, brandContext?: BrandPromptContext): string[] {
  const normalized = normalizeWhitespace(text).toLowerCase();

  if (!normalized) {
    return [];
  }

  const scores = new Map<string, number>();
  const signalPhrases = [
    ...(brandContext?.topics ?? []),
    ...(brandContext?.goals ?? []),
    ...(brandContext?.topContentTags ?? []),
  ];

  for (const phrase of signalPhrases) {
    const normalizedPhrase = normalizeTagValue(phrase);

    if (normalizedPhrase && normalized.includes(normalizedPhrase)) {
      addTagScore(scores, normalizedPhrase, normalizedPhrase.includes(" ") ? 8 : 6);
    }
  }

  const lines = extractLines(text);

  for (const [index, line] of lines.slice(0, 3).entries()) {
    const tokens = line
      .toLowerCase()
      .split(/[^a-z0-9]+/g)
      .map((token) => token.trim())
      .filter((token) => token.length >= 4 && !TAG_STOP_WORDS.has(token));

    for (const token of tokens) {
      addTagScore(scores, token, index === 0 ? 4 : 3 - index);
    }
  }

  const counts = new Map<string, number>();

  for (const token of normalized.split(/[^a-z0-9]+/g)) {
    const normalizedToken = normalizeTagValue(token);

    if (!normalizedToken || normalizedToken.includes(" ")) {
      continue;
    }

    counts.set(normalizedToken, (counts.get(normalizedToken) ?? 0) + 1);
  }

  for (const [token, count] of counts.entries()) {
    addTagScore(scores, token, count >= 3 ? count + 2 : count);
  }

  return [...scores.entries()]
    .sort((left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1];
      }

      return left[0].localeCompare(right[0]);
    })
    .map(([tag]) => tag)
    .slice(0, 5);
}

function inferCtaType(text: string): ContentAssetCtaType {
  const normalized = normalizeWhitespace(text).toLowerCase();

  if (!normalized) {
    return "none";
  }

  if (/\b(book|schedule|reserve|tour)\b/.test(normalized)) {
    return "book_now";
  }

  if (/\b(reply|respond|email me|send a reply)\b/.test(normalized)) {
    return "reply";
  }

  if (/\b(message|dm|call|text us|reach out)\b/.test(normalized)) {
    return "message";
  }

  if (/\b(download|get the guide|get the checklist|get the template)\b/.test(normalized)) {
    return "download";
  }

  if (/\b(sign up|subscribe|join now|start your|start the)\b/.test(normalized)) {
    return "sign_up";
  }

  if (/\b(shop|buy|order|claim)\b/.test(normalized)) {
    return "shop_now";
  }

  if (/\b(learn more|see more|explore|visit|take a look)\b/.test(normalized)) {
    return "learn_more";
  }

  return "none";
}

function inferContentIntent(input: {
  text: string;
  format: ContentAssetFormat;
  ctaType: ContentAssetCtaType;
}): ContentAssetIntent {
  const normalized = normalizeWhitespace(input.text).toLowerCase();

  if (input.ctaType === "book_now" || input.ctaType === "shop_now" || input.ctaType === "sign_up") {
    return "conversion";
  }

  if (input.ctaType === "reply" || input.ctaType === "message") {
    return "engagement";
  }

  if (input.format === "story") {
    return "storytelling";
  }

  if (input.format === "list") {
    return "education";
  }

  if (/\b(review|testimonial|trusted by|customer|famil(y|ies) love|why parents choose)\b/.test(normalized)) {
    return "social_proof";
  }

  return "awareness";
}

function scoreHookStrength(text: string, hookType: ContentAssetHookType): number {
  const openingLine = getOpeningLine(text);

  if (!openingLine) {
    return 28;
  }

  let score = 48;

  if (openingLine.length >= 24 && openingLine.length <= 96) {
    score += 16;
  }

  if (hookType === "curiosity") {
    score += 14;
  } else if (hookType === "bold_statement") {
    score += 12;
  } else if (hookType === "question") {
    score += 8;
  }

  if (/\bbut\b|\bunless\b|\binstead\b|\btruth\b|\bmistake\b|\bproblem\b/i.test(openingLine)) {
    score += 10;
  }

  if (openingLine.length > 120) {
    score -= 12;
  }

  return clampPercentage(score);
}

function scoreClarity(text: string): number {
  const lines = extractLines(text);

  if (lines.length === 0) {
    return 24;
  }

  const wordCount = countWords(text);
  const averageLineLength =
    lines.reduce((total, line) => total + line.length, 0) / Math.max(lines.length, 1);
  const shortParagraphBonus = averageLineLength <= 120 ? 16 : averageLineLength <= 180 ? 8 : 0;

  let score = 46 + shortParagraphBonus;

  if (lines.length >= 3) {
    score += 10;
  }

  if (wordCount >= 60 && wordCount <= 220) {
    score += 12;
  } else if (wordCount > 260) {
    score -= 8;
  }

  if (/\n\n/.test(text)) {
    score += 8;
  }

  return clampPercentage(score);
}

function tokenizeSignalText(value: string): string[] {
  return normalizeWhitespace(value)
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((part) => part.trim())
    .filter((part) => part.length >= 4);
}

function scoreBusinessAlignment(text: string, brandContext?: BrandPromptContext): number {
  const signalWords = [
    ...(brandContext?.goals ?? []),
    ...(brandContext?.topics ?? []),
    ...(brandContext?.patterns ?? []),
  ].flatMap((value) => tokenizeSignalText(value));

  if (signalWords.length === 0) {
    return 62;
  }

  const normalizedText = normalizeWhitespace(text).toLowerCase();
  const uniqueSignals = [...new Set(signalWords)];
  const hits = uniqueSignals.filter((signal) => normalizedText.includes(signal)).length;
  const coverage = hits / uniqueSignals.length;

  return clampPercentage(44 + coverage * 46);
}

function scoreOpinionStrength(text: string): number {
  const normalizedText = normalizeWhitespace(text);
  let score = 38;

  if (/\b(most|few|almost no one|the problem|the reason|truth is|founders)\b/i.test(normalizedText)) {
    score += 18;
  }

  if (/\bbut\b|\binstead\b|\brather than\b|\buntil\b|\bwithout\b|\byet\b/i.test(normalizedText)) {
    score += 14;
  }

  if (/\bshould\b|\bneed to\b|\bdon't\b|\bnever\b|\bstop\b/i.test(normalizedText)) {
    score += 10;
  }

  if (/\bimportant\b|\bgreat\b|\bvaluable\b|\bhelpful\b/i.test(normalizedText)) {
    score -= 6;
  }

  return clampPercentage(score);
}

function inferPovBoldness(opinionStrength: number): ContentPovBoldness {
  if (opinionStrength >= 78) {
    return "bold";
  }

  if (opinionStrength >= 58) {
    return "balanced";
  }

  return "measured";
}

function buildPovSummary(input: {
  format: ContentAssetFormat;
  hookType: ContentAssetHookType;
  quality: ContentQualityScore;
  brandContext?: BrandPromptContext;
}): string {
  const stance =
    input.quality.opinionStrength >= 74
      ? "Leads with a strong founder point of view."
      : input.quality.opinionStrength >= 56
        ? "Keeps a clear stance without overreaching."
        : "Still reads more informative than opinionated.";

  const alignment =
    input.quality.businessAlignment >= 72
      ? "Ties back to this workspace's positioning."
      : "Could tie more directly to the business goal.";

  const formatLabel =
    input.format === "story"
      ? "Uses a story structure."
      : input.format === "list"
        ? "Uses a structured list."
        : "Uses an insight-led structure.";

  const hookLabel =
    input.hookType === "curiosity"
      ? "The opening creates contrast and tension."
      : input.hookType === "bold_statement"
        ? "The opening lands as a sharp claim."
        : input.hookType === "question"
          ? "The opening invites a response."
          : "The opening is direct and readable.";

  const goal =
    input.brandContext?.goals && input.brandContext.goals.length > 0
      ? `Primary goal in view: ${input.brandContext.goals[0]}.`
      : undefined;

  return [stance, hookLabel, formatLabel, alignment, goal].filter(Boolean).join(" ");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isFormat(value: unknown): value is ContentAssetFormat {
  return value === "story" || value === "list" || value === "insight";
}

function isHookType(value: unknown): value is ContentAssetHookType {
  return value === "question" || value === "bold_statement" || value === "curiosity" || value === "direct";
}

function isLengthBucket(value: unknown): value is ContentAssetLengthBucket {
  return value === "short" || value === "medium" || value === "long";
}

function isCtaType(value: unknown): value is ContentAssetCtaType {
  return value === "book_now"
    || value === "learn_more"
    || value === "reply"
    || value === "message"
    || value === "download"
    || value === "sign_up"
    || value === "shop_now"
    || value === "none";
}

function isContentIntent(value: unknown): value is ContentAssetIntent {
  return value === "conversion"
    || value === "engagement"
    || value === "education"
    || value === "storytelling"
    || value === "social_proof"
    || value === "awareness";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isQualityScore(value: unknown): value is ContentQualityScore {
  if (!isObject(value)) {
    return false;
  }

  return [
    value.overall,
    value.hookStrength,
    value.clarity,
    value.businessAlignment,
    value.opinionStrength,
  ].every((candidate) => Number.isFinite(Number(candidate)));
}

function isPovBoldness(value: unknown): value is ContentPovBoldness {
  return value === "measured" || value === "balanced" || value === "bold";
}

function isPovProfile(value: unknown): value is ContentPovProfile {
  return (
    isObject(value) &&
    typeof value.summary === "string" &&
    value.summary.trim() !== "" &&
    isPovBoldness(value.boldness)
  );
}

export function buildContentQualityScoreFromText(
  text: string,
  brandContext?: BrandPromptContext,
): ContentQualityScore | undefined {
  const normalized = normalizeWhitespace(text);

  if (!normalized) {
    return undefined;
  }

  const hookType = inferHookType(normalized);
  const hookStrength = scoreHookStrength(normalized, hookType);
  const clarity = scoreClarity(normalized);
  const businessAlignment = scoreBusinessAlignment(normalized, brandContext);
  const opinionStrength = scoreOpinionStrength(normalized);

  return {
    overall: clampPercentage(
      hookStrength * 0.28 +
        clarity * 0.26 +
        businessAlignment * 0.22 +
        opinionStrength * 0.24,
    ),
    hookStrength,
    clarity,
    businessAlignment,
    opinionStrength,
  };
}

export function buildPovProfileFromText(
  text: string,
  brandContext?: BrandPromptContext,
): ContentPovProfile | undefined {
  const normalized = normalizeWhitespace(text);

  if (!normalized) {
    return undefined;
  }

  const format = inferContentFormat(normalized);
  const hookType = inferHookType(normalized);
  const quality = buildContentQualityScoreFromText(normalized, brandContext);

  if (!quality) {
    return undefined;
  }

  return {
    summary: buildPovSummary({
      format,
      hookType,
      quality,
      brandContext,
    }),
    boldness: inferPovBoldness(quality.opinionStrength),
  };
}

export function buildContentAssetIntelligenceFromText(
  text: string,
  brandContext?: BrandPromptContext,
): ContentAssetIntelligence | undefined {
  const normalized = normalizeWhitespace(text);

  if (!normalized) {
    return undefined;
  }

  const wordCount = countWords(normalized);
  const format = inferContentFormat(normalized);
  const ctaType = inferCtaType(normalized);
  const quality = buildContentQualityScoreFromText(normalized, brandContext);
  const pov = buildPovProfileFromText(normalized, brandContext);
  const tags = inferContentTags(normalized, brandContext);

  return {
    format,
    hookType: inferHookType(normalized),
    length: inferLengthBucket(wordCount),
    wordCount,
    characterCount: normalized.length,
    tags,
    primaryTag: tags[0],
    ctaType,
    intent: inferContentIntent({
      text: normalized,
      format,
      ctaType,
    }),
    quality,
    pov,
  };
}

export function resolveStoredContentAssetIntelligence(
  value: unknown,
  fallbackText: string,
): ContentAssetIntelligence | undefined {
  if (isObject(value)) {
    const format = value.format;
    const hookType = value.hookType;
    const length = value.length;
    const wordCount = Number(value.wordCount);
    const characterCount = Number(value.characterCount);

    if (
      isFormat(format) &&
      isHookType(hookType) &&
      isLengthBucket(length) &&
      Number.isFinite(wordCount) &&
      Number.isFinite(characterCount)
    ) {
      const tags = isStringArray(value.tags)
        ? value.tags
            .map((entry) => normalizeTagValue(entry))
            .filter((entry): entry is string => Boolean(entry))
            .slice(0, 5)
        : [];
      const primaryTag = normalizeTagValue(typeof value.primaryTag === "string" ? value.primaryTag : undefined)
        ?? tags[0];

      return {
        format,
        hookType,
        length,
        wordCount,
        characterCount,
        tags,
        primaryTag,
        ctaType: isCtaType(value.ctaType) ? value.ctaType : undefined,
        intent: isContentIntent(value.intent) ? value.intent : undefined,
        quality: isQualityScore(value.quality)
          ? {
              overall: Number(value.quality.overall),
              hookStrength: Number(value.quality.hookStrength),
              clarity: Number(value.quality.clarity),
              businessAlignment: Number(value.quality.businessAlignment),
              opinionStrength: Number(value.quality.opinionStrength),
            }
          : undefined,
        pov: isPovProfile(value.pov)
          ? {
              summary: value.pov.summary.trim(),
              boldness: value.pov.boldness,
            }
          : undefined,
      };
    }
  }

  return buildContentAssetIntelligenceFromText(fallbackText);
}

function toUtcDateKey(value: string): string {
  return new Date(value).toISOString().slice(0, 10);
}

function countBestWeekPostedDays(dateKeys: string[]): number {
  if (dateKeys.length === 0) {
    return 0;
  }

  const uniqueDates = [...new Set(dateKeys)].sort();
  let best = 0;

  for (const dateKey of uniqueDates) {
    const start = new Date(`${dateKey}T00:00:00.000Z`).getTime();
    const end = start + 6 * 24 * 60 * 60 * 1000;
    const daysInWindow = uniqueDates.filter((candidate) => {
      const value = new Date(`${candidate}T00:00:00.000Z`).getTime();
      return value >= start && value <= end;
    }).length;

    best = Math.max(best, daysInWindow);
  }

  return best;
}

function findMostCommonValue<T extends string>(values: T[]): T | undefined {
  if (values.length === 0) {
    return undefined;
  }

  const counts = new Map<T, number>();

  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0];
}

export function buildDashboardIntelligenceSummary(input: {
  publishedAts: string[];
  bestTimeSlots: RecommendedPostTimeSlot[];
  pipelineItems: ContentAsset[];
}): DashboardIntelligenceSummary {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const windowStart = new Date(today);
  windowStart.setUTCDate(windowStart.getUTCDate() - 6);
  const windowStartMs = windowStart.getTime();

  const normalizedPublishedAts = input.publishedAts
    .map((value) => new Date(value))
    .filter((value) => !Number.isNaN(value.getTime()))
    .sort((left, right) => right.getTime() - left.getTime());

  const published7d = normalizedPublishedAts.filter((value) => value.getTime() >= windowStartMs);
  const postedDays7d = new Set(published7d.map((value) => value.toISOString().slice(0, 10))).size;
  const allDateKeys = normalizedPublishedAts.map((value) => toUtcDateKey(value.toISOString()));
  const assetsWithIntelligence = input.pipelineItems
    .map((asset) => asset.intelligence)
    .filter((value): value is NonNullable<ContentAsset["intelligence"]> => Boolean(value));

  return {
    postsPublished7d: published7d.length,
    postedDays7d,
    bestWeekPostedDays: countBestWeekPostedDays(allDateKeys),
    skippedDays7d: Math.max(0, 7 - postedDays7d),
    nextSuggestedPostLabel: input.bestTimeSlots[0]?.localLabel,
    topFormat: findMostCommonValue(assetsWithIntelligence.map((item) => item.format)),
    topHookType: findMostCommonValue(assetsWithIntelligence.map((item) => item.hookType)),
    topLength: findMostCommonValue(assetsWithIntelligence.map((item) => item.length)),
  };
}
