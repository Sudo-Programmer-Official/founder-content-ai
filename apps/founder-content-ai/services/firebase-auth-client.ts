import {
  clearStoredAuthSession,
  getStoredAuthSessionPersistence,
  isSessionExpiringSoon,
  loadStoredAuthSession,
  persistAuthSession,
  type AuthSessionPersistence,
  type StoredAuthSession,
} from "./auth-session-store";

interface FirebaseAuthResponse {
  idToken?: string;
  refreshToken?: string;
  expiresIn?: string | number;
  localId?: string;
  email?: string;
  displayName?: string;
  id_token?: string;
  refresh_token?: string;
  expires_in?: string | number;
  local_id?: string;
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
    case "USER_DISABLED":
    case "user-disabled":
      return "USER_DISABLED";
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
  options?: {
    existingSession?: StoredAuthSession | null;
    fallbackEmail?: string;
    fallbackDisplayName?: string;
  },
): StoredAuthSession {
  const existingSession = options?.existingSession;
  const idToken = response.idToken ?? response.id_token ?? existingSession?.idToken;
  const refreshToken = response.refreshToken ?? response.refresh_token ?? existingSession?.refreshToken;
  const localId = response.localId ?? response.local_id ?? existingSession?.localId;
  const email = response.email ?? options?.fallbackEmail ?? existingSession?.email;
  const expiresInRaw = response.expiresIn ?? response.expires_in;
  const expiresInSeconds = expiresInRaw === undefined || expiresInRaw === null ? NaN : Number(expiresInRaw);
  const expiresAt =
    Number.isFinite(expiresInSeconds)
      ? new Date(Date.now() + expiresInSeconds * 1000).toISOString()
      : existingSession?.expiresAt ?? new Date(Date.now() + 3600 * 1000).toISOString();

  if (!idToken || !refreshToken || !localId || !email) {
    throw new Error("Authentication succeeded, but the session payload was incomplete.");
  }

  return {
    idToken,
    refreshToken,
    expiresAt,
    email,
    localId,
    displayName:
      response.displayName?.trim() ||
      options?.fallbackDisplayName?.trim() ||
      existingSession?.displayName,
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
    case "USER_DISABLED":
      return "This account has been disabled.";
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

export async function updateCurrentUserDisplayName(
  displayName: string,
): Promise<StoredAuthSession> {
  const normalizedDisplayName = displayName.trim();

  if (!normalizedDisplayName) {
    throw new Error("Display name is required.");
  }

  const currentSession = await ensureFreshStoredAuthSession();

  if (!currentSession) {
    throw new Error("You must be signed in to update your display name.");
  }

  const response = await updateDisplayName(currentSession.idToken, normalizedDisplayName);
  const nextSession = toStoredAuthSession(response, {
    existingSession: currentSession,
    fallbackEmail: currentSession.email,
    fallbackDisplayName: normalizedDisplayName,
  });

  persistAuthSession(
    nextSession,
    (getStoredAuthSessionPersistence() ?? "local") as AuthSessionPersistence,
  );

  return nextSession;
}

export async function signInWithEmailPassword(
  email: string,
  password: string,
  options?: {
    rememberBrowser?: boolean;
  },
): Promise<StoredAuthSession> {
  const normalizedEmail = email.trim();
  const response = await postJson<FirebaseAuthResponse>(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${resolveFirebaseApiKey()}`,
    {
      email: normalizedEmail,
      password,
      returnSecureToken: true,
    },
  );

  const session = toStoredAuthSession(response, {
    fallbackEmail: normalizedEmail,
  });
  persistAuthSession(session, options?.rememberBrowser === false ? "session" : "local");
  return session;
}

export async function signUpWithEmailPassword(
  email: string,
  password: string,
  displayName?: string,
): Promise<StoredAuthSession> {
  const normalizedEmail = email.trim();
  const normalizedDisplayName = displayName?.trim() || undefined;
  const signUpResponse = await postJson<FirebaseAuthResponse>(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${resolveFirebaseApiKey()}`,
    {
      email: normalizedEmail,
      password,
      returnSecureToken: true,
    },
  );

  let session = toStoredAuthSession(signUpResponse, {
    fallbackEmail: normalizedEmail,
    fallbackDisplayName: normalizedDisplayName,
  });

  if (normalizedDisplayName) {
    try {
      const profileResponse = await updateDisplayName(session.idToken, normalizedDisplayName);
      session = toStoredAuthSession(profileResponse, {
        existingSession: session,
        fallbackEmail: normalizedEmail,
        fallbackDisplayName: normalizedDisplayName,
      });
    } catch {
      session = {
        ...session,
        displayName: normalizedDisplayName,
      };
    }
  }

  persistAuthSession(session);
  return session;
}

export async function sendPasswordResetEmail(email: string): Promise<void> {
  await postJson<Record<string, never>>(
    `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${resolveFirebaseApiKey()}`,
    {
      requestType: "PASSWORD_RESET",
      email,
    },
  );
}

export async function refreshStoredAuthSession(): Promise<StoredAuthSession | null> {
  const currentSession = loadStoredAuthSession();
  const persistence = getStoredAuthSessionPersistence();

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

    persistAuthSession(nextSession, (persistence ?? "local") as AuthSessionPersistence);
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
