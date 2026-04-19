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
  primary_color: string;
  secondary_color: string;
  background_style: BrandKitBackgroundStyle;
  font_style: BrandKitFontStyle;
  visual_style: BrandKitVisualStyle;
  tone: BrandKitTone;
  accent_style: BrandKitAccentStyle;
  brand_placement: BrandKitBrandPlacement;
  logo_url: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface BrandProfileSeedRow extends QueryResultRow {
  preferred_tone: string | null;
  tone: string | null;
  visual_style: string | null;
}

function toIsoString(value: Date | string): string {
  return new Date(value).toISOString();
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
    primaryColor: row.primary_color,
    secondaryColor: row.secondary_color,
    backgroundStyle: row.background_style,
    fontStyle: row.font_style,
    visualStyle: row.visual_style,
    tone: row.tone,
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

function buildSeedBrandKit(seed?: BrandProfileSeedRow): BrandKitInput {
  const tone = mapTone(seed?.tone ?? seed?.preferred_tone);
  const visualStyle = mapVisualStyle(seed?.visual_style);
  const accentStyle: BrandKitAccentStyle = tone === "professional" ? "underline" : "highlight_box";
  const brandPlacement: BrandKitBrandPlacement =
    visualStyle === "luxury" ? "side_label" : "top_left";
  const backgroundStyle: BrandKitBackgroundStyle =
    visualStyle === "playful" ? "gradient" : "dark";
  const fontStyle: BrandKitFontStyle = tone === "professional" ? "modern" : "bold";

  if (backgroundStyle === "gradient") {
    return {
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
      primaryColor: overrides?.primaryColor ?? existing.primaryColor,
      secondaryColor: overrides?.secondaryColor ?? existing.secondaryColor,
      backgroundStyle: overrides?.backgroundStyle ?? existing.backgroundStyle,
      fontStyle: overrides?.fontStyle ?? existing.fontStyle,
      visualStyle: overrides?.visualStyle ?? existing.visualStyle,
      tone: overrides?.tone ?? existing.tone,
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
        id,
        business_id,
        primary_color,
        secondary_color,
        background_style,
        font_style,
        visual_style,
        tone,
        accent_style,
        brand_placement,
        logo_url,
        created_at,
        updated_at
      from brand_kits
      where business_id = $1
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
        preferred_tone,
        tone,
        visual_style
      from brand_profiles
      where business_id = $1
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
        primary_color,
        secondary_color,
        background_style,
        font_style,
        visual_style,
        tone,
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
        $10
      )
      returning
        id,
        business_id,
        primary_color,
        secondary_color,
        background_style,
        font_style,
        visual_style,
        tone,
        accent_style,
        brand_placement,
        logo_url,
        created_at,
        updated_at
    `,
    [
      businessId,
      resolved.primaryColor,
      resolved.secondaryColor,
      resolved.backgroundStyle,
      resolved.fontStyle,
      resolved.visualStyle,
      resolved.tone,
      resolved.accentStyle,
      resolved.brandPlacement,
      resolved.logoUrl ?? null,
    ],
  );

  return mapBrandKit(result.rows[0]);
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
        primary_color = $2,
        secondary_color = $3,
        background_style = $4,
        font_style = $5,
        visual_style = $6,
        tone = $7,
        accent_style = $8,
        brand_placement = $9,
        logo_url = $10,
        updated_at = now()
      where business_id = $1
      returning
        id,
        business_id,
        primary_color,
        secondary_color,
        background_style,
        font_style,
        visual_style,
        tone,
        accent_style,
        brand_placement,
        logo_url,
        created_at,
        updated_at
    `,
    [
      input.businessId,
      merged.primaryColor,
      merged.secondaryColor,
      merged.backgroundStyle,
      merged.fontStyle,
      merged.visualStyle,
      merged.tone,
      merged.accentStyle,
      merged.brandPlacement,
      merged.logoUrl ?? null,
    ],
  );

  const brandKit = mapBrandKit(result.rows[0]);
  await syncWorkspaceBrandKitForBusiness(input.businessId);
  return brandKit;
}
