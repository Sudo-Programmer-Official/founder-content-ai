import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type DecodedIdToken } from "firebase-admin/auth";
import { HttpError } from "../utils/http.ts";
import { logInfo } from "../utils/logger.ts";

interface FirebaseCredentials {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

interface FirebaseServiceAccountJson {
  projectId?: string;
  clientEmail?: string;
  privateKey?: string;
  project_id?: string;
  client_email?: string;
  private_key?: string;
}

function normalizePrivateKey(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized.replace(/\\n/g, "\n") : null;
}

function resolveCredentialsFromEnv(): FirebaseCredentials | null {
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();

  if (serviceAccountJson) {
    try {
      const parsed = JSON.parse(serviceAccountJson) as FirebaseServiceAccountJson;
      const projectId = parsed.projectId ?? parsed.project_id;
      const clientEmail = parsed.clientEmail ?? parsed.client_email;
      const privateKey = normalizePrivateKey(parsed.privateKey ?? parsed.private_key);

      if (projectId && clientEmail && privateKey) {
        return {
          projectId,
          clientEmail,
          privateKey,
        };
      }
    } catch {
      throw new HttpError(
        500,
        "auth_not_configured",
        "FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON.",
      );
    }
  }

  const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
  const privateKey = normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY);

  if (!projectId || !clientEmail || !privateKey) {
    return null;
  }

  return {
    projectId,
    clientEmail,
    privateKey,
  };
}

export function isFirebaseConfigured(): boolean {
  return resolveCredentialsFromEnv() !== null;
}

function getFirebaseApp(): App {
  const existingApp = getApps()[0];

  if (existingApp) {
    return existingApp;
  }

  const credentials = resolveCredentialsFromEnv();

  if (!credentials) {
    throw new HttpError(
      500,
      "auth_not_configured",
      "Firebase admin credentials are not configured.",
    );
  }

  const app = initializeApp({
    credential: cert(credentials),
    projectId: credentials.projectId,
  });

  logInfo("Initialized Firebase Admin SDK.", {
    projectId: credentials.projectId,
  });

  return app;
}

export async function verifyFirebaseIdToken(idToken: string): Promise<DecodedIdToken> {
  try {
    return await getAuth(getFirebaseApp()).verifyIdToken(idToken, true);
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }

    throw new HttpError(401, "invalid_token", "Authentication token is invalid or expired.");
  }
}
