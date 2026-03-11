export interface StructuredGenerationRequest<TSchema> {
  prompt: string;
  schema: TSchema;
  model?: string;
}

export async function generateStructured<TOutput, TSchema>(
  _request: StructuredGenerationRequest<TSchema>,
): Promise<TOutput> {
  throw new Error("generateStructured is not implemented in Phase 3 scaffolding.");
}
