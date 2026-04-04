import sharp from "sharp";
import type {
  BrandKit,
  MotionTemplateAspectRatio,
  MotionTemplateMetadata,
} from "../../../../../packages/shared-types/index.ts";
import type { MotionTemplateConfig, MotionTextStyleConfig } from "./templates.ts";
import { formatMotionSeconds } from "./cameraMotion.ts";
import { resolveMotionBrandTheme } from "./brandTheme.ts";

export interface MotionLayerAsset {
  bytes: Buffer;
  width: number;
  height: number;
}

export interface MotionOverlayLayerPlan extends MotionLayerAsset {
  xExpression: string;
  yExpression: string;
  introStart: number;
  introDuration: number;
  pulseAfter?: number;
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncateAtWordBoundary(value: string | undefined, maxLength: number): string | undefined {
  const normalized = collapseWhitespace(value ?? "");

  if (!normalized) {
    return undefined;
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  const truncated = normalized.slice(0, maxLength).trim();
  const lastSpaceIndex = truncated.lastIndexOf(" ");
  return (lastSpaceIndex >= Math.floor(maxLength * 0.55) ? truncated.slice(0, lastSpaceIndex) : truncated).trim();
}

function escapeSvg(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function estimateTextWidth(value: string, fontSize: number, characterFactor = 0.56): number {
  return Math.ceil(collapseWhitespace(value).length * fontSize * characterFactor);
}

function wrapSvgText(value: string, maxLineLength: number, maxLines: number): string[] {
  const normalized = collapseWhitespace(value);

  if (!normalized) {
    return [];
  }

  const words = normalized.split(" ");
  const lines: string[] = [];
  let currentLine = "";
  let index = 0;

  for (; index < words.length; index += 1) {
    const word = words[index] ?? "";
    const candidate = currentLine ? `${currentLine} ${word}` : word;

    if (candidate.length <= maxLineLength || currentLine === "") {
      currentLine = candidate;
      continue;
    }

    lines.push(currentLine);
    currentLine = word;

    if (lines.length === maxLines - 1) {
      index += 1;
      break;
    }
  }

  if (currentLine) {
    const remainingWords = words.slice(index);
    const trailingText = collapseWhitespace([currentLine, ...remainingWords].join(" "));
    lines.push(trailingText);
  }

  return lines
    .slice(0, maxLines)
    .map((line, lineIndex, allLines) =>
      lineIndex === allLines.length - 1 && line.length > maxLineLength
        ? `${line.slice(0, Math.max(maxLineLength - 3, 12)).trimEnd()}...`
        : line,
    )
    .filter((line) => line.trim() !== "");
}

async function renderSvgOverlayToPng(svg: string): Promise<Buffer> {
  return sharp(Buffer.from(svg)).png().toBuffer();
}

function resolveMotionOverlayYOffsetExpression(
  baseY: number,
  introStart: number,
  introDuration: number,
  offsetY: number,
): string {
  if (offsetY === 0) {
    return `${baseY}`;
  }

  return `if(lt(t,${formatMotionSeconds(introStart)}),${baseY + offsetY},if(lt(t,${formatMotionSeconds(introStart + introDuration)}),${baseY}+${offsetY}*(1-(t-${formatMotionSeconds(introStart)})/${formatMotionSeconds(introDuration)}),${baseY}))`;
}

async function buildBrandLayer(label: string, brandKit?: BrandKit): Promise<MotionLayerAsset> {
  const theme = resolveMotionBrandTheme(brandKit);
  const normalized = truncateAtWordBoundary(label, 32) ?? "Founder Content";
  const fontSize = 18;
  const height = 44;
  const width = Math.min(Math.max(estimateTextWidth(normalized, fontSize, 0.55) + 60, 138), 340);
  const svg = `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="${width}" height="${height}" rx="22" fill="${theme.surfaceColor}" fill-opacity="${theme.surfaceOpacity}" />
      <circle cx="22" cy="22" r="10" fill="${theme.accentColor}" />
      <text x="42" y="28" font-size="${fontSize}" font-weight="720" font-family="'Avenir Next', 'Segoe UI', Arial, sans-serif" fill="${theme.textColor}">${escapeSvg(normalized.toUpperCase())}</text>
    </svg>
  `;

  return {
    bytes: await renderSvgOverlayToPng(svg),
    width,
    height,
  };
}

async function buildHeadlineLayer(
  style: MotionTextStyleConfig,
  headline: string,
  maxWidth: number,
  brandKit?: BrandKit,
): Promise<MotionLayerAsset | null> {
  const theme = resolveMotionBrandTheme(brandKit);
  const normalized = truncateAtWordBoundary(headline, style.maxLength);

  if (!normalized) {
    return null;
  }

  const lines = wrapSvgText(normalized, style.maxLineLength, style.maxLines);

  if (lines.length === 0) {
    return null;
  }

  const contentWidth = lines.reduce(
    (widest, line) => Math.max(widest, estimateTextWidth(line, style.fontSize, 0.53)),
    0,
  );
  const width = Math.min(Math.max(contentWidth + 56, 280), maxWidth);
  const height = (lines.length * style.lineHeight) + 42;
  const rectFill = style.variant === "promo" ? "url(#promoGradient)" : theme.surfaceColor;
  const rectOpacity =
    style.variant === "promo" ? 0.96 : style.variant === "problem" ? 0.88 : theme.surfaceOpacity;
  const headlineTextColor = style.variant === "promo" ? theme.accentTextColor : theme.textColor;
  const accentMarkup =
    style.variant === "problem" || theme.accentStyle === "underline"
      ? `<rect x="0" y="0" width="${width}" height="6" rx="3" fill="${theme.accentColor}" />`
      : "";
  const headlineMarkup = lines
    .map(
      (line, index) =>
        `<text x="28" y="${28 + style.fontSize + (index * style.lineHeight)}" font-size="${style.fontSize}" font-weight="780" font-family="'Avenir Next', 'Segoe UI', Arial, sans-serif" fill="${headlineTextColor}">${escapeSvg(line)}</text>`,
    )
    .join("");
  const svg = `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="promoGradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${theme.gradientStart}" />
          <stop offset="100%" stop-color="${theme.gradientEnd}" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="${width}" height="${height}" rx="26" fill="${rectFill}" fill-opacity="${rectOpacity}" />
      ${accentMarkup}
      ${headlineMarkup}
    </svg>
  `;

  return {
    bytes: await renderSvgOverlayToPng(svg),
    width,
    height,
  };
}

async function buildSubheadlineLayer(
  style: MotionTextStyleConfig,
  subheadline: string,
  maxWidth: number,
  brandKit?: BrandKit,
): Promise<MotionLayerAsset | null> {
  const theme = resolveMotionBrandTheme(brandKit);
  const normalized = truncateAtWordBoundary(subheadline, style.maxLength);

  if (!normalized) {
    return null;
  }

  const lines = wrapSvgText(normalized, style.maxLineLength, style.maxLines);

  if (lines.length === 0) {
    return null;
  }

  const contentWidth = lines.reduce(
    (widest, line) => Math.max(widest, estimateTextWidth(line, style.fontSize, 0.52)),
    0,
  );
  const width = Math.min(Math.max(contentWidth + 42, 220), maxWidth);
  const height = (lines.length * style.lineHeight) + 32;
  const svg = `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="${width}" height="${height}" rx="20" fill="${theme.subtleSurfaceColor}" fill-opacity="${theme.subtleSurfaceOpacity}" />
      ${lines
        .map(
          (line, index) =>
            `<text x="22" y="${22 + style.fontSize + (index * style.lineHeight)}" font-size="${style.fontSize}" font-weight="560" font-family="'Avenir Next', 'Segoe UI', Arial, sans-serif" fill="${theme.textColor}">${escapeSvg(line)}</text>`,
        )
        .join("")}
    </svg>
  `;

  return {
    bytes: await renderSvgOverlayToPng(svg),
    width,
    height,
  };
}

async function buildCtaLayer(
  style: MotionTextStyleConfig,
  label: string,
  brandKit?: BrandKit,
): Promise<MotionLayerAsset | null> {
  const theme = resolveMotionBrandTheme(brandKit);
  const normalized = truncateAtWordBoundary(label, style.maxLength);

  if (!normalized) {
    return null;
  }

  const height = 54;
  const width = Math.min(Math.max(estimateTextWidth(normalized, style.fontSize, 0.54) + 54, 170), 320);
  const svg = `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="${width}" height="${height}" rx="18" fill="${theme.accentColor}" />
      <text x="${Math.round(width / 2)}" y="34" text-anchor="middle" font-size="${style.fontSize}" font-weight="760" font-family="'Avenir Next', 'Segoe UI', Arial, sans-serif" fill="${theme.accentTextColor}">${escapeSvg(normalized)}</text>
    </svg>
  `;

  return {
    bytes: await renderSvgOverlayToPng(svg),
    width,
    height,
  };
}

export async function buildMotionOverlayPlans(input: {
  width: number;
  height: number;
  aspectRatio: MotionTemplateAspectRatio;
  template: MotionTemplateMetadata;
  config: MotionTemplateConfig;
  brandKit?: BrandKit;
}): Promise<MotionOverlayLayerPlan[]> {
  const { width, height, aspectRatio, template, config, brandKit } = input;
  const theme = resolveMotionBrandTheme(brandKit);
  const maxLayerWidth = width - 96;
  const headlineLayer = await buildHeadlineLayer(
    config.headline,
    template.overlay?.headline ?? "",
    maxLayerWidth,
    brandKit,
  );
  const subheadlineLayer = await buildSubheadlineLayer(
    config.subheadline,
    template.overlay?.subheadline ?? "",
    maxLayerWidth,
    brandKit,
  );
  const ctaLayer = await buildCtaLayer(config.cta, template.overlay?.cta ?? "", brandKit);
  const brandLayer = template.overlay?.brandText ? await buildBrandLayer(template.overlay.brandText, brandKit) : null;
  const totalTextHeight =
    (headlineLayer?.height ?? 0)
    + (subheadlineLayer ? subheadlineLayer.height + 16 : 0)
    + (ctaLayer ? ctaLayer.height + 20 : 0);
  const desiredHeadlineTop = Math.round(height * config.headlineTopRatio);
  const headlineTop = Math.min(desiredHeadlineTop, Math.max(84, height - totalTextHeight - 56));
  const centeredX = "(W-w)/2";
  const leftX = "48";
  const rightX = `(W-w-48)`;
  const layers: MotionOverlayLayerPlan[] = [];

  if (brandLayer) {
    layers.push({
      ...brandLayer,
      xExpression:
        theme.brandPlacement === "top_left"
        ? leftX
        : theme.brandPlacement === "bottom_right"
          ? rightX
          : rightX,
      yExpression:
        theme.brandPlacement === "bottom_right"
          ? `${Math.max(height - brandLayer.height - 38, config.brandTop)}`
          : `${config.brandTop}`,
      introStart: config.brandAnimation.introStart,
      introDuration: config.brandAnimation.introDuration,
    });
  }

  if (headlineLayer) {
    layers.push({
      ...headlineLayer,
      xExpression: config.centered ? centeredX : leftX,
      yExpression: resolveMotionOverlayYOffsetExpression(
        headlineTop,
        config.headline.animation.introStart,
        config.headline.animation.introDuration,
        config.headline.animation.slideOffsetY ?? 0,
      ),
      introStart: config.headline.animation.introStart,
      introDuration: config.headline.animation.introDuration,
    });
  }

  if (subheadlineLayer) {
    const subTop = headlineTop + (headlineLayer?.height ?? 0) + 16;
    layers.push({
      ...subheadlineLayer,
      xExpression: config.centered ? centeredX : leftX,
      yExpression: resolveMotionOverlayYOffsetExpression(
        subTop,
        config.subheadline.animation.introStart,
        config.subheadline.animation.introDuration,
        config.subheadline.animation.slideOffsetY ?? 0,
      ),
      introStart: config.subheadline.animation.introStart,
      introDuration: config.subheadline.animation.introDuration,
    });
  }

  if (ctaLayer) {
    const ctaTop =
      headlineTop
      + (headlineLayer?.height ?? 0)
      + (subheadlineLayer ? subheadlineLayer.height + 32 : 28);
    layers.push({
      ...ctaLayer,
      xExpression: config.centered ? centeredX : leftX,
      yExpression: `${Math.min(ctaTop, height - ctaLayer.height - 46)}`,
      introStart: config.cta.animation.introStart,
      introDuration: config.cta.animation.introDuration,
      pulseAfter: config.cta.animation.pulseAfter,
    });
  }

  return layers;
}
