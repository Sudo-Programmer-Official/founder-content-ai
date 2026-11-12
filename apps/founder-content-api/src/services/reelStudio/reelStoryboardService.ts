import { generateCompletion } from "../../../../../packages/ai-core/src/generateCompletion.ts";
import {
  REEL_ICON_NAMES,
  type ReelAudience,
  type ReelComparisonSide,
  type ReelFlowEdge,
  type ReelFlowNode,
  type ReelIconName,
  type ReelLanguage,
  type ReelProjectSettings,
  type ReelScene,
  type ReelStoryboard,
} from "../../../../../packages/shared-types/index.ts";
import { HttpError } from "../../utils/http.ts";

/** Spoken words per second used to budget narration for the requested duration. */
const WORDS_PER_SECOND: Record<ReelLanguage, number> = {
  english: 2.5,
  spanish: 2.6,
  hinglish: 2.4,
  hindi: 2.2,
};

const LANGUAGE_GUIDANCE: Record<ReelLanguage, string> = {
  english: "Write narration and on-screen text in natural, conversational English.",
  spanish: "Write narration and on-screen text in natural, conversational Latin American Spanish. Keep technical terms (API, Kafka, cache) in English.",
  hindi:
    "Write narration in natural spoken Hindi using Devanagari script, the way a friendly Indian tech teacher talks. Keep technical terms (API, Kafka, database, server) in English/Latin script inside the Hindi sentence. On-screen text may be short Hindi or English technical labels. Do not translate word-for-word from English.",
  hinglish:
    "Write narration in Hinglish: conversational Hindi-English mix in Roman (Latin) script, e.g. \"Socho tumhare paas 100 microservices hain\". Keep technical terms in English. On-screen text in short Hinglish or English.",
};

const AUDIENCE_GUIDANCE: Record<ReelAudience, string> = {
  developers: "Audience: working software engineers. Be precise, skip basics, use real terminology and concrete examples.",
  beginners: "Audience: complete beginners. Use everyday analogies, define jargon in one breath, no assumed knowledge.",
  students: "Audience: students preparing for exams or interviews. Be clear and structured, highlight the key takeaway.",
  general: "Audience: curious general public. Use relatable real-world analogies and avoid jargon.",
};

const SCENE_COUNT: Record<number, [number, number]> = {
  15: [3, 4],
  30: [5, 6],
  45: [6, 8],
  60: [8, 10],
};

const SCENE_LIBRARY = `
Scene types (pick the one that best VISUALISES each beat; vary them):
- "title": hook. Fields: kicker (1-3 words, optional), title (max 7 words), subtitle (max 10 words, optional).
- "bullets": key points. Fields: heading (max 6 words), bullets (2-4 items, each max 7 words).
- "flow": architecture / process diagram. Fields: heading (max 6 words), layout ("chain" for step-by-step pipelines, "hub" when one component sits in the middle of many), nodes (2-6, each {id, label max 2 words, icon}), edges ({from, to, label optional max 2 words}).
- "stat": one striking number. Fields: value (short, e.g. "10x", "99.99%", "1M+"), label (max 5 words), context (max 12 words, optional). Only use numbers that are realistic and widely accepted.
- "comparison": A vs B. Fields: heading (max 6 words), left {title max 3 words, points 2-3 items max 5 words}, right {same}. Right side is the recommended/better option.
- "code": tiny snippet. Fields: heading (max 6 words), language, code (max 8 lines, max 38 chars per line, real and correct).
- "outro": closing. Fields: title (max 6 words, the takeaway), cta (max 6 words, e.g. "Follow for more system design").
Allowed icons: ${REEL_ICON_NAMES.join(", ")}.
`;

function buildStoryboardPrompt(prompt: string, settings: ReelProjectSettings): string {
  const [minScenes, maxScenes] = SCENE_COUNT[settings.durationSeconds] ?? SCENE_COUNT[30];
  const wordBudget = Math.round(settings.durationSeconds * WORDS_PER_SECOND[settings.language]);

  return `You are the director of short vertical explainer reels (Instagram Reels / YouTube Shorts).
Turn the creator's request into a storyboard that a deterministic animation engine will render.
You only choose and configure scenes from the fixed library below; you never write animation code.

Creator request:
"""
${prompt}
"""

${AUDIENCE_GUIDANCE[settings.audience]}
${LANGUAGE_GUIDANCE[settings.language]}

Story rules:
- Target length: ${settings.durationSeconds} seconds of speech. Total narration across all scenes MUST be ${Math.round(wordBudget * 0.9)}-${Math.round(wordBudget * 1.05)} words (about ${Math.round(wordBudget / ((minScenes + maxScenes) / 2))} words per scene). Count them.
- Use ${minScenes}-${maxScenes} scenes. First scene must be "title": its narration is a scroll-stopping hook (a question or bold claim) plus a promise of what the viewer will learn. Last scene must be "outro" with the one-line takeaway.
- Tell it as a story with one concrete real-world example carried through the scenes (e.g. a specific app, company type, or everyday situation), not a list of generic facts.
- Narration is what the voice says; on-screen text is short and complements it (do not paste narration on screen).
- Each scene's narration matches exactly what that scene shows.
- Prefer at least one "flow" scene when explaining systems, processes, or architecture. Flow node labels: 1-2 words (e.g. "Orders", not "Order Service").
- Be technically accurate. Only use a "stat" scene for a number that is widely documented and verifiable; never invent survey percentages. When unsure, use another scene type.
${SCENE_LIBRARY}
Return ONLY a JSON object with this shape:
{
  "title": "short reel title",
  "caption": "Instagram caption, 1-2 sentences, in the same language",
  "hashtags": ["#tag", "... 3-6 tags"],
  "scenes": [ { "id": "s1", "type": "...", "narration": "...", ...type fields } ]
}`;
}

function buildSceneRegenerationPrompt(input: {
  storyboard: ReelStoryboard;
  sceneIndex: number;
  instruction?: string;
  settings: ReelProjectSettings;
  prompt: string;
}): string {
  const current = input.storyboard.scenes[input.sceneIndex];
  const wordsPerScene = Math.round(
    (input.settings.durationSeconds * WORDS_PER_SECOND[input.settings.language]) / Math.max(input.storyboard.scenes.length, 1),
  );

  return `You are the director of a short vertical explainer reel. Rewrite ONE scene of the storyboard.

Original creator request: """${input.prompt}"""
${AUDIENCE_GUIDANCE[input.settings.audience]}
${LANGUAGE_GUIDANCE[input.settings.language]}

Full storyboard for context:
${JSON.stringify(input.storyboard.scenes.map((scene) => ({ id: scene.id, type: scene.type, narration: scene.narration })), null, 2)}

Scene to rewrite (index ${input.sceneIndex}):
${JSON.stringify(current, null, 2)}

${input.instruction?.trim() ? `Creator's instruction for this scene: """${input.instruction.trim()}"""` : "Make this scene clearer and more engaging."}
Keep narration around ${wordsPerScene} words. Keep id "${current.id}". You may change the scene type if it visualises the beat better${
    input.sceneIndex === 0 ? ", but it must stay \"title\"" : input.sceneIndex === input.storyboard.scenes.length - 1 ? ", but it must stay \"outro\"" : ""
  }.
${SCENE_LIBRARY}
Return ONLY the scene as a JSON object.`;
}

// ---------------------------------------------------------------------------
// Normalisation: the LLM output is untrusted. Everything the renderer sees passes through here.
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function cleanText(value: unknown, maxChars: number): string {
  if (typeof value !== "string" && typeof value !== "number") {
    return "";
  }

  const text = String(value).replace(/\s+/g, " ").trim();
  const chars = [...text];
  return chars.length > maxChars ? `${chars.slice(0, maxChars - 1).join("").trimEnd()}…` : text;
}

function cleanList(value: unknown, maxItems: number, maxChars: number): string[] {
  return Array.isArray(value)
    ? value.map((item) => cleanText(item, maxChars)).filter(Boolean).slice(0, maxItems)
    : [];
}

function cleanIcon(value: unknown): ReelIconName {
  const icon = typeof value === "string" ? value.trim().toLowerCase() : "";
  return (REEL_ICON_NAMES as readonly string[]).includes(icon) ? (icon as ReelIconName) : "service";
}

function cleanCode(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .replace(/\r/g, "")
    .split("\n")
    .slice(0, 10)
    .map((line) => line.replace(/\t/g, "  ").slice(0, 46).trimEnd())
    .join("\n")
    .trim();
}

function cleanComparisonSide(value: unknown, fallbackTitle: string): ReelComparisonSide {
  const record = asRecord(value);
  return {
    title: cleanText(record.title, 28) || fallbackTitle,
    points: cleanList(record.points, 3, 48),
  };
}

function cleanFlow(record: Record<string, unknown>): { nodes: ReelFlowNode[]; edges: ReelFlowEdge[] } {
  const usedIds = new Set<string>();
  const nodes: ReelFlowNode[] = [];
  // Edges may reference nodes by raw id or by label; map both to the cleaned id.
  const rawToId = new Map<string, string>();

  for (const [index, rawNode] of (Array.isArray(record.nodes) ? record.nodes : []).slice(0, 7).entries()) {
    const node = asRecord(rawNode);
    const label = cleanText(node.label, 22);

    if (!label) {
      continue;
    }

    let id = cleanText(node.id, 40).toLowerCase().replace(/[^a-z0-9_-]/g, "") || `n${index + 1}`;
    while (usedIds.has(id)) {
      id = `${id}_${index}`;
    }

    usedIds.add(id);
    nodes.push({ id, label, icon: cleanIcon(node.icon) });
    rawToId.set(String(node.id ?? "").trim().toLowerCase(), id);
    rawToId.set(id, id);
    rawToId.set(label.toLowerCase(), id);
  }

  const edges: ReelFlowEdge[] = [];
  const seen = new Set<string>();

  for (const rawEdge of Array.isArray(record.edges) ? record.edges : []) {
    const edge = asRecord(rawEdge);
    const from = rawToId.get(String(edge.from ?? "").trim().toLowerCase());
    const to = rawToId.get(String(edge.to ?? "").trim().toLowerCase());
    const key = `${from}->${to}`;

    if (!from || !to || from === to || seen.has(key)) {
      continue;
    }

    seen.add(key);
    edges.push({ from, to, ...(cleanText(edge.label, 18) ? { label: cleanText(edge.label, 18) } : {}) });
  }

  // A diagram with no valid edges still reads as a pipeline.
  if (edges.length === 0) {
    for (let index = 0; index < nodes.length - 1; index += 1) {
      edges.push({ from: nodes[index].id, to: nodes[index + 1].id });
    }
  }

  return { nodes, edges };
}

/** Returns null when the scene cannot be salvaged into something renderable. */
function normalizeScene(raw: unknown, index: number): ReelScene | null {
  const record = asRecord(raw);
  const id = cleanText(record.id, 24).replace(/[^A-Za-z0-9_-]/g, "") || `s${index + 1}`;
  const narration = cleanText(record.narration, 420);
  const type = typeof record.type === "string" ? record.type.trim().toLowerCase() : "";

  if (!narration) {
    return null;
  }

  switch (type) {
    case "title": {
      const title = cleanText(record.title, 64);
      return title
        ? {
            id,
            type,
            narration,
            title,
            ...(cleanText(record.kicker, 24) ? { kicker: cleanText(record.kicker, 24) } : {}),
            ...(cleanText(record.subtitle, 90) ? { subtitle: cleanText(record.subtitle, 90) } : {}),
          }
        : null;
    }
    case "bullets": {
      const bullets = cleanList(record.bullets, 4, 60);
      return bullets.length > 0
        ? { id, type, narration, heading: cleanText(record.heading, 48) || "Key points", bullets }
        : null;
    }
    case "flow": {
      const { nodes, edges } = cleanFlow(record);
      return nodes.length >= 2
        ? {
            id,
            type,
            narration,
            heading: cleanText(record.heading, 48),
            layout: record.layout === "hub" ? "hub" : "chain",
            nodes: nodes.slice(0, 7),
            edges,
          }
        : null;
    }
    case "stat": {
      const value = cleanText(record.value, 12);
      return value
        ? {
            id,
            type,
            narration,
            value,
            label: cleanText(record.label, 44),
            ...(cleanText(record.context, 100) ? { context: cleanText(record.context, 100) } : {}),
          }
        : null;
    }
    case "comparison": {
      const left = cleanComparisonSide(record.left, "Before");
      const right = cleanComparisonSide(record.right, "After");
      return left.points.length > 0 && right.points.length > 0
        ? { id, type, narration, heading: cleanText(record.heading, 48), left, right }
        : null;
    }
    case "code": {
      const code = cleanCode(record.code);
      return code
        ? { id, type, narration, heading: cleanText(record.heading, 48), language: cleanText(record.language, 20) || "code", code }
        : null;
    }
    case "outro":
      return {
        id,
        type,
        narration,
        title: cleanText(record.title, 56) || "Thanks for watching",
        cta: cleanText(record.cta, 48) || "Follow for more",
      };
    default: {
      // Unknown type: keep the beat as a bullet scene if there is usable on-screen text.
      const heading = cleanText(record.heading ?? record.title, 48);
      return heading ? { id, type: "bullets", narration, heading, bullets: [cleanText(narration, 60)] } : null;
    }
  }
}

function ensureUniqueSceneIds(scenes: ReelScene[]): ReelScene[] {
  const seen = new Set<string>();
  return scenes.map((scene, index) => {
    let id = scene.id;
    while (seen.has(id)) {
      id = `${scene.id}_${index + 1}`;
    }
    seen.add(id);
    return { ...scene, id };
  });
}

export function normalizeStoryboard(raw: unknown): ReelStoryboard {
  const record = asRecord(raw);
  const scenes = ensureUniqueSceneIds(
    (Array.isArray(record.scenes) ? record.scenes : [])
      .slice(0, 12)
      .map((scene, index) => normalizeScene(scene, index))
      .filter((scene): scene is ReelScene => scene !== null),
  );

  if (scenes.length < 2) {
    throw new HttpError(502, "reel_storyboard_invalid", "The AI director returned an unusable storyboard. Try again.");
  }

  const hashtags = cleanList(record.hashtags, 8, 32).map((tag) => (tag.startsWith("#") ? tag : `#${tag}`).replace(/\s+/g, ""));

  return {
    title: cleanText(record.title, 80) || (scenes[0].type === "title" ? scenes[0].title : "Untitled reel"),
    caption: cleanText(record.caption, 600),
    hashtags,
    scenes,
  };
}

function parseJsonObject(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        // fall through
      }
    }
    throw new HttpError(502, "reel_storyboard_invalid", "The AI director returned malformed JSON. Try again.");
  }
}

function resolveStoryboardModel(): string | undefined {
  return process.env.REEL_STORYBOARD_MODEL?.trim() || undefined;
}

function countNarrationWords(storyboard: ReelStoryboard): number {
  return storyboard.scenes.reduce((sum, scene) => sum + scene.narration.split(/\s+/).filter(Boolean).length, 0);
}

export async function generateReelStoryboard(prompt: string, settings: ReelProjectSettings): Promise<ReelStoryboard> {
  const basePrompt = buildStoryboardPrompt(prompt, settings);
  const wordBudget = Math.round(settings.durationSeconds * WORDS_PER_SECOND[settings.language]);
  const model = resolveStoryboardModel();
  const storyboard = normalizeStoryboard(parseJsonObject(await generateCompletion(basePrompt, { jsonMode: true, model })));
  const words = countNarrationWords(storyboard);

  // Models routinely under-write narration, which yields a rushed, too-short reel. One corrective pass.
  if (words >= wordBudget * 0.75 && words <= wordBudget * 1.25) {
    return storyboard;
  }

  const feedback = `${basePrompt}

Your previous attempt is below. Its narration totals ${words} words but the reel needs about ${wordBudget} words.
Rewrite it so the total narration is ${Math.round(wordBudget * 0.9)}-${Math.round(wordBudget * 1.05)} words, keeping the same structure where it works.
${JSON.stringify(storyboard)}`;

  try {
    const revised = normalizeStoryboard(parseJsonObject(await generateCompletion(feedback, { jsonMode: true, model })));
    const revisedWords = countNarrationWords(revised);
    return Math.abs(revisedWords - wordBudget) < Math.abs(words - wordBudget) ? revised : storyboard;
  } catch {
    return storyboard;
  }
}

export async function regenerateReelScene(input: {
  storyboard: ReelStoryboard;
  sceneId: string;
  instruction?: string;
  settings: ReelProjectSettings;
  prompt: string;
}): Promise<ReelStoryboard> {
  const sceneIndex = input.storyboard.scenes.findIndex((scene) => scene.id === input.sceneId);

  if (sceneIndex < 0) {
    throw new HttpError(404, "reel_scene_not_found", "That scene no longer exists in this storyboard.");
  }

  const completion = await generateCompletion(
    buildSceneRegenerationPrompt({ ...input, sceneIndex }),
    { jsonMode: true, model: resolveStoryboardModel() },
  );
  const scene = normalizeScene(parseJsonObject(completion), sceneIndex);

  if (!scene) {
    throw new HttpError(502, "reel_scene_invalid", "The AI director returned an unusable scene. Try again.");
  }

  const scenes = [...input.storyboard.scenes];
  scenes[sceneIndex] = { ...scene, id: input.sceneId };
  return { ...input.storyboard, scenes };
}
