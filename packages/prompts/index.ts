export const founderContentPromptFiles = {
  linkedinPost: "packages/prompts/founder-content/linkedin-post.prompt",
  hookGenerator: "packages/prompts/founder-content/hook-generator.prompt",
  ideaGenerator: "packages/prompts/founder-content/idea-generator.prompt",
  captureGenerator: "packages/prompts/founder-content/capture-generator.prompt",
  remixGenerator: "packages/prompts/founder-content/remix-generator.prompt",
  editorCommand: "packages/prompts/founder-content/editor-command.prompt",
} as const;

export const competitiveIntelligencePromptFiles = {
  sourceItemAnalysis: "packages/prompts/competitive-intelligence/source-item-analysis.prompt",
} as const;

export const brandIntelligencePromptFiles = {
  brandProfileExtractor: "packages/prompts/brand-intelligence/brand-profile-extractor.prompt",
  workspaceKnowledgeExtractor: "packages/prompts/brand-intelligence/workspace-knowledge-extractor.prompt",
} as const;
