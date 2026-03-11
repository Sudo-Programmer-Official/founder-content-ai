export interface TextGenerationRequest {
  prompt: string;
  model?: string;
  temperature?: number;
}

export async function generateText(_request: TextGenerationRequest): Promise<string> {
  throw new Error("generateText is not implemented in Phase 3 scaffolding.");
}
