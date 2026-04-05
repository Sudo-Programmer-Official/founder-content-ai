import sharp from "sharp";
import type {
  BrandKit,
  PostAssetAspectRatio,
  PromoVisualLayoutId,
} from "../../../../packages/shared-types/index.ts";

const PROMO_VISUAL_DIMENSIONS: Record<PostAssetAspectRatio, { width: number; height: number }> = {
  "1:1": { width: 1080, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
};

interface PromoVisualComposerInput {
  brandKit: BrandKit;
  brandLabel: string;
  headline: string;
  subheadline?: string;
  cta?: string;
  layout: PromoVisualLayoutId;
  aspectRatio: PostAssetAspectRatio;
  screenshotBytes?: Buffer;
}

export interface PromoVisualComposerResult {
  bytes: Buffer;
  width: number;
  height: number;
  aspectRatio: PostAssetAspectRatio;
  resolvedLayout: PromoVisualLayoutId;
  usedLogo: boolean;
  usedSourceImage: boolean;
}

function collapseWhitespace(value: string | undefined | null): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function escapeSvg(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function truncateAtWordBoundary(value: string | undefined, maxLength: number): string | undefined {
  const normalized = collapseWhitespace(value);

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

function wrapText(value: string, maxCharsPerLine: number, maxLines: number): string[] {
  const normalized = collapseWhitespace(value);

  if (!normalized) {
    return [];
  }

  const words = normalized.split(" ");
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    const nextLine = currentLine ? `${currentLine} ${word}` : word;

    if (nextLine.length <= maxCharsPerLine) {
      currentLine = nextLine;
      continue;
    }

    if (currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      lines.push(word.slice(0, maxCharsPerLine));
      currentLine = word.slice(maxCharsPerLine);
    }

    if (lines.length >= maxLines) {
      break;
    }
  }

  if (lines.length < maxLines && currentLine) {
    lines.push(currentLine);
  }

  return lines.slice(0, maxLines).map((line, index, array) =>
    index === array.length - 1 && array.length === maxLines && normalized.length > array.join(" ").length
      ? `${line.replace(/[,.!?\-:;]+$/g, "").trimEnd()}...`
      : line,
  );
}

function estimateTextWidth(text: string, fontSize: number, factor = 0.56): number {
  return Math.ceil(text.length * fontSize * factor);
}

function hexToRgb(value: string): { r: number; g: number; b: number } {
  const normalized = value.replace("#", "").trim();
  const safe = normalized.length === 3
    ? normalized.split("").map((segment) => `${segment}${segment}`).join("")
    : normalized.padEnd(6, "0").slice(0, 6);

  return {
    r: parseInt(safe.slice(0, 2), 16),
    g: parseInt(safe.slice(2, 4), 16),
    b: parseInt(safe.slice(4, 6), 16),
  };
}

function toRgba(value: string, alpha: number): string {
  const { r, g, b } = hexToRgb(value);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function relativeLuminance(value: string): number {
  const { r, g, b } = hexToRgb(value);
  const transform = (channel: number): number => {
    const normalized = channel / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  };

  return (0.2126 * transform(r)) + (0.7152 * transform(g)) + (0.0722 * transform(b));
}

function pickReadableTextColor(background: string): "#0F172A" | "#FFFFFF" {
  return relativeLuminance(background) > 0.52 ? "#0F172A" : "#FFFFFF";
}

function buildInitialsLabel(value: string): string {
  const normalized = collapseWhitespace(value);

  if (!normalized) {
    return "FC";
  }

  return normalized
    .split(/[\s.-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((segment) => segment.charAt(0).toUpperCase())
    .join("") || "FC";
}

function resolvePromoSurfaceColors(brandKit: BrandKit): {
  backgroundStart: string;
  backgroundEnd: string;
  orbColor: string;
  panelFill: string;
  panelStroke: string;
  panelText: string;
  secondaryText: string;
  chipFill: string;
  chipStroke: string;
  chipText: string;
  chipIconFill: string;
  chipIconText: string;
  ctaFill: string;
  ctaText: string;
} {
  const lightBackground = brandKit.backgroundStyle === "light";
  const baseSurface = lightBackground ? "#FFF8F1" : "#0B1120";
  const panelFill = lightBackground
    ? toRgba("#FFFFFF", 0.92)
    : toRgba("#FFFFFF", 0.12);
  const panelStroke = lightBackground
    ? toRgba(brandKit.primaryColor, 0.14)
    : toRgba("#FFFFFF", 0.14);
  const panelText = lightBackground ? "#0F172A" : "#FFFFFF";
  const secondaryText = lightBackground ? "#334155" : toRgba("#FFFFFF", 0.82);
  const chipFill = lightBackground
    ? toRgba("#FFFFFF", 0.86)
    : toRgba("#0F172A", 0.44);
  const chipStroke = lightBackground
    ? toRgba(brandKit.primaryColor, 0.12)
    : toRgba("#FFFFFF", 0.12);
  const chipText = lightBackground ? "#0F172A" : "#FFFFFF";
  const chipIconFill = lightBackground ? brandKit.primaryColor : "#FFFFFF";
  const chipIconText = pickReadableTextColor(chipIconFill);
  const ctaFill = brandKit.secondaryColor;
  const ctaText = pickReadableTextColor(ctaFill);

  return {
    backgroundStart: baseSurface,
    backgroundEnd: lightBackground ? toRgba(brandKit.primaryColor, 0.1) : brandKit.primaryColor,
    orbColor: toRgba(brandKit.secondaryColor, lightBackground ? 0.16 : 0.2),
    panelFill,
    panelStroke,
    panelText,
    secondaryText,
    chipFill,
    chipStroke,
    chipText,
    chipIconFill,
    chipIconText,
    ctaFill,
    ctaText,
  };
}

function buildRoundedMask(width: number, height: number, radius: number): Buffer {
  return Buffer.from(
    `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${width}" height="${height}" rx="${radius}" fill="#FFFFFF" />
    </svg>`,
  );
}

async function prepareRoundedImage(
  bytes: Buffer,
  width: number,
  height: number,
  radius: number,
): Promise<Buffer> {
  return sharp(bytes)
    .resize(width, height, {
      fit: "cover",
      position: "attention",
    })
    .composite([
      {
        input: buildRoundedMask(width, height, radius),
        blend: "dest-in",
      },
    ])
    .png()
    .toBuffer();
}

async function loadRemoteLogoBytes(logoUrl: string | undefined): Promise<Buffer | null> {
  if (!logoUrl) {
    return null;
  }

  try {
    const response = await fetch(logoUrl);

    if (!response.ok) {
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch {
    return null;
  }
}

async function prepareLogoBuffer(bytes: Buffer | null): Promise<Buffer | null> {
  if (!bytes) {
    return null;
  }

  try {
    return await sharp(bytes)
      .resize(36, 36, {
        fit: "contain",
        background: { r: 255, g: 255, b: 255, alpha: 0 },
      })
      .png()
      .toBuffer();
  } catch {
    return null;
  }
}

function buildLogoComposite(input: {
  width: number;
  height: number;
  usedLogo: boolean;
  brandLabel: string;
  headlineLines: string[];
  subheadlineLines: string[];
  ctaText?: string;
  layout: PromoVisualLayoutId;
  colors: ReturnType<typeof resolvePromoSurfaceColors>;
  screenshotFrame?: { x: number; y: number; width: number; height: number; radius: number };
  brandMarkLabel: string;
}): string {
  const chipWidth = Math.max(244, estimateTextWidth(input.brandLabel.toUpperCase(), 18, 0.52) + 128);
  const chipX = 64;
  const chipY = 64;
  const chipHeight = 66;
  const chipIconSize = 36;
  const chipIconX = chipX + 18;
  const chipIconY = chipY + 15;
  const chipTextX = chipIconX + 50;
  const cardPaddingX = input.layout === "headline_only" ? 86 : 64;
  const lineHeight = input.layout === "headline_only" ? 72 : 62;
  const headlineFontSize = input.layout === "headline_only" ? 68 : 58;
  const subheadlineFontSize = 28;
  const ctaFontSize = 28;

  let cardX = 64;
  let cardY = input.height - 380;
  let cardWidth = input.width - 128;

  if (input.layout === "headline_only") {
    cardY = Math.round(input.height * 0.44);
    cardWidth = input.width - 160;
    cardX = Math.round((input.width - cardWidth) / 2);
  }

  if (input.layout === "screenshot_headline" && input.screenshotFrame) {
    cardY = input.height - (input.height > input.width ? 560 : 330);
    cardWidth = input.width - 128;
  }

  const headlineStartY = cardY + 94;
  const subheadlineStartY = headlineStartY + (input.headlineLines.length * lineHeight) + 26;
  const ctaWidth = input.ctaText
    ? Math.max(188, estimateTextWidth(input.ctaText, ctaFontSize, 0.52) + 54)
    : 0;
  const ctaY = subheadlineStartY + (input.subheadlineLines.length * 38) + 34;
  const ctaTextY = ctaY + 30;
  const headlineAnchor = input.layout === "headline_only" ? "middle" : "start";
  const textX = input.layout === "headline_only" ? input.width / 2 : cardX + cardPaddingX;

  return `
    <svg width="${input.width}" height="${input.height}" viewBox="0 0 ${input.width} ${input.height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="promoBackground" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${input.colors.backgroundStart}" />
          <stop offset="100%" stop-color="${input.colors.backgroundEnd}" />
        </linearGradient>
        <filter id="promoShadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="28" stdDeviation="34" flood-color="#020617" flood-opacity="0.26" />
        </filter>
      </defs>
      <rect width="${input.width}" height="${input.height}" fill="url(#promoBackground)" />
      <circle cx="${input.width - 120}" cy="${Math.round(input.height * 0.2)}" r="${Math.round(input.width * 0.24)}" fill="${input.colors.orbColor}" />
      <circle cx="${Math.round(input.width * 0.18)}" cy="${Math.round(input.height * 0.82)}" r="${Math.round(input.width * 0.18)}" fill="${toRgba(input.colors.ctaFill, 0.12)}" />
      ${input.screenshotFrame
        ? `
          <g filter="url(#promoShadow)">
            <rect
              x="${input.screenshotFrame.x}"
              y="${input.screenshotFrame.y}"
              width="${input.screenshotFrame.width}"
              height="${input.screenshotFrame.height}"
              rx="${input.screenshotFrame.radius}"
              fill="${toRgba("#0F172A", 0.18)}"
            />
          </g>
        `
        : ""}
      <g filter="url(#promoShadow)">
        <rect x="${chipX}" y="${chipY}" width="${chipWidth}" height="${chipHeight}" rx="22" fill="${input.colors.chipFill}" stroke="${input.colors.chipStroke}" />
        <rect x="${chipIconX}" y="${chipIconY}" width="${chipIconSize}" height="${chipIconSize}" rx="12" fill="${input.colors.chipIconFill}" />
        ${input.usedLogo
          ? ""
          : `<text x="${chipIconX + (chipIconSize / 2)}" y="${chipIconY + 24}" text-anchor="middle" font-size="16" font-weight="760" font-family="'Avenir Next', 'Segoe UI', Arial, sans-serif" fill="${input.colors.chipIconText}">${escapeSvg(input.brandMarkLabel)}</text>`}
        <text x="${chipTextX}" y="${chipY + 42}" font-size="18" font-weight="650" letter-spacing="1.4" font-family="'Avenir Next', 'Segoe UI', Arial, sans-serif" fill="${input.colors.chipText}">${escapeSvg(input.brandLabel.toUpperCase())}</text>
      </g>
      <g filter="url(#promoShadow)">
        <rect x="${cardX}" y="${cardY}" width="${cardWidth}" height="${input.layout === "headline_only" ? 350 : input.layout === "screenshot_headline" && input.height > input.width ? 440 : 286}" rx="34" fill="${input.colors.panelFill}" stroke="${input.colors.panelStroke}" />
      </g>
      ${input.headlineLines
        .map((line, index) =>
          `<text x="${textX}" y="${headlineStartY + (index * lineHeight)}" text-anchor="${headlineAnchor}" font-size="${headlineFontSize}" font-weight="780" font-family="'Avenir Next', 'Segoe UI', Arial, sans-serif" fill="${input.colors.panelText}">${escapeSvg(line)}</text>`,
        )
        .join("")}
      ${input.subheadlineLines
        .map((line, index) =>
          `<text x="${textX}" y="${subheadlineStartY + (index * 38)}" text-anchor="${headlineAnchor}" font-size="${subheadlineFontSize}" font-weight="530" font-family="'Avenir Next', 'Segoe UI', Arial, sans-serif" fill="${input.colors.secondaryText}">${escapeSvg(line)}</text>`,
        )
        .join("")}
      ${input.ctaText
        ? `
          <g filter="url(#promoShadow)">
            <rect
              x="${input.layout === "headline_only" ? Math.round((input.width - ctaWidth) / 2) : cardX + cardPaddingX}"
              y="${ctaY}"
              width="${ctaWidth}"
              height="52"
              rx="20"
              fill="${input.colors.ctaFill}"
            />
            <text
              x="${input.layout === "headline_only" ? Math.round(input.width / 2) : cardX + cardPaddingX + 24}"
              y="${ctaTextY}"
              text-anchor="${input.layout === "headline_only" ? "middle" : "start"}"
              font-size="${ctaFontSize}"
              font-weight="700"
              font-family="'Avenir Next', 'Segoe UI', Arial, sans-serif"
              fill="${input.colors.ctaText}"
            >${escapeSvg(input.ctaText)}</text>
          </g>
        `
        : ""}
    </svg>
  `.trim();
}

export async function composePromoVisual(
  input: PromoVisualComposerInput,
): Promise<PromoVisualComposerResult> {
  const normalizedHeadline = truncateAtWordBoundary(input.headline, 120) || "New update";
  const normalizedSubheadline = truncateAtWordBoundary(input.subheadline, 160);
  const normalizedCta = truncateAtWordBoundary(input.cta, 28);
  const normalizedBrandLabel = collapseWhitespace(input.brandLabel) || "Workspace";
  const dimensions = PROMO_VISUAL_DIMENSIONS[input.aspectRatio];
  const resolvedLayout =
    input.layout === "screenshot_headline" && !input.screenshotBytes
      ? "logo_headline"
      : input.layout;
  const colors = resolvePromoSurfaceColors(input.brandKit);
  const logoBuffer = await prepareLogoBuffer(await loadRemoteLogoBytes(input.brandKit.logoUrl));
  const usedLogo = Boolean(logoBuffer);
  const brandMarkLabel = buildInitialsLabel(normalizedBrandLabel);
  const headlineLines = wrapText(
    normalizedHeadline,
    resolvedLayout === "headline_only"
      ? input.aspectRatio === "9:16" ? 18 : 20
      : resolvedLayout === "screenshot_headline" && input.aspectRatio === "1:1"
        ? 16
        : input.aspectRatio === "9:16"
          ? 18
          : 20,
    input.aspectRatio === "9:16" ? 4 : 3,
  );
  const subheadlineLines = normalizedSubheadline
    ? wrapText(
        normalizedSubheadline,
        resolvedLayout === "headline_only" ? 28 : input.aspectRatio === "9:16" ? 32 : 40,
        3,
      )
    : [];

  const screenshotFrame = resolvedLayout === "screenshot_headline"
    ? (
        input.aspectRatio === "9:16"
          ? { x: 72, y: 158, width: dimensions.width - 144, height: 860, radius: 36 }
          : { x: dimensions.width - 430, y: 128, width: 356, height: 472, radius: 30 }
      )
    : undefined;

  const baseSvg = buildLogoComposite({
    width: dimensions.width,
    height: dimensions.height,
    usedLogo,
    brandLabel: normalizedBrandLabel,
    headlineLines,
    subheadlineLines,
    ctaText: normalizedCta,
    layout: resolvedLayout,
    colors,
    screenshotFrame,
    brandMarkLabel,
  });

  const compositeLayers: sharp.OverlayOptions[] = [];

  if (resolvedLayout === "screenshot_headline" && screenshotFrame && input.screenshotBytes) {
    compositeLayers.push({
      input: await prepareRoundedImage(
        input.screenshotBytes,
        screenshotFrame.width,
        screenshotFrame.height,
        screenshotFrame.radius,
      ),
      left: screenshotFrame.x,
      top: screenshotFrame.y,
    });
  }

  if (usedLogo && logoBuffer) {
    compositeLayers.push({
      input: logoBuffer,
      left: 82,
      top: 79,
    });
  }

  const bytes = await sharp(Buffer.from(baseSvg))
    .composite(compositeLayers)
    .png()
    .toBuffer();

  return {
    bytes,
    width: dimensions.width,
    height: dimensions.height,
    aspectRatio: input.aspectRatio,
    resolvedLayout,
    usedLogo,
    usedSourceImage: Boolean(input.screenshotBytes && resolvedLayout === "screenshot_headline"),
  };
}
