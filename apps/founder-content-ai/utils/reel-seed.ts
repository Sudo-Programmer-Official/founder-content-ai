export interface ReelSeedPayload {
  prompt: string;
  sourcePostId?: string;
  sourceTitle?: string;
  createdAt: number;
}

const STORAGE_KEY = "founder-content-reel-seed";

export function saveReelSeed(input: Omit<ReelSeedPayload, "createdAt">): void {
  if (typeof window === "undefined" || !input.prompt.trim()) {
    return;
  }

  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      prompt: input.prompt.trim(),
      sourcePostId: input.sourcePostId?.trim() || undefined,
      sourceTitle: input.sourceTitle?.trim() || undefined,
      createdAt: Date.now(),
    } satisfies ReelSeedPayload),
  );
}

export function consumeReelSeed(): ReelSeedPayload | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  window.localStorage.removeItem(STORAGE_KEY);

  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<ReelSeedPayload>;
    if (typeof parsed.prompt !== "string" || parsed.prompt.trim().length < 8) {
      return null;
    }

    return {
      prompt: parsed.prompt.trim(),
      sourcePostId: typeof parsed.sourcePostId === "string" ? parsed.sourcePostId : undefined,
      sourceTitle: typeof parsed.sourceTitle === "string" ? parsed.sourceTitle : undefined,
      createdAt: typeof parsed.createdAt === "number" ? parsed.createdAt : Date.now(),
    };
  } catch {
    return null;
  }
}
