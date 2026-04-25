import type { PoolClient, QueryResultRow } from "pg";
import { generateImage } from "../../../../packages/ai-core/src/index.ts";
import { resolveBrandKit } from "../../../../packages/content-engine/src/index.ts";
import type {
  BrandAssetType,
  BrandKit,
  BrandStudioAssetKind,
  BrandStudioConsistencyMode,
  BrandStudioGeneration,
  BrandStudioHistoryQuery,
  BrandStudioHistoryResponse,
  BrandStudioIndustryTemplate,
  GenerateBrandStudioAssetRequest,
  GenerateBrandStudioAssetResponse,
} from "../../../../packages/shared-types/index.ts";
import type { AuthenticatedPrincipal } from "../middleware/auth.ts";
import { getBrandKitForBusiness, resolveBrandKitForGeneration } from "./brandIntelligence/brandKitService.ts";
import { queryDb, withDbTransaction } from "./db/client.ts";
import { HttpError } from "../utils/http.ts";

interface BusinessContextRow extends QueryResultRow {
  id: string;
  name: string;
  brand_name: string;
  website_url: string | null;
  niche: string | null;
}

interface BrandStudioGenerationRow extends QueryResultRow {
  id: string;
  business_id: string;
  workspace_asset_id: string | null;
  reference_generation_id: string | null;
  asset_kind: BrandStudioAssetKind;
  template_key: BrandStudioIndustryTemplate;
  consistency_mode: BrandStudioConsistencyMode;
  title: string;
  prompt: string;
  goal: string | null;
  context: string | null;
  layout: string | null;
  extra_instructions: string | null;
  icon_labels: unknown;
  brand_snapshot: unknown;
  asset_metadata: unknown;
  created_at: Date | string;
  asset_title: string | null;
  storage_url: string | null;
  mime_type: string | null;
  size_bytes: number | string | null;
}

interface ReferenceGenerationRow extends QueryResultRow {
  id: string;
  business_id: string;
  asset_kind: BrandStudioAssetKind;
  template_key: BrandStudioIndustryTemplate;
  title: string;
  prompt: string;
  brand_snapshot: unknown;
  asset_metadata: unknown;
  created_at: Date | string;
}

interface IndustryTemplateRule {
  imagery: string[];
  iconLanguage: string;
  layoutDirection: string;
  visualGuardrails: string[];
}

interface AssetKindRule {
  label: string;
  size: "1024x1024" | "1536x1024" | "1024x1536";
  composition: string;
  outputInstruction: string;
}

const INDUSTRY_TEMPLATE_RULES: Record<BrandStudioIndustryTemplate, IndustryTemplateRule> = {
  daycare: {
    imagery: [
      "daycare classrooms",
      "teachers with children",
      "safe and welcoming learning spaces",
    ],
    iconLanguage: "rounded, soft, friendly",
    layoutDirection: "simple, spacious, reassuring",
    visualGuardrails: [
      "avoid generic stock-business scenes",
      "show warmth and safety without clutter",
      "keep expressions natural and trustworthy",
    ],
  },
  salon: {
    imagery: [
      "salon interiors",
      "stylist-client moments",
      "premium beauty detail shots",
    ],
    iconLanguage: "clean, elegant, light stroke",
    layoutDirection: "polished, editorial, premium",
    visualGuardrails: [
      "favor refined composition over busy product collage",
      "keep surfaces clean and modern",
      "avoid discount-flyer styling",
    ],
  },
  fitness: {
    imagery: [
      "coaching moments",
      "training environments",
      "movement and momentum",
    ],
    iconLanguage: "bold, geometric, energetic",
    layoutDirection: "dynamic, directional, high-contrast",
    visualGuardrails: [
      "prioritize energy without chaos",
      "avoid bodybuilder poster aesthetics unless asked",
      "keep the composition sharp and modern",
    ],
  },
  restaurant: {
    imagery: [
      "signature dishes",
      "hospitality moments",
      "warm dining atmosphere",
    ],
    iconLanguage: "simple, warm, welcoming",
    layoutDirection: "balanced, appetizing, inviting",
    visualGuardrails: [
      "make food look natural and premium",
      "avoid cluttered menu-board layouts",
      "keep hospitality cues warm and authentic",
    ],
  },
  custom: {
    imagery: [
      "industry-relevant subject matter",
      "realistic environment details",
      "brand-led focal point",
    ],
    iconLanguage: "consistent, simple, system-based",
    layoutDirection: "clean, web-ready, deliberate",
    visualGuardrails: [
      "avoid off-brand generic iconography",
      "maintain strong hierarchy and whitespace",
      "keep the asset ready for real UI placement",
    ],
  },
};

const ASSET_KIND_RULES: Record<BrandStudioAssetKind, AssetKindRule> = {
  homepage_hero: {
    label: "Hero banner",
    size: "1536x1024",
    composition:
      "Create a website hero visual with a strong focal point and deliberate negative space for headline and CTA overlay.",
    outputInstruction:
      "Landscape composition, web-first crop, premium polish, and no text rendered into the image.",
  },
  feature_section: {
    label: "Feature section",
    size: "1536x1024",
    composition:
      "Create a section-ready visual that can sit beside product copy on a landing page without feeling noisy.",
    outputInstruction:
      "Landscape composition, balanced visual weight, clean edges, and no embedded text.",
  },
  cta_banner: {
    label: "CTA banner",
    size: "1536x1024",
    composition:
      "Create a punchy conversion banner with a clear focal area and space for a CTA message block.",
    outputInstruction:
      "Wide website-ready composition, bold but uncluttered, and no embedded text.",
  },
  icon_set: {
    label: "Icon set",
    size: "1024x1024",
    composition:
      "Create a cohesive 2x2 icon system with four matching icons using the same stroke weight, corner radius, and visual language.",
    outputInstruction:
      "Square grid, crisp vector-like clarity, neutral or transparent-feel background, and absolutely no labels or numbers.",
  },
  social_media: {
    label: "Social post",
    size: "1024x1024",
    composition:
      "Create a scroll-stopping square social visual that still feels like part of the website brand system.",
    outputInstruction:
      "Square composition, campaign-ready, clean framing, and no embedded text unless the prompt explicitly requests typographic treatment.",
  },
  email_header: {
    label: "Email header",
    size: "1536x1024",
    composition:
      "Create a wide email header visual that works above a marketing message and remains readable when cropped.",
    outputInstruction:
      "Wide composition, polished top-of-email treatment, and no embedded text.",
  },
};

function toIsoString(value: Date | string): string {
  return new Date(value).toISOString();
}

function normalizeOptionalString(value: string | undefined | null): string | undefined {
  const normalized = value?.replace(/\s+/g, " ").trim();
  return normalized ? normalized : undefined;
}

function normalizeStringArray(value: unknown, limit = 6, maxLength = 40): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((entry) => (entry.length > maxLength ? entry.slice(0, maxLength).trim() : entry)))]
    .slice(0, limit);
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function truncate(value: string | undefined, maxLength: number): string | undefined {
  const normalized = normalizeOptionalString(value);

  if (!normalized) {
    return undefined;
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  const truncated = normalized.slice(0, maxLength).trim();
  const boundary = truncated.lastIndexOf(" ");
  return boundary >= Math.floor(maxLength * 0.6) ? truncated.slice(0, boundary).trim() : truncated;
}

function resolveIndustryTemplate(industry: string | undefined): BrandStudioIndustryTemplate {
  const normalized = normalizeOptionalString(industry)?.toLowerCase() ?? "";

  if (normalized.includes("daycare")) {
    return "daycare";
  }

  if (normalized.includes("salon") || normalized.includes("beauty")) {
    return "salon";
  }

  if (normalized.includes("fitness") || normalized.includes("gym")) {
    return "fitness";
  }

  if (normalized.includes("restaurant") || normalized.includes("food")) {
    return "restaurant";
  }

  return "custom";
}

function decodeDataUrlSizeBytes(value: string): number {
  const match = value.match(/^data:[^;]+;base64,(.+)$/);

  if (!match) {
    return Buffer.byteLength(value, "utf8");
  }

  return Buffer.from(match[1], "base64").byteLength;
}

export function mapBrandAssetTypeToStudioKind(assetType: BrandAssetType): BrandStudioAssetKind {
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
      throw new HttpError(400, "bad_request", "Unsupported brand asset type.");
  }
}

function resolveAssetKindRule(assetKind: BrandStudioAssetKind): AssetKindRule {
  const rule = ASSET_KIND_RULES[assetKind];

  if (!rule) {
    throw new HttpError(400, "bad_request", "Unsupported brand studio asset kind.");
  }

  return rule;
}

function buildGenerationTitle(input: {
  assetKind: BrandStudioAssetKind;
  goal?: string;
  context?: string;
}): string {
  const assetLabel = resolveAssetKindRule(input.assetKind).label;
  const focus = truncate(input.goal ?? input.context, 60);

  return focus ? `${assetLabel}: ${focus}` : assetLabel;
}

function buildPrompt(input: {
  request: GenerateBrandStudioAssetRequest;
  brandKit: BrandKit;
  businessContext: BusinessContextRow;
  templateKey: BrandStudioIndustryTemplate;
  referenceGeneration?: ReferenceGenerationRow | null;
  consistencyMode: BrandStudioConsistencyMode;
}): string {
  const assetRule = resolveAssetKindRule(input.request.assetKind);
  const templateRule = INDUSTRY_TEMPLATE_RULES[input.templateKey];
  const iconLabels = normalizeStringArray(input.request.iconLabels, 4, 28);
  const toneKeywords = normalizeStringArray(input.brandKit.toneKeywords, 6, 24);
  const referenceSnapshot = input.referenceGeneration
    ? resolveBrandKit(normalizeRecord(input.referenceGeneration.brand_snapshot))
    : null;
  const referenceMetadata = input.referenceGeneration
    ? normalizeRecord(input.referenceGeneration.asset_metadata)
    : {};

  return [
    `Create a ${assetRule.label.toLowerCase()} for a branded marketing system.`,
    "",
    "BRAND:",
    `- Name: ${input.brandKit.brandName || input.businessContext.brand_name || input.businessContext.name}`,
    `- Industry: ${input.brandKit.industry || input.businessContext.niche || input.templateKey}`,
    `- Colors: ${input.brandKit.primaryColor} and ${input.brandKit.secondaryColor}`,
    `- Tone: ${input.brandKit.tone}`,
    toneKeywords.length > 0 ? `- Tone keywords: ${toneKeywords.join(", ")}` : undefined,
    input.brandKit.style ? `- Style: ${input.brandKit.style}` : undefined,
    input.brandKit.fontFamily ? `- Preferred font family reference: ${input.brandKit.fontFamily}` : undefined,
    input.brandKit.iconStyle ? `- Icon style: ${input.brandKit.iconStyle}` : undefined,
    input.brandKit.businessDescription ? `- Business context: ${input.brandKit.businessDescription}` : undefined,
    input.brandKit.websiteUrl || input.businessContext.website_url
      ? `- Website context: ${input.brandKit.websiteUrl || input.businessContext.website_url}`
      : undefined,
    input.brandKit.imageGuidelines ? `- Image guidelines: ${input.brandKit.imageGuidelines}` : undefined,
    "",
    "INDUSTRY SYSTEM:",
    `- Imagery cues: ${templateRule.imagery.join(", ")}`,
    `- Icon language: ${templateRule.iconLanguage}`,
    `- Layout direction: ${templateRule.layoutDirection}`,
    `- Guardrails: ${templateRule.visualGuardrails.join("; ")}`,
    "",
    "ASSET SPEC:",
    `- Type: ${assetRule.label}`,
    `- Goal: ${truncate(input.request.goal, 140) || "Create a polished on-brand asset."}`,
    input.request.context ? `- Context: ${truncate(input.request.context, 160)}` : undefined,
    input.request.layout ? `- Layout: ${truncate(input.request.layout, 120)}` : undefined,
    iconLabels.length > 0
      ? `- Icon subjects: ${iconLabels.join(", ")}`
      : input.request.assetKind === "icon_set"
        ? "- Icon subjects: use four relevant product or workflow icons that match the brand."
        : undefined,
    `- Composition: ${assetRule.composition}`,
    `- Output rule: ${assetRule.outputInstruction}`,
    input.request.extraInstructions
      ? `- Extra direction: ${truncate(input.request.extraInstructions, 200)}`
      : undefined,
    "",
    "CONSISTENCY:",
    input.consistencyMode === "match_previous_style"
      ? `- Match the previous visual system from "${input.referenceGeneration?.title || "the most recent brand asset"}".`
      : "- Build from the brand kit as the primary design system.",
    input.referenceGeneration
      ? `- Reference asset type: ${resolveAssetKindRule(input.referenceGeneration.asset_kind).label}`
      : undefined,
    referenceSnapshot?.style ? `- Reference style summary: ${referenceSnapshot.style}` : undefined,
    referenceSnapshot?.iconStyle ? `- Reference icon language: ${referenceSnapshot.iconStyle}` : undefined,
    input.referenceGeneration?.prompt
      ? `- Reference prompt excerpt: ${truncate(input.referenceGeneration.prompt, 220)}`
      : undefined,
    referenceMetadata.layout ? `- Reuse the same overall polish and spacing discipline.` : undefined,
    "",
    "QUALITY:",
    "- Use brand colors intentionally rather than washing the entire image with one tint.",
    "- Keep the output website-ready and presentation-ready.",
    "- Avoid irrelevant symbols, random clip-art, and generic stock-business scenes.",
    input.request.assetKind === "icon_set"
      ? "- Keep all four icons stylistically identical and do not add text labels."
      : "- Do not render typographic blocks or UI chrome unless explicitly required by the brief.",
  ]
    .filter((entry): entry is string => Boolean(entry))
    .join("\n");
}

async function loadBusinessContext(businessId: string): Promise<BusinessContextRow> {
  const result = await queryDb<BusinessContextRow>(
    `
      select
        id,
        name,
        brand_name,
        website_url,
        niche
      from businesses
      where id = $1
      limit 1
    `,
    [businessId],
  );

  const row = result.rows[0];

  if (!row) {
    throw new HttpError(404, "business_not_found", "Workspace was not found.");
  }

  return row;
}

async function loadReferenceGeneration(input: {
  businessId: string;
  referenceGenerationId?: string;
  matchPreviousStyle?: boolean;
}): Promise<ReferenceGenerationRow | null> {
  if (input.referenceGenerationId) {
    const result = await queryDb<ReferenceGenerationRow>(
      `
        select
          id,
          business_id,
          asset_kind,
          template_key,
          title,
          prompt,
          brand_snapshot,
          asset_metadata,
          created_at
        from brand_studio_generations
        where business_id = $1
          and id = $2
        limit 1
      `,
      [input.businessId, input.referenceGenerationId],
    );

    const row = result.rows[0];

    if (!row) {
      throw new HttpError(404, "reference_generation_not_found", "Reference brand asset was not found.");
    }

    return row;
  }

  if (!input.matchPreviousStyle) {
    return null;
  }

  const result = await queryDb<ReferenceGenerationRow>(
    `
      select
        id,
        business_id,
        asset_kind,
        template_key,
        title,
        prompt,
        brand_snapshot,
        asset_metadata,
        created_at
      from brand_studio_generations
      where business_id = $1
      order by created_at desc
      limit 1
    `,
    [input.businessId],
  );

  return result.rows[0] ?? null;
}

async function insertWorkspaceAssetRecord(
  client: PoolClient,
  input: {
    businessId: string;
    principal: AuthenticatedPrincipal;
    generationId: string;
    title: string;
    imageDataUrl: string;
    mimeType: string;
    sizeBytes: number;
    assetKind: BrandStudioAssetKind;
    templateKey: BrandStudioIndustryTemplate;
    prompt: string;
  },
): Promise<{ id: string; title: string; storageUrl: string; mimeType: string; sizeBytes: number }> {
  const result = await client.query<{
    id: string;
    title: string | null;
    storage_url: string;
    mime_type: string;
    size_bytes: string | number;
  }>(
    `
      insert into workspace_assets (
        business_id,
        created_by_user_id,
        asset_type,
        source_type,
        source_reference_id,
        title,
        storage_url,
        mime_type,
        size_bytes,
        tags,
        metadata,
        usage_count,
        is_active
      ) values (
        $1,
        $2,
        'image',
        'generated',
        $3,
        $4,
        $5,
        $6,
        $7,
        $8::jsonb,
        $9::jsonb,
        1,
        true
      )
      returning
        id,
        title,
        storage_url,
        mime_type,
        size_bytes
    `,
    [
      input.businessId,
      input.principal.userId,
      input.generationId,
      input.title,
      input.imageDataUrl,
      input.mimeType,
      input.sizeBytes,
      JSON.stringify([input.assetKind, input.templateKey, "brand_studio"]),
      JSON.stringify({
        source: "brand_studio",
        prompt: input.prompt,
        templateKey: input.templateKey,
        assetKind: input.assetKind,
      }),
    ],
  );

  const asset = result.rows[0];

  await client.query(
    `
      insert into workspace_asset_usages (
        business_id,
        asset_id,
        usage_surface,
        reference_id,
        metadata
      ) values (
        $1,
        $2,
        'visual_generation',
        $3,
        $4::jsonb
      )
      on conflict (asset_id, usage_surface, reference_id)
      do update set
        metadata = excluded.metadata
    `,
    [
      input.businessId,
      asset.id,
      input.generationId,
      JSON.stringify({
        source: "brand_studio",
        assetKind: input.assetKind,
      }),
    ],
  );

  return {
    id: asset.id,
    title: asset.title ?? input.title,
    storageUrl: asset.storage_url,
    mimeType: asset.mime_type,
    sizeBytes: Number(asset.size_bytes) || input.sizeBytes,
  };
}

function mapGenerationRow(row: BrandStudioGenerationRow): BrandStudioGeneration {
  if (!row.storage_url || !row.mime_type) {
    throw new HttpError(500, "brand_studio_asset_missing", "Brand studio asset is missing its image payload.");
  }

  const metadata = normalizeRecord(row.asset_metadata);
  const brandSnapshot = resolveBrandKit(normalizeRecord(row.brand_snapshot));

  return {
    id: row.id,
    businessId: row.business_id,
    assetKind: row.asset_kind,
    templateKey: row.template_key,
    consistencyMode: row.consistency_mode,
    title: row.title,
    prompt: row.prompt,
    goal: normalizeOptionalString(row.goal),
    context: normalizeOptionalString(row.context),
    layout: normalizeOptionalString(row.layout),
    extraInstructions: normalizeOptionalString(row.extra_instructions),
    iconLabels: normalizeStringArray(row.icon_labels, 4, 28),
    referenceGenerationId: row.reference_generation_id ?? undefined,
    asset: {
      workspaceAssetId: row.workspace_asset_id ?? undefined,
      previewUrl: row.storage_url,
      downloadUrl: row.storage_url,
      mimeType: row.mime_type,
      sizeBytes: Number(row.size_bytes) || decodeDataUrlSizeBytes(row.storage_url),
      title: row.asset_title ?? row.title,
    },
    brandKit: brandSnapshot,
    metadata,
    createdAt: toIsoString(row.created_at),
  };
}

export async function listBrandStudioHistory(input: {
  principal: AuthenticatedPrincipal;
  query: BrandStudioHistoryQuery;
}): Promise<BrandStudioHistoryResponse> {
  const businessId = input.query.businessId.trim();
  const limit = Math.min(Math.max(Math.floor(input.query.limit ?? 8), 1), 12);
  const [brandKit, result] = await Promise.all([
    getBrandKitForBusiness({
      principal: input.principal,
      businessId,
    }),
    queryDb<BrandStudioGenerationRow>(
      `
        select
          brand_studio_generations.id,
          brand_studio_generations.business_id,
          brand_studio_generations.workspace_asset_id,
          brand_studio_generations.reference_generation_id,
          brand_studio_generations.asset_kind,
          brand_studio_generations.template_key,
          brand_studio_generations.consistency_mode,
          brand_studio_generations.title,
          brand_studio_generations.prompt,
          brand_studio_generations.goal,
          brand_studio_generations.context,
          brand_studio_generations.layout,
          brand_studio_generations.extra_instructions,
          brand_studio_generations.icon_labels,
          brand_studio_generations.brand_snapshot,
          brand_studio_generations.asset_metadata,
          brand_studio_generations.created_at,
          workspace_assets.title as asset_title,
          workspace_assets.storage_url,
          workspace_assets.mime_type,
          workspace_assets.size_bytes
        from brand_studio_generations
        left join workspace_assets
          on workspace_assets.id = brand_studio_generations.workspace_asset_id
        where brand_studio_generations.business_id = $1
        order by brand_studio_generations.created_at desc
        limit $2
      `,
      [businessId, limit],
    ),
  ]);

  return {
    brandKit,
    generations: result.rows
      .filter((row) => Boolean(row.storage_url && row.mime_type))
      .map((row) => mapGenerationRow(row)),
  };
}

export async function generateBrandStudioAsset(input: {
  principal: AuthenticatedPrincipal;
  request: GenerateBrandStudioAssetRequest;
}): Promise<GenerateBrandStudioAssetResponse> {
  const businessId = input.request.businessId.trim();
  const businessContext = await loadBusinessContext(businessId);
  const brandKit = await resolveBrandKitForGeneration({
    principal: input.principal,
    businessId,
    brandKit: input.request.brandKit,
  });
  const templateKey = resolveIndustryTemplate(brandKit.industry ?? businessContext.niche ?? undefined);
  const referenceGeneration = await loadReferenceGeneration({
    businessId,
    referenceGenerationId: input.request.referenceGenerationId?.trim() || undefined,
    matchPreviousStyle: input.request.matchPreviousStyle,
  });
  const consistencyMode: BrandStudioConsistencyMode =
    input.request.matchPreviousStyle && referenceGeneration ? "match_previous_style" : "standard";
  const prompt = buildPrompt({
    request: input.request,
    brandKit,
    businessContext,
    templateKey,
    referenceGeneration,
    consistencyMode,
  });
  const image = await generateImage({
    prompt,
    size: resolveAssetKindRule(input.request.assetKind).size,
  });
  const title = buildGenerationTitle({
    assetKind: input.request.assetKind,
    goal: input.request.goal,
    context: input.request.context,
  });
  const sizeBytes = decodeDataUrlSizeBytes(image.imageDataUrl);

  const generation = await withDbTransaction(async (client) => {
    const generationResult = await client.query<BrandStudioGenerationRow>(
      `
        insert into brand_studio_generations (
          business_id,
          created_by_user_id,
          reference_generation_id,
          asset_kind,
          template_key,
          consistency_mode,
          title,
          prompt,
          goal,
          context,
          layout,
          extra_instructions,
          icon_labels,
          brand_snapshot,
          request_payload,
          asset_metadata
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
          $14::jsonb,
          $15::jsonb,
          $16::jsonb
        )
        returning
          id,
          business_id,
          workspace_asset_id,
          reference_generation_id,
          asset_kind,
          template_key,
          consistency_mode,
          title,
          prompt,
          goal,
          context,
          layout,
          extra_instructions,
          icon_labels,
          brand_snapshot,
          asset_metadata,
          created_at,
          null::text as asset_title,
          null::text as storage_url,
          null::text as mime_type,
          null::bigint as size_bytes
      `,
      [
        businessId,
        input.principal.userId,
        referenceGeneration?.id ?? null,
        input.request.assetKind,
        templateKey,
        consistencyMode,
        title,
        prompt,
        normalizeOptionalString(input.request.goal) ?? null,
        normalizeOptionalString(input.request.context) ?? null,
        normalizeOptionalString(input.request.layout) ?? null,
        normalizeOptionalString(input.request.extraInstructions) ?? null,
        JSON.stringify(normalizeStringArray(input.request.iconLabels, 4, 28)),
        JSON.stringify(brandKit),
        JSON.stringify(input.request),
        JSON.stringify({
          model: image.model,
          size: resolveAssetKindRule(input.request.assetKind).size,
          generatedAt: new Date().toISOString(),
        }),
      ],
    );

    const generationRow = generationResult.rows[0];
    const asset = await insertWorkspaceAssetRecord(client, {
      businessId,
      principal: input.principal,
      generationId: generationRow.id,
      title,
      imageDataUrl: image.imageDataUrl,
      mimeType: image.mimeType,
      sizeBytes,
      assetKind: input.request.assetKind,
      templateKey,
      prompt,
    });

    const finalized = await client.query<BrandStudioGenerationRow>(
      `
        update brand_studio_generations
        set
          workspace_asset_id = $2::uuid,
          asset_metadata = jsonb_set(
            coalesce(asset_metadata, '{}'::jsonb),
            '{workspaceAssetId}',
            to_jsonb($3::text),
            true
          )
        where id = $1
        returning
          id,
          business_id,
          workspace_asset_id,
          reference_generation_id,
          asset_kind,
          template_key,
          consistency_mode,
          title,
          prompt,
          goal,
          context,
          layout,
          extra_instructions,
          icon_labels,
          brand_snapshot,
          asset_metadata,
          created_at
      `,
      [generationRow.id, asset.id, asset.id],
    );

    return mapGenerationRow({
      ...finalized.rows[0],
      asset_title: asset.title,
      storage_url: asset.storageUrl,
      mime_type: asset.mimeType,
      size_bytes: asset.sizeBytes,
    });
  });

  return {
    generation,
  };
}

export async function generateBrandAsset(input: {
  principal: AuthenticatedPrincipal;
  request: Omit<GenerateBrandStudioAssetRequest, "assetKind"> & { assetType: BrandAssetType };
}): Promise<GenerateBrandStudioAssetResponse> {
  return generateBrandStudioAsset({
    principal: input.principal,
    request: {
      businessId: input.request.businessId,
      assetKind: mapBrandAssetTypeToStudioKind(input.request.assetType),
      goal: input.request.goal,
      context: input.request.context,
      layout: input.request.layout,
      extraInstructions: input.request.extraInstructions,
      iconLabels: input.request.iconLabels,
      brandKit: input.request.brandKit,
      referenceGenerationId: input.request.referenceGenerationId,
      matchPreviousStyle: input.request.matchPreviousStyle,
    },
  });
}
