import type { BrandPromptContext } from "../../shared-types/index.ts";

function sanitizeList(values: string[] | undefined): string[] {
  return (values ?? []).map((value) => value.trim()).filter((value) => value.length > 0);
}

export function buildBrandAlignedImagePrompt(
  brief: string | undefined,
  brandContext?: BrandPromptContext,
): string {
  const promptParts = [
    "Create a social-ready marketing visual aligned to the brand identity.",
    brief?.trim() ? `Creative brief: ${brief.trim()}` : undefined,
    brandContext?.tone ? `Brand tone: ${brandContext.tone}.` : undefined,
    brandContext?.writingStyle ? `Writing style cues: ${brandContext.writingStyle}.` : undefined,
    brandContext?.visualStyle ? `Visual style: ${brandContext.visualStyle}.` : undefined,
  ];

  const topics = sanitizeList(brandContext?.topics);
  const patterns = sanitizeList(brandContext?.patterns);

  if (topics.length > 0) {
    promptParts.push(`Prioritize these content themes: ${topics.join(", ")}.`);
  }

  if (patterns.length > 0) {
    promptParts.push(`Reflect these recurring patterns: ${patterns.join(" | ")}.`);
  }

  promptParts.push(
    "Favor high-contrast composition, clean hierarchy, and a layout that works for LinkedIn and brand-led social posts.",
  );

  return promptParts.filter(Boolean).join(" ");
}
