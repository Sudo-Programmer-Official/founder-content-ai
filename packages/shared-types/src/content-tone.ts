export type GenerationToneMode = "direct" | "storytelling" | "professional";

export const DEFAULT_GENERATION_TONE: GenerationToneMode = "direct";

const STORYTELLING_KEYWORDS = [
  "story",
  "storytelling",
  "founder",
  "narrative",
  "personal",
  "reflective",
  "friendly",
];

const PROFESSIONAL_KEYWORDS = [
  "professional",
  "structured",
  "educational",
  "framework",
  "analytical",
  "teaching",
];

const DIRECT_KEYWORDS = [
  "direct",
  "clear",
  "concise",
  "sharp",
  "practical",
  "punchy",
  "bold",
  "simple",
  "straight",
];

function normalizeToneInput(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

export function resolveGenerationToneMode(
  value: string | null | undefined,
): GenerationToneMode | undefined {
  const normalized = normalizeToneInput(value);

  if (!normalized) {
    return undefined;
  }

  if (normalized === "founder" || normalized === "storytelling") {
    return "storytelling";
  }

  if (normalized === "structured" || normalized === "professional") {
    return "professional";
  }

  if (normalized === "direct") {
    return "direct";
  }

  if (PROFESSIONAL_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
    return "professional";
  }

  if (STORYTELLING_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
    return "storytelling";
  }

  if (DIRECT_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
    return "direct";
  }

  return undefined;
}

export function normalizeGenerationToneOverride(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();

  if (!normalized) {
    return undefined;
  }

  return resolveGenerationToneMode(normalized) ?? normalized;
}
