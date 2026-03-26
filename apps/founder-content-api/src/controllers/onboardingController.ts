import type {
  ApiError,
  CompleteOnboardingRequest,
  CompleteOnboardingResponse,
  CreateOnboardingWorkspaceRequest,
  CreateOnboardingWorkspaceResponse,
  OnboardingStatusResponse,
  SaveOnboardingPreferencesRequest,
  SaveOnboardingPreferencesResponse,
  StartOnboardingRequest,
  StartOnboardingResponse,
} from "../../../../packages/shared-types/index.ts";
import type { Request, Response } from "express";
import {
  completeOnboarding,
  createOnboardingWorkspace,
  getOnboardingStatus,
  saveOnboardingPreferences,
  startOnboarding,
} from "../services/onboardingService.ts";
import { handleApiError, sendApiError } from "../utils/http.ts";

export async function getStatus(
  request: Request,
  response: Response<OnboardingStatusResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  try {
    response.json(await getOnboardingStatus(request.auth));
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "onboarding_status_failed",
      message: "Unable to load onboarding status.",
      logMessage: "Failed to load onboarding status.",
    });
  }
}

export async function start(
  request: Request<unknown, StartOnboardingResponse | ApiError, Partial<StartOnboardingRequest>>,
  response: Response<StartOnboardingResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  try {
    response.status(201).json(
      await startOnboarding(request.auth, {
        entryPoint: request.body?.entryPoint?.trim(),
      }),
    );
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "onboarding_start_failed",
      message: "Unable to start onboarding.",
      logMessage: "Failed to start onboarding.",
    });
  }
}

export async function savePreferences(
  request: Request<
    unknown,
    SaveOnboardingPreferencesResponse | ApiError,
    Partial<SaveOnboardingPreferencesRequest>
  >,
  response: Response<SaveOnboardingPreferencesResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  if (!request.body?.useCase) {
    sendApiError(response, 400, "bad_request", "useCase is required.");
    return;
  }

  try {
    response.json(
      await saveOnboardingPreferences(request.auth, {
        useCase: request.body.useCase,
        targetChannels: request.body.targetChannels ?? [],
        goals: request.body.goals ?? [],
        preferredTone: request.body.preferredTone,
      }),
    );
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "onboarding_preferences_failed",
      message: "Unable to save onboarding preferences.",
      logMessage: "Failed to save onboarding preferences.",
    });
  }
}

export async function createWorkspace(
  request: Request<
    unknown,
    CreateOnboardingWorkspaceResponse | ApiError,
    Partial<CreateOnboardingWorkspaceRequest>
  >,
  response: Response<CreateOnboardingWorkspaceResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  if (!request.body?.name?.trim()) {
    sendApiError(response, 400, "bad_request", "name is required.");
    return;
  }

  try {
    response.status(201).json(
      await createOnboardingWorkspace(request.auth, {
        name: request.body.name,
        websiteUrl: request.body.websiteUrl,
        timezone: request.body.timezone,
        industry: request.body.industry,
        tone: request.body.tone,
      }),
    );
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "onboarding_workspace_failed",
      message: "Unable to create onboarding workspace.",
      logMessage: "Failed to create onboarding workspace.",
    });
  }
}

export async function complete(
  request: Request<unknown, CompleteOnboardingResponse | ApiError, Partial<CompleteOnboardingRequest>>,
  response: Response<CompleteOnboardingResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  try {
    response.json(
      await completeOnboarding(request.auth, {
        businessId: request.body?.businessId,
        firstContentGenerated: request.body?.firstContentGenerated,
        firstContentCopied: request.body?.firstContentCopied,
        connectedChannel: request.body?.connectedChannel,
        scheduledFor: request.body?.scheduledFor,
      }),
    );
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "onboarding_complete_failed",
      message: "Unable to complete onboarding.",
      logMessage: "Failed to complete onboarding.",
    });
  }
}
