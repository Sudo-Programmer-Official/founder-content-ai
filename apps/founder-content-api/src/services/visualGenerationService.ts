import { Buffer } from "node:buffer";
import sharp from "sharp";
import { generateImage } from "../../../../packages/ai-core/src/index.ts";
import { generateNarrative, buildVisualPrompt } from "../../../../packages/content-engine/src/index.ts";
import type {
  ContentNarrative,
  ContentNarrativeSlide,
  ContentNarrativeType,
  GenerateVisualRequest,
  GenerateVisualResponse,
  GeneratedVisualStory,
  GeneratedVisualStoryPanel,
  VisualStoryCharacter,
  VisualStoryMediaType,
  VisualStoryTone,
  VisualPromptContent,
  VisualTemplateType,
} from "../../../../packages/shared-types/index.ts";
import type { QueryResultRow } from "pg";
import type { AuthenticatedPrincipal } from "../middleware/auth.ts";
import { resolveBrandKitForGeneration } from "./brandIntelligence/brandKitService.ts";
import { getGlobalMediaGenerationSettings } from "./adminMediaRegistryService.ts";
import { resolveBrandingPolicy } from "./brandingService.ts";
import { queryDb } from "./db/client.ts";
import { HttpError, toErrorContext } from "../utils/http.ts";
import { logWarn } from "../utils/logger.ts";

interface BusinessVisualContextRow extends QueryResultRow {
  name: string;
  brand_name: string;
  website_url: string | null;
}

interface BusinessVisualContext {
  brandName: string;
  domainLabel?: string;
}

interface VisualSplitContent {
  before: string;
  highlight: string;
  after: string;
}

interface CanvasBounds {
  frameX: number;
  frameY: number;
  frameWidth: number;
  frameHeight: number;
  contentLeft: number;
  contentTop: number;
  contentRight: number;
  contentBottom: number;
  contentWidth: number;
}

interface AccentMarkupResult {
  markup: string;
  endY: number;
}

type BrandSignatureMode = "subtle" | "closing";
type CarouselSlideVisualRole = "hook" | "problem" | "story" | "breakdown" | "takeaway";
type ImageGenerationQuality = "low" | "medium" | "high" | "auto";

interface RuntimeMediaGenerationSettings {
  imageQuality: ImageGenerationQuality;
  techMemePanelCount: 1 | 3 | 5;
  comicStripPanelCount: 1 | 3 | 5;
  cartoonExplainerPanelCount: 1 | 3 | 5;
  founderDoodlePanelCount: 1 | 3 | 5;
  minimalInfographicPanelCount: 1 | 3 | 5;
}

interface CarouselSlideRenderProfile {
  visualRole: CarouselSlideVisualRole;
  eyebrowLabel: string;
  allowDerivedHighlight: boolean;
  suppressHighlight: boolean;
  highlightMode: "none" | "single";
  brandSignatureMode: BrandSignatureMode;
}

interface CarouselSvgLayoutProfile {
  contentStartOffset: number;
  headlineFontSize: number;
  headlineLineHeight: number;
  headlineMaxLineLength: number;
  headlineMaxLines: number;
  accentFontSize: number;
  accentLineHeight: number;
  accentMaxLineLength: number;
  accentMaxLines: number;
  supportFontSize: number;
  supportLineHeight: number;
  supportMaxLineLength: number;
  supportMaxLines: number;
  supportStartGap: number;
  bulletStartGap: number;
  bulletCardHeight: number;
  bulletRowHeight: number;
  bulletFontSize: number;
  bulletOpacityDark: string;
  bulletOpacityLight: string;
}

interface ResolvedBrandSignatureLabel {
  label: string;
  source: "domain" | "brand_name" | "footer" | "watermark" | "fallback";
}

const DEFAULT_RUNTIME_MEDIA_GENERATION_SETTINGS: RuntimeMediaGenerationSettings = {
  imageQuality: "medium",
  techMemePanelCount: 1,
  comicStripPanelCount: 3,
  cartoonExplainerPanelCount: 3,
  founderDoodlePanelCount: 3,
  minimalInfographicPanelCount: 3,
};
let cachedRuntimeMediaGenerationSettings: {
  expiresAt: number;
  value: RuntimeMediaGenerationSettings;
} | null = null;

function normalizeRuntimeImageQuality(value: string | undefined): ImageGenerationQuality {
  return value === "low" || value === "medium" || value === "high" || value === "auto"
    ? value
    : DEFAULT_RUNTIME_MEDIA_GENERATION_SETTINGS.imageQuality;
}

async function resolveRuntimeMediaGenerationSettings(): Promise<RuntimeMediaGenerationSettings> {
  const now = Date.now();

  if (cachedRuntimeMediaGenerationSettings && cachedRuntimeMediaGenerationSettings.expiresAt > now) {
    return cachedRuntimeMediaGenerationSettings.value;
  }

  try {
    const settings = await getGlobalMediaGenerationSettings();
    const value: RuntimeMediaGenerationSettings = {
      imageQuality: settings.imageQuality,
      techMemePanelCount: settings.techMemePanelCount,
      comicStripPanelCount: settings.comicStripPanelCount,
      cartoonExplainerPanelCount: settings.cartoonExplainerPanelCount,
      founderDoodlePanelCount: settings.founderDoodlePanelCount,
      minimalInfographicPanelCount: settings.minimalInfographicPanelCount,
    };

    cachedRuntimeMediaGenerationSettings = {
      value,
      expiresAt: now + 60_000,
    };

    return value;
  } catch (error) {
    logWarn("Unable to load global media generation settings. Falling back to environment defaults.", toErrorContext(error));
    return {
      ...DEFAULT_RUNTIME_MEDIA_GENERATION_SETTINGS,
      imageQuality: normalizeRuntimeImageQuality(process.env.OPENAI_IMAGE_QUALITY),
    };
  }
}

function resolveDefaultVisualStoryPanelCount(
  mediaType: VisualStoryMediaType,
  settings: RuntimeMediaGenerationSettings,
): 1 | 3 | 5 {
  switch (mediaType) {
    case "tech_meme":
      return settings.techMemePanelCount;
    case "comic_strip":
      return settings.comicStripPanelCount;
    case "cartoon_explainer":
      return settings.cartoonExplainerPanelCount;
    case "founder_doodle":
      return settings.founderDoodlePanelCount;
    case "minimal_infographic":
      return settings.minimalInfographicPanelCount;
    case "clean_carousel":
    default:
      return 3;
  }
}

function collapseWhitespace(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function sanitizePhrase(value: string | undefined, maxLength = 72): string {
  const normalized = collapseWhitespace(value)
    .replace(/^[\s"'()[\]]+/, "")
    .replace(/[\s"'()[\].,!?;:]+$/, "")
    .trim();

  if (!normalized) {
    return "";
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  const truncated = normalized.slice(0, maxLength).trim();
  const lastSpaceIndex = truncated.lastIndexOf(" ");
  return lastSpaceIndex >= Math.floor(maxLength * 0.55)
    ? truncated.slice(0, lastSpaceIndex).trim()
    : truncated;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function parseHexColorChannels(value: string): [number, number, number] | null {
  const normalized = value.trim().toUpperCase();

  if (!/^#[0-9A-F]{6}$/.test(normalized)) {
    return null;
  }

  return [
    Number.parseInt(normalized.slice(1, 3), 16),
    Number.parseInt(normalized.slice(3, 5), 16),
    Number.parseInt(normalized.slice(5, 7), 16),
  ];
}

function normalizeChannelForLuminance(value: number): number {
  const channel = value / 255;
  return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function calculateRelativeLuminance(value: string): number {
  const channels = parseHexColorChannels(value);

  if (!channels) {
    return 0;
  }

  const [red, green, blue] = channels.map((channel) => normalizeChannelForLuminance(channel));
  return (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);
}

function calculateContrastRatio(left: string, right: string): number {
  const leftLuminance = calculateRelativeLuminance(left);
  const rightLuminance = calculateRelativeLuminance(right);
  const brightest = Math.max(leftLuminance, rightLuminance);
  const darkest = Math.min(leftLuminance, rightLuminance);

  return (brightest + 0.05) / (darkest + 0.05);
}

function extractHighlightCandidate(value: string): string {
  const normalized = collapseWhitespace(value);

  if (!normalized) {
    return "";
  }

  const preferredPatterns = [
    /\babout\s+(.+)$/i,
    /\bwithout\s+(.+)$/i,
    /\binto\s+(.+)$/i,
    /\bthan\s+(.+)$/i,
    /\bisn't\s+(.+)$/i,
    /\bis not\s+(.+)$/i,
    /\bis\s+(.+)$/i,
    /\bwas\s+(.+)$/i,
  ];

  for (const pattern of preferredPatterns) {
    const match = normalized.match(pattern);
    const candidate = sanitizePhrase(match?.[1], 64);

    if (candidate.split(/\s+/).length >= 2) {
      return candidate;
    }
  }

  const words = normalized.split(/\s+/).filter(Boolean);

  if (words.length <= 4) {
    return sanitizePhrase(normalized, 64);
  }

  for (const size of [4, 3, 2]) {
    const candidate = sanitizePhrase(words.slice(-size).join(" "), 64);

    if (candidate.split(/\s+/).length >= 2) {
      return candidate;
    }
  }

  return sanitizePhrase(normalized, 64);
}

function resolveBrandSignatureLabel(input: {
  content: VisualPromptContent;
  businessContext: BusinessVisualContext | null;
  brandingPolicy: ReturnType<typeof resolveBrandingPolicy>;
}): ResolvedBrandSignatureLabel {
  const footerText = sanitizePhrase(input.content.footerText, 42);

  if (footerText) {
    if (input.businessContext?.domainLabel && footerText === input.businessContext.domainLabel) {
      return {
        label: footerText,
        source: "domain",
      };
    }

    if (input.businessContext?.brandName && footerText === input.businessContext.brandName) {
      return {
        label: footerText,
        source: "brand_name",
      };
    }

    return {
      label: footerText,
      source: "footer",
    };
  }

  if (input.businessContext?.domainLabel) {
    return {
      label: input.businessContext.domainLabel,
      source: "domain",
    };
  }

  if (input.businessContext?.brandName) {
    return {
      label: input.businessContext.brandName,
      source: "brand_name",
    };
  }

  if (input.brandingPolicy.watermarkApplied) {
    return {
      label: input.brandingPolicy.watermarkText,
      source: "watermark",
    };
  }

  return {
    label: "",
    source: "fallback",
  };
}

function normalizeContent(
  content: GenerateVisualRequest["content"],
  defaults?: {
    footerText?: string;
    eyebrowText?: string;
    allowDerivedHighlight?: boolean;
  },
): VisualPromptContent {
  const headline = content.headline?.trim();

  if (!headline) {
    throw new HttpError(400, "bad_request", "content.headline is required.");
  }

  const explicitHighlight = sanitizePhrase(content.highlightText, 64) || undefined;
  const derivedHighlight =
    defaults?.allowDerivedHighlight === false
      ? undefined
      : sanitizePhrase(extractHighlightCandidate(content.headline || content.supportingText || ""), 64) || undefined;

  return {
    headline,
    supportingText: content.supportingText?.trim() || undefined,
    bulletPoints: (content.bulletPoints ?? [])
      .map((point) => point.trim())
      .filter((point) => point.length > 0)
      .slice(0, 3),
    highlightText: explicitHighlight || derivedHighlight,
    eyebrowText:
      sanitizePhrase(content.eyebrowText, 36) ||
      sanitizePhrase(defaults?.eyebrowText, 36) ||
      undefined,
    footerText:
      sanitizePhrase(content.footerText, 42) ||
      sanitizePhrase(defaults?.footerText, 42) ||
      undefined,
    sceneDescription: content.sceneDescription?.trim() || undefined,
    customStylePrompt: sanitizePhrase(content.customStylePrompt, 160) || undefined,
    closingText: sanitizePhrase(content.closingText, 72) || undefined,
  };
}

function escapeSvg(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function loadRemoteBrandLogoBytes(logoUrl: string | undefined): Promise<Buffer | null> {
  if (!logoUrl) {
    return null;
  }

  try {
    const response = await fetch(logoUrl);
    if (!response.ok) {
      return null;
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) {
      return null;
    }

    return Buffer.from(await response.arrayBuffer());
  } catch {
    return null;
  }
}

async function preparePhotoOverlayLogoDataUrl(logoUrl: string | undefined): Promise<string | undefined> {
  const logoBytes = await loadRemoteBrandLogoBytes(logoUrl);

  if (!logoBytes) {
    return undefined;
  }

  try {
    const preparedLogo = await sharp(logoBytes)
      .trim()
      .resize(320, 112, {
        fit: "contain",
        background: {
          r: 0,
          g: 0,
          b: 0,
          alpha: 0,
        },
        withoutEnlargement: true,
      })
      .png()
      .toBuffer();

    return `data:image/png;base64,${preparedLogo.toString("base64")}`;
  } catch {
    return undefined;
  }
}

function wrapSvgText(text: string, maxLineLength: number, maxLines = 4): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    const nextLine = currentLine ? `${currentLine} ${word}` : word;

    if (nextLine.length <= maxLineLength) {
      currentLine = nextLine;
      continue;
    }

    if (currentLine) {
      lines.push(currentLine);
    }

    currentLine = word;

    if (lines.length >= maxLines - 1) {
      break;
    }
  }

  if (currentLine && lines.length < maxLines) {
    lines.push(currentLine);
  }

  return lines.slice(0, maxLines);
}

function estimateTextWidth(text: string, fontSize: number, widthFactor = 0.56): number {
  return Math.max(fontSize * 1.4, Math.round(text.length * fontSize * widthFactor));
}

function buildBackgroundFill(
  backgroundStyle: GenerateVisualResponse["brandKit"]["backgroundStyle"],
  primaryColor: string,
  secondaryColor: string,
): string {
  if (backgroundStyle === "light") {
    return `<rect width="100%" height="100%" fill="#FFF8F1" /><rect width="100%" height="100%" fill="${primaryColor}" opacity="0.08" />`;
  }

  if (backgroundStyle === "gradient") {
    return `
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${primaryColor}" />
          <stop offset="100%" stop-color="${secondaryColor}" />
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#bg)" />
    `;
  }

  return `<rect width="100%" height="100%" fill="${primaryColor}" />`;
}

function resolveTextColor(
  backgroundStyle: GenerateVisualResponse["brandKit"]["backgroundStyle"],
): string {
  return backgroundStyle === "light" ? "#161616" : "#FFF8F1";
}

function resolveAccentColor(
  brandKit: GenerateVisualResponse["brandKit"],
): string {
  return brandKit.secondaryColor;
}

function resolvePreviewBackgrounds(
  brandKit: GenerateVisualResponse["brandKit"],
): string[] {
  if (brandKit.backgroundStyle === "light") {
    return ["#FFF8F1"];
  }

  if (brandKit.backgroundStyle === "gradient") {
    return [brandKit.primaryColor, brandKit.secondaryColor];
  }

  return [brandKit.primaryColor];
}

function formatBrandPlacementLabel(
  brandPlacement: GenerateVisualResponse["brandKit"]["brandPlacement"],
): string {
  if (brandPlacement === "bottom_right") {
    return "bottom-right";
  }

  if (brandPlacement === "side_label") {
    return "side label";
  }

  return "top-left";
}

function resolveBrandPlacementLabelForConsistency(
  templateType: VisualTemplateType,
  brandPlacement: GenerateVisualResponse["brandKit"]["brandPlacement"],
): string {
  if (templateType === "carousel") {
    return "bottom-right footer";
  }

  return formatBrandPlacementLabel(brandPlacement);
}

function isContentTextDense(input: {
  templateType: VisualTemplateType;
  brandKit: GenerateVisualResponse["brandKit"];
  content: VisualPromptContent;
}): boolean {
  const { content, brandKit, templateType } = input;
  const headlineLength = collapseWhitespace(content.headline).length;
  const supportingLength = collapseWhitespace(content.supportingText || content.closingText).length;
  const bulletLoad = (content.bulletPoints ?? [])
    .reduce((sum, point) => sum + collapseWhitespace(point).length, 0);
  const bulletCount = content.bulletPoints?.length ?? 0;
  const narrowLayout = brandKit.brandPlacement === "side_label";

  if (templateType === "quote") {
    return headlineLength > (narrowLayout ? 86 : 104) || supportingLength > 120;
  }

  if (templateType === "contrarian") {
    return headlineLength > (narrowLayout ? 70 : 84) || supportingLength > 90;
  }

  return (
    headlineLength > (narrowLayout ? 60 : 76)
    || supportingLength > (narrowLayout ? 96 : 126)
    || bulletLoad > (narrowLayout ? 90 : 126)
    || (bulletCount >= 3 && supportingLength > 72)
  );
}

function buildBrandConsistencySummary(
  checks: GenerateVisualResponse["brandConsistency"]["checks"],
  tone: GenerateVisualResponse["brandConsistency"]["tone"],
  templateType: VisualTemplateType,
): string {
  if (tone === "strong") {
    return templateType === "carousel"
      ? "Brand system stays consistent across the slide set."
      : "Brand system looks consistent. Contrast, placement, accent, and spacing are aligned.";
  }

  const warnings = checks.filter((check) => check.status === "warn");

  if (warnings.length === 0) {
    return "Review the visual before publishing.";
  }

  if (warnings.length === 1) {
    return `Review ${warnings[0].label.toLowerCase()} before publishing. ${warnings[0].message}`;
  }

  return `Review ${warnings[0].label.toLowerCase()} and ${warnings[1].label.toLowerCase()} before publishing.`;
}

function evaluateBrandConsistency(input: {
  templateType: VisualTemplateType;
  brandKit: GenerateVisualResponse["brandKit"];
  businessContext: BusinessVisualContext | null;
  brandingPolicy: ReturnType<typeof resolveBrandingPolicy>;
  contents: VisualPromptContent[];
}): GenerateVisualResponse["brandConsistency"] {
  const contents = input.contents.filter((content) => collapseWhitespace(content.headline) !== "");
  const referenceContent = contents[0] ?? {
    headline: "Founder insight",
  };
  const textColor = resolveTextColor(input.brandKit.backgroundStyle);
  const contrastRatioValue = Math.min(
    ...resolvePreviewBackgrounds(input.brandKit)
      .map((background) => calculateContrastRatio(background, textColor)),
  );
  const contrastCheck: GenerateVisualResponse["brandConsistency"]["checks"][number] =
    contrastRatioValue >= 7
      ? {
          key: "contrast",
          label: "Contrast",
          status: "pass",
          score: 100,
          message: "Text contrast is strong enough to survive the feed.",
        }
      : contrastRatioValue >= 4.5
        ? {
            key: "contrast",
            label: "Contrast",
            status: "pass",
            score: 86,
            message: "Contrast is acceptable, but there is not much margin for weaker exports.",
          }
        : {
            key: "contrast",
            label: "Contrast",
            status: "warn",
            score: 58,
            message: "Text contrast is too soft for a reliable social preview. Increase separation before reusing this theme.",
          };

  const brandSignature = resolveBrandSignatureLabel({
    content: referenceContent,
    businessContext: input.businessContext,
    brandingPolicy: input.brandingPolicy,
  });
  const placementLabel = resolveBrandPlacementLabelForConsistency(
    input.templateType,
    input.brandKit.brandPlacement,
  );
  const brandVisibilityCheck: GenerateVisualResponse["brandConsistency"]["checks"][number] =
    brandSignature.source === "domain"
      ? {
          key: "brand_visibility",
          label: "Brand visibility",
          status: "pass",
          score: 96,
          message: `Brand signature is edge-locked at the ${placementLabel} and resolves to ${brandSignature.label}.`,
        }
      : brandSignature.source === "brand_name" || brandSignature.source === "footer"
        ? {
            key: "brand_visibility",
            label: "Brand visibility",
            status: "pass",
            score: 88,
            message: `Brand signature is visible at the ${placementLabel} and uses ${brandSignature.label}.`,
          }
        : brandSignature.source === "watermark"
          ? {
              key: "brand_visibility",
              label: "Brand visibility",
              status: "warn",
              score: 68,
              message: "Brand signature falls back to a generic watermark. Connect a workspace domain or brand source for stronger recall.",
            }
          : {
              key: "brand_visibility",
              label: "Brand visibility",
              status: "warn",
              score: 52,
              message: "Brand signature is not resolving cleanly. Add a workspace domain or footer label before publishing.",
            };

  const aggressiveHighlightCount = contents.filter((content) => {
    const highlight = sanitizePhrase(
      content.highlightText || extractHighlightCandidate(content.headline || content.supportingText || ""),
      64,
    );
    const wordCount = highlight ? highlight.split(/\s+/).filter(Boolean).length : 0;

    if (!highlight) {
      return false;
    }

    if (wordCount > 5 || highlight.length > 30) {
      return true;
    }

    if (input.brandKit.accentStyle === "bold" && highlight.length > 22) {
      return true;
    }

    if (input.brandKit.accentStyle === "highlight_box" && highlight.length > 26) {
      return true;
    }

    return false;
  }).length;
  const highlightBalanceCheck: GenerateVisualResponse["brandConsistency"]["checks"][number] =
    aggressiveHighlightCount === 0
      ? {
          key: "highlight_balance",
          label: "Highlight balance",
          status: "pass",
          score: 92,
          message: "Accent phrase length stays controlled and should not overpower the layout.",
        }
      : aggressiveHighlightCount < Math.max(2, contents.length)
        ? {
            key: "highlight_balance",
            label: "Highlight balance",
            status: "warn",
            score: 74,
            message:
              input.templateType === "carousel"
                ? `${aggressiveHighlightCount} slide${aggressiveHighlightCount === 1 ? "" : "s"} carry an accent phrase long enough to overpower the frame.`
                : "The accent phrase is long enough to overpower the layout.",
          }
        : {
            key: "highlight_balance",
            label: "Highlight balance",
            status: "warn",
            score: 62,
            message: "The highlight treatment is too aggressive for the amount of copy on the canvas.",
          };

  const denseContentCount = contents.filter((content) =>
    isContentTextDense({
      templateType: input.templateType,
      brandKit: input.brandKit,
      content,
    }),
  ).length;
  const spacingCheck: GenerateVisualResponse["brandConsistency"]["checks"][number] =
    denseContentCount === 0
      ? {
          key: "spacing",
          label: "Spacing",
          status: "pass",
          score: 94,
          message: "Renderer padding stays aligned and the copy volume fits the frame.",
        }
      : denseContentCount < Math.max(2, contents.length)
        ? {
            key: "spacing",
            label: "Spacing",
            status: "warn",
            score: 76,
            message:
              input.templateType === "carousel"
                ? `${denseContentCount} slide${denseContentCount === 1 ? "" : "s"} are text-heavy enough to crowd the frame.`
                : "The copy volume is heavy enough to crowd the frame.",
          }
        : {
            key: "spacing",
            label: "Spacing",
            status: "warn",
            score: 66,
            message: "The layout is likely to feel crowded even though padding stays aligned.",
          };

  const checks = [
    contrastCheck,
    brandVisibilityCheck,
    highlightBalanceCheck,
    spacingCheck,
  ];
  const overallScore = clampScore(
    checks.reduce((sum, check) => sum + check.score, 0) / checks.length,
  );
  const tone: GenerateVisualResponse["brandConsistency"]["tone"] =
    overallScore >= 80 && checks.every((check) => check.status === "pass")
      ? "strong"
      : "review";

  return {
    overallScore,
    tone,
    summary: buildBrandConsistencySummary(checks, tone, input.templateType),
    checks,
  };
}

function resolveHighlightSurfaceColor(
  brandKit: GenerateVisualResponse["brandKit"],
): string {
  return brandKit.backgroundStyle === "light" ? brandKit.secondaryColor : "#FFF8F1";
}

function resolveHighlightSurfaceTextColor(
  brandKit: GenerateVisualResponse["brandKit"],
): string {
  return brandKit.backgroundStyle === "light" ? "#FFF8F1" : "#101826";
}

function extractDomainLabel(websiteUrl: string | null | undefined): string | undefined {
  const normalized = collapseWhitespace(websiteUrl);

  if (!normalized) {
    return undefined;
  }

  try {
    const url = /^https?:\/\//i.test(normalized) ? new URL(normalized) : new URL(`https://${normalized}`);
    return url.hostname.replace(/^www\./i, "");
  } catch {
    return undefined;
  }
}

async function loadBusinessVisualContext(businessId: string | undefined): Promise<BusinessVisualContext | null> {
  if (!businessId) {
    return null;
  }

  const result = await queryDb<BusinessVisualContextRow>(
    `
      select
        name,
        brand_name,
        website_url
      from businesses
      where id = $1
      limit 1
    `,
    [businessId],
  );
  const row = result.rows[0];

  if (!row) {
    return null;
  }

  return {
    brandName: row.brand_name || row.name,
    domainLabel: extractDomainLabel(row.website_url),
  };
}

function buildBrandMarkLabel(
  businessContext: BusinessVisualContext | null,
  brandingPolicy: ReturnType<typeof resolveBrandingPolicy>,
): string {
  const source = businessContext?.brandName || brandingPolicy.watermarkText;

  return source
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((segment) => segment.charAt(0).toUpperCase())
    .join("") || "FC";
}

function splitTextAroundHighlight(text: string, highlightText: string | undefined): VisualSplitContent {
  const normalizedText = collapseWhitespace(text);
  const highlight = sanitizePhrase(highlightText, 64);

  if (!normalizedText || !highlight) {
    return {
      before: normalizedText,
      highlight,
      after: "",
    };
  }

  const lowerText = normalizedText.toLowerCase();
  const lowerHighlight = highlight.toLowerCase();
  const matchIndex = lowerText.indexOf(lowerHighlight);

  if (matchIndex < 0) {
    return {
      before: normalizedText,
      highlight,
      after: "",
    };
  }

  return {
    before: normalizedText.slice(0, matchIndex).trim(),
    highlight: normalizedText.slice(matchIndex, matchIndex + highlight.length).trim(),
    after: normalizedText.slice(matchIndex + highlight.length).trim(),
  };
}

function resolveCanvasBounds(
  brandKit: GenerateVisualResponse["brandKit"],
): CanvasBounds {
  const contentLeft = 88;
  const contentTop = 88;
  const contentBottom = 936;
  const rightInset = brandKit.brandPlacement === "side_label" ? 184 : 88;
  const contentRight = 1024 - rightInset;

  return {
    frameX: 56,
    frameY: 56,
    frameWidth: 912,
    frameHeight: 912,
    contentLeft,
    contentTop,
    contentRight,
    contentBottom,
    contentWidth: contentRight - contentLeft,
  };
}

function resolveContentStartY(
  brandKit: GenerateVisualResponse["brandKit"],
): number {
  return brandKit.brandPlacement === "top_left" ? 214 : 160;
}

function buildAtmosphereMarkup(
  brandKit: GenerateVisualResponse["brandKit"],
  accentColor: string,
): string {
  if (brandKit.backgroundStyle === "light") {
    return `
      <circle cx="874" cy="164" r="220" fill="${accentColor}" opacity="0.08" />
      <circle cx="164" cy="856" r="180" fill="${brandKit.primaryColor}" opacity="0.05" />
    `;
  }

  return `
    <circle cx="860" cy="170" r="220" fill="${accentColor}" opacity="0.14" />
    <circle cx="188" cy="864" r="190" fill="#FFFFFF" opacity="0.05" />
  `;
}

function buildFrameMarkup(bounds: CanvasBounds, accentColor: string): string {
  return `
    <rect
      x="${bounds.frameX}"
      y="${bounds.frameY}"
      width="${bounds.frameWidth}"
      height="${bounds.frameHeight}"
      rx="42"
      fill="none"
      stroke="${accentColor}"
      stroke-width="2"
      opacity="0.16"
    />
  `;
}

function buildBrandSignatureMarkup(input: {
  brandKit: GenerateVisualResponse["brandKit"];
  bounds: CanvasBounds;
  brandLabel: string;
  brandMarkLabel: string;
  accentColor: string;
  textColor: string;
  signatureMode?: BrandSignatureMode;
}): string {
  const { brandKit, bounds, brandLabel, brandMarkLabel, accentColor, textColor } = input;
  const closingMode = input.signatureMode === "closing";
  const rawLabel =
    sanitizePhrase(
      brandLabel,
      brandKit.brandPlacement === "side_label" ? 24 : 28,
    ) || "FounderContent";
  const safeLabel = escapeSvg(rawLabel);

  if (brandKit.brandPlacement === "bottom_right") {
    const x = bounds.contentRight;
    const y = bounds.contentBottom - 10;
    const lineStartX = x - (closingMode ? 156 : 132);
    const lineEndX = x - 40;
    const fontSize = closingMode ? 28 : 24;
    const opacity = closingMode ? 0.94 : 0.86;
    return `
      <line x1="${lineStartX}" y1="${y - 18}" x2="${lineEndX}" y2="${y - 18}" stroke="${accentColor}" stroke-width="${closingMode ? 5 : 4}" stroke-linecap="round" opacity="${closingMode ? "0.94" : "0.88"}" />
      <text x="${x}" y="${y}" text-anchor="end" font-size="${fontSize}" letter-spacing="1.2" font-family="'Avenir Next', 'Segoe UI', Arial, sans-serif" fill="${textColor}" opacity="${opacity}">${safeLabel}</text>
    `;
  }

  if (brandKit.brandPlacement === "side_label") {
    const railX = 952;
    const railY = 512;
    return `
      <g transform="translate(${railX} ${railY}) rotate(90)">
        <line x1="-${closingMode ? 184 : 168}" y1="-24" x2="-70" y2="-24" stroke="${accentColor}" stroke-width="${closingMode ? 5 : 4}" stroke-linecap="round" opacity="${closingMode ? "0.9" : "0.82"}" />
        <text x="0" y="0" text-anchor="middle" font-size="${closingMode ? 24 : 22}" letter-spacing="6" font-family="'Avenir Next', 'Segoe UI', Arial, sans-serif" fill="${textColor}" opacity="${closingMode ? "0.9" : "0.84"}">${safeLabel}</text>
      </g>
    `;
  }

  const x = bounds.contentLeft;
  const y = bounds.contentTop;
  const markTextColor = brandKit.backgroundStyle === "light" ? "#FFF8F1" : "#121212";
  const markSize = closingMode ? 54 : 48;
  const markRadius = closingMode ? 17 : 15;
  const markCenter = x + markSize / 2;
  const markTextY = y + (closingMode ? 35 : 31);
  const labelFontSize = closingMode ? 18 : 16;
  const labelLineEnd = x + (closingMode ? 198 : 182);

  return `
    <rect x="${x}" y="${y}" width="${markSize}" height="${markSize}" rx="${markRadius}" fill="${accentColor}" />
    <text x="${markCenter}" y="${markTextY}" text-anchor="middle" font-size="${closingMode ? 24 : 22}" font-weight="750" font-family="'Avenir Next', 'Segoe UI', Arial, sans-serif" fill="${markTextColor}">${escapeSvg(brandMarkLabel)}</text>
    <text x="${x + 70}" y="${y + 20}" font-size="${labelFontSize}" letter-spacing="${closingMode ? "3.5" : "3.2"}" font-family="'Avenir Next', 'Segoe UI', Arial, sans-serif" fill="${accentColor}" opacity="${closingMode ? "0.96" : "0.92"}">${escapeSvg(rawLabel.toUpperCase())}</text>
    <line x1="${x + 70}" y1="${y + 34}" x2="${labelLineEnd}" y2="${y + 34}" stroke="${accentColor}" stroke-width="${closingMode ? 5 : 4}" stroke-linecap="round" opacity="${closingMode ? "0.88" : "0.78"}" />
  `;
}

function buildCarouselFooterBrandingMarkup(input: {
  bounds: CanvasBounds;
  brandLabel: string;
  accentColor: string;
  textColor: string;
  backgroundStyle: GenerateVisualResponse["brandKit"]["backgroundStyle"];
  signatureMode?: BrandSignatureMode;
}): string {
  const closingMode = input.signatureMode === "closing";
  const rawLabel = sanitizePhrase(input.brandLabel, closingMode ? 34 : 30) || "Founder Content";
  const safeLabel = escapeSvg(rawLabel);
  const fontSize = closingMode ? 24 : 18;
  const baselineY = input.bounds.frameY + input.bounds.frameHeight - (closingMode ? 24 : 26);
  const textX = input.bounds.frameX + input.bounds.frameWidth - 34;
  const estimatedLabelWidth = estimateTextWidth(rawLabel, fontSize, 0.46);
  const lineEndX = textX - estimatedLabelWidth - 16;
  const lineStartX = lineEndX - (closingMode ? 74 : 48);
  const fill = closingMode ? input.accentColor : input.textColor;
  const textOpacity =
    closingMode
      ? "0.94"
      : input.backgroundStyle === "light"
        ? "0.54"
        : "0.48";
  const lineOpacity =
    closingMode
      ? "0.74"
      : input.backgroundStyle === "light"
        ? "0.18"
        : "0.22";

  return `
    <line x1="${lineStartX}" y1="${baselineY - 12}" x2="${lineEndX}" y2="${baselineY - 12}" stroke="${closingMode ? input.accentColor : input.textColor}" stroke-width="${closingMode ? 4 : 2}" stroke-linecap="round" opacity="${lineOpacity}" />
    <text x="${textX}" y="${baselineY}" text-anchor="end" font-size="${fontSize}" letter-spacing="${closingMode ? "0.8" : "0.5"}" font-family="'Avenir Next', 'Segoe UI', Arial, sans-serif" fill="${fill}" opacity="${textOpacity}">${safeLabel}</text>
  `;
}

function resolveCarouselSlideVisualRole(
  slide: ContentNarrativeSlide,
  index: number,
  totalSlides: number,
): CarouselSlideVisualRole {
  const role = collapseWhitespace(typeof slide.role === "string" ? slide.role : "").toLowerCase();
  const bulletCount = slide.bulletPoints?.filter(Boolean).length ?? 0;

  if (index === 0 || role === "hook") {
    return "hook";
  }

  if (index === totalSlides - 1 || /^(cta|takeaway)$/i.test(role)) {
    return "takeaway";
  }

  if (/^(pattern_break|challenge|insight|reframe|problem)$/i.test(role)) {
    return "problem";
  }

  if (/^(lesson|belief|story)$/i.test(role)) {
    return "story";
  }

  if (/^(proof|step_1|step_2|step_3|breakdown)$/i.test(role) || bulletCount > 0) {
    return "breakdown";
  }

  return index <= 1 ? "problem" : bulletCount > 0 ? "breakdown" : "story";
}

function resolveCarouselSlideRenderProfile(
  slide: ContentNarrativeSlide,
  index: number,
  totalSlides: number,
): CarouselSlideRenderProfile {
  const visualRole = resolveCarouselSlideVisualRole(slide, index, totalSlides);

  switch (visualRole) {
    case "hook":
      return {
        visualRole,
        eyebrowLabel: "HOOK",
        allowDerivedHighlight: true,
        suppressHighlight: false,
        highlightMode: "single",
        brandSignatureMode: index === totalSlides - 1 ? "closing" : "subtle",
      };
    case "problem":
      return {
        visualRole,
        eyebrowLabel: "PROBLEM",
        allowDerivedHighlight: false,
        suppressHighlight: false,
        highlightMode: "single",
        brandSignatureMode: index === totalSlides - 1 ? "closing" : "subtle",
      };
    case "story":
      return {
        visualRole,
        eyebrowLabel: "STORY",
        allowDerivedHighlight: false,
        suppressHighlight: true,
        highlightMode: "none",
        brandSignatureMode: index === totalSlides - 1 ? "closing" : "subtle",
      };
    case "breakdown":
      return {
        visualRole,
        eyebrowLabel: "BREAKDOWN",
        allowDerivedHighlight: false,
        suppressHighlight: false,
        highlightMode: "single",
        brandSignatureMode: index === totalSlides - 1 ? "closing" : "subtle",
      };
    case "takeaway":
    default:
      return {
        visualRole: "takeaway",
        eyebrowLabel: "TAKEAWAY",
        allowDerivedHighlight: true,
        suppressHighlight: false,
        highlightMode: "single",
        brandSignatureMode: index === totalSlides - 1 ? "closing" : "subtle",
      };
  }
}

function resolveCarouselSvgLayoutProfile(visualRole: CarouselSlideVisualRole): CarouselSvgLayoutProfile {
  switch (visualRole) {
    case "hook":
      return {
        contentStartOffset: 18,
        headlineFontSize: 94,
        headlineLineHeight: 100,
        headlineMaxLineLength: 12,
        headlineMaxLines: 3,
        accentFontSize: 34,
        accentLineHeight: 50,
        accentMaxLineLength: 18,
        accentMaxLines: 1,
        supportFontSize: 30,
        supportLineHeight: 38,
        supportMaxLineLength: 20,
        supportMaxLines: 1,
        supportStartGap: 44,
        bulletStartGap: 40,
        bulletCardHeight: 74,
        bulletRowHeight: 88,
        bulletFontSize: 28,
        bulletOpacityDark: "0.08",
        bulletOpacityLight: "0.54",
      };
    case "problem":
      return {
        contentStartOffset: 22,
        headlineFontSize: 88,
        headlineLineHeight: 94,
        headlineMaxLineLength: 12,
        headlineMaxLines: 4,
        accentFontSize: 30,
        accentLineHeight: 46,
        accentMaxLineLength: 18,
        accentMaxLines: 1,
        supportFontSize: 30,
        supportLineHeight: 40,
        supportMaxLineLength: 20,
        supportMaxLines: 2,
        supportStartGap: 44,
        bulletStartGap: 42,
        bulletCardHeight: 74,
        bulletRowHeight: 88,
        bulletFontSize: 28,
        bulletOpacityDark: "0.08",
        bulletOpacityLight: "0.54",
      };
    case "story":
      return {
        contentStartOffset: 54,
        headlineFontSize: 70,
        headlineLineHeight: 80,
        headlineMaxLineLength: 16,
        headlineMaxLines: 5,
        accentFontSize: 0,
        accentLineHeight: 0,
        accentMaxLineLength: 0,
        accentMaxLines: 0,
        supportFontSize: 30,
        supportLineHeight: 44,
        supportMaxLineLength: 22,
        supportMaxLines: 4,
        supportStartGap: 56,
        bulletStartGap: 48,
        bulletCardHeight: 74,
        bulletRowHeight: 88,
        bulletFontSize: 28,
        bulletOpacityDark: "0.08",
        bulletOpacityLight: "0.54",
      };
    case "takeaway":
      return {
        contentStartOffset: 26,
        headlineFontSize: 82,
        headlineLineHeight: 88,
        headlineMaxLineLength: 12,
        headlineMaxLines: 3,
        accentFontSize: 32,
        accentLineHeight: 48,
        accentMaxLineLength: 18,
        accentMaxLines: 1,
        supportFontSize: 30,
        supportLineHeight: 42,
        supportMaxLineLength: 20,
        supportMaxLines: 2,
        supportStartGap: 46,
        bulletStartGap: 42,
        bulletCardHeight: 74,
        bulletRowHeight: 88,
        bulletFontSize: 28,
        bulletOpacityDark: "0.08",
        bulletOpacityLight: "0.54",
      };
    case "breakdown":
    default:
      return {
        contentStartOffset: 28,
        headlineFontSize: 74,
        headlineLineHeight: 82,
        headlineMaxLineLength: 14,
        headlineMaxLines: 3,
        accentFontSize: 28,
        accentLineHeight: 44,
        accentMaxLineLength: 18,
        accentMaxLines: 1,
        supportFontSize: 28,
        supportLineHeight: 38,
        supportMaxLineLength: 20,
        supportMaxLines: 2,
        supportStartGap: 40,
        bulletStartGap: 44,
        bulletCardHeight: 78,
        bulletRowHeight: 92,
        bulletFontSize: 30,
        bulletOpacityDark: "0.12",
        bulletOpacityLight: "0.6",
      };
  }
}

function buildAccentPhraseMarkup(input: {
  lines: string[];
  brandKit: GenerateVisualResponse["brandKit"];
  x: number;
  startY: number;
  fontSize: number;
  lineHeight: number;
  maxWidth: number;
  textColor: string;
  accentColor: string;
}): AccentMarkupResult {
  const { lines, brandKit, x, startY, fontSize, lineHeight, maxWidth, textColor, accentColor } = input;
  const surfaceFill = resolveHighlightSurfaceColor(brandKit);
  const surfaceTextColor = resolveHighlightSurfaceTextColor(brandKit);
  let markup = "";
  let currentY = startY;

  for (const line of lines) {
    const width = Math.min(maxWidth, estimateTextWidth(line, fontSize, 0.6) + 48);

    if (brandKit.accentStyle === "highlight_box") {
      markup += `
        <rect x="${x}" y="${currentY - fontSize + 16}" width="${width}" height="${fontSize + 34}" rx="22" fill="${surfaceFill}" />
        <text x="${x + 24}" y="${currentY + 6}" font-size="${fontSize}" font-weight="820" font-family="'Arial Black', 'Avenir Next', Arial, sans-serif" fill="${surfaceTextColor}">${escapeSvg(line)}</text>
      `;
      currentY += lineHeight;
      continue;
    }

    if (brandKit.accentStyle === "underline") {
      markup += `
        <text x="${x}" y="${currentY}" font-size="${fontSize}" font-weight="760" font-family="'Avenir Next', 'Segoe UI', Arial, sans-serif" fill="${textColor}">${escapeSvg(line)}</text>
        <line x1="${x}" y1="${currentY + 18}" x2="${x + width - 28}" y2="${currentY + 18}" stroke="${accentColor}" stroke-width="8" stroke-linecap="round" opacity="0.92" />
      `;
      currentY += lineHeight;
      continue;
    }

    markup += `
      <text x="${x}" y="${currentY}" font-size="${fontSize + 6}" font-weight="840" font-family="'Arial Black', 'Avenir Next', Arial, sans-serif" fill="${accentColor}">${escapeSvg(line)}</text>
    `;
    currentY += lineHeight;
  }

  return {
    markup,
    endY: currentY,
  };
}

function buildQuoteFallbackSvg(
  content: VisualPromptContent,
  brandKit: GenerateVisualResponse["brandKit"],
  brandMarkLabel: string,
): string {
  const bounds = resolveCanvasBounds(brandKit);
  const textColor = resolveTextColor(brandKit.backgroundStyle);
  const accentColor = resolveAccentColor(brandKit);
  const split = splitTextAroundHighlight(content.headline, content.highlightText);
  const introLines = wrapSvgText(
    split.before || content.headline,
    brandKit.brandPlacement === "side_label" ? 15 : 18,
    3,
  );
  const highlightLines = wrapSvgText(
    split.highlight || content.highlightText || extractHighlightCandidate(content.headline),
    brandKit.brandPlacement === "side_label" ? 10 : 12,
    2,
  );
  const closingLines = wrapSvgText(
    content.closingText || content.supportingText || split.after,
    brandKit.brandPlacement === "side_label" ? 18 : 22,
    3,
  );
  const contentStartY = resolveContentStartY(brandKit);
  const eyebrowText = escapeSvg((content.eyebrowText || "SIGNATURE VISUAL").toUpperCase());
  const introMarkup = introLines
    .map(
      (line, index) =>
        `<text x="${bounds.contentLeft}" y="${contentStartY + index * 76}" font-size="72" font-weight="720" font-family="'Avenir Next', 'Segoe UI', Arial, sans-serif" fill="${textColor}">${escapeSvg(line)}</text>`,
    )
    .join("");
  const highlightMarkup = buildAccentPhraseMarkup({
    lines: highlightLines,
    brandKit,
    x: bounds.contentLeft,
    startY: contentStartY + introLines.length * 76 + 18,
    fontSize: 66,
    lineHeight: 90,
    maxWidth: bounds.contentWidth,
    textColor,
    accentColor,
  });
  const closingStartY = highlightMarkup.endY + 34;
  const closingMarkup = closingLines
    .map(
      (line, index) =>
        `<text x="${bounds.contentLeft}" y="${closingStartY + index * 48}" font-size="36" font-weight="560" font-family="'Avenir Next', 'Segoe UI', Arial, sans-serif" fill="${textColor}" opacity="0.9">${escapeSvg(line)}</text>`,
    )
    .join("");

  return `
    <svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
      ${buildBackgroundFill(brandKit.backgroundStyle, brandKit.primaryColor, brandKit.secondaryColor)}
      ${buildAtmosphereMarkup(brandKit, accentColor)}
      ${buildFrameMarkup(bounds, accentColor)}
      ${buildBrandSignatureMarkup({
        brandKit,
        bounds,
        brandLabel: content.footerText || content.eyebrowText || "FounderContent",
        brandMarkLabel,
        accentColor,
        textColor,
      })}
      <text x="${bounds.contentLeft}" y="${contentStartY - 38}" font-size="18" letter-spacing="4.2" font-family="'Avenir Next', 'Segoe UI', Arial, sans-serif" fill="${accentColor}" opacity="0.92">${eyebrowText}</text>
      ${introMarkup}
      ${highlightMarkup.markup}
      ${closingMarkup}
    </svg>
  `.trim();
}

function buildSplitEmphasisFallbackSvg(
  content: VisualPromptContent,
  brandKit: GenerateVisualResponse["brandKit"],
  brandMarkLabel: string,
): string {
  const bounds = resolveCanvasBounds(brandKit);
  const textColor = resolveTextColor(brandKit.backgroundStyle);
  const accentColor = resolveAccentColor(brandKit);
  const split = splitTextAroundHighlight(content.headline, content.highlightText);
  const contentStartY = resolveContentStartY(brandKit);
  const dividerX = bounds.contentLeft + Math.round(bounds.contentWidth * 0.46);
  const rightX = dividerX + 44;
  const introLines = wrapSvgText(
    split.before || content.headline,
    brandKit.brandPlacement === "side_label" ? 13 : 15,
    5,
  );
  const emphasisLines = wrapSvgText(
    split.highlight || content.highlightText || extractHighlightCandidate(content.headline),
    brandKit.brandPlacement === "side_label" ? 8 : 9,
    3,
  );
  const supportLines = wrapSvgText(
    content.supportingText || split.after || content.closingText || "",
    brandKit.brandPlacement === "side_label" ? 16 : 18,
    3,
  );
  const introMarkup = introLines
    .map(
      (line, index) =>
        `<text x="${bounds.contentLeft}" y="${contentStartY + index * 54}" font-size="44" font-weight="620" font-family="'Avenir Next', 'Segoe UI', Arial, sans-serif" fill="${textColor}" opacity="0.92">${escapeSvg(line)}</text>`,
    )
    .join("");
  const emphasisMarkup = buildAccentPhraseMarkup({
    lines: emphasisLines,
    brandKit,
    x: rightX,
    startY: contentStartY + 82,
    fontSize: 80,
    lineHeight: 100,
    maxWidth: bounds.contentRight - rightX,
    textColor,
    accentColor,
  });
  const supportMarkup = supportLines
    .map(
      (line, index) =>
        `<text x="${bounds.contentLeft}" y="${emphasisMarkup.endY + 28 + index * 42}" font-size="30" font-weight="560" font-family="'Avenir Next', 'Segoe UI', Arial, sans-serif" fill="${textColor}" opacity="0.82">${escapeSvg(line)}</text>`,
    )
    .join("");

  return `
    <svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
      ${buildBackgroundFill(brandKit.backgroundStyle, brandKit.primaryColor, brandKit.secondaryColor)}
      ${buildAtmosphereMarkup(brandKit, accentColor)}
      ${buildFrameMarkup(bounds, accentColor)}
      ${buildBrandSignatureMarkup({
        brandKit,
        bounds,
        brandLabel: content.footerText || content.eyebrowText || "FounderContent",
        brandMarkLabel,
        accentColor,
        textColor,
      })}
      <text x="${bounds.contentLeft}" y="${contentStartY - 38}" font-size="18" letter-spacing="4.2" font-family="'Avenir Next', 'Segoe UI', Arial, sans-serif" fill="${accentColor}" opacity="0.92">${escapeSvg((content.eyebrowText || "SPLIT EMPHASIS").toUpperCase())}</text>
      <line x1="${dividerX}" y1="${contentStartY - 10}" x2="${dividerX}" y2="834" stroke="${accentColor}" stroke-width="4" opacity="0.72" />
      ${introMarkup}
      ${emphasisMarkup.markup}
      ${supportMarkup}
    </svg>
  `.trim();
}

function buildMinimalBrandFallbackSvg(
  content: VisualPromptContent,
  brandKit: GenerateVisualResponse["brandKit"],
  brandMarkLabel: string,
  signatureMode: BrandSignatureMode = "subtle",
  visualRole: CarouselSlideVisualRole = "breakdown",
): string {
  const bounds = resolveCanvasBounds(brandKit);
  const textColor = resolveTextColor(brandKit.backgroundStyle);
  const accentColor = resolveAccentColor(brandKit);
  const footerBrandingMarkup = buildCarouselFooterBrandingMarkup({
    bounds,
    brandLabel: content.footerText || "Founder Content",
    accentColor,
    textColor,
    backgroundStyle: brandKit.backgroundStyle,
    signatureMode,
  });
  const layout = resolveCarouselSvgLayoutProfile(visualRole);
  const hookSplit = visualRole === "hook"
    ? splitTextAroundHighlight(content.headline, content.highlightText)
    : null;
  const resolvedHeadline = hookSplit?.before || content.headline;
  const resolvedHighlight = hookSplit?.highlight || content.highlightText || "";
  const resolvedSupportText =
    hookSplit?.after || content.supportingText || content.closingText || "";
  const maxHeadlineLength =
    brandKit.brandPlacement === "side_label"
      ? Math.max(8, layout.headlineMaxLineLength - 2)
      : layout.headlineMaxLineLength;
  const maxSupportLength =
    brandKit.brandPlacement === "side_label"
      ? Math.max(14, layout.supportMaxLineLength - 2)
      : layout.supportMaxLineLength;
  const contentStartY = resolveContentStartY(brandKit) + layout.contentStartOffset;
  const headlineLines = wrapSvgText(
    resolvedHeadline,
    maxHeadlineLength,
    layout.headlineMaxLines,
  );
  const headlineMarkup = headlineLines
    .map(
      (line, index) =>
        `<text x="${bounds.contentLeft}" y="${contentStartY + index * layout.headlineLineHeight}" font-size="${layout.headlineFontSize}" font-weight="820" font-family="'Arial Black', 'Avenir Next', Arial, sans-serif" fill="${textColor}">${escapeSvg(line)}</text>`,
    )
    .join("");
  const accentLines =
    resolvedHighlight && layout.accentMaxLines > 0
      ? wrapSvgText(resolvedHighlight, layout.accentMaxLineLength, layout.accentMaxLines)
      : [];
  const shouldRenderHookDivider =
    visualRole === "hook" &&
    headlineLines.length > 0 &&
    accentLines.length > 0 &&
    collapseWhitespace(headlineLines.join(" ")).toLowerCase() !== collapseWhitespace(accentLines.join(" ")).toLowerCase();
  const headlineBottomY = contentStartY + headlineLines.length * layout.headlineLineHeight;
  const dividerReferenceLine = headlineLines.reduce<string>(
    (longestLine, line) =>
      estimateTextWidth(line, layout.headlineFontSize, 0.48) >
      estimateTextWidth(longestLine, layout.headlineFontSize, 0.48)
        ? line
        : longestLine,
    headlineLines[0] ?? resolvedHeadline,
  );
  const dividerWidth = Math.round(
    Math.min(
      bounds.contentWidth * 0.58,
      Math.max(
        bounds.contentWidth * 0.42,
        estimateTextWidth(dividerReferenceLine, layout.headlineFontSize, 0.48) * 0.56,
      ),
    ),
  );
  const dividerY = headlineBottomY + 14;
  const dividerMarkup = shouldRenderHookDivider
    ? `<line x1="${bounds.contentLeft}" y1="${dividerY}" x2="${bounds.contentLeft + dividerWidth}" y2="${dividerY}" stroke="${textColor}" stroke-width="2" stroke-linecap="round" opacity="${brandKit.backgroundStyle === "light" ? "0.28" : "0.38"}" />`
    : "";
  const accentStartY = shouldRenderHookDivider ? dividerY + 36 : headlineBottomY + 8;
  const accentMarkup = accentLines.length > 0
    ? buildAccentPhraseMarkup({
        lines: accentLines,
        brandKit,
        x: bounds.contentLeft,
        startY: accentStartY,
        fontSize: layout.accentFontSize,
        lineHeight: layout.accentLineHeight,
        maxWidth: bounds.contentWidth,
        textColor,
        accentColor,
      })
    : {
        markup: "",
        endY: accentStartY,
      };
  const supportLines = wrapSvgText(
    resolvedSupportText,
    maxSupportLength,
    layout.supportMaxLines,
  );
  const supportStartY =
    (accentLines.length > 0 ? accentMarkup.endY : contentStartY + headlineLines.length * layout.headlineLineHeight)
    + layout.supportStartGap;
  const supportMarkup = supportLines
    .map(
      (line, index) =>
        `<text x="${bounds.contentLeft}" y="${supportStartY + index * layout.supportLineHeight}" font-size="${layout.supportFontSize}" font-weight="560" font-family="'Avenir Next', 'Segoe UI', Arial, sans-serif" fill="${textColor}" opacity="0.84">${escapeSvg(line)}</text>`,
    )
    .join("");
  const bulletAnchorY =
    supportLines.length > 0
      ? supportStartY + supportLines.length * layout.supportLineHeight
      : accentLines.length > 0
        ? accentMarkup.endY
        : contentStartY + headlineLines.length * layout.headlineLineHeight;
  const bulletStartY = bulletAnchorY + layout.bulletStartGap;
  const bulletMarkup = (content.bulletPoints ?? [])
    .slice(0, 3)
    .map((point, index) => {
      const y = bulletStartY + index * layout.bulletRowHeight;
      return `
        <rect x="${bounds.contentLeft}" y="${y - 38}" width="${bounds.contentWidth}" height="${layout.bulletCardHeight}" rx="22" fill="#FFFFFF" opacity="${brandKit.backgroundStyle === "light" ? layout.bulletOpacityLight : layout.bulletOpacityDark}" />
        <circle cx="${bounds.contentLeft + 28}" cy="${y - 2}" r="7" fill="${accentColor}" />
        <text x="${bounds.contentLeft + 52}" y="${y + 8}" font-size="${layout.bulletFontSize}" font-weight="600" font-family="'Avenir Next', 'Segoe UI', Arial, sans-serif" fill="${textColor}" opacity="0.88">${escapeSvg(point)}</text>
      `;
    })
    .join("");

  return `
    <svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
      ${buildBackgroundFill(brandKit.backgroundStyle, brandKit.primaryColor, brandKit.secondaryColor)}
      ${buildAtmosphereMarkup(brandKit, accentColor)}
      ${buildFrameMarkup(bounds, accentColor)}
      ${footerBrandingMarkup}
      <text x="${bounds.contentLeft}" y="${contentStartY - 42}" font-size="18" letter-spacing="4.2" font-family="'Avenir Next', 'Segoe UI', Arial, sans-serif" fill="${accentColor}" opacity="0.92">${escapeSvg((content.eyebrowText || "CAROUSEL COVER").toUpperCase())}</text>
      ${headlineMarkup}
      ${dividerMarkup}
      ${accentMarkup.markup}
      ${supportMarkup}
      ${bulletMarkup}
    </svg>
  `.trim();
}

function buildInsightFallbackSvg(
  content: VisualPromptContent,
  brandKit: GenerateVisualResponse["brandKit"],
  brandMarkLabel: string,
): string {
  const bounds = resolveCanvasBounds(brandKit);
  const textColor = resolveTextColor(brandKit.backgroundStyle);
  const accentColor = resolveAccentColor(brandKit);
  const contentStartY = resolveContentStartY(brandKit);
  const headlineLines = wrapSvgText(
    content.headline,
    brandKit.brandPlacement === "side_label" ? 14 : 16,
    3,
  );
  const headlineMarkup = headlineLines
    .map(
      (line, index) =>
        `<text x="${bounds.contentLeft}" y="${contentStartY + index * 60}" font-size="54" font-weight="720" font-family="'Avenir Next', 'Segoe UI', Arial, sans-serif" fill="${textColor}">${escapeSvg(line)}</text>`,
    )
    .join("");
  const accentMarkup = buildAccentPhraseMarkup({
    lines: wrapSvgText(content.highlightText || extractHighlightCandidate(content.headline), 18, 2),
    brandKit,
    x: bounds.contentLeft,
    startY: contentStartY + headlineLines.length * 60 + 28,
    fontSize: 28,
    lineHeight: 46,
    maxWidth: bounds.contentWidth,
    textColor,
    accentColor,
  });
  const bulletPoints = (content.bulletPoints?.length ? content.bulletPoints : [content.supportingText || "Lead with one hard truth, then make the next move obvious."])
    .slice(0, 3);
  const bulletMarkup = bulletPoints
    .map((point, index) => {
      const y = accentMarkup.endY + 46 + index * 112;
      return `
        <rect x="${bounds.contentLeft}" y="${y - 44}" width="${bounds.contentWidth}" height="88" rx="24" fill="#FFFFFF" opacity="${brandKit.backgroundStyle === "light" ? "0.54" : "0.08"}" />
        <circle cx="${bounds.contentLeft + 32}" cy="${y}" r="8" fill="${accentColor}" />
        <text x="${bounds.contentLeft + 58}" y="${y + 10}" font-size="32" font-weight="620" font-family="'Avenir Next', 'Segoe UI', Arial, sans-serif" fill="${textColor}">${escapeSvg(point)}</text>
      `;
    })
    .join("");

  return `
    <svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
      ${buildBackgroundFill(brandKit.backgroundStyle, brandKit.primaryColor, brandKit.secondaryColor)}
      ${buildAtmosphereMarkup(brandKit, accentColor)}
      ${buildFrameMarkup(bounds, accentColor)}
      ${buildBrandSignatureMarkup({
        brandKit,
        bounds,
        brandLabel: content.footerText || content.eyebrowText || "FounderContent",
        brandMarkLabel,
        accentColor,
        textColor,
      })}
      <text x="${bounds.contentLeft}" y="${contentStartY - 38}" font-size="18" letter-spacing="4.2" font-family="'Avenir Next', 'Segoe UI', Arial, sans-serif" fill="${accentColor}" opacity="0.92">${escapeSvg((content.eyebrowText || "INSIGHT CARD").toUpperCase())}</text>
      ${headlineMarkup}
      ${accentMarkup.markup}
      ${bulletMarkup}
    </svg>
  `.trim();
}

function buildPromptWithBranding(
  basePrompt: string,
  brandingPolicy: ReturnType<typeof resolveBrandingPolicy>,
  generatedMediaType?: GenerateVisualRequest["generatedMediaType"],
): string {
  if (generatedMediaType === "photo_overlay") {
    return basePrompt;
  }

  return brandingPolicy.watermarkApplied
    ? `${basePrompt}\n\nBRANDING:\nInclude a subtle watermark that reads "${brandingPolicy.watermarkText}". Keep it aligned to the composition edge, restrained, and never centered at the bottom.`
    : basePrompt;
}

function decodeImageDataUrl(dataUrl: string): {
  mimeType: string;
  bytes: Buffer;
} {
  const match = dataUrl.match(/^data:(.+?);base64,(.+)$/);

  if (!match) {
    throw new Error("Generated image response did not include a valid data URL.");
  }

  return {
    mimeType: match[1],
    bytes: Buffer.from(match[2], "base64"),
  };
}

function encodeImageDataUrl(bytes: Buffer, mimeType: string): string {
  return `data:${mimeType};base64,${bytes.toString("base64")}`;
}

function resolvePhotoOverlayHeadlineProfile(headline: string): {
  fontSize: number;
  lineHeight: number;
  maxLineLength: number;
  maxLines: number;
  paddingX: number;
  paddingY: number;
} {
  const length = collapseWhitespace(headline).length;

  if (length <= 38) {
    return {
      fontSize: 74,
      lineHeight: 82,
      maxLineLength: 16,
      maxLines: 3,
      paddingX: 44,
      paddingY: 40,
    };
  }

  if (length <= 60) {
    return {
      fontSize: 66,
      lineHeight: 74,
      maxLineLength: 20,
      maxLines: 4,
      paddingX: 44,
      paddingY: 40,
    };
  }

  if (length <= 84) {
    return {
      fontSize: 58,
      lineHeight: 66,
      maxLineLength: 22,
      maxLines: 5,
      paddingX: 42,
      paddingY: 38,
    };
  }

  return {
    fontSize: 52,
    lineHeight: 60,
    maxLineLength: 24,
    maxLines: 5,
    paddingX: 40,
    paddingY: 36,
  };
}

function resolvePhotoOverlaySurfaceColors(
  brandKit: GenerateVisualResponse["brandKit"],
): {
  surfaceColor: string;
  surfaceTextColor: string;
  brandPillColor: string;
  brandPillTextColor: string;
  borderColor: string;
} {
  const whiteContrastOnSecondary = calculateContrastRatio(brandKit.secondaryColor, "#FFFFFF");
  const whiteContrastOnPrimary = calculateContrastRatio(brandKit.primaryColor, "#FFFFFF");
  const surfaceColor =
    whiteContrastOnSecondary >= 4.5
      ? brandKit.secondaryColor
      : whiteContrastOnPrimary >= 4.5
        ? brandKit.primaryColor
        : "#1F2937";
  const surfaceTextColor = calculateContrastRatio(surfaceColor, "#FFFFFF") >= 4.5 ? "#FFFFFF" : "#111827";
  const brandPillColor = "#0F172ACC";
  const brandPillTextColor = "#FFFFFF";

  return {
    surfaceColor,
    surfaceTextColor,
    brandPillColor,
    brandPillTextColor,
    borderColor: surfaceTextColor === "#FFFFFF" ? "#FFFFFF33" : "#11182726",
  };
}

function buildPhotoOverlayCompositeSvg(input: {
  content: VisualPromptContent;
  brandKit: GenerateVisualResponse["brandKit"];
  businessContext: BusinessVisualContext | null;
  brandingPolicy: ReturnType<typeof resolveBrandingPolicy>;
  logoDataUrl?: string;
}): string {
  const headline = collapseWhitespace(input.content.headline) || "Founder insight";
  const ctaText = sanitizePhrase(input.content.closingText, 28) || "";
  const eyebrowText = sanitizePhrase(input.content.eyebrowText, 28) || "";
  const brandLabel =
    sanitizePhrase(
      input.content.footerText
      || input.businessContext?.brandName
      || input.businessContext?.domainLabel
      || input.brandingPolicy.watermarkText,
      24,
    ) || "Founder Content";
  const brandMarkLabel = buildBrandMarkLabel(input.businessContext, input.brandingPolicy);
  const profile = resolvePhotoOverlayHeadlineProfile(headline);
  const headlineLines = wrapSvgText(headline, profile.maxLineLength, profile.maxLines);
  const boxX = 82;
  const boxWidth = 860;
  const boxHeight =
    (profile.paddingY * 2)
    + (headlineLines.length * profile.lineHeight)
    + (ctaText ? 82 : 0);
  const boxY = 1024 - boxHeight - 124;
  const headlineStartY = boxY + profile.paddingY + profile.fontSize;
  const { surfaceColor, surfaceTextColor, brandPillColor, brandPillTextColor, borderColor } =
    resolvePhotoOverlaySurfaceColors(input.brandKit);
  const brandLabelUpper = escapeSvg(brandLabel.toUpperCase());
  const brandPillWidth = Math.max(240, estimateTextWidth(brandLabelUpper, 18, 0.52) + 116);
  const ctaWidth = ctaText ? Math.max(176, estimateTextWidth(ctaText, 24, 0.5) + 58) : 0;
  const promoDomainLabel =
    input.logoDataUrl && ctaText
      ? sanitizePhrase(input.businessContext?.domainLabel, 36)
      : "";
  const logoImageX = 72;
  const logoImageY = 68;
  const logoImageWidth = 260;
  const logoImageHeight = 84;

  return `
    <svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="photoOverlayShade" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#030712" stop-opacity="0.26" />
          <stop offset="36%" stop-color="#030712" stop-opacity="0.05" />
          <stop offset="100%" stop-color="#030712" stop-opacity="0.76" />
        </linearGradient>
        <filter id="photoOverlayShadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="18" stdDeviation="26" flood-color="#020617" flood-opacity="0.28" />
        </filter>
      </defs>
      <rect width="1024" height="1024" fill="url(#photoOverlayShade)" />
      ${input.logoDataUrl
        ? `
          <image
            x="${logoImageX}"
            y="${logoImageY}"
            width="${logoImageWidth}"
            height="${logoImageHeight}"
            href="${input.logoDataUrl}"
            preserveAspectRatio="xMinYMid meet"
            filter="url(#photoOverlayShadow)"
          />
        `
        : `
          <g filter="url(#photoOverlayShadow)">
            <rect x="72" y="72" width="${brandPillWidth}" height="58" rx="22" fill="${brandPillColor}" />
            <rect x="88" y="87" width="30" height="30" rx="11" fill="${surfaceColor}" />
            <text x="103" y="109" text-anchor="middle" font-size="16" font-weight="760" font-family="'Avenir Next', 'Segoe UI', Arial, sans-serif" fill="${brandPillTextColor}">${escapeSvg(brandMarkLabel)}</text>
            <text x="136" y="109" font-size="18" font-weight="650" letter-spacing="1.4" font-family="'Avenir Next', 'Segoe UI', Arial, sans-serif" fill="${brandPillTextColor}">${brandLabelUpper}</text>
          </g>
        `}
      ${eyebrowText && eyebrowText.toLowerCase() !== brandLabel.toLowerCase()
        ? `<text x="${boxX + 8}" y="${boxY - 22}" font-size="20" letter-spacing="3.4" font-family="'Avenir Next', 'Segoe UI', Arial, sans-serif" fill="#FFFFFF" opacity="0.9">${escapeSvg(eyebrowText.toUpperCase())}</text>`
        : ""}
      <g filter="url(#photoOverlayShadow)">
        <rect x="${boxX}" y="${boxY}" width="${boxWidth}" height="${boxHeight}" rx="34" fill="${surfaceColor}" opacity="0.96" stroke="${borderColor}" stroke-width="2" />
        ${headlineLines
          .map(
            (line, index) =>
              `<text x="${boxX + profile.paddingX}" y="${headlineStartY + index * profile.lineHeight}" font-size="${profile.fontSize}" font-weight="760" font-family="'Avenir Next', 'Segoe UI', Arial, sans-serif" fill="${surfaceTextColor}">${escapeSvg(line)}</text>`,
          )
          .join("")}
        ${ctaText
          ? `
            <rect x="${boxX + profile.paddingX}" y="${boxY + boxHeight - 64}" width="${ctaWidth}" height="42" rx="18" fill="${surfaceTextColor === "#FFFFFF" ? "#FFFFFF29" : "#11182712"}" />
            <text x="${boxX + profile.paddingX + 22}" y="${boxY + boxHeight - 36}" font-size="24" font-weight="620" font-family="'Avenir Next', 'Segoe UI', Arial, sans-serif" fill="${surfaceTextColor}">${escapeSvg(ctaText)}</text>
          `
          : ""}
      </g>
      ${promoDomainLabel
        ? `
          <text
            x="952"
            y="972"
            text-anchor="end"
            font-size="21"
            font-weight="600"
            letter-spacing="0.5"
            font-family="'Avenir Next', 'Segoe UI', Arial, sans-serif"
            fill="#FFFFFF"
            opacity="0.88"
            filter="url(#photoOverlayShadow)"
          >${escapeSvg(promoDomainLabel)}</text>
        `
        : ""}
    </svg>
  `.trim();
}

async function applyPhotoOverlayTreatment(input: {
  imageDataUrl: string;
  content: VisualPromptContent;
  brandKit: GenerateVisualResponse["brandKit"];
  businessContext: BusinessVisualContext | null;
  brandingPolicy: ReturnType<typeof resolveBrandingPolicy>;
}): Promise<{
  imageDataUrl: string;
  mimeType: string;
}> {
  const { bytes } = decodeImageDataUrl(input.imageDataUrl);
  const resizedBackground = await sharp(bytes)
    .resize(1024, 1024, {
      fit: "cover",
      position: "centre",
    })
    .png()
    .toBuffer();
  const logoDataUrl = await preparePhotoOverlayLogoDataUrl(input.brandKit.logoUrl);
  const overlaySvg = buildPhotoOverlayCompositeSvg({
    content: input.content,
    brandKit: input.brandKit,
    businessContext: input.businessContext,
    brandingPolicy: input.brandingPolicy,
    logoDataUrl,
  });
  const composed = await sharp(resizedBackground)
    .composite([
      {
        input: Buffer.from(overlaySvg),
        top: 0,
        left: 0,
      },
    ])
    .png()
    .toBuffer();

  return {
    imageDataUrl: encodeImageDataUrl(composed, "image/png"),
    mimeType: "image/png",
  };
}

async function generateSingleVisualAsset(input: {
  templateType: VisualTemplateType;
  content: VisualPromptContent;
  brandKit: GenerateVisualResponse["brandKit"];
  brandingPolicy: ReturnType<typeof resolveBrandingPolicy>;
  businessContext: BusinessVisualContext | null;
  captionFooterCredit?: string;
  renderContext?: {
    generatedMediaType?: GenerateVisualRequest["generatedMediaType"];
    brandSignatureMode?: BrandSignatureMode;
    slideVisualRole?: CarouselSlideVisualRole;
    highlightMode?: "none" | "single";
    visualStoryMediaType?: VisualStoryMediaType;
    imageQuality?: ImageGenerationQuality;
  };
}): Promise<GenerateVisualResponse> {
  const basePrompt = buildVisualPrompt({
    templateType: input.templateType,
      content: input.content,
      brandKit: input.brandKit,
      renderContext: input.renderContext,
  });
  const prompt = buildPromptWithBranding(
    basePrompt,
    input.brandingPolicy,
    input.renderContext?.generatedMediaType,
  );
  const brandConsistency = evaluateBrandConsistency({
    templateType: input.templateType,
    brandKit: input.brandKit,
    businessContext: input.businessContext,
    brandingPolicy: input.brandingPolicy,
    contents: [input.content],
  });

  try {
    const image = await generateImage({
      prompt,
      size: "1024x1024",
      quality: input.renderContext?.imageQuality,
    });
    let imageDataUrl = image.imageDataUrl;
    let mimeType = image.mimeType;

    if (input.renderContext?.generatedMediaType === "photo_overlay") {
      try {
        const treatedImage = await applyPhotoOverlayTreatment({
          imageDataUrl,
          content: input.content,
          brandKit: input.brandKit,
          businessContext: input.businessContext,
          brandingPolicy: input.brandingPolicy,
        });

        imageDataUrl = treatedImage.imageDataUrl;
        mimeType = treatedImage.mimeType;
      } catch (overlayError) {
        logWarn("Unable to apply photo overlay treatment.", toErrorContext(overlayError));
      }
    }

    return {
      templateType: input.templateType,
      prompt,
      provider: "openai",
      imageDataUrl,
      mimeType,
      brandKit: input.brandKit,
      brandConsistency,
      watermarkApplied: input.brandingPolicy.watermarkApplied,
      watermarkText: input.brandingPolicy.watermarkApplied ? input.brandingPolicy.watermarkText : undefined,
      captionFooterCredit: input.captionFooterCredit?.trim() || input.brandingPolicy.captionFooterCredit,
    };
  } catch (error) {
    if (!shouldUseSvgFallback(error)) {
      throw error;
    }

    logWarn("Falling back to SVG visual generation.", toErrorContext(error));
    return buildFallbackImage(
      input.templateType,
      input.content,
      input.brandKit,
      input.brandingPolicy,
      input.businessContext,
      input.renderContext,
    );
  }
}

function formatCarouselNarrativeLabel(value: ContentNarrativeType): string {
  if (value === "framework") {
    return "Framework";
  }

  if (value === "contrarian") {
    return "Contrarian";
  }

  return "Story";
}

function formatVisualStoryMediaType(value: VisualStoryMediaType): string {
  switch (value) {
    case "comic_strip":
      return "Comic strip";
    case "cartoon_explainer":
      return "Cartoon explainer";
    case "founder_doodle":
      return "Founder doodle";
    case "tech_meme":
      return "Tech meme";
    case "minimal_infographic":
      return "Minimal infographic";
    case "clean_carousel":
    default:
      return "Clean carousel";
  }
}

function formatVisualStoryTone(value: VisualStoryTone): string {
  switch (value) {
    case "funny":
      return "funny";
    case "serious":
      return "serious";
    case "motivational":
      return "motivational";
    case "dramatic":
      return "dramatic";
    case "professional":
      return "professional";
    case "educational":
    default:
      return "educational";
  }
}

function formatVisualStoryCharacter(value: VisualStoryCharacter): string {
  switch (value) {
    case "founder_creator":
      return "founder or creator";
    case "student":
      return "student";
    case "robot_assistant":
      return "robot assistant";
    case "office_team":
      return "small office team";
    case "abstract_mascot":
      return "abstract mascot";
    case "friendly_developer":
    default:
      return "friendly developer";
  }
}

function resolveVisualStoryStylePrompt(input: {
  mediaType: VisualStoryMediaType;
  tone: VisualStoryTone;
  character: VisualStoryCharacter;
  panelNumber: number;
  panelCount: number;
  scenePrompt: string;
}): string {
  const mediaLabel = formatVisualStoryMediaType(input.mediaType).toLowerCase();
  const characterLabel = formatVisualStoryCharacter(input.character);
  const toneLabel = formatVisualStoryTone(input.tone);

  return [
    `${mediaLabel} panel ${input.panelNumber} of ${input.panelCount}.`,
    `Create a premium, image-led ${toneLabel} social-media visual with a consistent ${characterLabel}.`,
    "Make it colorful, polished, expressive, and scroll-stopping, with cinematic lighting and a clear visual metaphor.",
    input.mediaType === "tech_meme"
      ? "Make it feel like a premium single-panel developer meme: exaggerated facial expression, obvious visual joke, absurd-but-relatable software chaos, punchline energy, and no educational slide layout. Do not render platform names like LinkedIn, Instagram, Twitter, or Facebook."
      : undefined,
    input.mediaType === "cartoon_explainer"
      ? "Use a high-quality cartoon explainer style with dimensional characters, vivid props, and a bright modern palette."
      : undefined,
    input.mediaType === "comic_strip"
      ? "Use a premium comic-panel style with dramatic staging, expressive faces, and colorful scene detail."
      : undefined,
    input.mediaType === "minimal_infographic"
      ? "Use a colorful illustrated diagram style with dimensional icons, arrows, and one clear visual idea."
      : undefined,
    "Keep it square and suitable for LinkedIn or Instagram carousel posting.",
    "Avoid text-card layouts, large paragraphs, black-only templates, tiny speech bubbles, and generic flat vector art.",
    "Any visible words must be optional, large, and under six words.",
    `Scene: ${input.scenePrompt}`,
  ]
    .filter((line): line is string => Boolean(line))
    .join(" ");
}

function buildShortStoryCaption(value: string | undefined, fallback: string): string {
  const candidate =
    sanitizePhrase(extractHighlightCandidate(value ?? ""), 38)
    || sanitizePhrase(value, 38)
    || fallback;
  const words = candidate.split(/\s+/).filter(Boolean);

  if (words.length <= 5) {
    return candidate;
  }

  return sanitizePhrase(words.slice(0, 5).join(" "), 38) || fallback;
}

function buildTechMemePunchline(value: string | undefined, fallback: string): string {
  const normalized = collapseWhitespace(value).toLowerCase();

  if (/\bsecurity\b/.test(normalized)) {
    return "Fix it later?";
  }

  if (/\bbug|bugs|debug|error|crash\b/.test(normalized)) {
    return "Works locally";
  }

  if (/\bdeploy|ship|shipping|release\b/.test(normalized)) {
    return "Ship it?";
  }

  if (/\bai|agent|automation\b/.test(normalized)) {
    return "Autopilot, sure";
  }

  return fallback;
}

function buildTechMemePanels(input: {
  content: VisualPromptContent;
  panelCount: number;
  characterLabel: string;
  mediaLabel: string;
  toneLabel: string;
}): GeneratedVisualStoryPanel[] {
  const coreIdea = sanitizePhrase(input.content.headline, 86) || "The risky shortcut";
  const supportingText = sanitizePhrase(input.content.supportingText, 118);
  const punchline = buildTechMemePunchline(`${coreIdea} ${supportingText}`, "What could go wrong?");
  const beats = [
    {
      caption: punchline,
      scene: `${input.characterLabel} at a laptop, nervous smile, about to ignore an obvious security warning while colorful alert icons glow behind the screen. The joke is the developer pretending the risk is fine.`,
      role: "setup",
    },
    {
      caption: "Tiny shortcut",
      scene: `${input.characterLabel} proudly points at a messy whiteboard labeled only with simple squiggles while a giant bug-shaped warning light looms in the background. The scene should feel funny and chaotic, not instructional.`,
      role: "escalation",
    },
    {
      caption: "Future me",
      scene: `${input.characterLabel} looks dramatically betrayed by their own old code while a glowing shield icon saves the laptop. Exaggerated meme reaction, expressive face, colorful modern workspace, punchline ending.`,
      role: "punchline",
    },
  ];

  return beats.slice(0, input.panelCount === 1 ? 1 : 3).map((beat, index) => ({
    panelNumber: index + 1,
    caption: beat.caption,
    scenePrompt: [
      `${input.mediaLabel}, ${input.toneLabel} tone.`,
      beat.scene,
      `Underlying post idea, for visual context only: ${coreIdea}.`,
      "Make this a meme image first: humorous reaction, visual punchline, minimal text, no paragraph copy.",
      `Narrative role: ${beat.role}.`,
    ].join(" "),
    style: "tech_meme",
    status: "generated",
  }));
}

function buildVisualStoryPanels(input: {
  content: VisualPromptContent;
  mediaType: VisualStoryMediaType;
  panelCount: number;
  tone: VisualStoryTone;
  character: VisualStoryCharacter;
}): GeneratedVisualStoryPanel[] {
  const coreIdea = sanitizePhrase(input.content.headline, 86) || "The idea";
  const supportingText = sanitizePhrase(input.content.supportingText, 118);
  const lesson = sanitizePhrase(input.content.closingText || input.content.highlightText || supportingText || coreIdea, 86);
  const hookCaption = buildShortStoryCaption(input.content.highlightText || coreIdea, "The hidden problem");
  const supportCaption = buildShortStoryCaption(supportingText, "Why it matters");
  const lessonCaption = buildShortStoryCaption(lesson, "The better way");
  const characterLabel = formatVisualStoryCharacter(input.character);
  const toneLabel = formatVisualStoryTone(input.tone);
  const mediaLabel = formatVisualStoryMediaType(input.mediaType).toLowerCase();

  if (input.mediaType === "tech_meme") {
    return buildTechMemePanels({
      content: input.content,
      panelCount: input.panelCount,
      characterLabel,
      mediaLabel,
      toneLabel,
    });
  }

  const beats =
    input.panelCount === 3
      ? [
          {
            caption: hookCaption,
            scene: `${characterLabel} notices a practical problem connected to this idea: ${coreIdea}`,
            role: "hook",
          },
          {
            caption: supportCaption || "Old way friction",
            scene: `${characterLabel} compares the messy old way with a clearer smarter path.`,
            role: "story",
          },
          {
            caption: lessonCaption || "Build it in",
            scene: `${characterLabel} shows the takeaway as a simple win the reader can remember.`,
            role: "takeaway",
          },
        ]
      : [
          {
            caption: hookCaption,
            scene: `${characterLabel} opens with a relatable moment around: ${coreIdea}`,
            role: "hook",
          },
          {
            caption: supportCaption || "Hidden problem",
            scene: `${characterLabel} sees the problem becoming visible in a work setting.`,
            role: "problem",
          },
          {
            caption: "Shortcut looks easier",
            scene: `${characterLabel} considers the shortcut while small warning signs appear around the workspace.`,
            role: "story",
          },
          {
            caption: "Better system wins",
            scene: `${characterLabel} rebuilds the workflow with a calmer, more intentional process.`,
            role: "breakdown",
          },
          {
            caption: lessonCaption || "Build it in",
            scene: `${characterLabel} presents the memorable lesson with a confident finish.`,
            role: "takeaway",
          },
        ];

  return beats.map((beat, index) => ({
    panelNumber: index + 1,
    caption: sanitizePhrase(beat.caption, 86) || `Panel ${index + 1}`,
    scenePrompt: [
      `${mediaLabel}, ${toneLabel} tone.`,
      beat.scene,
      `Narrative role: ${beat.role}.`,
      input.content.sceneDescription ? `Context: ${sanitizePhrase(input.content.sceneDescription, 120)}.` : undefined,
    ]
      .filter((line): line is string => Boolean(line))
      .join(" "),
    style: input.mediaType,
    status: "generated",
  }));
}

function buildVisualStoryNarrative(input: {
  content: VisualPromptContent;
  sourceText: string;
  mediaType: VisualStoryMediaType;
  panelCount: number;
  tone: VisualStoryTone;
  character: VisualStoryCharacter;
}): { narrative: ContentNarrative; visualStory: GeneratedVisualStory } {
  const panels = buildVisualStoryPanels(input);
  const narrative: ContentNarrative = {
    format: "carousel",
    type: "story",
    title: sanitizePhrase(input.content.headline, 84) || "Visual story",
    subtitle: sanitizePhrase(input.content.supportingText, 140) || formatVisualStoryMediaType(input.mediaType),
    sourceText: input.sourceText,
    slides: panels.map((panel) => ({
      role:
        panel.panelNumber === 1
          ? "hook"
          : panel.panelNumber === panels.length
            ? "cta"
            : panel.panelNumber === 2
              ? "challenge"
              : "lesson",
      headline: panel.caption,
      supportingText: panel.panelNumber === panels.length
        ? sanitizePhrase(input.content.supportingText, 112) || undefined
        : undefined,
      highlightText: panel.panelNumber === 1 || panel.panelNumber === panels.length
        ? sanitizePhrase(input.content.highlightText || panel.caption, 64) || undefined
        : undefined,
    })),
  };

  return {
    narrative,
    visualStory: {
      mediaType: input.mediaType,
      panelCount: panels.length,
      tone: input.tone,
      character: input.character,
      panels,
    },
  };
}

function normalizeNarrativeSlide(
  slide: ContentNarrativeSlide,
  fallbackRole: ContentNarrativeSlide["role"],
): ContentNarrativeSlide {
  return {
    role: sanitizePhrase(typeof slide.role === "string" ? slide.role : undefined, 32) || fallbackRole,
    headline: sanitizePhrase(slide.headline, 84),
    supportingText: sanitizePhrase(slide.supportingText, 140) || undefined,
    bulletPoints: (slide.bulletPoints ?? [])
      .map((point) => sanitizePhrase(point, 88))
      .filter(Boolean)
      .slice(0, 3),
    highlightText: sanitizePhrase(slide.highlightText, 64) || undefined,
    eyebrowText: sanitizePhrase(slide.eyebrowText, 36) || undefined,
    footerText: sanitizePhrase(slide.footerText, 42) || undefined,
    closingText: sanitizePhrase(slide.closingText, 72) || undefined,
    assetId: slide.assetId?.trim() || undefined,
    imageDataUrl: slide.imageDataUrl?.trim() || undefined,
    mimeType: slide.mimeType?.trim() || undefined,
  };
}

function normalizeContentNarrative(input: ContentNarrative): ContentNarrative {
  return {
    format: "carousel",
    type: input.type,
    title: sanitizePhrase(input.title, 84) || "Founder narrative",
    subtitle: sanitizePhrase(input.subtitle, 140) || "",
    sourceText: input.sourceText?.trim() || undefined,
    slides: (input.slides ?? [])
      .map((slide, index) => normalizeNarrativeSlide(slide, `slide_${index + 1}`))
      .filter((slide) => slide.headline)
      .slice(0, 5),
  };
}

function normalizeStructuredNarrativeRole(value: string | undefined): string {
  return collapseWhitespace(value).toLowerCase();
}

function normalizeComparableNarrativeText(value: string | undefined): string {
  return collapseWhitespace(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasDuplicateNarrativeText(slides: ContentNarrativeSlide[]): boolean {
  const seen = new Set<string>();

  for (const slide of slides) {
    for (const value of [
      slide.headline,
      slide.supportingText,
      ...(slide.bulletPoints ?? []),
    ]) {
      const normalized = normalizeComparableNarrativeText(value);

      if (!normalized) {
        continue;
      }

      if (seen.has(normalized)) {
        return true;
      }

      seen.add(normalized);
    }
  }

  return false;
}

function shouldRebuildStructuredNarrative(narrative: ContentNarrative): boolean {
  const expectedRoles = ["hook", "problem", "story", "breakdown", "takeaway"];

  if (narrative.slides.length !== expectedRoles.length) {
    return true;
  }

  if (hasDuplicateNarrativeText(narrative.slides)) {
    return true;
  }

  if (narrative.slides[2]?.highlightText) {
    return true;
  }

  return narrative.slides.some((slide, index) =>
    normalizeStructuredNarrativeRole(typeof slide.role === "string" ? slide.role : undefined) !== expectedRoles[index],
  );
}

function resolveContentNarrative(
  input: GenerateVisualRequest,
  content: VisualPromptContent,
): ContentNarrative {
  const normalizedInputNarrative =
    input.narrative?.format === "carousel"
      ? normalizeContentNarrative(input.narrative)
      : null;

  if (normalizedInputNarrative && normalizedInputNarrative.slides.length > 0) {
    if (!shouldRebuildStructuredNarrative(normalizedInputNarrative)) {
      return normalizedInputNarrative;
    }
  }

  if (input.narrative?.format === "carousel") {
    return generateNarrative({
      narrativeType: normalizedInputNarrative?.type,
      sourceText:
        normalizedInputNarrative?.sourceText
        || [
          content.headline,
          content.supportingText,
          ...(content.bulletPoints ?? []),
          content.closingText,
        ]
          .filter(Boolean)
          .join("\n\n"),
      title: normalizedInputNarrative?.title || content.headline,
      subtitle: normalizedInputNarrative?.subtitle || content.supportingText,
    });
  }

  const sourceText = input.carousel?.sourceText?.trim()
    || [
      content.headline,
      content.supportingText,
      ...(content.bulletPoints ?? []),
      content.closingText,
    ]
      .filter(Boolean)
      .join("\n\n");
  const explicitCarouselSlides = input.carousel?.slides?.map((slide, index) => ({
    role: slide.narrativeRole || `slide_${index + 1}`,
    headline: slide.headline,
    supportingText: slide.supportingText,
    bulletPoints: slide.bulletPoints,
    highlightText: slide.highlightText,
    eyebrowText: slide.eyebrowText,
    footerText: slide.footerText,
    closingText: slide.closingText,
  }));
  const normalizedCarouselNarrative =
    explicitCarouselSlides && explicitCarouselSlides.length > 0
      ? normalizeContentNarrative({
          format: "carousel",
          type: input.carousel?.narrativeType || "story",
          title: input.carousel?.title?.trim() || content.headline,
          subtitle: input.carousel?.subtitle?.trim() || content.supportingText || "",
          sourceText,
          slides: explicitCarouselSlides,
        })
      : null;

  if (normalizedCarouselNarrative && !shouldRebuildStructuredNarrative(normalizedCarouselNarrative)) {
    return normalizedCarouselNarrative;
  }

  return generateNarrative({
    narrativeType: input.carousel?.narrativeType,
    slideCount: input.carousel?.slideCount === 3 || input.carousel?.slideCount === 5
      ? input.carousel.slideCount
      : 5,
    sourceText,
    title: input.carousel?.title?.trim() || content.headline,
    subtitle: input.carousel?.subtitle?.trim() || content.supportingText,
  });
}

async function generateCarouselAsset(input: {
  request: GenerateVisualRequest;
  content: VisualPromptContent;
  brandKit: GenerateVisualResponse["brandKit"];
  brandingPolicy: ReturnType<typeof resolveBrandingPolicy>;
  businessContext: BusinessVisualContext | null;
  generationSettings: RuntimeMediaGenerationSettings;
}): Promise<GenerateVisualResponse> {
  const visualStoryInput =
    input.request.visualStory && input.request.visualStory.mediaType !== "clean_carousel"
      ? {
          mediaType: input.request.visualStory.mediaType,
          panelCount: resolveDefaultVisualStoryPanelCount(
            input.request.visualStory.mediaType,
            input.generationSettings,
          ),
          tone: input.request.visualStory.tone ?? "educational",
          character: input.request.visualStory.character ?? "friendly_developer",
        }
      : null;
  const visualStoryPlan = visualStoryInput
    ? buildVisualStoryNarrative({
        content: input.content,
        sourceText:
          input.request.carousel?.sourceText?.trim()
          || input.request.narrative?.sourceText?.trim()
          || [
            input.content.headline,
            input.content.supportingText,
            ...(input.content.bulletPoints ?? []),
            input.content.closingText,
          ]
            .filter(Boolean)
            .join("\n\n"),
        mediaType: visualStoryInput.mediaType,
        panelCount: visualStoryInput.panelCount,
        tone: visualStoryInput.tone,
        character: visualStoryInput.character,
      })
    : null;
  const narrative = visualStoryPlan?.narrative ?? resolveContentNarrative(input.request, input.content);
  const footerText =
    resolveBrandSignatureLabel({
      content: input.content,
      businessContext: input.businessContext,
      brandingPolicy: input.brandingPolicy,
    }).label
    || input.businessContext?.domainLabel
    || input.businessContext?.brandName
    || input.brandingPolicy.watermarkText;
  const renderedNarrativeSlides = await Promise.all(
    narrative.slides.map(async (slide, index) => {
      const visualStoryPanel = visualStoryPlan?.visualStory.panels[index];
      const renderProfile = resolveCarouselSlideRenderProfile(slide, index, narrative.slides.length);
      const eyebrowText = slide.eyebrowText || `${renderProfile.eyebrowLabel} ${index + 1}/${narrative.slides.length}`;
      const normalizedSlideContent = normalizeContent(
        {
          ...slide,
          eyebrowText,
          footerText,
          sceneDescription: visualStoryPanel?.scenePrompt,
          customStylePrompt: visualStoryPanel
            ? resolveVisualStoryStylePrompt({
                mediaType: visualStoryPanel.style,
                tone: visualStoryPlan.visualStory.tone,
                character: visualStoryPlan.visualStory.character,
                panelNumber: visualStoryPanel.panelNumber,
                panelCount: visualStoryPlan.visualStory.panelCount,
                scenePrompt: visualStoryPanel.scenePrompt,
              })
            : undefined,
        },
        {
          eyebrowText,
          footerText,
          allowDerivedHighlight: renderProfile.allowDerivedHighlight,
        },
      );
      const slideContent =
        renderProfile.suppressHighlight
          ? {
              ...normalizedSlideContent,
              highlightText: undefined,
            }
          : normalizedSlideContent;

      const rendered = await generateSingleVisualAsset({
        templateType: "carousel",
        content: slideContent,
        brandKit: input.brandKit,
        brandingPolicy: input.brandingPolicy,
        businessContext: input.businessContext,
        captionFooterCredit: input.request.captionFooterCredit,
        renderContext: {
          brandSignatureMode: renderProfile.brandSignatureMode,
          slideVisualRole: renderProfile.visualRole,
          highlightMode: renderProfile.highlightMode,
          visualStoryMediaType: visualStoryPanel?.style,
          imageQuality: input.generationSettings.imageQuality,
        },
      });

      return {
        ...slide,
        role: slide.role,
        imageDataUrl: rendered.imageDataUrl,
        mimeType: rendered.mimeType,
        headline: slideContent.headline,
        supportingText: slideContent.supportingText,
        bulletPoints: slideContent.bulletPoints,
        highlightText: slideContent.highlightText,
        eyebrowText: slideContent.eyebrowText,
        footerText: slideContent.footerText,
        closingText: slideContent.closingText,
        prompt: rendered.prompt,
        provider: rendered.provider,
      } as ContentNarrativeSlide & { prompt: string; provider: GenerateVisualResponse["provider"] };
    }),
  );

  const firstSlide = renderedNarrativeSlides[0];

  if (!firstSlide) {
    throw new HttpError(500, "visual_generation_failed", "Unable to build carousel slides.");
  }

  const renderedNarrative: ContentNarrative = {
    format: "carousel",
    type: narrative.type,
    title: narrative.title,
    subtitle: narrative.subtitle,
    sourceText: narrative.sourceText,
    slides: renderedNarrativeSlides.map(({ prompt: _prompt, provider: _provider, ...slide }) => ({
      ...slide,
    })),
  };
  const legacyCarousel = {
    narrativeType: renderedNarrative.type,
    slides: renderedNarrativeSlides.map((slide, index) => ({
      index,
      prompt: slide.prompt,
      provider: slide.provider,
      imageDataUrl: slide.imageDataUrl || "",
      mimeType: slide.mimeType || "image/png",
      content: {
        headline: slide.headline,
        supportingText: slide.supportingText,
        bulletPoints: slide.bulletPoints,
        highlightText: slide.highlightText,
        eyebrowText: slide.eyebrowText,
        footerText: slide.footerText,
        closingText: slide.closingText,
        narrativeRole: slide.role,
      },
    })),
  };
  const brandConsistency = evaluateBrandConsistency({
    templateType: "carousel",
    brandKit: input.brandKit,
    businessContext: input.businessContext,
    brandingPolicy: input.brandingPolicy,
    contents: legacyCarousel.slides.map((slide) => slide.content),
  });

  return {
    templateType: "carousel",
    prompt: firstSlide.prompt,
    provider: firstSlide.provider,
    imageDataUrl: firstSlide.imageDataUrl || "",
    mimeType: firstSlide.mimeType || "image/png",
    brandKit: input.brandKit,
    brandConsistency,
    watermarkApplied: input.brandingPolicy.watermarkApplied,
    watermarkText: input.brandingPolicy.watermarkApplied ? input.brandingPolicy.watermarkText : undefined,
    captionFooterCredit: input.request.captionFooterCredit?.trim() || input.brandingPolicy.captionFooterCredit,
    narrative: renderedNarrative,
    visualStory: visualStoryPlan?.visualStory,
    carousel: legacyCarousel,
  };
}

function buildFallbackImage(
  templateType: VisualTemplateType,
  content: VisualPromptContent,
  brandKit: GenerateVisualResponse["brandKit"],
  brandingPolicy: ReturnType<typeof resolveBrandingPolicy>,
  businessContext: BusinessVisualContext | null,
  renderContext?: {
    generatedMediaType?: GenerateVisualRequest["generatedMediaType"];
    brandSignatureMode?: BrandSignatureMode;
    slideVisualRole?: CarouselSlideVisualRole;
    highlightMode?: "none" | "single";
    visualStoryMediaType?: VisualStoryMediaType;
    imageQuality?: ImageGenerationQuality;
  },
): GenerateVisualResponse {
  const brandMarkLabel = buildBrandMarkLabel(businessContext, brandingPolicy);
  const brandLabel =
    content.footerText ||
    businessContext?.domainLabel ||
    businessContext?.brandName ||
    brandingPolicy.watermarkText;
  const svgContent = {
    ...content,
    eyebrowText: content.eyebrowText || businessContext?.brandName || undefined,
    footerText: brandLabel,
  };
  const brandConsistency = evaluateBrandConsistency({
    templateType,
    brandKit,
    businessContext,
    brandingPolicy,
    contents: [svgContent],
  });
  let svg = "";

  switch (templateType) {
    case "quote":
      svg = buildQuoteFallbackSvg(svgContent, brandKit, brandMarkLabel);
      break;
    case "contrarian":
      svg = buildSplitEmphasisFallbackSvg(svgContent, brandKit, brandMarkLabel);
      break;
    case "carousel":
      svg = buildMinimalBrandFallbackSvg(
        svgContent,
        brandKit,
        brandMarkLabel,
        renderContext?.brandSignatureMode ?? "subtle",
        renderContext?.slideVisualRole ?? "breakdown",
      );
      break;
    case "insight":
    default:
      svg = buildInsightFallbackSvg(svgContent, brandKit, brandMarkLabel);
      break;
  }

  return {
    templateType,
    prompt: buildVisualPrompt({
      templateType,
      content: svgContent,
      brandKit,
      renderContext,
    }),
    provider: "svg_fallback",
    imageDataUrl: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
    mimeType: "image/svg+xml",
    brandKit,
    brandConsistency,
    watermarkApplied: brandingPolicy.watermarkApplied,
    watermarkText: brandingPolicy.watermarkApplied ? brandingPolicy.watermarkText : undefined,
    captionFooterCredit: brandingPolicy.captionFooterCredit,
  };
}

function shouldUseSvgFallback(error: unknown): boolean {
  return process.env.NODE_ENV !== "production" || process.env.ALLOW_VISUAL_SVG_FALLBACK === "true";
}

export async function generateVisualAsset(
  input: GenerateVisualRequest,
  principal?: AuthenticatedPrincipal,
): Promise<GenerateVisualResponse> {
  const businessId = input.businessId?.trim() || undefined;
  const [brandKit, businessContext] = await Promise.all([
    resolveBrandKitForGeneration({
      principal,
      businessId,
      brandKit: input.brandKit,
    }),
    loadBusinessVisualContext(businessId),
  ]);
  const generationSettings = await resolveRuntimeMediaGenerationSettings();
  const brandingPolicy = resolveBrandingPolicy({
    principal,
    businessId,
    watermarkMode: input.watermarkMode,
  });
  const content = normalizeContent(input.content, {
    eyebrowText: businessContext?.brandName,
    footerText: businessContext?.domainLabel || businessContext?.brandName,
  });

  if (input.templateType === "carousel" || input.visualStory) {
    return generateCarouselAsset({
      request: input,
      content,
      brandKit,
      brandingPolicy,
      businessContext,
      generationSettings,
    });
  }

  return generateSingleVisualAsset({
    templateType: input.templateType,
    content,
    brandKit,
    brandingPolicy,
    businessContext,
    captionFooterCredit: input.captionFooterCredit,
    renderContext: {
      generatedMediaType: input.generatedMediaType,
      imageQuality: generationSettings.imageQuality,
    },
  });
}
