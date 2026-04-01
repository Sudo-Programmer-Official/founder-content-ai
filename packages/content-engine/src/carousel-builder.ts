import type {
  CarouselNarrativeType,
  CarouselSlideContent,
  ContentNarrative,
  ContentNarrativeSlide,
  ContentNarrativeType,
} from "../../shared-types/index.ts";
import {
  type NarrativeBeat,
  resolveNarrativePatternFromPatterns,
} from "./narrative-pattern.ts";

interface BuildContentNarrativeInput {
  narrativeType?: ContentNarrativeType;
  slideCount?: number;
  sourceText?: string;
  title?: string;
  subtitle?: string;
  slides?: ContentNarrativeSlide[];
  narrativePattern?: string[];
}

export interface CarouselNarrativeDeck {
  narrativeType: CarouselNarrativeType;
  slides: CarouselSlideContent[];
}

const DEFAULT_CTA_HEADLINE = "Follow for more founder insights";
const DEFAULT_CTA_SUPPORTING = "Turn ideas into trusted distribution.";

function normalizeLine(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function truncateLine(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  const truncated = value.slice(0, maxLength).trim();
  const lastSpaceIndex = truncated.lastIndexOf(" ");

  return lastSpaceIndex >= Math.floor(maxLength * 0.55)
    ? truncated.slice(0, lastSpaceIndex).trim()
    : truncated;
}

function clampSlideCount(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return 5;
  }

  return Math.max(3, Math.min(5, Math.floor(value!)));
}

function clampSlideCountForPattern(value: number | undefined, patternLength: number | undefined): number {
  const baseCount = clampSlideCount(value);

  if (!patternLength || patternLength <= 3) {
    return baseCount;
  }

  return Math.max(baseCount, Math.min(5, patternLength));
}

function dedupeLines(values: string[]): string[] {
  const seen = new Set<string>();

  return values.filter((value) => {
    const key = value.toLowerCase();

    if (!value || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function splitParagraphs(value: string | undefined): string[] {
  return dedupeLines(
    (value ?? "")
      .split(/\n{2,}/)
      .map((paragraph) => normalizeLine(paragraph.replace(/^[-*•]\s*/, "")))
      .filter(Boolean),
  );
}

function splitLines(value: string | undefined): string[] {
  return dedupeLines(
    (value ?? "")
      .split(/\n+/)
      .map((line) => normalizeLine(line.replace(/^[-*•]\s*/, "")))
      .filter(Boolean),
  );
}

function splitSentences(value: string | undefined): string[] {
  const paragraphs = splitParagraphs(value);

  return dedupeLines(
    paragraphs.flatMap((paragraph) =>
      paragraph
        .split(/(?<=[.!?])\s+/)
        .map((sentence) => normalizeLine(sentence))
        .filter(Boolean),
    ),
  );
}

function summarizeSentence(value: string | undefined, maxLength: number): string {
  const normalized = normalizeLine(value);

  if (!normalized) {
    return "";
  }

  const firstSentence = normalized.split(/(?<=[.!?])\s+/)[0] ?? normalized;
  return truncateLine(firstSentence, maxLength);
}

function stripTrailingPunctuation(value: string): string {
  return value.replace(/[\s"'()[\].,!?;:]+$/g, "").trim();
}

function splitHeadlineAndSupport(
  value: string,
  maxHeadlineLength: number,
): { headline: string; supportingText?: string } {
  const normalized = normalizeLine(value);

  if (!normalized) {
    return { headline: "" };
  }

  const clauseMatch = normalized.match(/^([^:;.-]{8,88})[:;-]\s+(.+)$/);

  if (clauseMatch) {
    return {
      headline: truncateLine(stripTrailingPunctuation(clauseMatch[1]), maxHeadlineLength),
      supportingText: truncateLine(clauseMatch[2], 120),
    };
  }

  const firstSentence = summarizeSentence(normalized, maxHeadlineLength);
  const remainder = normalizeLine(normalized.slice(firstSentence.length));

  return {
    headline: firstSentence,
    supportingText: remainder ? truncateLine(remainder, 120) : undefined,
  };
}

function inferNarrativeType(input: BuildContentNarrativeInput): ContentNarrativeType {
  const normalized = `${input.title ?? ""} ${input.subtitle ?? ""} ${input.sourceText ?? ""}`.toLowerCase();
  const lineCandidates = splitLines(input.sourceText);
  const hasFrameworkSignals =
    /\b(step|framework|system|playbook|process|checklist|how to|formula)\b/.test(normalized)
    || lineCandidates.filter((line) => /^(\d+\.|step\s+\d+|[-*•])\s*/i.test(line)).length >= 2;
  const hasContrarianSignals =
    /\b(i was wrong|wrong|myth|isn't|is not|stop|used to think|not\b.+\bbut\b|truth is)\b/.test(
      normalized,
    );
  const hasStorySignals =
    /\b(i|we)\b/.test(normalized)
    && /\b(learned|realized|mistake|lesson|failed|changed|thought)\b/.test(normalized);

  if (hasFrameworkSignals && !hasContrarianSignals) {
    return "framework";
  }

  if (hasContrarianSignals) {
    return "contrarian";
  }

  if (hasStorySignals) {
    return "story";
  }

  return lineCandidates.length >= 4 ? "framework" : "story";
}

function buildCtaSlide(): ContentNarrativeSlide {
  return {
    role: "cta",
    headline: DEFAULT_CTA_HEADLINE,
    supportingText: DEFAULT_CTA_SUPPORTING,
    bulletPoints: [],
  };
}

function createFallbackBeatSlide(beat: NarrativeBeat): ContentNarrativeSlide {
  switch (beat) {
    case "hook":
      return normalizeSlide({
        role: "hook",
        headline: "The usual content advice breaks too fast",
        bulletPoints: [],
      });
    case "insight":
      return normalizeSlide({
        role: "insight",
        headline: "Consistency comes from structure, not inspiration",
        bulletPoints: [],
      });
    case "breakdown":
      return normalizeSlide({
        role: "breakdown",
        headline: "Use one repeatable system instead of reinventing every post",
        bulletPoints: [],
      });
    case "takeaway":
    default:
      return normalizeSlide({
        role: "takeaway",
        headline: DEFAULT_CTA_HEADLINE,
        supportingText: DEFAULT_CTA_SUPPORTING,
        bulletPoints: [],
      });
  }
}

function normalizeSlide(slide: ContentNarrativeSlide): ContentNarrativeSlide {
  const normalizedBulletPoints = (slide.bulletPoints ?? [])
    .map((point) => truncateLine(normalizeLine(point), 88))
    .filter(Boolean)
    .slice(0, 3);

  return {
    role: normalizeLine(slide.role) || "insight",
    headline: truncateLine(normalizeLine(slide.headline), 84),
    supportingText: truncateLine(normalizeLine(slide.supportingText), 140) || undefined,
    bulletPoints: normalizedBulletPoints,
    highlightText: truncateLine(normalizeLine(slide.highlightText), 64) || undefined,
    eyebrowText: truncateLine(normalizeLine(slide.eyebrowText), 36) || undefined,
    footerText: truncateLine(normalizeLine(slide.footerText), 42) || undefined,
    closingText: truncateLine(normalizeLine(slide.closingText), 72) || undefined,
    assetId: normalizeLine(slide.assetId) || undefined,
    imageDataUrl: normalizeLine(slide.imageDataUrl) || undefined,
    mimeType: normalizeLine(slide.mimeType) || undefined,
  };
}

function toProofSlide(
  headline: string,
  supportingText: string | undefined,
  bulletPoints: string[],
  role: ContentNarrativeSlide["role"],
): ContentNarrativeSlide {
  return normalizeSlide({
    role,
    headline,
    supportingText,
    bulletPoints,
  });
}

function buildFrameworkSlides(input: BuildContentNarrativeInput, slideCount: number): ContentNarrativeSlide[] {
  const paragraphs = splitParagraphs(input.sourceText);
  const lines = splitLines(input.sourceText);
  const sentenceCandidates = splitSentences(input.sourceText);
  const lead = summarizeSentence(input.title || paragraphs[0] || sentenceCandidates[0], 84)
    || "A better founder framework";
  const leadSupport = summarizeSentence(input.subtitle || sentenceCandidates[1] || paragraphs[1], 120) || undefined;
  const rawSteps = dedupeLines(
    [
      ...lines.filter((line) => line.length > 14),
      ...paragraphs.slice(1),
      ...sentenceCandidates.slice(1),
    ],
  ).filter((candidate) => normalizeLine(candidate).toLowerCase() !== lead.toLowerCase());

  const stepCapacity = Math.max(1, slideCount - 2);
  const stepSlides = rawSteps.slice(0, stepCapacity).map((step, index) => {
    const split = splitHeadlineAndSupport(step, 72);

    return normalizeSlide({
      role: `step_${index + 1}`,
      headline: split.headline || `Step ${index + 1}`,
      supportingText: split.supportingText,
      bulletPoints: [],
    });
  });
  const resolvedStepSlides =
    stepSlides.length > 0
      ? stepSlides
      : [
          normalizeSlide({
            role: "step_1",
            headline: summarizeSentence(sentenceCandidates[1] || paragraphs[1] || input.subtitle, 72) || "Make the point easy to scan",
            supportingText: summarizeSentence(sentenceCandidates[2] || paragraphs[2], 120) || undefined,
            bulletPoints: [],
          }),
        ];

  return [
    normalizeSlide({
      role: "hook",
      headline: lead,
      supportingText: leadSupport,
      bulletPoints: [],
    }),
    ...resolvedStepSlides,
    buildCtaSlide(),
  ].slice(0, slideCount);
}

function extractContrarianReframe(value: string | undefined): string {
  const normalized = normalizeLine(value);

  if (!normalized) {
    return "";
  }

  const match = normalized.match(/\bnot\b\s+(.+?)\s+\bbut\b\s+(.+)$/i);

  if (match) {
    return summarizeSentence(match[2], 84);
  }

  const stopMatch = normalized.match(/\bstop\b\s+(.+?)\.\s+(.+)$/i);

  if (stopMatch) {
    return summarizeSentence(stopMatch[2], 84);
  }

  return "";
}

function buildContrarianSlides(
  input: BuildContentNarrativeInput,
  slideCount: number,
  storyMode = false,
): ContentNarrativeSlide[] {
  const paragraphs = splitParagraphs(input.sourceText);
  const sentences = splitSentences(input.sourceText);
  const lead = summarizeSentence(input.title || sentences[0] || paragraphs[0], 84)
    || "Most founders get this wrong";
  const challenge = summarizeSentence(
    sentences.find((sentence, index) =>
      index > 0 && /\b(wrong|but|actually|instead|turns out|problem)\b/i.test(sentence),
    ) || sentences[1] || "I was wrong.",
    72,
  ) || "I was wrong.";
  const reframe = extractContrarianReframe(input.sourceText)
    || summarizeSentence(sentences[2] || paragraphs[1] || input.subtitle, 84)
    || "The better way is simpler than it looks";
  const remaining = dedupeLines([...paragraphs.slice(1), ...sentences.slice(3)]).slice(0, 3);
  const proofBullets = remaining
    .map((entry) => summarizeSentence(entry, 84))
    .filter((entry) => entry.toLowerCase() !== reframe.toLowerCase())
    .slice(0, 3);
  const proofSupport = proofBullets.length > 0 ? undefined : summarizeSentence(paragraphs[2] || sentences[3], 120) || undefined;

  return [
    normalizeSlide({
      role: storyMode ? "hook" : "belief",
      headline: lead,
      supportingText: summarizeSentence(input.subtitle, 120) || undefined,
      bulletPoints: [],
    }),
    normalizeSlide({
      role: storyMode ? "pattern_break" : "challenge",
      headline: challenge,
      bulletPoints: [],
    }),
    normalizeSlide({
      role: storyMode ? "insight" : "reframe",
      headline: reframe,
      supportingText:
        storyMode
          ? summarizeSentence(sentences[3] || paragraphs[2], 120) || undefined
          : undefined,
      bulletPoints: [],
    }),
    toProofSlide(
      storyMode ? "What changed next" : "What that changes",
      proofSupport,
      proofBullets,
      storyMode ? "lesson" : "proof",
    ),
    buildCtaSlide(),
  ].slice(0, slideCount);
}

function buildPatternDrivenSlides(
  input: BuildContentNarrativeInput,
  slideCount: number,
  beats: NarrativeBeat[],
): ContentNarrativeSlide[] {
  const paragraphs = splitParagraphs(input.sourceText);
  const sentences = splitSentences(input.sourceText);
  const lineCandidates = dedupeLines([
    normalizeLine(input.title),
    normalizeLine(input.subtitle),
    ...paragraphs,
    ...sentences,
  ]).filter(Boolean);
  const lead = summarizeSentence(input.title || lineCandidates[0], 84)
    || "One founder idea worth keeping";
  const insight = summarizeSentence(
    input.subtitle
      || lineCandidates.find((candidate) => candidate.toLowerCase() !== lead.toLowerCase())
      || sentences[1]
      || paragraphs[1],
    84,
  ) || "The point gets stronger when the structure is obvious.";
  const takeaway = summarizeSentence(
    [...lineCandidates].reverse().find((candidate) =>
      candidate.toLowerCase() !== lead.toLowerCase()
      && candidate.toLowerCase() !== insight.toLowerCase(),
    ) || input.subtitle,
    84,
  ) || DEFAULT_CTA_HEADLINE;
  const supportingInsight = summarizeSentence(paragraphs[1] || sentences[2], 120) || undefined;
  const breakdownCandidates = dedupeLines([
    ...paragraphs,
    ...sentences,
  ])
    .filter((candidate) => {
      const normalized = candidate.toLowerCase();
      return (
        normalized !== lead.toLowerCase()
        && normalized !== insight.toLowerCase()
        && normalized !== takeaway.toLowerCase()
      );
    });
  const nonBreakdownCount = beats.filter((beat) => beat !== "breakdown").length;
  const breakdownSlots = beats.includes("breakdown")
    ? Math.max(1, slideCount - nonBreakdownCount)
    : 0;
  const breakdownSlides = breakdownSlots > 0
    ? Array.from({ length: breakdownSlots }, (_, index) => {
        const candidate = breakdownCandidates[index] || breakdownCandidates[breakdownCandidates.length - 1] || "";
        const split = splitHeadlineAndSupport(candidate, 72);

        return normalizeSlide({
          role: breakdownSlots > 1 ? `step_${Math.min(index + 1, 3)}` : "breakdown",
          headline: split.headline || summarizeSentence(candidate, 72) || "Break the idea into something usable",
          supportingText: split.supportingText || summarizeSentence(sentences[index + 2], 120) || undefined,
          bulletPoints: [],
        });
      })
    : [];
  const stageSlides = beats.flatMap((beat) => {
    if (beat === "breakdown") {
      return breakdownSlides.length > 0 ? breakdownSlides : [createFallbackBeatSlide("breakdown")];
    }

    if (beat === "hook") {
      return [normalizeSlide({
        role: "hook",
        headline: lead,
        supportingText: summarizeSentence(sentences[1], 120) || undefined,
        bulletPoints: [],
      })];
    }

    if (beat === "insight") {
      return [normalizeSlide({
        role: "insight",
        headline: insight,
        supportingText: supportingInsight,
        bulletPoints: [],
      })];
    }

    return [normalizeSlide({
      role: "takeaway",
      headline: takeaway,
      supportingText:
        takeaway === DEFAULT_CTA_HEADLINE
          ? DEFAULT_CTA_SUPPORTING
          : summarizeSentence(paragraphs[paragraphs.length - 1], 120) || undefined,
      bulletPoints: [],
    })];
  });

  return stageSlides.length > 0 ? stageSlides.slice(0, slideCount) : [buildCtaSlide()];
}

export function generateNarrative(input: BuildContentNarrativeInput): ContentNarrative {
  const resolvedPattern = resolveNarrativePatternFromPatterns(input.narrativePattern);
  const slideCount = clampSlideCountForPattern(input.slideCount, resolvedPattern?.beats.length);
  const explicitSlides = (input.slides ?? []).map(normalizeSlide).filter((slide) => slide.headline);
  const resolvedTitle = truncateLine(normalizeLine(input.title), 84) || "Founder narrative";
  const resolvedSubtitle = truncateLine(normalizeLine(input.subtitle), 140) || "";

  if (explicitSlides.length > 0) {
    return {
      format: "carousel",
      type: input.narrativeType ?? inferNarrativeType(input),
      title: resolvedTitle,
      subtitle: resolvedSubtitle,
      sourceText: normalizeLine(input.sourceText) || undefined,
      slides: explicitSlides.slice(0, slideCount),
    };
  }

  const narrativeType = input.narrativeType ?? inferNarrativeType(input);
  const slides =
    resolvedPattern
      ? buildPatternDrivenSlides(input, slideCount, resolvedPattern.beats)
      : narrativeType === "framework"
      ? buildFrameworkSlides(input, slideCount)
      : narrativeType === "contrarian"
        ? buildContrarianSlides(input, slideCount)
        : buildContrarianSlides(input, slideCount, true);

  return {
    format: "carousel",
    type: narrativeType,
    title: resolvedTitle,
    subtitle: resolvedSubtitle,
    sourceText: normalizeLine(input.sourceText) || undefined,
    slides,
  };
}

export function buildCarouselNarrative(input: BuildContentNarrativeInput): CarouselNarrativeDeck {
  const narrative = generateNarrative(input);

  return {
    narrativeType: narrative.type,
    slides: narrative.slides.map((slide) => ({
      headline: slide.headline,
      supportingText: slide.supportingText,
      bulletPoints: slide.bulletPoints,
      highlightText: slide.highlightText,
      eyebrowText: slide.eyebrowText,
      footerText: slide.footerText,
      closingText: slide.closingText,
      narrativeRole: slide.role,
    })),
  };
}
