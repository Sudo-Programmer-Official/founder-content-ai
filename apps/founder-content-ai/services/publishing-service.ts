import type {
  DisconnectSocialAccountRequest,
  DisconnectSocialAccountResponse,
  GenerateHashtagsRequest,
  GenerateHashtagsResponse,
  PublishPostRequest,
  PublishPostResponse,
  RecommendPostTimeContentType,
  RecommendPostTimeResponse,
  SchedulePostRequest,
  SchedulePostResponse,
  UpdateScheduledPostRequest,
  UpdateScheduledPostResponse,
  ScheduledPostsResponse,
  SelectSocialAccountIdentityRequest,
  SelectSocialAccountIdentityResponse,
  SocialAccountsResponse,
  StartSocialAuthResponse,
} from "../../../packages/shared-types";
import { apiGet, apiPatch, apiPost } from "./api-client";

export async function requestSocialAccounts(businessId: string): Promise<SocialAccountsResponse> {
  const encodedBusinessId = encodeURIComponent(businessId);
  return apiGet<SocialAccountsResponse>(`/social-accounts?businessId=${encodedBusinessId}`);
}

export async function requestLinkedInSocialAuthStart(input: {
  businessId: string;
  returnPath?: string;
}): Promise<StartSocialAuthResponse> {
  return apiPost<
    {
      businessId: string;
      platform: "linkedin";
      returnPath?: string;
    },
    StartSocialAuthResponse
  >("/social-auth/linkedin/start", {
    businessId: input.businessId,
    platform: "linkedin",
    returnPath: input.returnPath,
  });
}

export async function requestDisconnectSocialAccount(input: {
  accountId: string;
  businessId: string;
}): Promise<DisconnectSocialAccountResponse> {
  return apiPost<DisconnectSocialAccountRequest, DisconnectSocialAccountResponse>(
    `/social-accounts/${encodeURIComponent(input.accountId)}/disconnect`,
    {
      businessId: input.businessId,
    },
  );
}

export async function requestSelectSocialAccountIdentity(input: {
  accountId: string;
  businessId: string;
  identityId: string;
}): Promise<SelectSocialAccountIdentityResponse> {
  return apiPost<SelectSocialAccountIdentityRequest, SelectSocialAccountIdentityResponse>(
    `/social-accounts/${encodeURIComponent(input.accountId)}/select-identity`,
    {
      businessId: input.businessId,
      identityId: input.identityId,
    },
  );
}

export async function requestSchedulePost(
  input: SchedulePostRequest,
): Promise<SchedulePostResponse> {
  return apiPost<SchedulePostRequest, SchedulePostResponse>("/schedule-post", input);
}

export async function requestPublishPost(
  input: PublishPostRequest,
): Promise<PublishPostResponse> {
  return apiPost<PublishPostRequest, PublishPostResponse>("/publish-post", input);
}

export async function requestScheduledPosts(
  businessId: string,
): Promise<ScheduledPostsResponse> {
  const encodedBusinessId = encodeURIComponent(businessId);
  return apiGet<ScheduledPostsResponse>(`/scheduled-posts?businessId=${encodedBusinessId}`);
}

export async function requestUpdateScheduledPost(
  scheduledPostId: string,
  input: UpdateScheduledPostRequest,
): Promise<UpdateScheduledPostResponse> {
  return apiPatch<UpdateScheduledPostRequest, UpdateScheduledPostResponse>(
    `/scheduled-posts/${encodeURIComponent(scheduledPostId)}`,
    input,
  );
}

export async function requestRecommendedPostTimes(
  businessId: string,
  contentType: RecommendPostTimeContentType = "carousel",
  audienceTimezone?: string,
): Promise<RecommendPostTimeResponse> {
  const encodedBusinessId = encodeURIComponent(businessId);
  const encodedContentType = encodeURIComponent(contentType);
  const audienceTimezoneQuery = audienceTimezone
    ? `&audienceTimezone=${encodeURIComponent(audienceTimezone)}`
    : "";

  return apiGet<RecommendPostTimeResponse>(
    `/recommend-post-time?businessId=${encodedBusinessId}&contentType=${encodedContentType}${audienceTimezoneQuery}`,
  );
}

export async function requestGeneratedHashtags(
  input: GenerateHashtagsRequest,
): Promise<GenerateHashtagsResponse> {
  return apiPost<GenerateHashtagsRequest, GenerateHashtagsResponse>("/generate-hashtags", input);
}
