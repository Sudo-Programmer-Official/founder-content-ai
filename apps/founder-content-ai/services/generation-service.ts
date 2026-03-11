import type {
  ApiError,
  HookGenerationRequest,
  HookGenerationResponse,
  IdeaGenerationRequest,
  IdeaGenerationResponse,
  LinkedInPostGenerationRequest,
  LinkedInPostGenerationResponse,
} from "../../../packages/shared-types";

const API_ENDPOINTS = {
  ideas: "/generate-ideas",
  hook: "/generate-hook",
  post: "/generate-post",
} as const;

declare global {
  interface Window {
    __FOUNDER_CONTENT_API_BASE_URL__?: string;
  }
}

function resolveApiBaseUrl(): string {
  const envBaseUrl = import.meta.env.VITE_API_URL;

  if (typeof envBaseUrl === "string" && envBaseUrl.trim() !== "") {
    return envBaseUrl.replace(/\/$/, "");
  }

  if (typeof window === "undefined") {
    return "";
  }

  if (typeof window.__FOUNDER_CONTENT_API_BASE_URL__ === "string") {
    return window.__FOUNDER_CONTENT_API_BASE_URL__.replace(/\/$/, "");
  }

  if (window.location.hostname === "localhost") {
    return "http://localhost:3001/api";
  }

  return "https://api.foundercontent.ai/api";
}

function resolveFallbackApiBaseUrl(primaryApiBaseUrl: string): string | null {
  const fallbackApiUrl = "https://founder-content-api.onrender.com/api";

  return primaryApiBaseUrl === fallbackApiUrl ? null : fallbackApiUrl;
}

async function postJson<TRequest, TResponse>(
  endpoint: string,
  payload: TRequest,
): Promise<TResponse> {
  const apiBaseUrl = resolveApiBaseUrl();
  const fallbackApiBaseUrl = resolveFallbackApiBaseUrl(apiBaseUrl);

  async function send(requestBaseUrl: string): Promise<TResponse> {
    const requestUrl = `${requestBaseUrl}${endpoint}`;
    let response: Response;

    try {
      response = await fetch(requestUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      if (fallbackApiBaseUrl && requestBaseUrl !== fallbackApiBaseUrl) {
        return send(fallbackApiBaseUrl);
      }

      throw error;
    }

    const responseBody = (await response.json()) as TResponse | ApiError;

    if (!response.ok) {
      const message =
        "error" in responseBody
          ? responseBody.error.message
          : `Request failed with status ${response.status}.`;
      throw new Error(message);
    }

    return responseBody as TResponse;
  }

  return send(apiBaseUrl);
}

export async function requestIdeaGeneration(
  input: IdeaGenerationRequest,
): Promise<IdeaGenerationResponse> {
  return postJson<IdeaGenerationRequest, IdeaGenerationResponse>(API_ENDPOINTS.ideas, input);
}

export async function requestHookGeneration(
  input: HookGenerationRequest,
): Promise<HookGenerationResponse> {
  return postJson<HookGenerationRequest, HookGenerationResponse>(API_ENDPOINTS.hook, input);
}

export async function requestLinkedInPostGeneration(
  input: LinkedInPostGenerationRequest,
): Promise<LinkedInPostGenerationResponse> {
  return postJson<LinkedInPostGenerationRequest, LinkedInPostGenerationResponse>(
    API_ENDPOINTS.post,
    input,
  );
}
