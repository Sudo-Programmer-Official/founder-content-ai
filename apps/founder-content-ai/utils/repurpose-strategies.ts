import {
  DEFAULT_REPURPOSE_STRATEGY,
  type RepurposeStrategy,
} from "../../../packages/shared-types";

export interface RepurposeStrategyOption {
  value: RepurposeStrategy;
  label: string;
  shortLabel: string;
  summary: string;
  submitLabel: string;
  autoLabel: string;
}

export const REPURPOSE_STRATEGY_OPTIONS: readonly RepurposeStrategyOption[] = [
  {
    value: "continue",
    label: "Continue writing",
    shortLabel: "Continue",
    summary: "Write the next logical post so the narrative keeps moving instead of repeating the same point.",
    submitLabel: "Generate next post",
    autoLabel: "Continue",
  },
  {
    value: "deepen",
    label: "Deeper angle",
    shortLabel: "Deeper",
    summary: "Go deeper into the same lesson, stakes, or mechanism with more depth and sharper founder reality.",
    submitLabel: "Generate deeper angle",
    autoLabel: "Deeper angle",
  },
  {
    value: "contrarian",
    label: "Contrarian take",
    shortLabel: "Contrarian",
    summary: "Challenge the safe default and turn the same idea into a sharper, more opinionated point of view.",
    submitLabel: "Generate contrarian take",
    autoLabel: "Contrarian take",
  },
  {
    value: "tactical",
    label: "Make it tactical",
    shortLabel: "Tactical",
    summary: "Convert the insight into a practical, usable post with specific actions or decisions founders can apply.",
    submitLabel: "Generate tactical post",
    autoLabel: "Make it tactical",
  },
] as const;

export function getRepurposeStrategyOption(
  strategy: RepurposeStrategy | null | undefined,
): RepurposeStrategyOption {
  return (
    REPURPOSE_STRATEGY_OPTIONS.find((option) => option.value === strategy)
    ?? REPURPOSE_STRATEGY_OPTIONS[0]
  );
}

export function resolveRepurposeStrategyLabel(
  strategy: RepurposeStrategy | null | undefined,
): string {
  return getRepurposeStrategyOption(strategy).label;
}

export function resolveRepurposeStrategySubmitLabel(
  strategy: RepurposeStrategy | null | undefined,
): string {
  return getRepurposeStrategyOption(strategy).submitLabel;
}

export { DEFAULT_REPURPOSE_STRATEGY };
