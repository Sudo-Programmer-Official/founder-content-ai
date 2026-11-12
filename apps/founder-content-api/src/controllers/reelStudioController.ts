import type {
  ApiError,
  ReelProjectListResponse,
  ReelProjectResponse,
  ReelProjectSettings,
  ReelYouTubeConnection,
  ReelYouTubePublishRequest,
  ReelYouTubePublishResponse,
  ReelWorkflowActionRequest,
} from "../../../../packages/shared-types/index.ts";
import type { Request, Response } from "express";
import { ensureCurrentUser } from "../services/authBusinessService.ts";
import { enforceWorkspaceReadAccess, enforceWorkspaceWriteAccess } from "../services/governanceService.ts";
import { resolveSignedLocalReelMedia } from "../services/reelStudio/reelMediaStorage.ts";
import {
  createReelYouTubeAuthorizationUrl,
  getReelYouTubeConnection,
  handleReelYouTubeOAuthCallback,
  publishReelToYouTube,
} from "../services/reelStudio/reelYouTubeService.ts";
import {
  createReelProject,
  deleteReelProject,
  getReelProject,
  listReelProjects,
  approveReelProject,
  queueReelRender,
  markReelReviewed,
  regenerateReelProjectScene,
  updateReelStoryboard,
} from "../services/reelStudio/reelProjectService.ts";
import { safeCreateSystemErrorLog } from "../services/systemErrorLogService.ts";
import { handleApiError, sendApiError } from "../utils/http.ts";

// Reel Studio is gated by the same feature flag and generation quota as visual generation.
const REEL_FEATURE_KEY = "visual_generation" as const;

function readBusinessId(request: Request): string | undefined {
  const fromBody = (request.body as { businessId?: unknown } | undefined)?.businessId;
  const fromQuery = request.query.businessId;
  const value = typeof fromBody === "string" ? fromBody : typeof fromQuery === "string" ? fromQuery : "";
  return value.trim() || undefined;
}

function readSettings(body: unknown): Partial<ReelProjectSettings> {
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const source = record.settings && typeof record.settings === "object" ? (record.settings as Record<string, unknown>) : record;
  return {
    language: source.language as ReelProjectSettings["language"],
    durationSeconds: source.durationSeconds as ReelProjectSettings["durationSeconds"],
    style: source.style as ReelProjectSettings["style"],
    audience: source.audience as ReelProjectSettings["audience"],
    voice: source.voice as ReelProjectSettings["voice"],
    showCaptions: source.showCaptions as boolean,
    brandHandle: source.brandHandle as string,
  };
}

/** Shared guard + error handling so each handler only states its happy path. */
async function withReelAccess<TResponse>(
  request: Request,
  response: Response<TResponse | ApiError>,
  options: { write?: boolean; consumesGeneration?: boolean; errorCode: string; errorMessage: string },
  handler: (context: { businessId: string; userId?: string }) => Promise<TResponse>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  const businessId = readBusinessId(request);

  if (!businessId) {
    sendApiError(response, 400, "business_id_required", "businessId is required.");
    return;
  }

  try {
    if (options.write) {
      await enforceWorkspaceWriteAccess({
        principal: request.auth,
        businessId,
        featureKey: REEL_FEATURE_KEY,
        usageMetric: options.consumesGeneration ? "generations" : undefined,
      });
    } else {
      await enforceWorkspaceReadAccess(request.auth, businessId, REEL_FEATURE_KEY);
    }

    const user = await ensureCurrentUser(request.auth);
    response.json(await handler({ businessId, userId: user.id }));
  } catch (error) {
    void safeCreateSystemErrorLog({
      route: request.originalUrl,
      code: options.errorCode,
      message: options.errorMessage,
      businessId,
      userId: request.auth.userId,
    });
    handleApiError(response, error, {
      statusCode: 500,
      code: options.errorCode,
      message: options.errorMessage,
      logMessage: options.errorMessage,
    });
  }
}

export async function listReelProjectsController(
  request: Request,
  response: Response<ReelProjectListResponse | ApiError>,
): Promise<void> {
  await withReelAccess(
    request,
    response,
    { errorCode: "reel_projects_list_failed", errorMessage: "Unable to load your reels." },
    async ({ businessId }) => ({ projects: await listReelProjects(businessId) }),
  );
}

export async function getReelProjectController(
  request: Request<{ projectId: string }>,
  response: Response<ReelProjectResponse | ApiError>,
): Promise<void> {
  await withReelAccess(
    request as unknown as Request,
    response,
    { errorCode: "reel_project_load_failed", errorMessage: "Unable to load this reel." },
    async ({ businessId }) => ({ project: await getReelProject(businessId, request.params.projectId) }),
  );
}

export async function createReelStoryboardController(
  request: Request,
  response: Response<ReelProjectResponse | ApiError>,
): Promise<void> {
  await withReelAccess(
    request,
    response,
    {
      write: true,
      consumesGeneration: true,
      errorCode: "reel_storyboard_failed",
      errorMessage: "Unable to generate a storyboard right now.",
    },
    async ({ businessId, userId }) => ({
      project: await createReelProject({
        businessId,
        userId,
        prompt: typeof request.body?.prompt === "string" ? request.body.prompt : "",
        settings: readSettings(request.body),
      }),
    }),
  );
}

export async function updateReelStoryboardController(
  request: Request<{ projectId: string }>,
  response: Response<ReelProjectResponse | ApiError>,
): Promise<void> {
  await withReelAccess(
    request as unknown as Request,
    response,
    { write: true, errorCode: "reel_storyboard_update_failed", errorMessage: "Unable to save the storyboard." },
    async ({ businessId, userId }) => ({
      project: await updateReelStoryboard({
        businessId,
        projectId: request.params.projectId,
        userId,
        storyboard: request.body?.storyboard,
        settings: request.body?.settings ? readSettings({ settings: request.body.settings }) : undefined,
      }),
    }),
  );
}

export async function regenerateReelSceneController(
  request: Request<{ projectId: string; sceneId: string }>,
  response: Response<ReelProjectResponse | ApiError>,
): Promise<void> {
  await withReelAccess(
    request as unknown as Request,
    response,
    {
      write: true,
      consumesGeneration: true,
      errorCode: "reel_scene_regenerate_failed",
      errorMessage: "Unable to regenerate this scene.",
    },
    async ({ businessId, userId }) => ({
      project: await regenerateReelProjectScene({
        businessId,
        projectId: request.params.projectId,
        sceneId: request.params.sceneId,
        userId,
        instruction: typeof request.body?.instruction === "string" ? request.body.instruction : undefined,
      }),
    }),
  );
}

export async function approveReelProjectController(
  request: Request<{ projectId: string }, ReelProjectResponse | ApiError, ReelWorkflowActionRequest>,
  response: Response<ReelProjectResponse | ApiError>,
): Promise<void> {
  await withReelAccess(
    request as unknown as Request,
    response,
    { write: true, errorCode: "reel_approval_failed", errorMessage: "Unable to approve this storyboard." },
    async ({ businessId, userId }) => ({
      project: await approveReelProject({
        businessId,
        projectId: request.params.projectId,
        userId,
        note: typeof request.body?.note === "string" ? request.body.note : undefined,
      }),
    }),
  );
}

export async function markReelReviewedController(
  request: Request<{ projectId: string }, ReelProjectResponse | ApiError, ReelWorkflowActionRequest>,
  response: Response<ReelProjectResponse | ApiError>,
): Promise<void> {
  await withReelAccess(
    request as unknown as Request,
    response,
    { write: true, errorCode: "reel_review_failed", errorMessage: "Unable to save the review decision." },
    async ({ businessId, userId }) => ({
      project: await markReelReviewed({
        businessId,
        projectId: request.params.projectId,
        userId,
        note: typeof request.body?.note === "string" ? request.body.note : undefined,
      }),
    }),
  );
}

export async function startReelYouTubeAuthController(
  request: Request<unknown, { authorizationUrl: string } | ApiError, { businessId?: string; returnPath?: string }>,
  response: Response<{ authorizationUrl: string } | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }
  const businessId = request.body?.businessId?.trim();
  if (!businessId) {
    sendApiError(response, 400, "business_id_required", "businessId is required.");
    return;
  }
  try {
    response.json(await createReelYouTubeAuthorizationUrl(request.auth, {
      businessId,
      returnPath: request.body?.returnPath,
    }));
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "youtube_auth_start_failed",
      message: "Unable to connect YouTube.",
      logMessage: "Failed to start Reel Studio YouTube auth.",
    });
  }
}

export async function reelYouTubeOAuthCallbackController(request: Request, response: Response): Promise<void> {
  const redirectUrl = await handleReelYouTubeOAuthCallback({
    code: typeof request.query.code === "string" ? request.query.code : undefined,
    state: typeof request.query.state === "string" ? request.query.state : undefined,
    error: typeof request.query.error === "string" ? request.query.error : undefined,
    errorDescription: typeof request.query.error_description === "string" ? request.query.error_description : undefined,
  });
  response.redirect(302, redirectUrl);
}

export async function getReelYouTubeConnectionController(
  request: Request,
  response: Response<ReelYouTubeConnection | ApiError>,
): Promise<void> {
  await withReelAccess(
    request,
    response,
    { errorCode: "youtube_connection_lookup_failed", errorMessage: "Unable to load YouTube connection." },
    async ({ businessId }) => getReelYouTubeConnection(businessId),
  );
}

export async function publishReelToYouTubeController(
  request: Request<{ projectId: string }, ReelYouTubePublishResponse | ApiError, ReelYouTubePublishRequest>,
  response: Response<ReelYouTubePublishResponse | ApiError>,
): Promise<void> {
  await withReelAccess(
    request as unknown as Request,
    response,
    { write: true, errorCode: "youtube_publish_failed", errorMessage: "Unable to publish this reel to YouTube." },
    async ({ businessId }) => {
      const publication = await publishReelToYouTube({
        businessId,
        projectId: request.params.projectId,
        visibility: request.body?.visibility,
      });
      const project = await getReelProject(businessId, request.params.projectId);
      return { project, publication };
    },
  );
}

export async function renderReelController(
  request: Request<{ projectId: string }>,
  response: Response<ReelProjectResponse | ApiError>,
): Promise<void> {
  await withReelAccess(
    request as unknown as Request,
    response,
    { write: true, errorCode: "reel_render_queue_failed", errorMessage: "Unable to start rendering." },
    async ({ businessId }) => ({ project: await queueReelRender(businessId, request.params.projectId) }),
  );
}

export async function deleteReelProjectController(
  request: Request<{ projectId: string }>,
  response: Response<{ deleted: true } | ApiError>,
): Promise<void> {
  await withReelAccess(
    request as unknown as Request,
    response,
    { write: true, errorCode: "reel_project_delete_failed", errorMessage: "Unable to delete this reel." },
    async ({ businessId }) => {
      await deleteReelProject(businessId, request.params.projectId);
      return { deleted: true as const };
    },
  );
}

/** Streams locally stored reel media (development fallback when S3 is not configured). */
export function getLocalReelMediaController(request: Request, response: Response<ApiError>): void {
  try {
    const filePath = resolveSignedLocalReelMedia(request.query);
    response.sendFile(filePath, { headers: { "Cache-Control": "private, max-age=3600" } }, (error) => {
      if (error && !response.headersSent) {
        sendApiError(response, 404, "reel_media_not_found", "Media file not found.");
      }
    });
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 400,
      code: "reel_media_invalid",
      message: "Unable to load this media file.",
      logMessage: "Rejected reel media request.",
    });
  }
}
