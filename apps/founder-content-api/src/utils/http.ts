import type { ApiError } from "../../../../packages/shared-types/index.ts";
import type { Response } from "express";
import { logError } from "./logger.ts";

export class HttpError extends Error {
  statusCode: number;
  code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function isHttpError(error: unknown): error is HttpError {
  return error instanceof HttpError;
}

function toLogPayload(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    value: error,
  };
}

export function sendApiError(
  response: Response,
  statusCode: number,
  code: string,
  message: string,
): void {
  response.status(statusCode).json({
    ok: false,
    error: {
      code,
      message,
    },
  } satisfies ApiError);
}

export function handleApiError(
  response: Response,
  error: unknown,
  fallback: {
    statusCode: number;
    code: string;
    message: string;
    logMessage: string;
  },
): void {
  if (isHttpError(error)) {
    sendApiError(response, error.statusCode, error.code, error.message);
    return;
  }

  logError(fallback.logMessage, toLogPayload(error));
  sendApiError(response, fallback.statusCode, fallback.code, fallback.message);
}

export function toErrorContext(error: unknown): Record<string, unknown> {
  return toLogPayload(error);
}
