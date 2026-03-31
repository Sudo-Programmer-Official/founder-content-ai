import type { WorkspaceInsightsResponse } from "../../../packages/shared-types";
import { apiGet } from "./api-client";

export async function requestWorkspaceInsights(
  businessId: string,
): Promise<WorkspaceInsightsResponse> {
  const encodedBusinessId = encodeURIComponent(businessId);
  return apiGet<WorkspaceInsightsResponse>(`/workspace-insights?businessId=${encodedBusinessId}`);
}
