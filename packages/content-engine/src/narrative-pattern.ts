import type { BrandPromptContext } from "../../shared-types/index.ts";

export type NarrativeBeat = "hook" | "insight" | "breakdown" | "takeaway";

export interface ResolvedNarrativePattern {
  rawPattern: string;
  beats: NarrativeBeat[];
  label: string;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function toTitleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function splitPatternTokens(value: string): string[] {
  return value
    .split(/\s*(?:->|=>|→|\||\/|,|\n)\s*/g)
    .map((token) => normalizeWhitespace(token.toLowerCase()))
    .filter(Boolean);
}

function resolveNarrativeBeat(token: string): NarrativeBeat | null {
  if (!token) {
    return null;
  }

  if (/\b(takeaway|cta|close|closing|punchline|conclusion|invite|invitation|next step|action)\b/.test(token)) {
    return "takeaway";
  }

  if (/\b(breakdown|proof|example|examples|reality|mechanism|why|how|step|steps|framework|system|playbook|process|tactical|operational)\b/.test(token)) {
    return "breakdown";
  }

  if (/\b(insight|lesson|belief|reframe|answer|angle|thesis|point|opinion|observation)\b/.test(token)) {
    return "insight";
  }

  if (/\b(hook|opener|opening|lead|setup|headline|story|question|challenge|contrarian|curiosity|pattern break)\b/.test(token)) {
    return "hook";
  }

  return null;
}

function normalizeNarrativeBeats(beats: NarrativeBeat[]): NarrativeBeat[] {
  const middleBeats = beats.filter((beat) => beat !== "hook" && beat !== "takeaway");
  const dedupedMiddle: NarrativeBeat[] = [];

  for (const beat of middleBeats) {
    if (!dedupedMiddle.includes(beat)) {
      dedupedMiddle.push(beat);
    }
  }

  return ["hook", ...dedupedMiddle, "takeaway"];
}

export function resolveNarrativePatternFromPatterns(
  patterns: string[] | undefined,
): ResolvedNarrativePattern | undefined {
  const normalizedPatterns = (patterns ?? [])
    .map((pattern) => normalizeWhitespace(pattern))
    .filter(Boolean);

  for (const pattern of normalizedPatterns) {
    const beats = splitPatternTokens(pattern)
      .map((token) => resolveNarrativeBeat(token))
      .filter((beat): beat is NarrativeBeat => Boolean(beat));

    if (beats.length === 0) {
      continue;
    }

    const normalizedBeats = normalizeNarrativeBeats(beats);

    return {
      rawPattern: pattern,
      beats: normalizedBeats,
      label: normalizedBeats.map((beat) => toTitleCase(beat)).join(" -> "),
    };
  }

  return undefined;
}

export function resolveNarrativePattern(
  brandContext: BrandPromptContext | undefined,
): ResolvedNarrativePattern | undefined {
  return resolveNarrativePatternFromPatterns(brandContext?.patterns);
}

export function serializeNarrativePattern(
  brandContext: BrandPromptContext | undefined,
): string | undefined {
  return resolveNarrativePattern(brandContext)?.label;
}

export function serializeNarrativePatternContext(
  brandContext: BrandPromptContext | undefined,
): string | undefined {
  const pattern = resolveNarrativePattern(brandContext);

  if (!pattern) {
    return undefined;
  }

  const beatCopy: Record<NarrativeBeat, string> = {
    hook: "Open with a short first line that creates tension or curiosity immediately.",
    insight: "State the core point early so the reader knows what the post is really about.",
    breakdown: "Use the middle to unpack proof, founder reality, mechanism, or example.",
    takeaway: "End with a crisp takeaway, closing punchline, or invitation. Do not fade out.",
  };

  return [
    `Use this narrative sequence as a required structure: ${pattern.label}.`,
    ...pattern.beats.map((beat, index) => `${index + 1}. ${toTitleCase(beat)}: ${beatCopy[beat]}`),
    pattern.beats.includes("breakdown")
      ? "Let the breakdown do the heavy lifting in the middle instead of front-loading everything into the hook."
      : "Keep the middle concise and move cleanly toward the close.",
  ].join("\n");
}
