const LOCAL_DEV_HOSTS = new Set(["localhost", "127.0.0.1"]);
const DEFAULT_PUBLIC_API_BASE_URL = "https://api.foundercontent.ai/api";

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/$/, "");
}

function resolveConfiguredFrontendOrigin(): string | null {
  const configuredOrigin = (process.env.FRONTEND_ORIGIN ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .find(Boolean);

  return configuredOrigin ?? null;
}

export function resolveEmailPublicApiBaseUrl(): string {
  const configuredApiBaseUrl = process.env.API_PUBLIC_BASE_URL?.trim();

  if (configuredApiBaseUrl) {
    return normalizeBaseUrl(configuredApiBaseUrl);
  }

  const configuredFrontendOrigin = resolveConfiguredFrontendOrigin();

  if (configuredFrontendOrigin) {
    try {
      const parsedOrigin = new URL(configuredFrontendOrigin);

      if (LOCAL_DEV_HOSTS.has(parsedOrigin.hostname.toLowerCase())) {
        return normalizeBaseUrl(`http://localhost:${process.env.PORT?.trim() || "3001"}/api`);
      }

      return DEFAULT_PUBLIC_API_BASE_URL;
    } catch {
      // Ignore invalid configured origins and fall through to the runtime fallback.
    }
  }

  if (process.env.NODE_ENV?.trim() !== "production") {
    return normalizeBaseUrl(`http://localhost:${process.env.PORT?.trim() || "3001"}/api`);
  }

  return DEFAULT_PUBLIC_API_BASE_URL;
}
