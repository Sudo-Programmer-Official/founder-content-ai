import {
  clearStoredAuthSession,
  isSessionExpiringSoon,
  loadStoredAuthSession,
  persistAuthSession,
  type StoredAuthSession,
} from "./auth-session-store";

interface FirebaseAuthResponse {
  idToken: string;
  refreshToken: string;
  expiresIn: string;
  localId: string;
  email: string;
  displayName?: string;
}

interface FirebaseRefreshResponse {
  id_token: string;
  refresh_token: string;
  expires_in: string;
  user_id: string;
}

interface FirebaseErrorResponse {
  error?: {
    message?: string;
    errors?: Array<{
      message?: string;
    }>;
  };
}

export class FirebaseAuthClientError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = "FirebaseAuthClientError";
    this.code = code;
  }
}

function normalizeFirebaseErrorCode(errorCode: string | undefined): string | undefined {
  const trimmedCode = errorCode?.trim();

  if (!trimmedCode) {
    return undefined;
  }

  const sdkPatternMatch = /auth\/([^)]+)/i.exec(trimmedCode);
  if (sdkPatternMatch?.[1]) {
    return normalizeFirebaseErrorCode(sdkPatternMatch[1]);
  }

  switch (trimmedCode) {
    case "EMAIL_EXISTS":
    case "email-already-in-use":
      return "EMAIL_EXISTS";
    case "INVALID_EMAIL":
    case "invalid-email":
      return "INVALID_EMAIL";
    case "EMAIL_NOT_FOUND":
    case "user-not-found":
      return "EMAIL_NOT_FOUND";
    case "INVALID_PASSWORD":
    case "wrong-password":
    case "INVALID_LOGIN_CREDENTIALS":
    case "invalid-credential":
      return "INVALID_LOGIN_CREDENTIALS";
    case "WEAK_PASSWORD":
    case "weak-password":
    case "WEAK_PASSWORD : Password should be at least 6 characters":
      return "WEAK_PASSWORD";
    case "TOO_MANY_ATTEMPTS_TRY_LATER":
    case "too-many-requests":
      return "TOO_MANY_ATTEMPTS_TRY_LATER";
    default:
      return trimmedCode;
  }
}

function extractFirebaseErrorCode(body: FirebaseErrorResponse | null): string | undefined {
  const rawCode = body?.error?.message ?? body?.error?.errors?.[0]?.message;
  return normalizeFirebaseErrorCode(rawCode);
}

function resolveFirebaseApiKey(): string {
  const apiKey = import.meta.env.VITE_FIREBASE_API_KEY?.trim();

  if (!apiKey) {
    throw new Error("VITE_FIREBASE_API_KEY is not configured.");
  }

  return apiKey;
}

function toStoredAuthSession(
  response: FirebaseAuthResponse,
  existingSession?: StoredAuthSession | null,
): StoredAuthSession {
  return {
    idToken: response.idToken,
    refreshToken: response.refreshToken,
    expiresAt: new Date(Date.now() + Number(response.expiresIn) * 1000).toISOString(),
    email: response.email,
    localId: response.localId,
    displayName: response.displayName?.trim() || existingSession?.displayName,
  };
}

function mapFirebaseError(errorCode: string | undefined): string {
  switch (normalizeFirebaseErrorCode(errorCode)) {
    case "EMAIL_EXISTS":
      return "This email is already registered. Try logging in.";
    case "INVALID_EMAIL":
      return "Invalid email address.";
    case "EMAIL_NOT_FOUND":
    case "INVALID_LOGIN_CREDENTIALS":
      return "Email or password is incorrect.";
    case "WEAK_PASSWORD":
      return "Password must be at least 6 characters.";
    case "TOO_MANY_ATTEMPTS_TRY_LATER":
      return "Too many attempts. Try again later.";
    default:
      return "Authentication failed. Try again.";
  }
}

export function getFirebaseAuthErrorCode(error: unknown): string | undefined {
  if (error instanceof FirebaseAuthClientError) {
    return error.code;
  }

  if (error instanceof Error) {
    return normalizeFirebaseErrorCode(
      typeof (error as { code?: unknown }).code === "string"
        ? ((error as { code?: string }).code ?? error.message)
        : error.message,
    );
  }

  if (error && typeof error === "object") {
    const candidate = error as {
      code?: unknown;
      message?: unknown;
      error?: {
        message?: unknown;
      };
    };

    const rawCode =
      typeof candidate.code === "string"
        ? candidate.code
        : typeof candidate.message === "string"
          ? candidate.message
          : typeof candidate.error?.message === "string"
            ? candidate.error.message
            : undefined;

    return normalizeFirebaseErrorCode(rawCode);
  }

  return undefined;
}

export function isEmailAlreadyInUseError(error: unknown): boolean {
  return getFirebaseAuthErrorCode(error) === "EMAIL_EXISTS";
}

async function postJson<TResponse>(
  url: string,
  payload: Record<string, unknown>,
): Promise<TResponse> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const body = (await response.json().catch(() => null)) as TResponse | FirebaseErrorResponse | null;

  if (!response.ok) {
    const errorCode =
      body && typeof body === "object" && "error" in body ? extractFirebaseErrorCode(body) : undefined;
    throw new FirebaseAuthClientError(mapFirebaseError(errorCode), errorCode);
  }

  if (!body) {
    throw new Error("Authentication service returned an empty response.");
  }

  return body as TResponse;
}

async function postForm<TResponse>(
  url: string,
  payload: Record<string, string>,
): Promise<TResponse> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(payload).toString(),
  });

  const body = (await response.json().catch(() => null)) as TResponse | FirebaseErrorResponse | null;

  if (!response.ok) {
    const errorCode =
      body && typeof body === "object" && "error" in body ? extractFirebaseErrorCode(body) : undefined;
    throw new FirebaseAuthClientError(mapFirebaseError(errorCode), errorCode);
  }

  if (!body) {
    throw new Error("Authentication refresh returned an empty response.");
  }

  return body as TResponse;
}

async function updateDisplayName(idToken: string, displayName: string): Promise<FirebaseAuthResponse> {
  return postJson<FirebaseAuthResponse>(
    `https://identitytoolkit.googleapis.com/v1/accounts:update?key=${resolveFirebaseApiKey()}`,
    {
      idToken,
      displayName,
      returnSecureToken: true,
    },
  );
}

export async function signInWithEmailPassword(
  email: string,
  password: string,
): Promise<StoredAuthSession> {
  const response = await postJson<FirebaseAuthResponse>(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${resolveFirebaseApiKey()}`,
    {
      email,
      password,
      returnSecureToken: true,
    },
  );

  const session = toStoredAuthSession(response);
  persistAuthSession(session);
  return session;
}

export async function signUpWithEmailPassword(
  email: string,
  password: string,
  displayName?: string,
): Promise<StoredAuthSession> {
  const signUpResponse = await postJson<FirebaseAuthResponse>(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${resolveFirebaseApiKey()}`,
    {
      email,
      password,
      returnSecureToken: true,
    },
  );

  let session = toStoredAuthSession(signUpResponse);

  if (displayName?.trim()) {
    const profileResponse = await updateDisplayName(signUpResponse.idToken, displayName.trim());
    session = toStoredAuthSession(profileResponse, session);
  }

  persistAuthSession(session);
  return session;
}

export async function refreshStoredAuthSession(): Promise<StoredAuthSession | null> {
  const currentSession = loadStoredAuthSession();

  if (!currentSession?.refreshToken) {
    clearStoredAuthSession();
    return null;
  }

  try {
    const response = await postForm<FirebaseRefreshResponse>(
      `https://securetoken.googleapis.com/v1/token?key=${resolveFirebaseApiKey()}`,
      {
        grant_type: "refresh_token",
        refresh_token: currentSession.refreshToken,
      },
    );

    const nextSession: StoredAuthSession = {
      idToken: response.id_token,
      refreshToken: response.refresh_token,
      expiresAt: new Date(Date.now() + Number(response.expires_in) * 1000).toISOString(),
      email: currentSession.email,
      localId: response.user_id,
      displayName: currentSession.displayName,
    };

    persistAuthSession(nextSession);
    return nextSession;
  } catch {
    clearStoredAuthSession();
    return null;
  }
}

export async function ensureFreshStoredAuthSession(): Promise<StoredAuthSession | null> {
  const session = loadStoredAuthSession();

  if (!session) {
    return null;
  }

  if (!isSessionExpiringSoon(session)) {
    return session;
  }

  return refreshStoredAuthSession();
}
