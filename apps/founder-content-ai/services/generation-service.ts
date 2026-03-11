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
  ideas: "/api/generate-ideas",
  hook: "/api/generate-hook",
  post: "/api/generate-post",
} as const;

declare global {
  interface Window {
    __FOUNDER_CONTENT_API_BASE_URL__?: string;
  }
}

function resolveApiBaseUrl(): string {
  if (typeof window === "undefined") {
    return "http://localhost:3001";
  }

  if (typeof window.__FOUNDER_CONTENT_API_BASE_URL__ === "string") {
    return window.__FOUNDER_CONTENT_API_BASE_URL__;
  }

  return window.location.hostname === "localhost" ? "http://localhost:3001" : "";
}

async function postJson<TRequest, TResponse>(
  endpoint: string,
  payload: TRequest,
): Promise<TResponse> {
  const apiBaseUrl = resolveApiBaseUrl();
  const requestUrl = `${apiBaseUrl}${endpoint}`;
  const response = await fetch(requestUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const responseBody = (await response.json()) as TResponse | ApiError;

  if (!response.ok) {
    const message =
      "error" in responseBody ? responseBody.error.message : `Request failed with status ${response.status}.`;
    throw new Error(message);
  }

  return responseBody as TResponse;
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
