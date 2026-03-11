export interface TokenUsageRecord {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export function createEmptyTokenUsageRecord(): TokenUsageRecord {
  return {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  };
}
