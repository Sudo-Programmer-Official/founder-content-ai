import type { IdeaOption, ContentAsset } from "../../../packages/shared-types";
import type {
  AIRailContext,
  AISuggestion,
  ContentScoreResult,
  ContentSuggestion,
} from "../components/dashboard/dashboard-types";
import { calculateContentScore } from "./useContentScore";

export function getContentSuggestions(
  asset: ContentAsset,
  score: ContentScoreResult,
): ContentSuggestion[] {
  const suggestions: ContentSuggestion[] = [];

  if (score.hookScore < 60) {
    suggestions.push({
      severity: "critical",
      tone: "negative",
      label: "Will underperform",
      message: "This post will not perform as written. The hook is too generic to stop the scroll.",
      action: "fix_hook",
      priority: 96,
    });
  }

  if (score.length < 150) {
    suggestions.push({
      severity: "important",
      tone: "neutral",
      label: "Needs more depth",
      message: "There is not enough proof or story here yet. Add one concrete example before posting.",
      action: "expand_post",
      priority: 76,
    });
  }

  if (score.structure === "flat") {
    suggestions.push({
      severity: "optional",
      tone: "neutral",
      label: "Format is too flat",
      message: "This angle needs structure. A short story or list format will land better.",
      action: "change_format",
      priority: 72,
    });
  }

  if (score.viralScore >= 82 || asset.pipelineStage === "scheduled") {
    suggestions.push({
      severity: "optional",
      tone: "positive",
      label: "High viral potential",
      message: "This format already has the right ingredients for a stronger reach window.",
      action: "advance",
      priority: 64,
    });
  }

  return prioritizeSuggestions(suggestions).slice(0, 3);
}

export function getNextActionCopy(
  asset: ContentAsset,
  score: ContentScoreResult,
): string {
  const stage = asset.pipelineStage ?? "draft";

  if (stage === "draft") {
    return score.hookScore < 70
      ? "Do not move this forward until the hook creates more tension."
      : "Move this into review before the angle loses momentum.";
  }

  if (stage === "review") {
    return score.hasCTA
      ? "Schedule this in the next strong posting window."
      : "Add a CTA before you schedule this.";
  }

  if (stage === "scheduled") {
    return "Let this run, then repurpose the angle immediately while it is still fresh.";
  }

  return "Capture what worked here, then reuse the same structure.";
}

export function prioritizeSuggestions<T extends { priority: number }>(suggestions: T[]): T[] {
  return [...suggestions].sort((a, b) => b.priority - a.priority);
}

function buildCreateSuggestion(dailyIdea?: IdeaOption): AISuggestion | null {
  if (!dailyIdea) {
    return null;
  }

  return {
    type: "create",
    title: "Create a post before today's window closes",
    description: `${dailyIdea.title} — ${dailyIdea.angle}`,
    action: "daily-idea",
    actionLabel: "Generate",
    priority: 90,
    severity: "important",
    idea: dailyIdea,
  };
}

function buildFixSuggestion(context: AIRailContext): AISuggestion | null {
  const candidate = context.pipelineItems.find((asset) => asset.pipelineStage === "draft")
    ?? context.mission?.missionAsset;

  if (!candidate) {
    return null;
  }

  return {
    type: "fix",
    title: "Fix your hook before posting",
    description: "Your strongest unfinished draft will underperform unless the opening creates more tension.",
    action: "focus_asset",
    actionLabel: "Preview fix",
    priority: 84,
    severity: "critical",
    assetId: candidate.id,
  };
}

function buildRepurposeSuggestion(context: AIRailContext): AISuggestion | null {
  const candidate =
    context.pipelineItems.find((asset) => asset.pipelineStage === "posted")
    ?? context.pipelineItems.find((asset) => asset.pipelineStage === "scheduled")
    ?? context.mission?.missionAsset;

  if (!candidate) {
    return null;
  }

  return {
    type: "repurpose",
    title: "Repurpose a recent winner",
    description: "Turn one recent post into a carousel or remix it into a stronger angle.",
    action: "repurpose",
    actionLabel: "Repurpose",
    priority: 74,
    severity: "optional",
    assetId: candidate.id,
  };
}

function buildPredictionSuggestion(context: AIRailContext): AISuggestion | null {
  const mission = context.mission;
  const candidate = mission?.missionAsset;

  if (!candidate) {
    return null;
  }

  const score = calculateContentScore(candidate);

  return {
    type: "predict",
    title: "Preview impact before you post",
    description:
      score.expectedReach === "High"
        ? `Expected reach: High. ${score.engagementOutlook}`
        : `Expected reach: ${score.expectedReach}. ${score.engagementOutlook}`,
    action: "focus_asset",
    actionLabel: "Review",
    priority: 68,
    severity: mission && mission.score >= 82 ? "optional" : "important",
    assetId: candidate.id,
  };
}

function buildPrimaryRecommendation(context: AIRailContext, dailyIdea?: IdeaOption): AISuggestion | null {
  const missionAsset = context.mission?.missionAsset;
  const missionScore = context.mission?.score ?? 0;
  const missionHookScore = missionAsset ? calculateContentScore(missionAsset).hookScore : 0;

  if (missionAsset && (missionHookScore < 60 || missionScore < 70)) {
    return {
      type: "fix",
      title: "Fix hook before posting",
      description: "This draft will underperform as written.",
      action: "focus_asset",
      actionLabel: "Preview fix",
      priority: 100,
      recommended: true,
      severity: "critical",
      assetId: missionAsset.id,
    };
  }

  if (!context.postedToday) {
    if (dailyIdea) {
      return {
        type: "create",
        title: "Create today's post now",
        description: dailyIdea.title,
        action: "daily-idea",
        actionLabel: "Generate",
        priority: 100,
        recommended: true,
        severity: "important",
        idea: dailyIdea,
      };
    }

    return {
      type: "create",
      title: "Create one post now",
      description: "You have not posted today, and momentum is starting to slip.",
      action: "write",
      actionLabel: "Write",
      priority: 100,
      recommended: true,
      severity: "important",
    };
  }

  const repurposeCandidate =
    context.pipelineItems.find((asset) => asset.pipelineStage === "posted")
    ?? context.pipelineItems.find((asset) => asset.pipelineStage === "scheduled")
    ?? missionAsset;

  if (!repurposeCandidate) {
    return null;
  }

  return {
    type: "repurpose",
    title: "Repurpose your latest content",
    description: "Use your recent content while the angle is still fresh.",
    action: "repurpose",
    actionLabel: "Repurpose",
    priority: 100,
    recommended: true,
    severity: "optional",
    assetId: repurposeCandidate.id,
  };
}

export function buildAISuggestions(
  context: AIRailContext,
  dailyIdea?: IdeaOption,
): AISuggestion[] {
  const primary = buildPrimaryRecommendation(context, dailyIdea);
  const secondary = prioritizeSuggestions(
    [
      buildCreateSuggestion(dailyIdea),
      buildFixSuggestion(context),
      buildRepurposeSuggestion(context),
      buildPredictionSuggestion(context),
    ].filter(Boolean) as AISuggestion[],
  ).filter((suggestion) => suggestion.action !== primary?.action || suggestion.assetId !== primary.assetId);

  return [primary, ...secondary].filter(Boolean).slice(0, 4) as AISuggestion[];
}

export function useSuggestions() {
  return {
    buildAISuggestions,
    getContentSuggestions,
    getNextActionCopy,
    prioritizeSuggestions,
  };
}
