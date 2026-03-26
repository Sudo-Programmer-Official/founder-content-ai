import type { ApiError } from "../../../packages/shared-types";
import { clearStoredAuthSession } from "./auth-session-store";
import { ensureFreshStoredAuthSession } from "./firebase-auth-client";

declare global {
  interface Window {
    __FOUNDER_CONTENT_API_BASE_URL__?: string;
  }
}

const LOCAL_DEV_HOSTS = new Set(["localhost", "127.0.0.1"]);
function normalizeApiBaseUrl(value: string): string {
  return value.trim().replace(/\/$/, "").replace(/\/health$/i, "");
}

function resolveApiBaseUrl(): string {
  const envBaseUrl = import.meta.env.VITE_API_URL;

  if (typeof envBaseUrl === "string" && envBaseUrl.trim() !== "") {
    return normalizeApiBaseUrl(envBaseUrl);
  }

  if (typeof window === "undefined") {
    return "";
  }

  if (typeof window.__FOUNDER_CONTENT_API_BASE_URL__ === "string") {
    return normalizeApiBaseUrl(window.__FOUNDER_CONTENT_API_BASE_URL__);
  }

  if (LOCAL_DEV_HOSTS.has(window.location.hostname)) {
    return "http://localhost:3001/api";
  }

  return "https://api.foundercontent.ai/api";
}

function parseJsonSafely<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function buildStubHeaders(): Record<string, string> {
  if (typeof window === "undefined" || !LOCAL_DEV_HOSTS.has(window.location.hostname)) {
    return {};
  }

  return {
    "X-Dev-User-Id": import.meta.env.VITE_DEV_USER_ID ?? "dev-super-admin",
    "X-Dev-User-Email": import.meta.env.VITE_DEV_USER_EMAIL ?? "admin@foundercontent.local",
    "X-Dev-User-Name": import.meta.env.VITE_DEV_USER_NAME ?? "Local Admin",
    "X-Dev-Super-Admin": import.meta.env.VITE_DEV_SUPER_ADMIN ?? "true",
  };
}

async function buildHeaders(hasBody: boolean): Promise<HeadersInit> {
  const headers: Record<string, string> = hasBody ? { "Content-Type": "application/json" } : {};
  const session = await ensureFreshStoredAuthSession();

  if (session?.idToken) {
    headers.Authorization = `Bearer ${session.idToken}`;
    return headers;
  }

  return {
    ...headers,
    ...buildStubHeaders(),
  };
}

async function requestJson<TResponse>(
  method: "GET" | "POST" | "PATCH",
  endpoint: string,
  payload?: unknown,
): Promise<TResponse> {
  const apiBaseUrl = resolveApiBaseUrl();

  async function send(requestBaseUrl: string): Promise<TResponse> {
    const requestUrl = `${requestBaseUrl}${endpoint}`;
    let response: Response;

    try {
      const headers = await buildHeaders(method !== "GET");
      response = await fetch(requestUrl, {
        method,
        headers,
        body: method === "GET" ? undefined : JSON.stringify(payload ?? {}),
      });
    } catch (error) {
      throw error;
    }

    const responseText = await response.text();
    const responseBody = parseJsonSafely<TResponse | ApiError>(responseText);

    if (!response.ok) {
      if (response.status === 401) {
        clearStoredAuthSession();
      }

      const message =
        responseBody && typeof responseBody === "object" && "error" in responseBody
          ? responseBody.error.message
          : `Request failed with status ${response.status}.`;
      throw new Error(message);
    }

    if (!responseBody) {
      throw new Error("API returned a non-JSON response.");
    }

    return responseBody as TResponse;
  }

  return send(apiBaseUrl);
}

export async function apiGet<TResponse>(endpoint: string): Promise<TResponse> {
  return requestJson<TResponse>("GET", endpoint);
}

export async function apiPost<TRequest, TResponse>(
  endpoint: string,
  payload: TRequest,
): Promise<TResponse> {
  return requestJson<TResponse>("POST", endpoint, payload);
}

export async function apiPatch<TRequest, TResponse>(
  endpoint: string,
  payload: TRequest,
): Promise<TResponse> {
  return requestJson<TResponse>("PATCH", endpoint, payload);
}
