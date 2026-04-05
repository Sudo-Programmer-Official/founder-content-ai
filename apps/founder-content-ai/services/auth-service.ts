import type { MeResponse } from "../../../packages/shared-types";
import { apiGet } from "./api-client";
import {
  clearStoredAuthSession,
  hasStoredAuthSession,
  type StoredAuthSession,
} from "./auth-session-store";
import {
  ensureFreshStoredAuthSession,
  getFirebaseAuthErrorCode,
  sendPasswordResetEmail,
  signInWithEmailPassword,
  signUpWithEmailPassword,
  updateCurrentUserDisplayName,
} from "./firebase-auth-client";

export interface FrontendAuthSession {
  authSession: StoredAuthSession | null;
  appSession: MeResponse | null;
  mode: "firebase" | "stub";
}

const LOCAL_DEV_HOSTS = new Set(["localhost", "127.0.0.1"]);
const AUTH_BOOTSTRAP_TIMEOUT_MS = 12_000;

function isLocalDevelopmentHost(): boolean {
  return typeof window !== "undefined" && LOCAL_DEV_HOSTS.has(window.location.hostname);
}

export function canUseDevelopmentStubAuth(): boolean {
  return (
    isLocalDevelopmentHost() &&
    !hasStoredAuthSession() &&
    (import.meta.env.VITE_DEV_USER_EMAIL?.trim() || import.meta.env.VITE_DEV_USER_ID?.trim())
      ? true
      : false
  );
}

async function loadAppSession(): Promise<MeResponse> {
  try {
    return await apiGet<MeResponse>("/me", {
      timeoutMs: AUTH_BOOTSTRAP_TIMEOUT_MS,
    });
  } catch (error) {
    if (error instanceof Error && /timed out/i.test(error.message)) {
      throw new Error(
        "Signed in with Firebase, but your app session did not finish loading. Check the API/database deployment and try again.",
      );
    }

    throw error;
  }
}

async function buildFirebaseFrontendSession(
  authSession: StoredAuthSession,
  options?: {
    tolerateAppSessionFailure?: boolean;
  },
): Promise<FrontendAuthSession> {
  try {
    return {
      authSession,
      appSession: await loadAppSession(),
      mode: "firebase",
    };
  } catch (error) {
    if (!options?.tolerateAppSessionFailure) {
      throw error;
    }

    return {
      authSession,
      appSession: null,
      mode: "firebase",
    };
  }
}

export async function restoreFrontendAuthSession(): Promise<FrontendAuthSession | null> {
  const authSession = await ensureFreshStoredAuthSession();

  if (authSession) {
    try {
      return {
        authSession,
        appSession: await loadAppSession(),
        mode: "firebase",
      };
    } catch (error) {
      clearStoredAuthSession();
      throw error;
    }
  }

  if (!canUseDevelopmentStubAuth()) {
    return null;
  }

  return {
    authSession: null,
    appSession: await loadAppSession(),
    mode: "stub",
  };
}

export async function loginWithEmailPassword(
  email: string,
  password: string,
  options?: {
    rememberBrowser?: boolean;
  },
): Promise<FrontendAuthSession> {
  const authSession = await signInWithEmailPassword(email, password, options);
  return buildFirebaseFrontendSession(authSession);
}

export async function signupWithEmailPassword(
  email: string,
  password: string,
  displayName?: string,
): Promise<FrontendAuthSession> {
  try {
    const authSession = await signUpWithEmailPassword(email, password, displayName);
    return buildFirebaseFrontendSession(authSession, {
      tolerateAppSessionFailure: true,
    });
  } catch (error) {
    if (getFirebaseAuthErrorCode(error) !== "EMAIL_EXISTS") {
      throw error;
    }

    try {
      const authSession = await signInWithEmailPassword(email, password);
      return buildFirebaseFrontendSession(authSession, {
        tolerateAppSessionFailure: true,
      });
    } catch {
      throw error;
    }
  }
}

export async function updateFrontendDisplayName(
  displayName: string,
): Promise<FrontendAuthSession> {
  const authSession = await updateCurrentUserDisplayName(displayName);
  return buildFirebaseFrontendSession(authSession);
}

export async function requestPasswordResetEmail(email: string): Promise<void> {
  try {
    await sendPasswordResetEmail(email);
  } catch (error) {
    if (getFirebaseAuthErrorCode(error) === "EMAIL_NOT_FOUND") {
      return;
    }

    throw error;
  }
}

export async function ensureProtectedRouteAccess(): Promise<boolean> {
  if (await ensureFreshStoredAuthSession()) {
    return true;
  }

  return canUseDevelopmentStubAuth();
}

export async function logoutFrontendSession(): Promise<void> {
  clearStoredAuthSession();
}
