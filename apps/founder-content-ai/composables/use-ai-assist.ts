import { computed } from "vue";
import type { AiAssistLevel } from "../../../packages/shared-types";
import { usePreferenceContext } from "../preferences/preference-context";

export interface AiAssistSuggestion {
  id: string;
  title: string;
  description: string;
  minimumLevel?: Exclude<AiAssistLevel, "off">;
  ctaLabel?: string;
  ctaTo?: string;
}

const AI_ASSIST_LEVEL_RANK: Record<AiAssistLevel, number> = {
  off: 0,
  minimal: 1,
  balanced: 2,
  proactive: 3,
};

const LEVEL_SUGGESTION_LIMIT: Record<AiAssistLevel, number> = {
  off: 0,
  minimal: 1,
  balanced: 2,
  proactive: 3,
};

export function useAiAssistSuggestions(suggestions: AiAssistSuggestion[]) {
  const { preferences } = usePreferenceContext();

  return computed(() => {
    const currentLevel = preferences.value.aiAssistLevel;
    const currentRank = AI_ASSIST_LEVEL_RANK[currentLevel];
    const visibleSuggestions = suggestions.filter((suggestion) => {
      const minimumLevel = suggestion.minimumLevel ?? "minimal";
      return currentRank >= AI_ASSIST_LEVEL_RANK[minimumLevel];
    });

    return visibleSuggestions.slice(0, LEVEL_SUGGESTION_LIMIT[currentLevel]);
  });
}
