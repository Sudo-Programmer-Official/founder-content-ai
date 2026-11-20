import type {
  ApproveContentPlanRequest,
  ApproveContentPlanResponse,
  GenerateContentPlanRequest,
  GenerateContentPlanResponse,
  GetContentPlanResponse,
  UpdateContentVariantRequest,
  UpdateContentVariantResponse,
} from "../../../packages/shared-types";
import { apiGet, apiPatch, apiPost } from "./api-client";

export async function requestGenerateContentPlan(
  input: GenerateContentPlanRequest,
): Promise<GenerateContentPlanResponse> {
  return apiPost<GenerateContentPlanRequest, GenerateContentPlanResponse>("/content/plan", input);
}

export async function requestGetContentPlan(input: {
  businessId: string;
  batchId: string;
  goal?: string;
  platforms?: string[];
  startDate?: string;
  defaultScheduledTime?: string;
}): Promise<GetContentPlanResponse> {
  const params = new URLSearchParams({
    businessId: input.businessId,
  });

  if (input.goal?.trim()) {
    params.set("goal", input.goal.trim());
  }

  if (input.platforms && input.platforms.length > 0) {
    params.set("platforms", input.platforms.join(","));
  }

  if (input.startDate?.trim()) {
    params.set("startDate", input.startDate.trim());
  }

  if (input.defaultScheduledTime?.trim()) {
    params.set("defaultScheduledTime", input.defaultScheduledTime.trim());
  }

  return apiGet<GetContentPlanResponse>(`/content/plan/${encodeURIComponent(input.batchId)}?${params.toString()}`);
}

export async function requestApproveContentPlan(
  batchId: string,
  input: ApproveContentPlanRequest,
): Promise<ApproveContentPlanResponse> {
  return apiPost<ApproveContentPlanRequest, ApproveContentPlanResponse>(
    `/content/plan/${encodeURIComponent(batchId)}/approve`,
    input,
  );
}

export async function requestUpdateContentVariant(
  input: UpdateContentVariantRequest,
): Promise<UpdateContentVariantResponse> {
  return apiPatch<UpdateContentVariantRequest, UpdateContentVariantResponse>(
    `/content/variants/${encodeURIComponent(input.variantId)}`,
    input,
  );
}
