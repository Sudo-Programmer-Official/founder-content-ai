import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateCompletion } from "../../../../../packages/ai-core/src/generateCompletion.ts";
import { competitiveIntelligencePromptFiles } from "../../../../../packages/prompts/index.ts";
import type {
  HookType,
  SourceItem,
  SourceItemAnalysis,
  SourceItemFormat,
  ToneCategory,
} from "../../../../../packages/shared-types/index.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../");

function stripCodeFences(value: string): string {
  return value
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function buildPrompt(template: string, variables: Record<string, string | undefined>): string {
  const filteredVariables = Object.fromEntries(
    Object.entries(variables).filter(([, value]) => typeof value === "string" && value.trim() !== ""),
  );

  return [
    template.trim(),
    "",
    "USER INPUT",
    JSON.stringify(filteredVariables, null, 2),
    "",
    "RESPONSE RULES",
    "- Return only valid JSON.",
    "- Do not wrap the JSON in markdown code fences.",
  ].join("\n");
}

async function loadAnalysisPrompt(): Promise<string> {
  return readFile(path.resolve(repoRoot, competitiveIntelligencePromptFiles.sourceItemAnalysis), "utf8");
}

function clampConfidence(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(numeric)) {
    return 0.55;
  }

  return Math.min(1, Math.max(0.1, numeric));
}

function normalizeHookType(value: unknown): HookType {
  const normalized = typeof value === "string" ? value.trim() : "";

  switch (normalized) {
    case "curiosity":
    case "contrarian":
    case "story":
    case "how-to":
    case "list":
    case "question":
    case "data":
    case "insight":
      return normalized;
    default:
      return "other";
  }
}

function normalizeTone(value: unknown): ToneCategory {
  const normalized = typeof value === "string" ? value.trim() : "";

  switch (normalized) {
    case "storytelling":
    case "educational":
    case "contrarian":
    case "analytical":
    case "promotional":
    case "conversational":
      return normalized;
    default:
      return "other";
  }
}

function normalizeFormat(value: unknown): SourceItemFormat {
  const normalized = typeof value === "string" ? value.trim() : "";

  switch (normalized) {
    case "article":
    case "post":
    case "thread":
    case "landing-page":
    case "newsletter":
    case "note":
      return normalized;
    default:
      return "other";
  }
}

function extractTopicFromText(item: SourceItem): string {
  const subject = `${item.title} ${item.excerpt ?? ""}`.toLowerCase();

  if (subject.includes("linkedin")) {
    return "LinkedIn growth";
  }

  if (subject.includes("startup") || subject.includes("founder")) {
    return "Founder lessons";
  }

  if (subject.includes("marketing") || subject.includes("content")) {
    return "Content marketing";
  }

  if (subject.includes("email")) {
    return "Email strategy";
  }

  return item.title.split(/[.:|-]/)[0]?.trim() || "General strategy";
}

function fallbackAnalysis(item: SourceItem): Omit<SourceItemAnalysis, "id" | "sourceItemId" | "createdAt" | "updatedAt"> {
  const title = item.title.trim();
  const lowerTitle = title.toLowerCase();
  const content = item.contentText.toLowerCase();

  const hookType: HookType = lowerTitle.endsWith("?")
    ? "question"
    : /\bhow\b/.test(lowerTitle)
      ? "how-to"
      : /\bwhy\b/.test(lowerTitle)
        ? "curiosity"
        : /\bmistake|lesson|learned\b/.test(content)
          ? "story"
          : /\bdata|study|report|numbers\b/.test(content)
            ? "data"
            : "insight";

  const tone: ToneCategory = /\bshould|must|framework|step\b/.test(content)
    ? "educational"
    : /\bbut|however|wrong|myth\b/.test(content)
      ? "contrarian"
      : /\bi\b|\bwe\b|\bour\b/.test(content)
        ? "storytelling"
        : "analytical";

  const format: SourceItemFormat = item.canonicalUrl?.includes("/newsletter/")
    ? "newsletter"
    : item.canonicalUrl?.includes("/blog/") || item.canonicalUrl?.includes("/article/")
      ? "article"
      : "post";

  return {
    businessId: item.businessId,
    topic: extractTopicFromText(item),
    hookType,
    tone,
    format,
    whyItMightWork:
      "It appears to package a clear angle with a readable structure, which makes the core idea easy to scan and reuse.",
    confidence: 0.55,
  };
}

export async function analyzeSourceItem(
  item: SourceItem,
): Promise<Omit<SourceItemAnalysis, "id" | "sourceItemId" | "createdAt" | "updatedAt">> {
  if (!process.env.OPENAI_API_KEY) {
    return fallbackAnalysis(item);
  }

  try {
    const promptTemplate = await loadAnalysisPrompt();
    const prompt = buildPrompt(promptTemplate, {
      source_label: item.title,
      source_type: item.canonicalUrl ? "public" : "manual",
      title: item.title,
      excerpt: item.excerpt,
      content_text: item.contentText.slice(0, 5_000),
      canonical_url: item.canonicalUrl,
    });

    const completion = await generateCompletion(prompt);
    const parsed = JSON.parse(stripCodeFences(completion)) as Record<string, unknown>;

    return {
      businessId: item.businessId,
      topic:
        typeof parsed.topic === "string" && parsed.topic.trim() !== ""
          ? parsed.topic.trim()
          : extractTopicFromText(item),
      hookType: normalizeHookType(parsed.hook_type),
      tone: normalizeTone(parsed.tone),
      format: normalizeFormat(parsed.format),
      whyItMightWork:
        typeof parsed.why_it_might_work === "string" && parsed.why_it_might_work.trim() !== ""
          ? parsed.why_it_might_work.trim()
          : "It likely works because the idea is easy to understand and the framing creates curiosity.",
      confidence: clampConfidence(parsed.confidence),
    };
  } catch {
    return fallbackAnalysis(item);
  }
}
