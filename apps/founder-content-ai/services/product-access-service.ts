import type {
  MyFeaturesQuery,
  MyFeaturesResponse,
} from "../../../packages/shared-types";
import { apiGet } from "./api-client";

function toQueryString(input?: MyFeaturesQuery): string {
  const params = new URLSearchParams();

  if (input?.businessId?.trim()) {
    params.set("businessId", input.businessId.trim());
  }

  const query = params.toString();
  return query ? `?${query}` : "";
}

export async function requestProductAccessBootstrap(
  input?: MyFeaturesQuery,
): Promise<MyFeaturesResponse> {
  return apiGet<MyFeaturesResponse>(`/me/features${toQueryString(input)}`);
}
