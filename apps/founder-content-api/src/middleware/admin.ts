import type { RequestHandler } from "express";
import { sendApiError } from "../utils/http.ts";

export function requireSuperAdmin(): RequestHandler {
  return (request, response, next) => {
    if (!request.auth) {
      sendApiError(response, 401, "auth_required", "Authentication is required.");
      return;
    }

    if (!request.auth.isSuperAdmin) {
      sendApiError(response, 403, "admin_required", "Super admin access is required.");
      return;
    }

    next();
  };
}
