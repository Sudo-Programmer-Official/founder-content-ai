export interface OpenAIProviderConfig {
  apiKey?: string;
  model?: string;
}

export interface OpenAIProvider {
  name: "openai";
  model: string;
}

export function createOpenAIProvider(config: OpenAIProviderConfig = {}): OpenAIProvider {
  return {
    name: "openai",
    model: config.model ?? "gpt-5",
  };
}
