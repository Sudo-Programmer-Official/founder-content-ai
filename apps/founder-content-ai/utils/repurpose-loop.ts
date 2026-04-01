import {
  DEFAULT_REPURPOSE_STRATEGY,
  isRepurposeStrategy,
  type RepurposeStrategy,
} from "../../../packages/shared-types";

export type GrowthDistributionFormat = "thread" | "carousel" | "video" | "email";

export interface RepurposeSeedPayload {
  text: string;
  title?: string;
  format?: GrowthDistributionFormat;
  strategy?: RepurposeStrategy;
  autoGenerate?: boolean;
  source: "dashboard" | "variation" | "history" | "result";
}

const REPURPOSE_SEED_STORAGE_KEY = "fc:repurpose-seed";

export function saveRepurposeSeed(payload: RepurposeSeedPayload): void {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.setItem(REPURPOSE_SEED_STORAGE_KEY, JSON.stringify(payload));
}

export function consumeRepurposeSeed(): RepurposeSeedPayload | null {
  if (typeof window === "undefined") {
    return null;
  }

  const rawValue = window.sessionStorage.getItem(REPURPOSE_SEED_STORAGE_KEY);

  if (!rawValue) {
    return null;
  }

  window.sessionStorage.removeItem(REPURPOSE_SEED_STORAGE_KEY);

  try {
    const parsed = JSON.parse(rawValue) as Partial<RepurposeSeedPayload>;

    if (typeof parsed.text !== "string" || parsed.text.trim() === "") {
      return null;
    }

    if (
      parsed.source !== "dashboard" &&
      parsed.source !== "variation" &&
      parsed.source !== "history" &&
      parsed.source !== "result"
    ) {
      return null;
    }

    if (
      parsed.format
      && parsed.format !== "thread"
      && parsed.format !== "carousel"
      && parsed.format !== "video"
      && parsed.format !== "email"
    ) {
      return null;
    }

    return {
      text: parsed.text.trim(),
      title: typeof parsed.title === "string" ? parsed.title.trim() : undefined,
      format: parsed.format,
      strategy: isRepurposeStrategy(parsed.strategy) ? parsed.strategy : DEFAULT_REPURPOSE_STRATEGY,
      autoGenerate: parsed.autoGenerate === true,
      source: parsed.source,
    };
  } catch {
    return null;
  }
}
