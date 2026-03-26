import type { ContentAsset } from "../../../packages/shared-types";
import type { ContentScoreResult } from "../components/dashboard/dashboard-types";

function extractLines(content: string): string[] {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

function detectStructure(lines: string[]): ContentScoreResult["structure"] {
  const listLineCount = lines.filter((line) => /^[-*•]|\d+\./.test(line)).length;

  if (listLineCount >= 2) {
    return "list";
  }

  if (lines.length >= 5 || /\bI\b|\bwe\b|\blearned\b|\bnoticed\b/i.test(lines.join(" "))) {
    return "story";
  }

  return "flat";
}

function detectCTA(content: string): boolean {
  return /\b(comment|share|follow|reply|dm|message|try|want to|what do you think|let me know)\b/i.test(
    content,
  );
}

function scoreHook(firstLine: string): number {
  if (!firstLine) {
    return 28;
  }

  let hookScore = 44;

  if (firstLine.length >= 30 && firstLine.length <= 90) {
    hookScore += 18;
  }

  if (/^(most|why|how|stop|nobody|the)\b/i.test(firstLine)) {
    hookScore += 12;
  }

  if (/[?:]/.test(firstLine) || /\bbut\b|\bunless\b|\bwithout\b/i.test(firstLine)) {
    hookScore += 10;
  }

  if (firstLine.length > 120) {
    hookScore -= 10;
  }

  return Math.max(22, Math.min(96, hookScore));
}

function describeExpectedReach(score: number, viralScore: number): ContentScoreResult["expectedReach"] {
  if (viralScore >= 84 || score >= 86) {
    return "High";
  }

  if (viralScore >= 66 || score >= 70) {
    return "Medium";
  }

  return "Low";
}

function describeEngagementOutlook(input: {
  hookScore: number;
  hasCTA: boolean;
  structure: ContentScoreResult["structure"];
  expectedReach: ContentScoreResult["expectedReach"];
}): string {
  if (input.hookScore < 60) {
    return "Engagement is likely to stay low unless the hook gets sharper.";
  }

  if (!input.hasCTA) {
    return "Reach is possible, but engagement will be softer without a CTA.";
  }

  if (input.structure === "flat") {
    return "This can reach people, but it needs a stronger format to drive saves and replies.";
  }

  if (input.expectedReach === "High") {
    return "This has the structure and hook strength to compete for stronger engagement.";
  }

  return "This is in range. One sharper edit can lift replies and saves.";
}

export function calculateContentScore(asset: ContentAsset): ContentScoreResult {
  const content = asset.textContent?.trim() ?? "";
  const lines = extractLines(content);
  const firstLine = lines[0] ?? "";
  const wordCount = content.split(/\s+/).filter(Boolean).length;
  const structure = detectStructure(lines);
  const hasCTA = detectCTA(content);
  const hookScore = scoreHook(firstLine);
  let score = 38;

  if (wordCount >= 90 && wordCount <= 230) {
    score += 16;
  } else if (wordCount > 230) {
    score += 10;
  } else if (wordCount < 50) {
    score -= 10;
  }

  if (structure === "story") {
    score += 12;
  } else if (structure === "list") {
    score += 10;
  }

  if (hasCTA) {
    score += 8;
  }

  if (asset.sourceKind === "capture" || asset.sourceKind === "remix") {
    score += 6;
  }

  if (asset.pipelineStage === "review" || asset.pipelineStage === "scheduled") {
    score += 8;
  }

  score += Math.round((hookScore - 50) * 0.35);
  score = Math.max(32, Math.min(97, score));

  const viralScore = Math.max(
    30,
    Math.min(
      98,
      Math.round(score * 0.72 + hookScore * 0.28 + (structure === "story" ? 4 : 0)),
    ),
  );
  const expectedReach = describeExpectedReach(score, viralScore);
  const engagementOutlook = describeEngagementOutlook({
    hookScore,
    hasCTA,
    structure,
    expectedReach,
  });

  if (score >= 84) {
    return {
      score,
      hookScore,
      viralScore,
      hasCTA,
      structure,
      length: wordCount,
      label: "High-performing format",
      detail: "Strong hook, enough depth, and a clear structure for LinkedIn.",
      highlight: true,
      expectedReach,
      engagementOutlook,
      suggestedTone: structure === "story" ? "storytelling" : undefined,
      suggestedFormat: structure === "list" ? "list" : undefined,
    };
  }

  if (score >= 70) {
    return {
      score,
      hookScore,
      viralScore,
      hasCTA,
      structure,
      length: wordCount,
      label: "Ready to post",
      detail: "This is close. One small improvement can raise the upside.",
      highlight: false,
      expectedReach,
      engagementOutlook,
      suggestedTone: structure === "flat" ? "storytelling" : undefined,
      suggestedFormat: structure === "flat" ? "story" : undefined,
    };
  }

  return {
    score,
    hookScore,
    viralScore,
    hasCTA,
    structure,
    length: wordCount,
    label: "Needs stronger positioning",
    detail: "Sharpen the opening and add one concrete takeaway before posting.",
    highlight: false,
    expectedReach,
    engagementOutlook,
    suggestedTone: "storytelling",
    suggestedFormat: structure === "flat" ? "list" : undefined,
  };
}

export function useContentScore() {
  return {
    calculateContentScore,
  };
}
