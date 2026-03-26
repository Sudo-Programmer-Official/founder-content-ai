import type {
  CompleteOnboardingRequest,
  CompleteOnboardingResponse,
  CreateOnboardingWorkspaceRequest,
  CreateOnboardingWorkspaceResponse,
  OnboardingStatusResponse,
  SaveOnboardingPreferencesRequest,
  SaveOnboardingPreferencesResponse,
  StartOnboardingRequest,
  StartOnboardingResponse,
} from "../../../packages/shared-types";
import { apiGet, apiPost } from "./api-client";

export async function requestOnboardingStatus(): Promise<OnboardingStatusResponse> {
  return apiGet<OnboardingStatusResponse>("/onboarding/status");
}

export async function requestOnboardingStart(
  payload: StartOnboardingRequest,
): Promise<StartOnboardingResponse> {
  return apiPost<StartOnboardingRequest, StartOnboardingResponse>("/onboarding/start", payload);
}

export async function requestOnboardingPreferences(
  payload: SaveOnboardingPreferencesRequest,
): Promise<SaveOnboardingPreferencesResponse> {
  return apiPost<SaveOnboardingPreferencesRequest, SaveOnboardingPreferencesResponse>(
    "/onboarding/preferences",
    payload,
  );
}

export async function requestOnboardingWorkspace(
  payload: CreateOnboardingWorkspaceRequest,
): Promise<CreateOnboardingWorkspaceResponse> {
  return apiPost<CreateOnboardingWorkspaceRequest, CreateOnboardingWorkspaceResponse>(
    "/onboarding/workspace",
    payload,
  );
}

export async function requestOnboardingComplete(
  payload: CompleteOnboardingRequest,
): Promise<CompleteOnboardingResponse> {
  return apiPost<CompleteOnboardingRequest, CompleteOnboardingResponse>("/onboarding/complete", payload);
}
