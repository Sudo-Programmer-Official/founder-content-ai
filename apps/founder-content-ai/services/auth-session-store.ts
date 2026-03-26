export interface StoredAuthSession {
  idToken: string;
  refreshToken: string;
  expiresAt: string;
  email: string;
  localId: string;
  displayName?: string;
}

const AUTH_SESSION_STORAGE_KEY = "founder-content-auth-session";
export const AUTH_SESSION_CHANGED_EVENT = "founder-content-auth-session-changed";

function canUseBrowserStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function dispatchAuthSessionChanged(): void {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent(AUTH_SESSION_CHANGED_EVENT));
}

export function loadStoredAuthSession(): StoredAuthSession | null {
  if (!canUseBrowserStorage()) {
    return null;
  }

  const rawValue = window.localStorage.getItem(AUTH_SESSION_STORAGE_KEY);

  if (!rawValue) {
    return null;
  }

  try {
    return JSON.parse(rawValue) as StoredAuthSession;
  } catch {
    window.localStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
    return null;
  }
}

export function persistAuthSession(session: StoredAuthSession): void {
  if (!canUseBrowserStorage()) {
    return;
  }

  window.localStorage.setItem(AUTH_SESSION_STORAGE_KEY, JSON.stringify(session));
  dispatchAuthSessionChanged();
}

export function clearStoredAuthSession(): void {
  if (!canUseBrowserStorage()) {
    return;
  }

  window.localStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
  dispatchAuthSessionChanged();
}

export function hasStoredAuthSession(): boolean {
  return Boolean(loadStoredAuthSession());
}

export function isSessionExpiringSoon(
  session: StoredAuthSession,
  bufferMs = 60_000,
): boolean {
  return new Date(session.expiresAt).getTime() - Date.now() <= bufferMs;
}
