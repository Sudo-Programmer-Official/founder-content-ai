import { ApiRequestError } from "./api-client";

const MEDIA_STORAGE_SETUP_MESSAGE =
  "Media uploads are unavailable right now because storage is not configured yet. This post can still publish as text until media storage is set up.";

function looksLikeMediaStorageError(message: string): boolean {
  return /S3_MEDIA_BUCKET|AWS access key and secret|required for S3 media uploads/i.test(message);
}

export function toFriendlyMediaStorageMessage(
  message: string | null | undefined,
  fallbackMessage?: string,
): string {
  const normalized = message?.trim() || "";

  if (!normalized) {
    return fallbackMessage || MEDIA_STORAGE_SETUP_MESSAGE;
  }

  if (looksLikeMediaStorageError(normalized)) {
    return MEDIA_STORAGE_SETUP_MESSAGE;
  }

  return normalized;
}

export function toFriendlyMediaStorageError(
  error: unknown,
  fallbackMessage = "Unable to upload media right now.",
): Error {
  if (error instanceof ApiRequestError) {
    if (error.code === "media_storage_not_configured" || looksLikeMediaStorageError(error.message)) {
      return new Error(MEDIA_STORAGE_SETUP_MESSAGE);
    }

    return new Error(error.message || fallbackMessage);
  }

  if (error instanceof Error) {
    if (looksLikeMediaStorageError(error.message)) {
      return new Error(MEDIA_STORAGE_SETUP_MESSAGE);
    }

    return error;
  }

  return new Error(fallbackMessage);
}

export { MEDIA_STORAGE_SETUP_MESSAGE };
