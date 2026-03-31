import { ApiRequestError } from "./api-client";

const MEDIA_STORAGE_SETUP_MESSAGE =
  "Media uploads are turned off until backend storage is configured. Set S3_MEDIA_BUCKET, AWS_REGION, AWS_ACCESS_KEY_ID, and AWS_SECRET_ACCESS_KEY on the API service.";

function looksLikeMediaStorageError(message: string): boolean {
  return /S3_MEDIA_BUCKET|AWS access key and secret|required for S3 media uploads/i.test(message);
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
