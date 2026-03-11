export interface PromptDefinition {
  name: string;
  path: string;
  version: string;
}

export interface GenerationMetadata {
  feature: "ideas" | "hooks" | "linkedin-post";
  model?: string;
}
