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
  };
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
  switch (errorCode) {
    case "EMAIL_EXISTS":
      return "An account already exists with this email address.";
    case "EMAIL_NOT_FOUND":
    case "INVALID_PASSWORD":
    case "INVALID_LOGIN_CREDENTIALS":
      return "Email or password is incorrect.";
    case "WEAK_PASSWORD : Password should be at least 6 characters":
    case "WEAK_PASSWORD":
      return "Password must be at least 6 characters.";
    case "TOO_MANY_ATTEMPTS_TRY_LATER":
      return "Too many attempts. Try again later.";
    default:
      return "Authentication failed. Try again.";
  }
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
      body && typeof body === "object" && "error" in body ? body.error?.message : undefined;
    throw new Error(mapFirebaseError(errorCode));
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
      body && typeof body === "object" && "error" in body ? body.error?.message : undefined;
    throw new Error(mapFirebaseError(errorCode));
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
