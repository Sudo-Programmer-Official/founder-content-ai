import type {
  BrandAssetType,
  BrandKitInput,
  BrandKitResponse,
  BrandStudioAssetKind,
  BrandStudioGeneration,
  BrandStudioIndustryTemplate,
  BrandStudioHistoryResponse,
  GenerateBrandAssetRequest,
  GenerateBrandAssetResponse,
  GenerateBrandStudioAssetRequest,
  GenerateVisualRequest,
  GenerateVisualResponse,
  MediaSuggestionType,
  VisualTemplateType,
} from "../../../packages/shared-types";
import { ApiRequestError, apiGet, apiPost } from "./api-client";

const API_ENDPOINTS = {
  history: "/brand/history",
  legacyHistory: "/brand-studio/history",
  generate: "/brand/generate-asset",
  legacyGenerate: "/brand-studio/generate",
  brandKit: "/brand-kit",
  visualGenerate: "/generate-visual",
} as const;

function shouldFallbackToBrandStudioCompatibility(
  error: unknown,
  codes: string[],
): error is ApiRequestError {
  if (!(error instanceof ApiRequestError)) {
    return false;
  }

  if (error.statusCode === 404) {
    return true;
  }

  return error.statusCode >= 500 && codes.includes(error.code ?? "");
}

function createSyntheticGenerationId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `brand-studio-fallback-${Date.now()}`;
}

function estimateDataUrlSizeBytes(dataUrl: string): number {
  const payload = dataUrl.split(",", 2)[1] ?? "";
  return Math.max(0, Math.floor((payload.length * 3) / 4));
}

function toLegacyAssetKind(assetType: BrandAssetType): BrandStudioAssetKind {
  switch (assetType) {
    case "hero_banner":
      return "homepage_hero";
    case "feature_section":
      return "feature_section";
    case "cta_banner":
      return "cta_banner";
    case "icon_set":
      return "icon_set";
    case "social_post":
      return "social_media";
    case "email_header":
      return "email_header";
    default:
      return "homepage_hero";
  }
}

function inferTemplateKey(brandKit?: BrandKitInput): BrandStudioIndustryTemplate {
  const industry = (brandKit?.industry ?? "").trim().toLowerCase();

  if (industry.includes("daycare")) {
    return "daycare";
  }

  if (industry.includes("salon")) {
    return "salon";
  }

  if (industry.includes("fitness")) {
    return "fitness";
  }

  if (industry.includes("restaurant")) {
    return "restaurant";
  }

  return "custom";
}

function toVisualTemplateType(assetType: BrandAssetType): VisualTemplateType {
  switch (assetType) {
    case "feature_section":
    case "icon_set":
      return "insight";
    case "cta_banner":
    case "social_post":
      return "contrarian";
    case "hero_banner":
    case "email_header":
    default:
      return "quote";
  }
}

function toGeneratedMediaType(assetType: BrandAssetType): MediaSuggestionType {
  switch (assetType) {
    case "icon_set":
      return "framework_card";
    case "feature_section":
      return "stat_card";
    case "cta_banner":
      return "quote_card";
    case "hero_banner":
    case "social_post":
    case "email_header":
    default:
      return "photo_overlay";
  }
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();

    if (trimmed) {
      return trimmed;
    }
  }

  return undefined;
}

function buildFallbackHeadline(input: GenerateBrandAssetRequest): string {
  return firstNonEmpty(
    input.goal,
    input.context,
    input.assetType === "icon_set"
      ? "Create a branded icon system"
      : input.assetType === "hero_banner"
        ? "Create a branded homepage hero"
        : input.assetType === "cta_banner"
          ? "Create a branded conversion banner"
          : input.assetType === "feature_section"
            ? "Create a branded feature visual"
            : input.assetType === "social_post"
              ? "Create a branded social campaign visual"
              : "Create a branded email header",
  ) ?? "Create a branded visual";
}

function buildFallbackSupportingText(input: GenerateBrandAssetRequest): string | undefined {
  return firstNonEmpty(input.context, input.layout, input.extraInstructions);
}

function buildFallbackSceneDescription(input: GenerateBrandAssetRequest): string | undefined {
  const iconSubjects = Array.isArray(input.iconLabels) && input.iconLabels.length > 0
    ? `Include these subjects: ${input.iconLabels.join(", ")}.`
    : undefined;

  return firstNonEmpty(
    input.context,
    input.brandKit?.imageGuidelines,
    iconSubjects,
  );
}

function buildFallbackStylePrompt(input: GenerateBrandAssetRequest): string | undefined {
  const parts = [
    input.layout?.trim(),
    input.extraInstructions?.trim(),
    input.brandKit?.style?.trim(),
    input.brandKit?.iconStyle?.trim()
      ? `Icon style: ${input.brandKit.iconStyle.trim()}.`
      : undefined,
  ].filter((value): value is string => Boolean(value));

  return parts.length > 0 ? parts.join(" ") : undefined;
}

function buildVisualFallbackRequest(input: GenerateBrandAssetRequest): GenerateVisualRequest {
  return {
    businessId: input.businessId,
    templateType: toVisualTemplateType(input.assetType),
    generatedMediaType: toGeneratedMediaType(input.assetType),
    brandKit: input.brandKit,
    content: {
      headline: buildFallbackHeadline(input),
      supportingText: buildFallbackSupportingText(input),
      sceneDescription: buildFallbackSceneDescription(input),
      customStylePrompt: buildFallbackStylePrompt(input),
      eyebrowText: firstNonEmpty(input.brandKit?.brandName, input.brandKit?.industry),
      footerText: firstNonEmpty(input.brandKit?.websiteUrl, input.brandKit?.brandName),
      highlightText: input.assetType === "icon_set"
        ? firstNonEmpty(input.iconLabels?.[0], input.goal)
        : firstNonEmpty(input.goal, input.context),
    },
  };
}

function buildFallbackGenerationTitle(input: GenerateBrandAssetRequest, brandName?: string): string {
  const resolvedBrandName = brandName?.trim() || input.brandKit?.brandName?.trim() || "Brand";

  switch (input.assetType) {
    case "hero_banner":
      return `${resolvedBrandName} hero banner`;
    case "feature_section":
      return `${resolvedBrandName} feature visual`;
    case "cta_banner":
      return `${resolvedBrandName} CTA banner`;
    case "icon_set":
      return `${resolvedBrandName} icon set`;
    case "social_post":
      return `${resolvedBrandName} social post`;
    case "email_header":
      return `${resolvedBrandName} email header`;
    default:
      return `${resolvedBrandName} brand asset`;
  }
}

function buildFallbackGeneration(
  input: GenerateBrandAssetRequest,
  response: GenerateVisualResponse,
): GenerateBrandAssetResponse {
  const createdAt = new Date().toISOString();
  const title = buildFallbackGenerationTitle(input, response.brandKit.brandName);
  const generation: BrandStudioGeneration = {
    id: createSyntheticGenerationId(),
    businessId: input.businessId,
    assetKind: toLegacyAssetKind(input.assetType),
    templateKey: inferTemplateKey(input.brandKit ?? response.brandKit),
    consistencyMode: input.matchPreviousStyle ? "match_previous_style" : "standard",
    title,
    prompt: response.prompt,
    goal: input.goal?.trim() || undefined,
    context: input.context?.trim() || undefined,
    layout: input.layout?.trim() || undefined,
    extraInstructions: input.extraInstructions?.trim() || undefined,
    iconLabels: input.iconLabels ?? [],
    referenceGenerationId: input.referenceGenerationId?.trim() || undefined,
    asset: {
      previewUrl: response.imageDataUrl,
      downloadUrl: response.imageDataUrl,
      mimeType: response.mimeType,
      sizeBytes: estimateDataUrlSizeBytes(response.imageDataUrl),
      title,
    },
    brandKit: response.brandKit,
    metadata: {
      compatibilityMode: "generate_visual_fallback",
      historyPersisted: false,
      provider: response.provider,
      templateType: response.templateType,
      brandConsistency: response.brandConsistency,
    },
    createdAt,
  };

  return {
    generation,
  };
}

export async function requestBrandStudioHistory(
  businessId: string,
  limit?: number,
): Promise<BrandStudioHistoryResponse> {
  const params = new URLSearchParams({
    businessId,
  });

  if (typeof limit === "number" && Number.isFinite(limit) && limit > 0) {
    params.set("limit", String(Math.floor(limit)));
  }

  const query = params.toString();

  try {
    return await apiGet<BrandStudioHistoryResponse>(`${API_ENDPOINTS.history}?${query}`);
  } catch (error) {
    if (shouldFallbackToBrandStudioCompatibility(error, ["brand_studio_history_failed"])) {
      try {
        return await apiGet<BrandStudioHistoryResponse>(`${API_ENDPOINTS.legacyHistory}?${query}`);
      } catch (legacyError) {
        if (shouldFallbackToBrandStudioCompatibility(legacyError, ["brand_studio_history_failed"])) {
          const brandKitResponse = await apiGet<BrandKitResponse>(`${API_ENDPOINTS.brandKit}?${query}`);
          return {
            brandKit: brandKitResponse.brandKit,
            generations: [],
          };
        }

        throw legacyError;
      }
    }

    throw error;
  }
}

export async function requestGenerateBrandStudioAsset(
  input: GenerateBrandAssetRequest,
): Promise<GenerateBrandAssetResponse> {
  try {
    return await apiPost<GenerateBrandAssetRequest, GenerateBrandAssetResponse>(
      API_ENDPOINTS.generate,
      input,
    );
  } catch (error) {
    if (shouldFallbackToBrandStudioCompatibility(error, ["brand_asset_generation_failed"])) {
      const legacyPayload: GenerateBrandStudioAssetRequest = {
        businessId: input.businessId,
        assetKind: toLegacyAssetKind(input.assetType),
        generationMode: input.generationMode,
        goal: input.goal,
        context: input.context,
        layout: input.layout,
        extraInstructions: input.extraInstructions,
        iconLabels: input.iconLabels,
        creativeComposition: input.creativeComposition,
        brandKit: input.brandKit,
        referenceGenerationId: input.referenceGenerationId,
        matchPreviousStyle: input.matchPreviousStyle,
      };

      try {
        return await apiPost<GenerateBrandStudioAssetRequest, GenerateBrandAssetResponse>(
          API_ENDPOINTS.legacyGenerate,
          legacyPayload,
        );
      } catch (legacyError) {
        if (shouldFallbackToBrandStudioCompatibility(legacyError, ["brand_studio_generation_failed"])) {
          const visualResponse = await apiPost<GenerateVisualRequest, GenerateVisualResponse>(
            API_ENDPOINTS.visualGenerate,
            buildVisualFallbackRequest(input),
          );
          return buildFallbackGeneration(input, visualResponse);
        }

        throw legacyError;
      }
    }

    throw error;
  }
}
