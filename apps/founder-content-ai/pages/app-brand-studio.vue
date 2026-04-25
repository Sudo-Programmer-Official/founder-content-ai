<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import type {
  BrandAssetType,
  BrandKit,
  BrandKitAccentStyle,
  BrandKitBackgroundStyle,
  BrandKitBrandPlacement,
  BrandKitFontStyle,
  BrandKitInput,
  BrandKitTone,
  BrandKitVisualStyle,
  BrandStudioAssetKind,
  BrandStudioGeneration,
} from "../../../packages/shared-types";
import { useProductAccessContext } from "../access/product-access-context";
import { requestUpdateBrandKit } from "../services/brand-kit-service";
import {
  requestBrandStudioHistory,
  requestGenerateBrandStudioAsset,
} from "../services/brand-studio-service";

const { bootstrap, isReady } = useProductAccessContext();

const activeBusinessId = computed(() => bootstrap.value?.activeBusinessId ?? "");
const GENERATOR_DRAFT_STORAGE_VERSION = 1;
const GENERATOR_DRAFT_STORAGE_PREFIX = "brand-studio-generator-drafts";
const BRAND_STUDIO_ASSET_KINDS: BrandStudioAssetKind[] = [
  "homepage_hero",
  "feature_section",
  "cta_banner",
  "icon_set",
  "social_media",
  "email_header",
];

const isLoading = ref(false);
const isSavingBrandKit = ref(false);
const isGenerating = ref(false);
const feedback = ref("");
const brandKit = ref<BrandKit | null>(null);
const history = ref<BrandStudioGeneration[]>([]);
const latestGeneration = ref<BrandStudioGeneration | null>(null);
const iconSetSlices = ref<IconSetSlicePreview[]>([]);
const generatorDrafts = reactive<Partial<Record<BrandStudioAssetKind, GeneratorDraft>>>({});
let isApplyingGeneratorDraft = false;
let iconSetSliceRequestId = 0;

type GeneratorDraft = {
  goal: string;
  context: string;
  layout: string;
  extraInstructions: string;
  iconLabels: string;
  matchPreviousStyle: boolean;
  referenceGenerationId: string;
};

type IconSetSlicePreview = {
  index: number;
  label: string;
  previewUrl: string;
};

type PersistedGeneratorDraftState = {
  version: number;
  selectedAssetKind?: BrandStudioAssetKind;
  drafts?: Partial<Record<BrandStudioAssetKind, GeneratorDraft>>;
};

const brandForm = reactive<{
  brandName: string;
  industry: string;
  style: string;
  primaryColor: string;
  secondaryColor: string;
  fontFamily: string;
  iconStyle: string;
  backgroundStyle: BrandKitBackgroundStyle;
  fontStyle: BrandKitFontStyle;
  visualStyle: BrandKitVisualStyle;
  tone: BrandKitTone;
  accentStyle: BrandKitAccentStyle;
  brandPlacement: BrandKitBrandPlacement;
  toneKeywords: string;
  imageGuidelines: string;
  businessDescription: string;
  websiteUrl: string;
  logoUrl: string;
}>({
  brandName: "",
  industry: "",
  style: "",
  primaryColor: "#111827",
  secondaryColor: "#F8FAFC",
  fontFamily: "",
  iconStyle: "",
  backgroundStyle: "dark",
  fontStyle: "modern",
  visualStyle: "minimal",
  tone: "professional",
  accentStyle: "underline",
  brandPlacement: "top_left",
  toneKeywords: "",
  imageGuidelines: "",
  businessDescription: "",
  websiteUrl: "",
  logoUrl: "",
});

const generatorForm = reactive<{
  assetKind: BrandStudioAssetKind;
  goal: string;
  context: string;
  layout: string;
  extraInstructions: string;
  iconLabels: string;
  matchPreviousStyle: boolean;
  referenceGenerationId: string;
}>({
  assetKind: "homepage_hero",
  goal: "",
  context: "",
  layout: "Website-ready composition with clean overlay space",
  extraInstructions: "",
  iconLabels: "Choose plan, Add location, Manage listings, Grow business",
  matchPreviousStyle: false,
  referenceGenerationId: "",
});

const assetKindOptions: Array<{ value: BrandStudioAssetKind; label: string; description: string }> = [
  {
    value: "homepage_hero",
    label: "Hero Banner",
    description: "Landscape hero art with negative space for headline and CTA.",
  },
  {
    value: "feature_section",
    label: "Feature Section",
    description: "Supporting section visual for landing pages and product copy.",
  },
  {
    value: "cta_banner",
    label: "CTA Banner",
    description: "Conversion-focused website banner with strong focal area.",
  },
  {
    value: "icon_set",
    label: "Icon Set",
    description: "Four matching icons for steps, features, or onboarding flows.",
  },
  {
    value: "social_media",
    label: "Social Post",
    description: "Square campaign asset for Instagram, Facebook, or paid social.",
  },
  {
    value: "email_header",
    label: "Email Header",
    description: "Wide header visual for newsletters and promotional emails.",
  },
];

const templateCards = [
  {
    label: "Daycare",
    details: "Rounded icons, warm trust signals, welcoming classroom imagery.",
  },
  {
    label: "Salon",
    details: "Premium editorial composition, clean lines, elevated beauty cues.",
  },
  {
    label: "Fitness",
    details: "Dynamic movement, stronger contrast, bold geometric icon language.",
  },
  {
    label: "Restaurant",
    details: "Warm hospitality scenes, appetizing focus, simple welcoming symbols.",
  },
];

const canGenerate = computed(() => Boolean(activeBusinessId.value));
const referenceOptions = computed(() =>
  history.value.map((generation) => ({
    value: generation.id,
    label: `${generation.title} · ${formatRelativeDate(generation.createdAt)}`,
  })),
);
const savedBrandRuleChips = computed(() => {
  if (!brandKit.value) {
    return [];
  }

  return [
    `Industry: ${brandKit.value.industry || "Not set"}`,
    `Tone: ${formatToneLabel(brandKit.value.tone)}`,
    `Visual style: ${formatVisualStyleLabel(brandKit.value.visualStyle)}`,
    `Background: ${formatBackgroundStyleLabel(brandKit.value.backgroundStyle)}`,
    `Accent: ${formatAccentStyleLabel(brandKit.value.accentStyle)}`,
    `Placement: ${formatBrandPlacementLabel(brandKit.value.brandPlacement)}`,
    `Font direction: ${formatFontStyleLabel(brandKit.value.fontStyle)}`,
    brandKit.value.fontFamily ? `Font family: ${brandKit.value.fontFamily}` : undefined,
    brandKit.value.iconStyle ? `Icon style: ${brandKit.value.iconStyle}` : undefined,
  ].filter((entry): entry is string => Boolean(entry));
});

function generatorDraftStorageKey(businessId: string): string {
  return `${GENERATOR_DRAFT_STORAGE_PREFIX}:${businessId}`;
}

function splitCommaList(value: string): string[] {
  return [...new Set(value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean))]
    .slice(0, 6);
}

function toApiAssetType(assetKind: BrandStudioAssetKind): BrandAssetType {
  switch (assetKind) {
    case "homepage_hero":
      return "hero_banner";
    case "feature_section":
      return "feature_section";
    case "cta_banner":
      return "cta_banner";
    case "icon_set":
      return "icon_set";
    case "social_media":
      return "social_post";
    case "email_header":
      return "email_header";
    default:
      return "hero_banner";
  }
}

function applyBrandKit(nextBrandKit: BrandKit): void {
  brandKit.value = nextBrandKit;
  brandForm.brandName = nextBrandKit.brandName ?? "";
  brandForm.industry = nextBrandKit.industry ?? "";
  brandForm.style = nextBrandKit.style ?? "";
  brandForm.primaryColor = nextBrandKit.primaryColor;
  brandForm.secondaryColor = nextBrandKit.secondaryColor;
  brandForm.fontFamily = nextBrandKit.fontFamily ?? "";
  brandForm.iconStyle = nextBrandKit.iconStyle ?? "";
  brandForm.backgroundStyle = nextBrandKit.backgroundStyle;
  brandForm.fontStyle = nextBrandKit.fontStyle;
  brandForm.visualStyle = nextBrandKit.visualStyle;
  brandForm.tone = nextBrandKit.tone;
  brandForm.accentStyle = nextBrandKit.accentStyle;
  brandForm.brandPlacement = nextBrandKit.brandPlacement;
  brandForm.toneKeywords = (nextBrandKit.toneKeywords ?? []).join(", ");
  brandForm.imageGuidelines = nextBrandKit.imageGuidelines ?? "";
  brandForm.businessDescription = nextBrandKit.businessDescription ?? "";
  brandForm.websiteUrl = nextBrandKit.websiteUrl ?? "";
  brandForm.logoUrl = nextBrandKit.logoUrl ?? "";
}

function buildBrandKitPayload(): BrandKitInput {
  return {
    brandName: brandForm.brandName,
    industry: brandForm.industry,
    style: brandForm.style,
    primaryColor: brandForm.primaryColor,
    secondaryColor: brandForm.secondaryColor,
    fontFamily: brandForm.fontFamily,
    iconStyle: brandForm.iconStyle,
    backgroundStyle: brandForm.backgroundStyle,
    fontStyle: brandForm.fontStyle,
    visualStyle: brandForm.visualStyle,
    tone: brandForm.tone,
    toneKeywords: splitCommaList(brandForm.toneKeywords),
    imageGuidelines: brandForm.imageGuidelines,
    businessDescription: brandForm.businessDescription,
    websiteUrl: brandForm.websiteUrl,
    accentStyle: brandForm.accentStyle,
    brandPlacement: brandForm.brandPlacement,
    logoUrl: brandForm.logoUrl,
  };
}

function formatRelativeDate(value: string): string {
  const date = new Date(value);

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatToneLabel(value: BrandKitTone): string {
  switch (value) {
    case "friendly":
      return "Friendly";
    case "bold":
      return "Bold";
    default:
      return "Professional";
  }
}

function formatVisualStyleLabel(value: BrandKitVisualStyle): string {
  switch (value) {
    case "playful":
      return "Playful";
    case "luxury":
      return "Luxury";
    default:
      return "Minimal";
  }
}

function formatBackgroundStyleLabel(value: BrandKitBackgroundStyle): string {
  switch (value) {
    case "light":
      return "Light";
    case "gradient":
      return "Gradient";
    default:
      return "Dark";
  }
}

function formatFontStyleLabel(value: BrandKitFontStyle): string {
  switch (value) {
    case "bold":
      return "Bold";
    case "elegant":
      return "Elegant";
    default:
      return "Modern";
  }
}

function formatAccentStyleLabel(value: BrandKitAccentStyle): string {
  switch (value) {
    case "underline":
      return "Underline";
    case "bold":
      return "Bold emphasis";
    default:
      return "Soft highlight";
  }
}

function formatBrandPlacementLabel(value: BrandKitBrandPlacement): string {
  switch (value) {
    case "bottom_right":
      return "Bottom right";
    case "side_label":
      return "Side label";
    default:
      return "Top left";
  }
}

function isExternalUrl(value: string | undefined): boolean {
  if (!value?.trim()) {
    return false;
  }

  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function resolveBrandNameForDrafts(): string {
  return brandKit.value?.brandName?.trim() || "your brand";
}

function resolveIndustryForDrafts(): string {
  return brandKit.value?.industry?.trim() || "your business";
}

function buildDefaultGeneratorDraft(assetKind: BrandStudioAssetKind): GeneratorDraft {
  const brandName = resolveBrandNameForDrafts();
  const industry = resolveIndustryForDrafts();

  switch (assetKind) {
    case "homepage_hero":
      return {
        goal: `Create a homepage hero visual for ${brandName} that feels trustworthy, modern, and on-brand.`,
        context: `Use this for the ${brandName} website and landing pages in the ${industry} category.`,
        layout: "Website-ready hero composition with clean overlay space for headline and CTA",
        extraInstructions: "Match the saved brand colors and overall visual system. No text baked into the image.",
        iconLabels: "Choose plan, Add location, Manage listings, Grow business",
        matchPreviousStyle: false,
        referenceGenerationId: "",
      };
    case "feature_section":
      return {
        goal: `Create a supporting feature visual for ${brandName} that explains the product clearly.`,
        context: `Use this beside product or website copy for ${brandName}. Keep it relevant to ${industry}.`,
        layout: "Landscape section visual with clear focal point and room for adjacent copy",
        extraInstructions: "Keep it simple, polished, and brand-matched. Avoid clutter and generic stock-business scenes.",
        iconLabels: "Choose plan, Add location, Manage listings, Grow business",
        matchPreviousStyle: false,
        referenceGenerationId: "",
      };
    case "cta_banner":
      return {
        goal: `Create a conversion-focused CTA banner for ${brandName}.`,
        context: `Use this for website calls to action that should drive clicks and conversions for ${brandName}.`,
        layout: "Wide website banner with a strong focal area and clean message space",
        extraInstructions: "Use the saved brand palette, keep the composition premium, and leave space for CTA copy.",
        iconLabels: "Choose plan, Add location, Manage listings, Grow business",
        matchPreviousStyle: false,
        referenceGenerationId: "",
      };
    case "icon_set":
      return {
        goal: `Create a clear, consistent icon system for ${brandName}.`,
        context: `Use this to replace confusing or generic icons with visuals that make sense for the ${industry} brand.`,
        layout: "Four matching icons in a clean 2x2 system with consistent spacing and stroke weight",
        extraInstructions: "Keep icons simple, recognizable, rounded, and relevant. No labels, numbers, or decorative clutter.",
        iconLabels: "Choose plan, Add location, Manage listings, Grow business",
        matchPreviousStyle: false,
        referenceGenerationId: "",
      };
    case "social_media":
      return {
        goal: `Create a branded social campaign visual for ${brandName}.`,
        context: `Use this for Instagram, Facebook, or paid social so it feels consistent with the ${brandName} website.`,
        layout: "Square social composition with one strong focal area and clean framing",
        extraInstructions: "Keep it scroll-stopping but brand-safe. Match saved colors and avoid generic stock-ad aesthetics.",
        iconLabels: "Choose plan, Add location, Manage listings, Grow business",
        matchPreviousStyle: false,
        referenceGenerationId: "",
      };
    case "email_header":
      return {
        goal: `Create a branded email header for ${brandName}.`,
        context: `Use this at the top of newsletters and promotional emails for ${brandName}.`,
        layout: "Wide email header composition with safe crop zone and calm overlay area",
        extraInstructions: "Keep it polished, readable, and consistent with the saved brand rules. No text baked into the image.",
        iconLabels: "Choose plan, Add location, Manage listings, Grow business",
        matchPreviousStyle: false,
        referenceGenerationId: "",
      };
    default:
      return {
        goal: "",
        context: "",
        layout: "Website-ready composition with clean overlay space",
        extraInstructions: "",
        iconLabels: "Choose plan, Add location, Manage listings, Grow business",
        matchPreviousStyle: false,
        referenceGenerationId: "",
      };
  }
}

function captureCurrentGeneratorDraft(): GeneratorDraft {
  return {
    goal: generatorForm.goal,
    context: generatorForm.context,
    layout: generatorForm.layout,
    extraInstructions: generatorForm.extraInstructions,
    iconLabels: generatorForm.iconLabels,
    matchPreviousStyle: generatorForm.matchPreviousStyle,
    referenceGenerationId: generatorForm.referenceGenerationId,
  };
}

function applyGeneratorDraft(assetKind: BrandStudioAssetKind): void {
  const draft = generatorDrafts[assetKind] ?? buildDefaultGeneratorDraft(assetKind);

  isApplyingGeneratorDraft = true;
  generatorForm.goal = draft.goal;
  generatorForm.context = draft.context;
  generatorForm.layout = draft.layout;
  generatorForm.extraInstructions = draft.extraInstructions;
  generatorForm.iconLabels = draft.iconLabels;
  generatorForm.matchPreviousStyle = draft.matchPreviousStyle;
  generatorForm.referenceGenerationId = draft.referenceGenerationId;
  isApplyingGeneratorDraft = false;
}

function clearGeneratorDrafts(): void {
  for (const assetKind of BRAND_STUDIO_ASSET_KINDS) {
    delete generatorDrafts[assetKind];
  }
}

function persistGeneratorDrafts(): void {
  if (typeof window === "undefined" || !activeBusinessId.value) {
    return;
  }

  const persistedDrafts = BRAND_STUDIO_ASSET_KINDS.reduce<Partial<Record<BrandStudioAssetKind, GeneratorDraft>>>(
    (accumulator, assetKind) => {
      const draft = generatorDrafts[assetKind];

      if (draft) {
        accumulator[assetKind] = draft;
      }

      return accumulator;
    },
    {},
  );
  const payload: PersistedGeneratorDraftState = {
    version: GENERATOR_DRAFT_STORAGE_VERSION,
    selectedAssetKind: generatorForm.assetKind,
    drafts: persistedDrafts,
  };

  window.localStorage.setItem(generatorDraftStorageKey(activeBusinessId.value), JSON.stringify(payload));
}

function normalizeGeneratorDraft(value: unknown): GeneratorDraft | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Record<string, unknown>;

  return {
    goal: typeof candidate.goal === "string" ? candidate.goal : "",
    context: typeof candidate.context === "string" ? candidate.context : "",
    layout: typeof candidate.layout === "string" ? candidate.layout : "",
    extraInstructions: typeof candidate.extraInstructions === "string" ? candidate.extraInstructions : "",
    iconLabels: typeof candidate.iconLabels === "string" ? candidate.iconLabels : buildDefaultGeneratorDraft("icon_set").iconLabels,
    matchPreviousStyle: candidate.matchPreviousStyle === true,
    referenceGenerationId: typeof candidate.referenceGenerationId === "string" ? candidate.referenceGenerationId : "",
  };
}

function loadGeneratorDrafts(): void {
  clearGeneratorDrafts();

  if (typeof window === "undefined" || !activeBusinessId.value) {
    applyGeneratorDraft(generatorForm.assetKind);
    return;
  }

  const persisted = window.localStorage.getItem(generatorDraftStorageKey(activeBusinessId.value));

  if (!persisted) {
    applyGeneratorDraft(generatorForm.assetKind);
    persistGeneratorDrafts();
    return;
  }

  try {
    const parsed = JSON.parse(persisted) as PersistedGeneratorDraftState;

    if (parsed.version !== GENERATOR_DRAFT_STORAGE_VERSION) {
      applyGeneratorDraft(generatorForm.assetKind);
      persistGeneratorDrafts();
      return;
    }

    for (const assetKind of BRAND_STUDIO_ASSET_KINDS) {
      const normalizedDraft = normalizeGeneratorDraft(parsed.drafts?.[assetKind]);

      if (normalizedDraft) {
        generatorDrafts[assetKind] = normalizedDraft;
      }
    }

    if (parsed.selectedAssetKind && BRAND_STUDIO_ASSET_KINDS.includes(parsed.selectedAssetKind)) {
      generatorForm.assetKind = parsed.selectedAssetKind;
    }

    applyGeneratorDraft(generatorForm.assetKind);
    persistGeneratorDrafts();
  } catch {
    applyGeneratorDraft(generatorForm.assetKind);
    persistGeneratorDrafts();
  }
}

async function loadStudio(): Promise<void> {
  if (!isReady.value || !activeBusinessId.value) {
    return;
  }

  isLoading.value = true;
  feedback.value = "";

  try {
    const response = await requestBrandStudioHistory(activeBusinessId.value, 8);
    applyBrandKit(response.brandKit);
    loadGeneratorDrafts();
    history.value = response.generations;
    latestGeneration.value = response.generations[0] ?? null;
  } catch (error) {
    feedback.value = error instanceof Error ? error.message : "Unable to load brand studio.";
  } finally {
    isLoading.value = false;
  }
}

async function saveBrandKit(): Promise<void> {
  if (!activeBusinessId.value) {
    return;
  }

  isSavingBrandKit.value = true;
  feedback.value = "";

  try {
    const response = await requestUpdateBrandKit({
      businessId: activeBusinessId.value,
      brandKit: buildBrandKitPayload(),
    });
    applyBrandKit(response.brandKit);
    feedback.value = "Brand system saved. New assets will use the updated rules.";
  } catch (error) {
    feedback.value = error instanceof Error ? error.message : "Unable to save brand kit.";
  } finally {
    isSavingBrandKit.value = false;
  }
}

function useAsReference(generation: BrandStudioGeneration): void {
  generatorForm.matchPreviousStyle = true;
  generatorForm.referenceGenerationId = generation.metadata?.historyPersisted === false ? "" : generation.id;
  latestGeneration.value = generation;
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, payload] = dataUrl.split(",", 2);
  const mimeMatch = header.match(/^data:([^;]+);base64$/);
  const mimeType = mimeMatch?.[1] ?? "application/octet-stream";
  const binary = atob(payload ?? "");
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], { type: mimeType });
}

function sanitizeFilenameFragment(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "asset";
}

function downloadGeneration(generation: BrandStudioGeneration): void {
  if (typeof window === "undefined") {
    return;
  }

  const blob = dataUrlToBlob(generation.asset.downloadUrl);
  const objectUrl = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  const extension = generation.asset.mimeType.includes("png")
    ? "png"
    : generation.asset.mimeType.includes("jpeg") || generation.asset.mimeType.includes("jpg")
      ? "jpg"
      : generation.asset.mimeType.includes("svg")
        ? "svg"
        : "png";

  link.href = objectUrl;
  link.download = `${generation.title.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "brand-asset"}.${extension}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(objectUrl);
}

function openGenerationPreview(generation: BrandStudioGeneration): void {
  latestGeneration.value = generation;
}

function formatIconSliceLabel(label: string | undefined, index: number): string {
  const normalized = label?.trim();

  if (!normalized) {
    return `Icon ${index + 1}`;
  }

  return normalized;
}

function loadImageElement(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Unable to load icon set image."));
    image.src = source;
  });
}

async function buildIconSetSlices(generation: BrandStudioGeneration): Promise<IconSetSlicePreview[]> {
  const image = await loadImageElement(generation.asset.previewUrl);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const cellWidth = width / 2;
  const cellHeight = height / 2;
  const paddingX = Math.round(cellWidth * 0.14);
  const paddingY = Math.round(cellHeight * 0.14);
  const mimeType = generation.asset.mimeType.includes("jpeg") ? "image/jpeg" : "image/png";

  return Array.from({ length: 4 }, (_, index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const sourceX = Math.max(0, Math.round(column * cellWidth + paddingX));
    const sourceY = Math.max(0, Math.round(row * cellHeight + paddingY));
    const sourceWidth = Math.max(1, Math.round(cellWidth - paddingX * 2));
    const sourceHeight = Math.max(1, Math.round(cellHeight - paddingY * 2));
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    canvas.width = sourceWidth;
    canvas.height = sourceHeight;
    context?.drawImage(
      image,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      sourceWidth,
      sourceHeight,
    );

    return {
      index,
      label: formatIconSliceLabel(generation.iconLabels[index], index),
      previewUrl: canvas.toDataURL(mimeType),
    };
  });
}

async function refreshIconSetSlices(generation: BrandStudioGeneration | null): Promise<void> {
  const requestId = ++iconSetSliceRequestId;

  if (!generation || generation.assetKind !== "icon_set") {
    iconSetSlices.value = [];
    return;
  }

  try {
    const slices = await buildIconSetSlices(generation);

    if (requestId !== iconSetSliceRequestId) {
      return;
    }

    iconSetSlices.value = slices;
  } catch {
    if (requestId === iconSetSliceRequestId) {
      iconSetSlices.value = [];
    }
  }
}

function downloadIconSetSlice(generation: BrandStudioGeneration, slice: IconSetSlicePreview): void {
  if (typeof window === "undefined") {
    return;
  }

  const blob = dataUrlToBlob(slice.previewUrl);
  const objectUrl = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  const extension = generation.asset.mimeType.includes("jpeg") || generation.asset.mimeType.includes("jpg")
    ? "jpg"
    : generation.asset.mimeType.includes("svg")
      ? "svg"
      : "png";

  link.href = objectUrl;
  link.download = `${sanitizeFilenameFragment(generation.title)}-${sanitizeFilenameFragment(slice.label)}.${extension}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(objectUrl);
}

async function generateAsset(): Promise<void> {
  if (!activeBusinessId.value) {
    return;
  }

  isGenerating.value = true;
  feedback.value = "";

  try {
    const fallbackReferenceId =
      generatorForm.matchPreviousStyle && !generatorForm.referenceGenerationId
        ? history.value[0]?.id
        : generatorForm.referenceGenerationId;
    const response = await requestGenerateBrandStudioAsset({
      businessId: activeBusinessId.value,
      assetType: toApiAssetType(generatorForm.assetKind),
      goal: generatorForm.goal,
      context: generatorForm.context,
      layout: generatorForm.layout,
      extraInstructions: generatorForm.extraInstructions,
      iconLabels: generatorForm.assetKind === "icon_set"
        ? splitCommaList(generatorForm.iconLabels)
        : undefined,
      brandKit: buildBrandKitPayload(),
      referenceGenerationId: fallbackReferenceId || undefined,
      matchPreviousStyle: generatorForm.matchPreviousStyle,
    });

    latestGeneration.value = response.generation;
    history.value = [response.generation, ...history.value.filter((item) => item.id !== response.generation.id)]
      .slice(0, 8);
    if (generatorForm.matchPreviousStyle && response.generation.metadata?.historyPersisted !== false) {
      generatorForm.referenceGenerationId = response.generation.id;
    }
    feedback.value = response.generation.metadata?.historyPersisted === false
      ? "Brand asset generated in compatibility mode. Preview and download work now; saved history will resume after the backend deploy."
      : "Brand asset generated and added to version history.";
  } catch (error) {
    feedback.value = error instanceof Error ? error.message : "Unable to generate asset.";
  } finally {
    isGenerating.value = false;
  }
}

watch(
  () => latestGeneration.value,
  (generation) => {
    void refreshIconSetSlices(generation);
  },
  { immediate: true },
);

watch(
  () => generatorForm.assetKind,
  (nextAssetKind, previousAssetKind) => {
    if (isApplyingGeneratorDraft) {
      return;
    }

    if (previousAssetKind && previousAssetKind !== nextAssetKind) {
      generatorDrafts[previousAssetKind] = captureCurrentGeneratorDraft();
    }

    applyGeneratorDraft(nextAssetKind);
    persistGeneratorDrafts();
  },
);

watch(
  () => [
    generatorForm.goal,
    generatorForm.context,
    generatorForm.layout,
    generatorForm.extraInstructions,
    generatorForm.iconLabels,
    generatorForm.matchPreviousStyle,
    generatorForm.referenceGenerationId,
  ],
  () => {
    if (isApplyingGeneratorDraft) {
      return;
    }

    generatorDrafts[generatorForm.assetKind] = captureCurrentGeneratorDraft();
    persistGeneratorDrafts();
  },
);

watch(
  () => activeBusinessId.value,
  () => {
    history.value = [];
    latestGeneration.value = null;
    void loadStudio();
  },
  { immediate: true },
);
</script>

<template>
  <main class="brand-studio-page">
    <section class="studio-hero">
      <div class="studio-copy">
        <p class="page-eyebrow">Brand Studio</p>
        <h1>Turn your brand kit into repeatable website assets.</h1>
        <p class="page-subtitle">
          Save the brand rules once, then generate hero visuals, icon systems, section art, and social creatives
          that stay visually consistent.
        </p>
      </div>

      <div class="template-strip">
        <article v-for="template in templateCards" :key="template.label" class="template-card">
          <p class="template-label">{{ template.label }}</p>
          <p class="template-details">{{ template.details }}</p>
        </article>
      </div>
    </section>

    <p v-if="feedback" class="studio-feedback">{{ feedback }}</p>
    <p v-else-if="isLoading" class="studio-feedback muted">Loading brand studio…</p>

    <section v-if="activeBusinessId" class="studio-grid">
      <article class="studio-panel">
        <header class="panel-header">
          <div>
            <p class="panel-eyebrow">Brand Engine</p>
            <h2>Brand settings</h2>
          </div>
          <button type="button" class="primary-button" :disabled="isSavingBrandKit" @click="saveBrandKit">
            {{ isSavingBrandKit ? "Saving…" : "Save Brand Rules" }}
          </button>
        </header>

        <div class="form-grid">
          <label class="field">
            <span>Brand name</span>
            <input v-model="brandForm.brandName" type="text" placeholder="Daycare Spots" />
          </label>

          <label class="field">
            <span>Industry</span>
            <input v-model="brandForm.industry" type="text" list="industry-options" placeholder="daycare" />
            <datalist id="industry-options">
              <option value="daycare" />
              <option value="salon" />
              <option value="fitness" />
              <option value="restaurant" />
            </datalist>
          </label>

          <label class="field field-wide">
            <span>Style</span>
            <input
              v-model="brandForm.style"
              type="text"
              placeholder="modern, soft, minimal"
            />
          </label>

          <label class="field">
            <span>Primary color</span>
            <input v-model="brandForm.primaryColor" type="text" placeholder="#FF7A00" />
          </label>

          <label class="field">
            <span>Secondary color</span>
            <input v-model="brandForm.secondaryColor" type="text" placeholder="#1F3C88" />
          </label>

          <label class="field">
            <span>Tone</span>
            <select v-model="brandForm.tone">
              <option value="professional">Professional</option>
              <option value="friendly">Friendly</option>
              <option value="bold">Bold</option>
            </select>
          </label>

          <label class="field">
            <span>Tone keywords</span>
            <input
              v-model="brandForm.toneKeywords"
              type="text"
              placeholder="friendly, trustworthy, family"
            />
          </label>

          <label class="field">
            <span>Font family</span>
            <input v-model="brandForm.fontFamily" type="text" placeholder="Manrope" />
          </label>

          <label class="field">
            <span>Icon style</span>
            <input v-model="brandForm.iconStyle" type="text" placeholder="rounded, soft, friendly" />
          </label>

          <label class="field">
            <span>Visual style</span>
            <select v-model="brandForm.visualStyle">
              <option value="minimal">Minimal</option>
              <option value="playful">Playful</option>
              <option value="luxury">Luxury</option>
            </select>
          </label>

          <label class="field">
            <span>Background style</span>
            <select v-model="brandForm.backgroundStyle">
              <option value="dark">Dark</option>
              <option value="light">Light</option>
              <option value="gradient">Gradient</option>
            </select>
          </label>

          <label class="field">
            <span>Font direction</span>
            <select v-model="brandForm.fontStyle">
              <option value="modern">Modern</option>
              <option value="bold">Bold</option>
              <option value="elegant">Elegant</option>
            </select>
          </label>

          <label class="field">
            <span>Accent style</span>
            <select v-model="brandForm.accentStyle">
              <option value="underline">Underline</option>
              <option value="highlight_box">Soft highlight</option>
              <option value="bold">Bold emphasis</option>
            </select>
          </label>

          <label class="field">
            <span>Brand placement</span>
            <select v-model="brandForm.brandPlacement">
              <option value="top_left">Top left</option>
              <option value="bottom_right">Bottom right</option>
              <option value="side_label">Side label</option>
            </select>
          </label>

          <label class="field">
            <span>Website URL</span>
            <input v-model="brandForm.websiteUrl" type="text" placeholder="https://www.daycarespots.com" />
          </label>

          <label class="field">
            <span>Logo URL</span>
            <input v-model="brandForm.logoUrl" type="text" placeholder="https://…" />
          </label>

          <label class="field field-wide">
            <span>Business description</span>
            <textarea
              v-model="brandForm.businessDescription"
              rows="3"
              placeholder="Marketplace helping families find trusted daycare locations."
            />
          </label>

          <label class="field field-wide">
            <span>Image guidelines</span>
            <textarea
              v-model="brandForm.imageGuidelines"
              rows="3"
              placeholder="Use welcoming daycare environments, avoid clutter, and keep composition website-ready."
            />
          </label>
        </div>

        <section v-if="brandKit" class="saved-guidelines">
          <div class="saved-guidelines-header">
            <div>
              <p class="panel-eyebrow">Live Brand Rules</p>
              <h3>Saved guidelines powering new assets</h3>
            </div>
            <p class="saved-guidelines-meta">Updated {{ formatRelativeDate(brandKit.updatedAt) }}</p>
          </div>

          <div class="saved-color-row">
            <div class="saved-color-card">
              <span class="saved-color-swatch" :style="{ background: brandKit.primaryColor }" />
              <div>
                <p class="saved-guideline-label">Primary color</p>
                <p class="saved-guideline-value">{{ brandKit.primaryColor }}</p>
              </div>
            </div>
            <div class="saved-color-card">
              <span class="saved-color-swatch" :style="{ background: brandKit.secondaryColor }" />
              <div>
                <p class="saved-guideline-label">Secondary color</p>
                <p class="saved-guideline-value">{{ brandKit.secondaryColor }}</p>
              </div>
            </div>
          </div>

          <div class="saved-guideline-chip-row">
            <span v-for="chip in savedBrandRuleChips" :key="chip" class="saved-guideline-chip">
              {{ chip }}
            </span>
          </div>

          <div class="saved-guideline-grid">
            <div class="saved-guideline-block">
              <p class="saved-guideline-label">Style direction</p>
              <p class="saved-guideline-value">{{ brandKit.style || "Not set yet" }}</p>
            </div>

            <div class="saved-guideline-block">
              <p class="saved-guideline-label">Tone keywords</p>
              <p class="saved-guideline-value">
                {{ brandKit.toneKeywords.length > 0 ? brandKit.toneKeywords.join(", ") : "Not set yet" }}
              </p>
            </div>

            <div class="saved-guideline-block">
              <p class="saved-guideline-label">Business description</p>
              <p class="saved-guideline-value">{{ brandKit.businessDescription || "Not set yet" }}</p>
            </div>

            <div class="saved-guideline-block">
              <p class="saved-guideline-label">Image guidelines</p>
              <p class="saved-guideline-value">{{ brandKit.imageGuidelines || "Not set yet" }}</p>
            </div>

            <div class="saved-guideline-block">
              <p class="saved-guideline-label">Website</p>
              <a
                v-if="isExternalUrl(brandKit.websiteUrl)"
                class="saved-guideline-link"
                :href="brandKit.websiteUrl"
                target="_blank"
                rel="noreferrer"
              >
                {{ brandKit.websiteUrl }}
              </a>
              <p v-else class="saved-guideline-value">{{ brandKit.websiteUrl || "Not set yet" }}</p>
            </div>

            <div class="saved-guideline-block">
              <p class="saved-guideline-label">Logo</p>
              <a
                v-if="isExternalUrl(brandKit.logoUrl)"
                class="saved-guideline-link"
                :href="brandKit.logoUrl"
                target="_blank"
                rel="noreferrer"
              >
                View saved logo
              </a>
              <p v-else class="saved-guideline-value">
                {{ brandKit.logoUrl ? "Logo asset connected" : "Not set yet" }}
              </p>
            </div>
          </div>
        </section>
      </article>

      <article class="studio-panel">
        <header class="panel-header">
          <div>
            <p class="panel-eyebrow">Asset Generator</p>
            <h2>Generate branded visuals</h2>
          </div>
          <button type="button" class="primary-button" :disabled="isGenerating || !canGenerate" @click="generateAsset">
            {{ isGenerating ? "Generating…" : "Generate Asset" }}
          </button>
        </header>

        <div class="asset-kind-grid">
          <button
            v-for="option in assetKindOptions"
            :key="option.value"
            type="button"
            class="asset-kind-card"
            :class="{ active: generatorForm.assetKind === option.value }"
            @click="generatorForm.assetKind = option.value"
          >
            <strong>{{ option.label }}</strong>
            <span>{{ option.description }}</span>
          </button>
        </div>

        <p class="draft-note">
          Prompts are remembered per asset type for this workspace, so switching between Hero, Icon Set, and other
          formats keeps your draft instead of wiping it.
        </p>

        <div class="form-grid">
          <label class="field field-wide">
            <span>Goal</span>
            <textarea
              v-model="generatorForm.goal"
              rows="2"
              placeholder="Generate homepage visuals for my daycare brand."
            />
          </label>

          <label class="field field-wide">
            <span>Context</span>
            <textarea
              v-model="generatorForm.context"
              rows="2"
              placeholder="Use this for the franchise and multi-center daycare landing page."
            />
          </label>

          <label class="field field-wide">
            <span>Layout direction</span>
            <input
              v-model="generatorForm.layout"
              type="text"
              placeholder="Hero section with clean text overlay space on the left"
            />
          </label>

          <label v-if="generatorForm.assetKind === 'icon_set'" class="field field-wide">
            <span>Icon subjects</span>
            <input
              v-model="generatorForm.iconLabels"
              type="text"
              placeholder="Choose plan, Add location, Manage listings, Grow business"
            />
          </label>

          <label class="field field-wide">
            <span>Extra instructions</span>
            <textarea
              v-model="generatorForm.extraInstructions"
              rows="3"
              placeholder="Keep the style clean and premium. No text baked into the image."
            />
          </label>
        </div>

        <div class="consistency-row">
          <label class="toggle">
            <input v-model="generatorForm.matchPreviousStyle" type="checkbox" />
            <span>Regenerate with consistency</span>
          </label>

          <select
            v-model="generatorForm.referenceGenerationId"
            :disabled="!generatorForm.matchPreviousStyle || referenceOptions.length === 0"
          >
            <option value="">
              {{ referenceOptions.length === 0 ? "No previous assets yet" : "Use most recent asset" }}
            </option>
            <option v-for="option in referenceOptions" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
        </div>
      </article>
    </section>

    <section v-if="!activeBusinessId" class="empty-state">
      <h2>Select a workspace</h2>
      <p>Brand Studio needs an active workspace so it can load the brand kit and generation history.</p>
    </section>

    <section v-if="latestGeneration" class="studio-results">
      <article class="studio-panel preview-panel">
        <header class="panel-header">
          <div>
            <p class="panel-eyebrow">Preview</p>
            <h2>{{ latestGeneration.title }}</h2>
          </div>
          <div class="panel-actions">
            <button type="button" class="secondary-button" @click="useAsReference(latestGeneration)">
              Match This Style
            </button>
            <button type="button" class="primary-button" @click="downloadGeneration(latestGeneration)">
              Download
            </button>
          </div>
        </header>

        <div class="preview-layout">
          <img
            class="preview-image"
            :src="latestGeneration.asset.previewUrl"
            :alt="latestGeneration.title"
          />

          <div class="preview-details">
            <div class="detail-chips">
              <span class="chip">{{ latestGeneration.assetKind.replace(/_/g, " ") }}</span>
              <span class="chip">{{ latestGeneration.templateKey }}</span>
              <span class="chip">{{ latestGeneration.consistencyMode.replace(/_/g, " ") }}</span>
            </div>

            <p class="detail-label">Prompt</p>
            <p class="detail-text">{{ latestGeneration.prompt }}</p>

            <p class="detail-label">Generated</p>
            <p class="detail-text">{{ formatRelativeDate(latestGeneration.createdAt) }}</p>
          </div>
        </div>

        <section v-if="latestGeneration.assetKind === 'icon_set' && iconSetSlices.length > 0" class="icon-slice-section">
          <p class="detail-label">Individual icons</p>
          <div class="icon-slice-grid">
            <article v-for="slice in iconSetSlices" :key="slice.index" class="icon-slice-card">
              <div class="icon-slice-frame">
                <img :src="slice.previewUrl" :alt="slice.label" class="icon-slice-image" />
              </div>
              <div class="icon-slice-meta">
                <strong>{{ slice.label }}</strong>
                <button
                  type="button"
                  class="secondary-button compact"
                  @click="downloadIconSetSlice(latestGeneration, slice)"
                >
                  Download Icon
                </button>
              </div>
            </article>
          </div>
        </section>
      </article>
    </section>

    <section class="studio-history">
      <div class="history-header">
        <div>
          <p class="panel-eyebrow">Version History</p>
          <h2>Recent brand assets</h2>
        </div>
      </div>

      <div v-if="history.length === 0 && !isLoading" class="empty-history">
        Your generated brand assets will appear here with previews and reusable style references.
      </div>

      <div v-else class="history-grid">
        <article v-for="generation in history" :key="generation.id" class="history-card">
          <img class="history-image" :src="generation.asset.previewUrl" :alt="generation.title" />
          <div class="history-body">
            <div class="history-topline">
              <strong>{{ generation.title }}</strong>
              <span>{{ formatRelativeDate(generation.createdAt) }}</span>
            </div>
            <p>{{ generation.assetKind.replace(/_/g, " ") }} · {{ generation.templateKey }}</p>
            <div class="history-actions">
              <button type="button" class="secondary-button compact" @click="openGenerationPreview(generation)">
                Preview
              </button>
              <button type="button" class="secondary-button compact" @click="useAsReference(generation)">
                Match Style
              </button>
              <button type="button" class="secondary-button compact" @click="downloadGeneration(generation)">
                Download
              </button>
            </div>
          </div>
        </article>
      </div>
    </section>
  </main>
</template>

<style scoped>
.brand-studio-page {
  display: grid;
  gap: 1.5rem;
  padding: 1.5rem;
}

.studio-hero {
  display: grid;
  gap: 1rem;
  padding: 1.5rem;
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 1.5rem;
  background:
    radial-gradient(circle at top left, rgba(255, 122, 0, 0.18), transparent 34%),
    linear-gradient(135deg, #fff7ed 0%, #f8fafc 42%, #eff6ff 100%);
  box-shadow: 0 18px 42px rgba(15, 23, 42, 0.08);
}

.studio-copy h1 {
  margin: 0.35rem 0 0.5rem;
  font-size: clamp(2rem, 3vw, 3rem);
  line-height: 1.05;
  color: #0f172a;
}

.page-eyebrow,
.panel-eyebrow {
  margin: 0;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #f97316;
}

.page-subtitle {
  max-width: 52rem;
  margin: 0;
  color: #334155;
}

.template-strip {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
  gap: 0.9rem;
}

.template-card,
.studio-panel,
.history-card,
.empty-state,
.empty-history {
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 1.25rem;
  background: #ffffff;
  box-shadow: 0 14px 30px rgba(15, 23, 42, 0.06);
}

.template-card {
  padding: 1rem;
}

.template-label {
  margin: 0 0 0.35rem;
  font-weight: 700;
  color: #0f172a;
}

.template-details {
  margin: 0;
  color: #475569;
  font-size: 0.95rem;
}

.studio-feedback {
  margin: 0;
  padding: 0.9rem 1rem;
  border-radius: 1rem;
  background: #fff7ed;
  color: #9a3412;
}

.studio-feedback.muted {
  background: #f8fafc;
  color: #475569;
}

.studio-grid,
.studio-results {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1.5rem;
}

.studio-panel {
  padding: 1.35rem;
}

.panel-header,
.history-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1.25rem;
}

.panel-header h2,
.history-header h2,
.empty-state h2 {
  margin: 0.25rem 0 0;
  color: #0f172a;
}

.panel-actions,
.history-actions {
  display: flex;
  gap: 0.75rem;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
}

.field {
  display: grid;
  gap: 0.4rem;
}

.field span {
  font-size: 0.85rem;
  font-weight: 600;
  color: #334155;
}

.field input,
.field select,
.field textarea,
.consistency-row select {
  width: 100%;
  padding: 0.8rem 0.9rem;
  border: 1px solid rgba(148, 163, 184, 0.45);
  border-radius: 0.9rem;
  background: #fff;
  color: #0f172a;
  font: inherit;
}

.field textarea {
  resize: vertical;
}

.field-wide {
  grid-column: 1 / -1;
}

.asset-kind-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.85rem;
  margin-bottom: 1rem;
}

.draft-note {
  margin: 0 0 1rem;
  color: #475569;
  font-size: 0.92rem;
  line-height: 1.5;
}

.saved-guidelines {
  margin-top: 1.25rem;
  padding: 1.1rem;
  border: 1px solid rgba(249, 115, 22, 0.18);
  border-radius: 1.1rem;
  background: linear-gradient(135deg, rgba(255, 247, 237, 0.95), rgba(248, 250, 252, 0.95));
}

.saved-guidelines-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1rem;
}

.saved-guidelines-header h3 {
  margin: 0.25rem 0 0;
  color: #0f172a;
}

.saved-guidelines-meta {
  margin: 0;
  color: #64748b;
  font-size: 0.9rem;
  white-space: nowrap;
}

.saved-color-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.85rem;
  margin-bottom: 0.85rem;
}

.saved-color-card,
.saved-guideline-block {
  display: grid;
  gap: 0.35rem;
  padding: 0.95rem;
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 0.95rem;
  background: rgba(255, 255, 255, 0.88);
}

.saved-color-card {
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: 0.85rem;
}

.saved-color-swatch {
  width: 2.2rem;
  height: 2.2rem;
  border-radius: 999px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.35);
}

.saved-guideline-label {
  margin: 0;
  color: #64748b;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.saved-guideline-value {
  margin: 0;
  color: #0f172a;
  line-height: 1.5;
}

.saved-guideline-chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  margin-bottom: 0.9rem;
}

.saved-guideline-chip {
  padding: 0.5rem 0.75rem;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid rgba(148, 163, 184, 0.2);
  color: #334155;
  font-size: 0.88rem;
  font-weight: 600;
}

.saved-guideline-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.85rem;
}

.saved-guideline-link {
  color: #1d4ed8;
  text-decoration: none;
  word-break: break-word;
}

.saved-guideline-link:hover {
  text-decoration: underline;
}

.asset-kind-card {
  display: grid;
  gap: 0.3rem;
  padding: 1rem;
  text-align: left;
  border: 1px solid rgba(148, 163, 184, 0.35);
  border-radius: 1rem;
  background: #fff;
  color: #0f172a;
  cursor: pointer;
}

.asset-kind-card span {
  color: #475569;
  font-size: 0.9rem;
}

.asset-kind-card.active {
  border-color: rgba(249, 115, 22, 0.35);
  background: linear-gradient(135deg, rgba(255, 237, 213, 0.72), rgba(239, 246, 255, 0.9));
  box-shadow: inset 0 0 0 1px rgba(249, 115, 22, 0.22);
}

.consistency-row {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-top: 1rem;
}

.consistency-row select {
  flex: 1 1 auto;
}

.toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  color: #0f172a;
  font-weight: 600;
}

.primary-button,
.secondary-button {
  border: none;
  border-radius: 999px;
  padding: 0.78rem 1.1rem;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}

.primary-button {
  background: linear-gradient(135deg, #f97316 0%, #fb923c 100%);
  color: #fff;
  box-shadow: 0 12px 24px rgba(249, 115, 22, 0.28);
}

.secondary-button {
  background: #eff6ff;
  color: #1d4ed8;
}

.secondary-button.compact {
  padding: 0.6rem 0.85rem;
  font-size: 0.9rem;
}

.primary-button:disabled,
.secondary-button:disabled,
.asset-kind-card:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.preview-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(18rem, 0.8fr);
  gap: 1rem;
}

.preview-image,
.history-image {
  width: 100%;
  display: block;
  object-fit: cover;
  border-radius: 1rem;
  background: #f8fafc;
}

.preview-details {
  display: grid;
  align-content: start;
  gap: 0.8rem;
}

.detail-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.chip {
  display: inline-flex;
  align-items: center;
  padding: 0.35rem 0.65rem;
  border-radius: 999px;
  background: #eff6ff;
  color: #1e40af;
  font-size: 0.84rem;
  font-weight: 600;
}

.detail-label {
  margin: 0;
  font-size: 0.8rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #64748b;
}

.detail-text {
  margin: 0;
  color: #334155;
  line-height: 1.55;
}

.icon-slice-section {
  margin-top: 1.1rem;
  display: grid;
  gap: 0.85rem;
}

.icon-slice-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.85rem;
}

.icon-slice-card {
  display: grid;
  gap: 0.75rem;
  padding: 0.9rem;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 1rem;
  background: #f8fafc;
}

.icon-slice-frame {
  display: grid;
  place-items: center;
  min-height: 12rem;
  padding: 1rem;
  border-radius: 0.9rem;
  background: #ffffff;
}

.icon-slice-image {
  width: 100%;
  max-width: 12rem;
  display: block;
  object-fit: contain;
}

.icon-slice-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.studio-history {
  display: grid;
  gap: 1rem;
}

.history-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
  gap: 1rem;
}

.history-card {
  overflow: hidden;
}

.history-body {
  display: grid;
  gap: 0.75rem;
  padding: 1rem;
}

.history-topline {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  color: #0f172a;
}

.history-body p,
.empty-state p,
.empty-history {
  margin: 0;
  color: #475569;
}

.empty-state,
.empty-history {
  padding: 1.4rem;
}

@media (max-width: 1080px) {
  .studio-grid,
  .studio-results,
  .preview-layout {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .brand-studio-page {
    padding: 1rem;
  }

  .form-grid,
  .asset-kind-grid,
  .saved-color-row,
  .saved-guideline-grid,
  .icon-slice-grid {
    grid-template-columns: 1fr;
  }

  .panel-header,
  .history-header,
  .saved-guidelines-header,
  .consistency-row,
  .history-topline,
  .icon-slice-meta,
  .panel-actions,
  .history-actions {
    flex-direction: column;
    align-items: stretch;
  }

  .saved-guidelines-meta {
    white-space: normal;
  }
}
</style>
