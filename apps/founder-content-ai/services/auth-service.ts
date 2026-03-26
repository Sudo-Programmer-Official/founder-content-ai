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
} from "./firebase-auth-client";

export interface FrontendAuthSession {
  authSession: StoredAuthSession | null;
  appSession: MeResponse | null;
  mode: "firebase" | "stub";
}

const LOCAL_DEV_HOSTS = new Set(["localhost", "127.0.0.1"]);

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
  return apiGet<MeResponse>("/me");
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
): Promise<FrontendAuthSession> {
  const authSession = await signInWithEmailPassword(email, password);

  return {
    authSession,
    appSession: await loadAppSession(),
    mode: "firebase",
  };
}

export async function signupWithEmailPassword(
  email: string,
  password: string,
  displayName?: string,
): Promise<FrontendAuthSession> {
  const authSession = await signUpWithEmailPassword(email, password, displayName);

  return {
    authSession,
    appSession: await loadAppSession(),
    mode: "firebase",
  };
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
