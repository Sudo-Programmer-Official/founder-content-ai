import type { QueryResultRow } from "pg";
import { resolveBrandKit } from "../../../../../packages/content-engine/src/index.ts";
import type {
  BrandKit,
  BrandKitAccentStyle,
  BrandKitBackgroundStyle,
  BrandKitBrandPlacement,
  BrandKitFontStyle,
  BrandKitInput,
  BrandKitTone,
  BrandKitVisualStyle,
} from "../../../../../packages/shared-types/index.ts";
import type { AuthenticatedPrincipal } from "../../middleware/auth.ts";
import { requireBusinessMembership } from "../authBusinessService.ts";
import { queryDb } from "../db/client.ts";
import {
  resolveWorkspaceAssetPreviewUrl,
  syncWorkspaceBrandKitForBusiness,
} from "../workspaceAssetService.ts";
import { HttpError } from "../../utils/http.ts";

interface BrandKitRow extends QueryResultRow {
  id: string;
  business_id: string;
  brand_name: string | null;
  industry: string | null;
  style: string | null;
  primary_color: string;
  secondary_color: string;
  font_family: string | null;
  icon_style: string | null;
  background_style: BrandKitBackgroundStyle;
  font_style: BrandKitFontStyle;
  visual_style: BrandKitVisualStyle;
  tone: BrandKitTone;
  tone_keywords: unknown;
  image_guidelines: string | null;
  business_description: string | null;
  website_url: string | null;
  accent_style: BrandKitAccentStyle;
  brand_placement: BrandKitBrandPlacement;
  logo_url: string | null;
  business_name: string | null;
  business_brand_name: string | null;
  business_website_url: string | null;
  business_niche: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface BrandProfileSeedRow extends QueryResultRow {
  preferred_tone: string | null;
  tone: string | null;
  visual_style: string | null;
  industry: string | null;
  location: string | null;
  website_url: string | null;
  business_name: string | null;
  business_brand_name: string | null;
  business_website_url: string | null;
  business_niche: string | null;
}

function toIsoString(value: Date | string): string {
  return new Date(value).toISOString();
}

function normalizeOptionalString(value: string | undefined | null): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed)
        ? parsed
          .filter((entry): entry is string => typeof entry === "string")
          .map((entry) => entry.trim())
          .filter(Boolean)
        : [];
    } catch {
      return [];
    }
  }

  return [];
}

function extractStorageKey(value: string): string | null {
  if (value.startsWith("s3://")) {
    const parts = value.replace(/^s3:\/\//, "").split("/");
    return parts.length > 1 ? parts.slice(1).join("/") : null;
  }

  return null;
}

function resolveBrandKitLogoUrl(value: string | null): string | undefined {
  const normalized = value?.trim();

  if (!normalized) {
    return undefined;
  }

  if (/^https?:\/\//i.test(normalized)) {
    return normalized;
  }

  const storageKey = extractStorageKey(normalized);
  return storageKey ? resolveWorkspaceAssetPreviewUrl(storageKey, normalized) ?? undefined : undefined;
}

function mapBrandKit(row: BrandKitRow): BrandKit {
  return {
    id: row.id,
    businessId: row.business_id,
    brandName:
      normalizeOptionalString(row.brand_name)
      ?? normalizeOptionalString(row.business_brand_name)
      ?? normalizeOptionalString(row.business_name),
    industry:
      normalizeOptionalString(row.industry) ?? normalizeOptionalString(row.business_niche),
    style: normalizeOptionalString(row.style),
    primaryColor: row.primary_color,
    secondaryColor: row.secondary_color,
    fontFamily: normalizeOptionalString(row.font_family),
    iconStyle: normalizeOptionalString(row.icon_style),
    backgroundStyle: row.background_style,
    fontStyle: row.font_style,
    visualStyle: row.visual_style,
    tone: row.tone,
    toneKeywords: parseStringArray(row.tone_keywords),
    imageGuidelines: normalizeOptionalString(row.image_guidelines),
    businessDescription: normalizeOptionalString(row.business_description),
    websiteUrl:
      normalizeOptionalString(row.website_url) ?? normalizeOptionalString(row.business_website_url),
    accentStyle: row.accent_style,
    brandPlacement: row.brand_placement,
    logoUrl: resolveBrandKitLogoUrl(row.logo_url),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function mapTone(value: string | undefined | null): BrandKitTone {
  const normalized = value?.trim().toLowerCase() ?? "";

  if (normalized.includes("friendly")) {
    return "friendly";
  }

  if (normalized.includes("bold") || normalized.includes("contrarian")) {
    return "bold";
  }

  return "professional";
}

function mapVisualStyle(value: string | undefined | null): BrandKitVisualStyle {
  const normalized = value?.trim().toLowerCase() ?? "";

  if (normalized.includes("luxury") || normalized.includes("premium")) {
    return "luxury";
  }

  if (
    normalized.includes("playful") ||
    normalized.includes("bright") ||
    normalized.includes("color")
  ) {
    return "playful";
  }

  return "minimal";
}

function buildDefaultStyleLabel(input: {
  visualStyle: BrandKitVisualStyle;
  tone: BrandKitTone;
}): string {
  if (input.visualStyle === "luxury") {
    return "premium, polished, editorial";
  }

  if (input.visualStyle === "playful") {
    return input.tone === "friendly"
      ? "modern, warm, playful"
      : "modern, colorful, expressive";
  }

  return input.tone === "bold" ? "modern, bold, minimal" : "modern, clean, minimal";
}

function buildDefaultToneKeywords(tone: BrandKitTone): string[] {
  switch (tone) {
    case "friendly":
      return ["friendly", "trustworthy", "approachable"];
    case "bold":
      return ["bold", "confident", "distinct"];
    case "professional":
    default:
      return ["professional", "clear", "credible"];
  }
}

function buildDefaultFontFamily(fontStyle: BrandKitFontStyle): string {
  switch (fontStyle) {
    case "elegant":
      return "Cormorant Garamond";
    case "modern":
      return "Manrope";
    case "bold":
    default:
      return "Poppins";
  }
}

function buildDefaultIconStyle(input: {
  tone: BrandKitTone;
  visualStyle: BrandKitVisualStyle;
  industry?: string | null;
}): string {
  const industry = normalizeOptionalString(input.industry)?.toLowerCase() ?? "";

  if (industry.includes("daycare")) {
    return "rounded, soft, friendly";
  }

  if (industry.includes("salon")) {
    return "clean, elegant, light stroke";
  }

  if (industry.includes("fitness")) {
    return "bold, energetic, geometric";
  }

  if (industry.includes("restaurant")) {
    return "warm, simple, welcoming";
  }

  if (input.visualStyle === "luxury") {
    return "refined, minimal, premium";
  }

  if (input.visualStyle === "playful" || input.tone === "friendly") {
    return "rounded, expressive, approachable";
  }

  return "clean, modern, minimal";
}

function buildSeedBrandKit(seed?: BrandProfileSeedRow): BrandKitInput {
  const tone = mapTone(seed?.tone ?? seed?.preferred_tone);
  const visualStyle = mapVisualStyle(seed?.visual_style);
  const accentStyle: BrandKitAccentStyle = tone === "professional" ? "underline" : "highlight_box";
  const brandPlacement: BrandKitBrandPlacement =
    visualStyle === "luxury" ? "side_label" : "top_left";
  const backgroundStyle: BrandKitBackgroundStyle =
    visualStyle === "playful" ? "gradient" : "dark";
  const fontStyle: BrandKitFontStyle = tone === "professional" ? "modern" : "bold";
  const baseSeed: BrandKitInput = {
    brandName:
      normalizeOptionalString(seed?.business_brand_name) ?? normalizeOptionalString(seed?.business_name),
    industry:
      normalizeOptionalString(seed?.industry) ?? normalizeOptionalString(seed?.business_niche),
    style: buildDefaultStyleLabel({ visualStyle, tone }),
    fontFamily: buildDefaultFontFamily(fontStyle),
    iconStyle: buildDefaultIconStyle({
      tone,
      visualStyle,
      industry: seed?.industry ?? seed?.business_niche,
    }),
    toneKeywords: buildDefaultToneKeywords(tone),
    imageGuidelines: "Keep assets consistent, uncluttered, and ready for web placement.",
    businessDescription:
      [
        normalizeOptionalString(seed?.industry) ?? normalizeOptionalString(seed?.business_niche),
        normalizeOptionalString(seed?.location),
      ]
        .filter(Boolean)
        .join(" in ") || undefined,
    websiteUrl:
      normalizeOptionalString(seed?.website_url) ?? normalizeOptionalString(seed?.business_website_url),
  };

  if (backgroundStyle === "gradient") {
    return {
      ...baseSeed,
      primaryColor: "#0F172A",
      secondaryColor: "#2563EB",
      backgroundStyle,
      fontStyle,
      visualStyle,
      tone,
      accentStyle,
      brandPlacement,
    };
  }

  return {
    ...baseSeed,
    primaryColor: "#111827",
    secondaryColor: "#F8FAFC",
    backgroundStyle,
    fontStyle,
    visualStyle,
    tone,
    accentStyle,
    brandPlacement,
  };
}

function mergeBrandKit(existing: BrandKit, overrides?: BrandKitInput): BrandKit {
  return resolveBrandKit(
    {
      brandName: overrides?.brandName ?? existing.brandName,
      industry: overrides?.industry ?? existing.industry,
      style: overrides?.style ?? existing.style,
      primaryColor: overrides?.primaryColor ?? existing.primaryColor,
      secondaryColor: overrides?.secondaryColor ?? existing.secondaryColor,
      fontFamily: overrides?.fontFamily ?? existing.fontFamily,
      iconStyle: overrides?.iconStyle ?? existing.iconStyle,
      backgroundStyle: overrides?.backgroundStyle ?? existing.backgroundStyle,
      fontStyle: overrides?.fontStyle ?? existing.fontStyle,
      visualStyle: overrides?.visualStyle ?? existing.visualStyle,
      tone: overrides?.tone ?? existing.tone,
      toneKeywords: overrides?.toneKeywords ?? existing.toneKeywords,
      imageGuidelines: overrides?.imageGuidelines ?? existing.imageGuidelines,
      businessDescription: overrides?.businessDescription ?? existing.businessDescription,
      websiteUrl: overrides?.websiteUrl ?? existing.websiteUrl,
      accentStyle: overrides?.accentStyle ?? existing.accentStyle,
      brandPlacement: overrides?.brandPlacement ?? existing.brandPlacement,
      logoUrl: overrides?.logoUrl ?? existing.logoUrl,
    },
    {
      id: existing.id,
      businessId: existing.businessId,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    },
  );
}

async function loadBrandKitRecord(businessId: string): Promise<BrandKit | null> {
  const result = await queryDb<BrandKitRow>(
    `
      select
        brand_kits.id,
        brand_kits.business_id,
        brand_kits.brand_name,
        brand_kits.industry,
        brand_kits.style,
        brand_kits.primary_color,
        brand_kits.secondary_color,
        brand_kits.font_family,
        brand_kits.icon_style,
        brand_kits.background_style,
        brand_kits.font_style,
        brand_kits.visual_style,
        brand_kits.tone,
        brand_kits.tone_keywords,
        brand_kits.image_guidelines,
        brand_kits.business_description,
        brand_kits.website_url,
        brand_kits.accent_style,
        brand_kits.brand_placement,
        brand_kits.logo_url,
        businesses.name as business_name,
        businesses.brand_name as business_brand_name,
        businesses.website_url as business_website_url,
        businesses.niche as business_niche,
        brand_kits.created_at,
        brand_kits.updated_at
      from brand_kits
      left join businesses
        on businesses.id = brand_kits.business_id
      where brand_kits.business_id = $1
      limit 1
    `,
    [businessId],
  );

  return result.rows[0] ? mapBrandKit(result.rows[0]) : null;
}

async function loadBrandProfileSeed(businessId: string): Promise<BrandProfileSeedRow | null> {
  const result = await queryDb<BrandProfileSeedRow>(
    `
      select
        brand_profiles.preferred_tone,
        brand_profiles.tone,
        brand_profiles.visual_style,
        brand_profiles.industry,
        brand_profiles.location,
        brand_profiles.website_url,
        businesses.name as business_name,
        businesses.brand_name as business_brand_name,
        businesses.website_url as business_website_url,
        businesses.niche as business_niche
      from businesses
      left join brand_profiles
        on brand_profiles.business_id = businesses.id
      where businesses.id = $1
      limit 1
    `,
    [businessId],
  );

  return result.rows[0] ?? null;
}

async function createBrandKitRecord(
  businessId: string,
  initialBrandKit: BrandKitInput,
): Promise<BrandKit> {
  const resolved = resolveBrandKit(initialBrandKit, {
    businessId,
  });

  const result = await queryDb<BrandKitRow>(
    `
      insert into brand_kits (
        business_id,
        brand_name,
        industry,
        style,
        primary_color,
        secondary_color,
        font_family,
        icon_style,
        background_style,
        font_style,
        visual_style,
        tone,
        tone_keywords,
        image_guidelines,
        business_description,
        website_url,
        accent_style,
        brand_placement,
        logo_url
      ) values (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        $11,
        $12,
        $13::jsonb,
        $14,
        $15,
        $16,
        $17,
        $18,
        $19
      )
      returning
        id,
        business_id,
        brand_name,
        industry,
        style,
        primary_color,
        secondary_color,
        font_family,
        icon_style,
        background_style,
        font_style,
        visual_style,
        tone,
        tone_keywords,
        image_guidelines,
        business_description,
        website_url,
        accent_style,
        brand_placement,
        logo_url,
        created_at,
        updated_at
    `,
    [
      businessId,
      resolved.brandName ?? null,
      resolved.industry ?? null,
      resolved.style ?? null,
      resolved.primaryColor,
      resolved.secondaryColor,
      resolved.fontFamily ?? null,
      resolved.iconStyle ?? null,
      resolved.backgroundStyle,
      resolved.fontStyle,
      resolved.visualStyle,
      resolved.tone,
      JSON.stringify(resolved.toneKeywords),
      resolved.imageGuidelines ?? null,
      resolved.businessDescription ?? null,
      resolved.websiteUrl ?? null,
      resolved.accentStyle,
      resolved.brandPlacement,
      resolved.logoUrl ?? null,
    ],
  );

  return mapBrandKit({
    ...result.rows[0],
    business_name: null,
    business_brand_name: null,
    business_website_url: null,
    business_niche: null,
  });
}

async function ensureBrandKitForBusiness(businessId: string): Promise<BrandKit> {
  const existing = await loadBrandKitRecord(businessId);

  if (existing) {
    return existing;
  }

  const seed = await loadBrandProfileSeed(businessId);

  try {
    return await createBrandKitRecord(businessId, buildSeedBrandKit(seed ?? undefined));
  } catch (error) {
    const candidate = error as { code?: string };

    if (candidate.code === "23505") {
      const concurrent = await loadBrandKitRecord(businessId);

      if (concurrent) {
        return concurrent;
      }
    }

    throw error;
  }
}

export async function resolveBrandKitForGeneration(input: {
  principal?: AuthenticatedPrincipal;
  businessId?: string;
  brandKit?: BrandKitInput;
}): Promise<BrandKit> {
  if (!input.businessId) {
    return resolveBrandKit(input.brandKit);
  }

  if (!input.principal) {
    throw new HttpError(
      401,
      "auth_required",
      "Authentication is required when generating visuals for a workspace.",
    );
  }

  if (!input.principal.isSuperAdmin) {
    await requireBusinessMembership(input.principal, input.businessId);
  }

  const existing = await ensureBrandKitForBusiness(input.businessId);
  return mergeBrandKit(existing, input.brandKit);
}

export async function getBrandKitForBusiness(input: {
  principal: AuthenticatedPrincipal;
  businessId: string;
}): Promise<BrandKit> {
  if (!input.principal.isSuperAdmin) {
    await requireBusinessMembership(input.principal, input.businessId);
  }

  return ensureBrandKitForBusiness(input.businessId);
}

export async function updateBrandKitForBusiness(input: {
  principal: AuthenticatedPrincipal;
  businessId: string;
  brandKit: BrandKitInput;
}): Promise<BrandKit> {
  if (!input.principal.isSuperAdmin) {
    await requireBusinessMembership(input.principal, input.businessId);
  }

  const existing = await ensureBrandKitForBusiness(input.businessId);
  const merged = mergeBrandKit(existing, input.brandKit);
  const result = await queryDb<BrandKitRow>(
    `
      update brand_kits
      set
        brand_name = $2,
        industry = $3,
        style = $4,
        primary_color = $5,
        secondary_color = $6,
        font_family = $7,
        icon_style = $8,
        background_style = $9,
        font_style = $10,
        visual_style = $11,
        tone = $12,
        tone_keywords = $13::jsonb,
        image_guidelines = $14,
        business_description = $15,
        website_url = $16,
        accent_style = $17,
        brand_placement = $18,
        logo_url = $19,
        updated_at = now()
      where business_id = $1
      returning
        id,
        business_id,
        brand_name,
        industry,
        style,
        primary_color,
        secondary_color,
        font_family,
        icon_style,
        background_style,
        font_style,
        visual_style,
        tone,
        tone_keywords,
        image_guidelines,
        business_description,
        website_url,
        accent_style,
        brand_placement,
        logo_url,
        created_at,
        updated_at
    `,
    [
      input.businessId,
      merged.brandName ?? null,
      merged.industry ?? null,
      merged.style ?? null,
      merged.primaryColor,
      merged.secondaryColor,
      merged.fontFamily ?? null,
      merged.iconStyle ?? null,
      merged.backgroundStyle,
      merged.fontStyle,
      merged.visualStyle,
      merged.tone,
      JSON.stringify(merged.toneKeywords),
      merged.imageGuidelines ?? null,
      merged.businessDescription ?? null,
      merged.websiteUrl ?? null,
      merged.accentStyle,
      merged.brandPlacement,
      merged.logoUrl ?? null,
    ],
  );

  const brandKit = mapBrandKit({
    ...result.rows[0],
    business_name: null,
    business_brand_name: null,
    business_website_url: null,
    business_niche: null,
  });
  await syncWorkspaceBrandKitForBusiness(input.businessId);
  return brandKit;
}
