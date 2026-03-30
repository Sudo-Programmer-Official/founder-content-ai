import type { RepurposeContentResponse } from "../../../packages/shared-types";

const ACTIVATION_DRAFTS_STORAGE_KEY = "founder-content-activation-drafts";
const MAX_STORED_DRAFTS = 12;

export interface ActivationDraftRecord {
  id: string;
  input: string;
  mode: "generate" | "improve";
  createdAt: string;
  result: RepurposeContentResponse;
}

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.sessionStorage !== "undefined";
}

function buildDraftId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `draft-${Date.now()}`;
}

function readDrafts(): ActivationDraftRecord[] {
  if (!canUseStorage()) {
    return [];
  }

  const storedValue = window.sessionStorage.getItem(ACTIVATION_DRAFTS_STORAGE_KEY);

  if (!storedValue) {
    return [];
  }

  try {
    const parsed = JSON.parse(storedValue) as ActivationDraftRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeDrafts(drafts: ActivationDraftRecord[]): void {
  if (!canUseStorage()) {
    return;
  }

  window.sessionStorage.setItem(ACTIVATION_DRAFTS_STORAGE_KEY, JSON.stringify(drafts));
}

export function saveActivationDraft(input: {
  input: string;
  mode: "generate" | "improve";
  result: RepurposeContentResponse;
}): ActivationDraftRecord {
  const draft: ActivationDraftRecord = {
    id: input.result.asset?.id ?? buildDraftId(),
    input: input.input,
    mode: input.mode,
    createdAt: new Date().toISOString(),
    result: input.result,
  };

  const nextDrafts = [draft, ...readDrafts().filter((entry) => entry.id !== draft.id)].slice(
    0,
    MAX_STORED_DRAFTS,
  );
  writeDrafts(nextDrafts);
  return draft;
}

export function getActivationDraft(draftId: string): ActivationDraftRecord | null {
  return readDrafts().find((entry) => entry.id === draftId) ?? null;
}

export function getLatestActivationDraft(): ActivationDraftRecord | null {
  return readDrafts()[0] ?? null;
}

export function replaceActivationDraft(draft: ActivationDraftRecord): ActivationDraftRecord {
  const nextDrafts = [draft, ...readDrafts().filter((entry) => entry.id !== draft.id)].slice(
    0,
    MAX_STORED_DRAFTS,
  );
  writeDrafts(nextDrafts);
  return draft;
}
