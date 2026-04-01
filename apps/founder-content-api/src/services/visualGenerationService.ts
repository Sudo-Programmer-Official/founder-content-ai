import { Buffer } from "node:buffer";
import { generateImage } from "../../../../packages/ai-core/src/index.ts";
import { buildVisualPrompt } from "../../../../packages/content-engine/src/index.ts";
import type {
  GenerateVisualRequest,
  GenerateVisualResponse,
  VisualPromptContent,
  VisualTemplateType,
} from "../../../../packages/shared-types/index.ts";
import type { QueryResultRow } from "pg";
import type { AuthenticatedPrincipal } from "../middleware/auth.ts";
import { resolveBrandKitForGeneration } from "./brandIntelligence/brandKitService.ts";
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

function normalizeContent(
  content: GenerateVisualRequest["content"],
  defaults?: {
    footerText?: string;
    eyebrowText?: string;
  },
): VisualPromptContent {
  const headline = content.headline?.trim();

  if (!headline) {
    throw new HttpError(400, "bad_request", "content.headline is required.");
  }

  return {
    headline,
    supportingText: content.supportingText?.trim() || undefined,
    bulletPoints: (content.bulletPoints ?? [])
      .map((point) => point.trim())
      .filter((point) => point.length > 0)
      .slice(0, 3),
    highlightText:
      sanitizePhrase(content.highlightText, 64) ||
      sanitizePhrase(extractHighlightCandidate(content.headline || content.supportingText || ""), 64) ||
      undefined,
    eyebrowText:
      sanitizePhrase(content.eyebrowText, 36) ||
      sanitizePhrase(defaults?.eyebrowText, 36) ||
      undefined,
    footerText:
      sanitizePhrase(content.footerText, 42) ||
      sanitizePhrase(defaults?.footerText, 42) ||
      undefined,
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
  if (brandKit.backgroundStyle === "light") {
    return brandKit.secondaryColor;
  }

  return brandKit.secondaryColor;
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
      highlight: highlight,
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

function buildFooterMarkup(
  footerText: string | undefined,
  textColor: string,
): string {
  if (!footerText) {
    return "";
  }

  return `<text x="928" y="948" text-anchor="end" font-size="24" letter-spacing="1.6" font-family="'Avenir Next', 'Segoe UI', Arial, sans-serif" fill="${textColor}" opacity="0.82">${escapeSvg(footerText)}</text>`;
}

function buildBrandMarkMarkup(markLabel: string, accentColor: string, textColor: string): string {
  return `
    <rect x="82" y="78" width="58" height="58" rx="18" fill="${accentColor}" />
    <text x="111" y="116" text-anchor="middle" font-size="24" font-weight="700" font-family="'Avenir Next', 'Segoe UI', Arial, sans-serif" fill="${textColor}">${escapeSvg(markLabel)}</text>
  `;
}

function buildQuoteFallbackSvg(
  content: VisualPromptContent,
  brandKit: GenerateVisualResponse["brandKit"],
  brandMarkLabel: string,
): string {
  const textColor = resolveTextColor(brandKit.backgroundStyle);
  const accentColor = resolveAccentColor(brandKit);
  const split = splitTextAroundHighlight(content.headline, content.highlightText);
  const introLines = wrapSvgText(split.before || content.headline, 24, 3);
  const highlightLines = wrapSvgText(split.highlight || content.highlightText || extractHighlightCandidate(content.headline), 14, 3);
  const closingLines = wrapSvgText(content.closingText || content.supportingText || split.after, 24, 2);
  const introMarkup = introLines
    .map(
      (line, index) =>
        `<text x="88" y="${250 + index * 60}" font-size="52" font-weight="650" font-family="'Avenir Next', 'Segoe UI', Arial, sans-serif" fill="${textColor}">${escapeSvg(line)}</text>`,
    )
    .join("");
  const highlightY = 250 + introLines.length * 60 + 34;
  const highlightMarkup = highlightLines
    .map((line, index) => {
      const width = Math.min(820, estimateTextWidth(line, 66, 0.64) + 52);
      const y = highlightY + index * 86;
      return `
        <rect x="88" y="${y - 56}" width="${width}" height="74" rx="22" fill="${accentColor}" />
        <text x="114" y="${y}" font-size="62" font-weight="800" font-family="'Arial Black', 'Avenir Next', Arial, sans-serif" fill="${brandKit.backgroundStyle === "light" ? "#FFF8F1" : "#111111"}">${escapeSvg(line)}</text>
      `;
    })
    .join("");
  const closingStartY = highlightY + highlightLines.length * 86 + 40;
  const closingMarkup = closingLines
    .map(
      (line, index) =>
        `<text x="88" y="${closingStartY + index * 48}" font-size="38" font-weight="560" font-family="'Avenir Next', 'Segoe UI', Arial, sans-serif" fill="${textColor}" opacity="0.92">${escapeSvg(line)}</text>`,
    )
    .join("");

  return `
    <svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
      ${buildBackgroundFill(brandKit.backgroundStyle, brandKit.primaryColor, brandKit.secondaryColor)}
      <rect x="58" y="58" width="908" height="908" rx="42" fill="none" stroke="${accentColor}" stroke-width="2" opacity="0.18" />
      ${buildBrandMarkMarkup(brandMarkLabel, accentColor, brandKit.backgroundStyle === "light" ? "#FFF8F1" : "#121212")}
      <text x="164" y="114" font-size="22" letter-spacing="4" font-family="'Avenir Next', 'Segoe UI', Arial, sans-serif" fill="${accentColor}" opacity="0.92">${escapeSvg(content.eyebrowText || "CONTRAST QUOTE")}</text>
      ${introMarkup}
      ${highlightMarkup}
      ${closingMarkup}
      ${buildFooterMarkup(content.footerText, textColor)}
    </svg>
  `.trim();
}

function buildSplitEmphasisFallbackSvg(
  content: VisualPromptContent,
  brandKit: GenerateVisualResponse["brandKit"],
  brandMarkLabel: string,
): string {
  const textColor = resolveTextColor(brandKit.backgroundStyle);
  const accentColor = resolveAccentColor(brandKit);
  const split = splitTextAroundHighlight(content.headline, content.highlightText);
  const introLines = wrapSvgText(split.before || content.headline, 18, 5);
  const emphasisLines = wrapSvgText(split.highlight || content.highlightText || extractHighlightCandidate(content.headline), 10, 3);
  const supportLines = wrapSvgText(content.supportingText || split.after || content.closingText || "", 20, 3);
  const introMarkup = introLines
    .map(
      (line, index) =>
        `<text x="92" y="${270 + index * 52}" font-size="40" font-weight="620" font-family="'Avenir Next', 'Segoe UI', Arial, sans-serif" fill="${textColor}" opacity="0.92">${escapeSvg(line)}</text>`,
    )
    .join("");
  const emphasisMarkup = emphasisLines
    .map(
      (line, index) =>
        `<text x="522" y="${356 + index * 96}" font-size="86" font-weight="800" font-family="'Arial Black', 'Avenir Next', Arial, sans-serif" fill="${accentColor}">${escapeSvg(line)}</text>`,
    )
    .join("");
  const supportMarkup = supportLines
    .map(
      (line, index) =>
        `<text x="92" y="${716 + index * 42}" font-size="32" font-weight="560" font-family="'Avenir Next', 'Segoe UI', Arial, sans-serif" fill="${textColor}" opacity="0.8">${escapeSvg(line)}</text>`,
    )
    .join("");

  return `
    <svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
      ${buildBackgroundFill(brandKit.backgroundStyle, brandKit.primaryColor, brandKit.secondaryColor)}
      <rect x="70" y="70" width="884" height="884" rx="42" fill="none" stroke="${accentColor}" stroke-width="2" opacity="0.16" />
      <line x1="474" y1="148" x2="474" y2="836" stroke="${accentColor}" stroke-width="6" opacity="0.76" />
      ${buildBrandMarkMarkup(brandMarkLabel, accentColor, brandKit.backgroundStyle === "light" ? "#FFF8F1" : "#121212")}
      <text x="164" y="114" font-size="22" letter-spacing="4" font-family="'Avenir Next', 'Segoe UI', Arial, sans-serif" fill="${accentColor}" opacity="0.92">${escapeSvg(content.eyebrowText || "SPLIT EMPHASIS")}</text>
      ${introMarkup}
      ${emphasisMarkup}
      ${supportMarkup}
      ${buildFooterMarkup(content.footerText, textColor)}
    </svg>
  `.trim();
}

function buildMinimalBrandFallbackSvg(
  content: VisualPromptContent,
  brandKit: GenerateVisualResponse["brandKit"],
  brandMarkLabel: string,
): string {
  const textColor = resolveTextColor(brandKit.backgroundStyle);
  const accentColor = resolveAccentColor(brandKit);
  const headlineLines = wrapSvgText(content.headline, 14, 4);
  const supportLines = wrapSvgText(content.supportingText || content.closingText || "", 26, 2);
  const headlineMarkup = headlineLines
    .map(
      (line, index) =>
        `<text x="88" y="${316 + index * 92}" font-size="84" font-weight="800" font-family="'Arial Black', 'Avenir Next', Arial, sans-serif" fill="${textColor}">${escapeSvg(line)}</text>`,
    )
    .join("");
  const supportMarkup = supportLines
    .map(
      (line, index) =>
        `<text x="88" y="${730 + index * 42}" font-size="32" font-weight="560" font-family="'Avenir Next', 'Segoe UI', Arial, sans-serif" fill="${textColor}" opacity="0.84">${escapeSvg(line)}</text>`,
    )
    .join("");

  return `
    <svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
      ${buildBackgroundFill(brandKit.backgroundStyle, brandKit.primaryColor, brandKit.secondaryColor)}
      <rect x="70" y="70" width="884" height="884" rx="42" fill="none" stroke="${accentColor}" stroke-width="2" opacity="0.14" />
      ${buildBrandMarkMarkup(brandMarkLabel, accentColor, brandKit.backgroundStyle === "light" ? "#FFF8F1" : "#121212")}
      <text x="164" y="114" font-size="22" letter-spacing="4" font-family="'Avenir Next', 'Segoe UI', Arial, sans-serif" fill="${accentColor}" opacity="0.92">${escapeSvg(content.eyebrowText || "MINIMAL BRAND")}</text>
      <rect x="88" y="170" width="104" height="6" rx="3" fill="${accentColor}" />
      ${headlineMarkup}
      ${supportMarkup}
      ${buildFooterMarkup(content.footerText, textColor)}
    </svg>
  `.trim();
}

function buildInsightFallbackSvg(
  content: VisualPromptContent,
  brandKit: GenerateVisualResponse["brandKit"],
  brandMarkLabel: string,
): string {
  const textColor = resolveTextColor(brandKit.backgroundStyle);
  const accentColor = resolveAccentColor(brandKit);
  const headlineLines = wrapSvgText(content.headline, 18, 3);
  const highlightText = content.highlightText || extractHighlightCandidate(content.headline);
  const bulletPoints = (content.bulletPoints ?? []).slice(0, 3);
  const headlineMarkup = headlineLines
    .map(
      (line, index) =>
        `<text x="88" y="${238 + index * 58}" font-size="50" font-weight="740" font-family="'Avenir Next', 'Segoe UI', Arial, sans-serif" fill="${textColor}">${escapeSvg(line)}</text>`,
    )
    .join("");
  const bulletMarkup = bulletPoints
    .map((point, index) => {
      const y = 470 + index * 118;
      return `
        <rect x="88" y="${y - 46}" width="848" height="88" rx="24" fill="rgba(255,255,255,0.08)" />
        <circle cx="126" cy="${y - 2}" r="8" fill="${accentColor}" />
        <text x="152" y="${y + 8}" font-size="34" font-weight="620" font-family="'Avenir Next', 'Segoe UI', Arial, sans-serif" fill="${textColor}">${escapeSvg(point)}</text>
      `;
    })
    .join("");
  const highlightWidth = Math.min(420, estimateTextWidth(highlightText, 28, 0.54) + 42);

  return `
    <svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
      ${buildBackgroundFill(brandKit.backgroundStyle, brandKit.primaryColor, brandKit.secondaryColor)}
      <rect x="70" y="70" width="884" height="884" rx="42" fill="none" stroke="${accentColor}" stroke-width="2" opacity="0.14" />
      ${buildBrandMarkMarkup(brandMarkLabel, accentColor, brandKit.backgroundStyle === "light" ? "#FFF8F1" : "#121212")}
      <text x="164" y="114" font-size="22" letter-spacing="4" font-family="'Avenir Next', 'Segoe UI', Arial, sans-serif" fill="${accentColor}" opacity="0.92">${escapeSvg(content.eyebrowText || "INSIGHT CARD")}</text>
      ${headlineMarkup}
      <rect x="88" y="352" width="${highlightWidth}" height="48" rx="18" fill="${accentColor}" />
      <text x="110" y="384" font-size="28" font-weight="760" font-family="'Avenir Next', 'Segoe UI', Arial, sans-serif" fill="${brandKit.backgroundStyle === "light" ? "#FFF8F1" : "#121212"}">${escapeSvg(highlightText)}</text>
      ${bulletMarkup}
      ${buildFooterMarkup(content.footerText, textColor)}
    </svg>
  `.trim();
}

function buildFallbackImage(
  templateType: VisualTemplateType,
  content: VisualPromptContent,
  brandKit: GenerateVisualResponse["brandKit"],
  brandingPolicy: ReturnType<typeof resolveBrandingPolicy>,
  businessContext: BusinessVisualContext | null,
): GenerateVisualResponse {
  const brandMarkLabel = buildBrandMarkLabel(businessContext, brandingPolicy);
  const footerText = content.footerText || businessContext?.domainLabel || businessContext?.brandName || brandingPolicy.watermarkText;
  const svgContent = {
    ...content,
    eyebrowText: content.eyebrowText || businessContext?.brandName || undefined,
    footerText,
  };
  let svg = "";

  switch (templateType) {
    case "quote":
      svg = buildQuoteFallbackSvg(svgContent, brandKit, brandMarkLabel);
      break;
    case "contrarian":
      svg = buildSplitEmphasisFallbackSvg(svgContent, brandKit, brandMarkLabel);
      break;
    case "carousel":
      svg = buildMinimalBrandFallbackSvg(svgContent, brandKit, brandMarkLabel);
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
    }),
    provider: "svg_fallback",
    imageDataUrl: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
    mimeType: "image/svg+xml",
    brandKit,
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
  const brandingPolicy = resolveBrandingPolicy({
    principal,
    businessId,
    watermarkMode: input.watermarkMode,
  });
  const content = normalizeContent(input.content, {
    eyebrowText: businessContext?.brandName,
    footerText: businessContext?.domainLabel || businessContext?.brandName,
  });
  const basePrompt = buildVisualPrompt({
    templateType: input.templateType,
    content,
    brandKit,
  });
  const prompt = brandingPolicy.watermarkApplied
    ? `${basePrompt}\n\nBRANDING:\nInclude a subtle footer watermark that reads "${brandingPolicy.watermarkText}". Keep it professional and LinkedIn-safe.`
    : basePrompt;

  try {
    const image = await generateImage({
      prompt,
      size: "1024x1024",
    });

    return {
      templateType: input.templateType,
      prompt,
      provider: "openai",
      imageDataUrl: image.imageDataUrl,
      mimeType: image.mimeType,
      brandKit,
      watermarkApplied: brandingPolicy.watermarkApplied,
      watermarkText: brandingPolicy.watermarkApplied ? brandingPolicy.watermarkText : undefined,
      captionFooterCredit: input.captionFooterCredit?.trim() || brandingPolicy.captionFooterCredit,
    };
  } catch (error) {
    if (!shouldUseSvgFallback(error)) {
      throw error;
    }

    logWarn("Falling back to SVG visual generation.", toErrorContext(error));
    return buildFallbackImage(input.templateType, content, brandKit, brandingPolicy, businessContext);
  }
}
