export interface StoredAuthSession {
  idToken: string;
  refreshToken: string;
  expiresAt: string;
  email: string;
  localId: string;
  displayName?: string;
}

export type AuthSessionPersistence = "local" | "session";

const AUTH_SESSION_STORAGE_KEY = "founder-content-auth-session";
export const AUTH_SESSION_CHANGED_EVENT = "founder-content-auth-session-changed";

function canUseBrowserStorage(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.localStorage !== "undefined" &&
    typeof window.sessionStorage !== "undefined"
  );
}

function storageForPersistence(persistence: AuthSessionPersistence): Storage {
  return persistence === "session" ? window.sessionStorage : window.localStorage;
}

function readStoredSessionFrom(storage: Storage): StoredAuthSession | null {
  const rawValue = storage.getItem(AUTH_SESSION_STORAGE_KEY);

  if (!rawValue) {
    return null;
  }

  try {
    return JSON.parse(rawValue) as StoredAuthSession;
  } catch {
    storage.removeItem(AUTH_SESSION_STORAGE_KEY);
    return null;
  }
}

function loadStoredAuthSessionRecord(): {
  session: StoredAuthSession;
  persistence: AuthSessionPersistence;
} | null {
  if (!canUseBrowserStorage()) {
    return null;
  }

  const localSession = readStoredSessionFrom(window.localStorage);

  if (localSession) {
    return {
      session: localSession,
      persistence: "local",
    };
  }

  const sessionSession = readStoredSessionFrom(window.sessionStorage);

  if (sessionSession) {
    return {
      session: sessionSession,
      persistence: "session",
    };
  }

  return null;
}

function dispatchAuthSessionChanged(): void {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent(AUTH_SESSION_CHANGED_EVENT));
}

export function loadStoredAuthSession(): StoredAuthSession | null {
  return loadStoredAuthSessionRecord()?.session ?? null;
}

export function getStoredAuthSessionPersistence(): AuthSessionPersistence | null {
  return loadStoredAuthSessionRecord()?.persistence ?? null;
}

export function persistAuthSession(
  session: StoredAuthSession,
  persistence: AuthSessionPersistence = "local",
): void {
  if (!canUseBrowserStorage()) {
    return;
  }

  storageForPersistence(persistence).setItem(AUTH_SESSION_STORAGE_KEY, JSON.stringify(session));
  storageForPersistence(persistence === "local" ? "session" : "local").removeItem(
    AUTH_SESSION_STORAGE_KEY,
  );
  dispatchAuthSessionChanged();
}

export function clearStoredAuthSession(): void {
  if (!canUseBrowserStorage()) {
    return;
  }

  window.localStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
  window.sessionStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
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
