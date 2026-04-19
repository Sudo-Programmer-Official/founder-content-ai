import type { ApiError } from "../../../packages/shared-types";
import { ensureFreshStoredAuthSession, refreshStoredAuthSession } from "./firebase-auth-client";

declare global {
  interface Window {
    __FOUNDER_CONTENT_API_BASE_URL__?: string;
  }
}

const LOCAL_DEV_HOSTS = new Set(["localhost", "127.0.0.1"]);

export interface ApiRequestOptions {
  timeoutMs?: number;
}

export class ApiRequestError extends Error {
  statusCode: number;
  code?: string;
  details?: Record<string, unknown>;

  constructor(input: {
    message: string;
    statusCode: number;
    code?: string;
    details?: Record<string, unknown>;
  }) {
    super(input.message);
    this.name = "ApiRequestError";
    this.statusCode = input.statusCode;
    this.code = input.code;
    this.details = input.details;
  }
}

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

  return `${window.location.origin}/api`;
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

function createRequestTimeout(timeoutMs: number | undefined): {
  signal?: AbortSignal;
  cleanup: () => void;
} {
  if (!timeoutMs || timeoutMs <= 0 || typeof AbortController === "undefined") {
    return {
      signal: undefined,
      cleanup: () => undefined,
    };
  }

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeoutHandle);
    },
  };
}

async function requestJson<TResponse>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  endpoint: string,
  payload?: unknown,
  options?: ApiRequestOptions,
): Promise<TResponse> {
  const apiBaseUrl = resolveApiBaseUrl();

  async function send(requestBaseUrl: string, allowAuthRetry: boolean): Promise<TResponse> {
    const requestUrl = `${requestBaseUrl}${endpoint}`;
    let response: Response;
    const timeout = createRequestTimeout(options?.timeoutMs);

    try {
      const headers = await buildHeaders(method !== "GET");
      response = await fetch(requestUrl, {
        method,
        headers,
        body: method === "GET" || method === "DELETE" ? undefined : JSON.stringify(payload ?? {}),
        signal: timeout.signal,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error("Request timed out. Check your connection and try again.");
      }

      throw error;
    } finally {
      timeout.cleanup();
    }

    const responseText = await response.text();
    const responseBody = parseJsonSafely<TResponse | ApiError>(responseText);

    if (!response.ok) {
      if (response.status === 401) {
        if (allowAuthRetry) {
          const refreshedSession = await refreshStoredAuthSession();

          if (refreshedSession?.idToken) {
            return send(requestBaseUrl, false);
          }
        }
      }

      const message =
        responseBody && typeof responseBody === "object" && "error" in responseBody
          ? responseBody.error.message
          : `Request failed with status ${response.status}.`;
      const code =
        responseBody && typeof responseBody === "object" && "error" in responseBody
          ? responseBody.error.code
          : undefined;
      const details =
        responseBody && typeof responseBody === "object" && "error" in responseBody
          ? responseBody.error.details
          : undefined;
      throw new ApiRequestError({
        message,
        statusCode: response.status,
        code,
        details,
      });
    }

    if (!responseBody) {
      throw new Error("API returned a non-JSON response.");
    }

    return responseBody as TResponse;
  }

  return send(apiBaseUrl, true);
}

export async function apiGet<TResponse>(
  endpoint: string,
  options?: ApiRequestOptions,
): Promise<TResponse> {
  return requestJson<TResponse>("GET", endpoint, undefined, options);
}

export async function apiPost<TRequest, TResponse>(
  endpoint: string,
  payload: TRequest,
  options?: ApiRequestOptions,
): Promise<TResponse> {
  return requestJson<TResponse>("POST", endpoint, payload, options);
}

export async function apiPatch<TRequest, TResponse>(
  endpoint: string,
  payload: TRequest,
  options?: ApiRequestOptions,
): Promise<TResponse> {
  return requestJson<TResponse>("PATCH", endpoint, payload, options);
}

export async function apiDelete<TResponse>(
  endpoint: string,
  options?: ApiRequestOptions,
): Promise<TResponse> {
  return requestJson<TResponse>("DELETE", endpoint, undefined, options);
}
