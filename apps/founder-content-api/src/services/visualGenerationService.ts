import { Buffer } from "node:buffer";
import { generateImage } from "../../../../packages/ai-core/src/index.ts";
import { buildVisualPrompt } from "../../../../packages/content-engine/src/index.ts";
import type {
  GenerateVisualRequest,
  GenerateVisualResponse,
  VisualPromptContent,
  VisualTemplateType,
} from "../../../../packages/shared-types/index.ts";
import type { AuthenticatedPrincipal } from "../middleware/auth.ts";
import { resolveBrandKitForGeneration } from "./brandIntelligence/brandKitService.ts";
import { resolveBrandingPolicy } from "./brandingService.ts";
import { HttpError, toErrorContext } from "../utils/http.ts";
import { logWarn } from "../utils/logger.ts";

function normalizeContent(content: GenerateVisualRequest["content"]): VisualPromptContent {
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

function wrapSvgText(text: string, maxLineLength: number): string[] {
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
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.slice(0, 4);
}

function buildBackgroundFill(backgroundStyle: GenerateVisualResponse["brandKit"]["backgroundStyle"], primaryColor: string, secondaryColor: string): string {
  if (backgroundStyle === "light") {
    return `<rect width="100%" height="100%" fill="${primaryColor}" />`;
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

function buildFallbackImage(
  templateType: VisualTemplateType,
  content: VisualPromptContent,
  brandKit: GenerateVisualResponse["brandKit"],
  brandingPolicy: ReturnType<typeof resolveBrandingPolicy>,
): GenerateVisualResponse {
  const headlineLines = wrapSvgText(content.headline, 24);
  const supportingText = content.supportingText?.trim();
  const bulletPoints = (content.bulletPoints ?? []).slice(0, 3);
  const textColor = brandKit.backgroundStyle === "light" ? brandKit.secondaryColor : "#F8FAFC";
  const accentColor = brandKit.backgroundStyle === "light" ? brandKit.primaryColor : brandKit.secondaryColor;

  const headlineMarkup = headlineLines
    .map(
      (line, index) =>
        `<text x="96" y="${170 + index * 72}" font-size="58" font-weight="700" font-family="Arial, Helvetica, sans-serif" fill="${textColor}">${escapeSvg(line)}</text>`,
    )
    .join("");

  const supportingMarkup = supportingText
    ? `<text x="96" y="${170 + headlineLines.length * 72 + 48}" font-size="28" font-family="Arial, Helvetica, sans-serif" fill="${accentColor}">${escapeSvg(supportingText)}</text>`
    : "";

  const bulletMarkup =
    templateType === "insight"
      ? bulletPoints
          .map(
            (point, index) =>
              `<text x="116" y="${340 + index * 64}" font-size="28" font-family="Arial, Helvetica, sans-serif" fill="${textColor}">• ${escapeSvg(point)}</text>`,
          )
          .join("")
      : "";

  const eyebrow = templateType.toUpperCase();
  const watermarkMarkup = brandingPolicy.watermarkApplied
    ? `<text x="96" y="944" font-size="24" font-family="Arial, Helvetica, sans-serif" fill="${accentColor}" opacity="0.86">${escapeSvg(brandingPolicy.watermarkText)}</text>`
    : "";
  const svg = `
    <svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
      ${buildBackgroundFill(brandKit.backgroundStyle, brandKit.primaryColor, brandKit.secondaryColor)}
      <rect x="64" y="64" width="896" height="896" rx="40" fill="none" stroke="${accentColor}" stroke-width="2" opacity="0.28" />
      <text x="96" y="120" font-size="24" letter-spacing="4" font-family="Arial, Helvetica, sans-serif" fill="${accentColor}">${eyebrow}</text>
      ${headlineMarkup}
      ${supportingMarkup}
      ${bulletMarkup}
      ${watermarkMarkup}
    </svg>
  `.trim();

  return {
    templateType,
    prompt: buildVisualPrompt({
      templateType,
      content,
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
  const content = normalizeContent(input.content);
  const brandKit = await resolveBrandKitForGeneration({
    principal,
    businessId: input.businessId?.trim() || undefined,
    brandKit: input.brandKit,
  });
  const brandingPolicy = resolveBrandingPolicy({
    principal,
    businessId: input.businessId?.trim() || undefined,
    watermarkMode: input.watermarkMode,
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
    return buildFallbackImage(input.templateType, content, brandKit, brandingPolicy);
  }
}
