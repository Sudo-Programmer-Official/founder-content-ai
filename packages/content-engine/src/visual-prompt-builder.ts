import type {
  BrandKit,
  BrandKitBackgroundStyle,
  BrandKitFontStyle,
  BrandKitInput,
  BrandKitTone,
  BrandKitVisualStyle,
  VisualPromptContent,
  VisualTemplateType,
} from "../../shared-types/index.ts";

const DEFAULT_BRAND_KIT: Omit<BrandKit, "id" | "businessId" | "createdAt" | "updatedAt"> = {
  primaryColor: "#111827",
  secondaryColor: "#F8FAFC",
  backgroundStyle: "dark",
  fontStyle: "bold",
  visualStyle: "minimal",
  tone: "professional",
  logoUrl: undefined,
};

function collapseWhitespace(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function truncateAtWordBoundary(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  const truncated = value.slice(0, maxLength).trim();
  const lastSpaceIndex = truncated.lastIndexOf(" ");

  if (lastSpaceIndex >= Math.floor(maxLength * 0.6)) {
    return truncated.slice(0, lastSpaceIndex).trim();
  }

  return truncated;
}

function toPunchyLine(value: string | undefined, maxLength = 120): string {
  const normalized = collapseWhitespace(value);

  if (!normalized) {
    return "";
  }

  const sentence = normalized.split(/(?<=[.!?])\s+/)[0] ?? normalized;
  return truncateAtWordBoundary(sentence, maxLength);
}

function sanitizeColor(value: string | undefined, fallback: string): string {
  const normalized = collapseWhitespace(value);

  if (/^#[0-9a-f]{6}$/i.test(normalized)) {
    return normalized.toUpperCase();
  }

  return fallback;
}

function sanitizeEnum<TValue extends string>(
  value: string | undefined,
  allowedValues: readonly TValue[],
  fallback: TValue,
): TValue {
  const normalized = collapseWhitespace(value).toLowerCase() as TValue;
  return allowedValues.includes(normalized) ? normalized : fallback;
}

function resolveDefaultColors(
  backgroundStyle: BrandKitBackgroundStyle,
): Pick<BrandKit, "primaryColor" | "secondaryColor"> {
  if (backgroundStyle === "light") {
    return {
      primaryColor: "#FFFFFF",
      secondaryColor: "#111827",
    };
  }

  if (backgroundStyle === "gradient") {
    return {
      primaryColor: "#0F172A",
      secondaryColor: "#2563EB",
    };
  }

  return {
    primaryColor: "#111827",
    secondaryColor: "#F8FAFC",
  };
}

function resolveStyleBlock(brandKit: BrandKitInput): string {
  const backgroundStyle = sanitizeEnum<BrandKitBackgroundStyle>(
    brandKit.backgroundStyle,
    ["dark", "light", "gradient"],
    DEFAULT_BRAND_KIT.backgroundStyle,
  );
  const fontStyle = sanitizeEnum<BrandKitFontStyle>(
    brandKit.fontStyle,
    ["modern", "bold", "elegant"],
    DEFAULT_BRAND_KIT.fontStyle,
  );
  const visualStyle = sanitizeEnum<BrandKitVisualStyle>(
    brandKit.visualStyle,
    ["minimal", "luxury", "playful"],
    DEFAULT_BRAND_KIT.visualStyle,
  );
  const colorPalette = resolveDefaultColors(backgroundStyle);
  const primaryColor = sanitizeColor(brandKit.primaryColor, colorPalette.primaryColor);
  const secondaryColor = sanitizeColor(brandKit.secondaryColor, colorPalette.secondaryColor);

  const backgroundDescriptions: Record<BrandKitBackgroundStyle, string> = {
    dark: "dark background, high contrast, confident mood",
    light: "clean light background, editorial clarity, polished contrast",
    gradient: "controlled gradient background, high contrast, bold energy",
  };

  const fontDescriptions: Record<BrandKitFontStyle, string> = {
    modern: "modern typography with clean geometric forms",
    bold: "bold typography with sharp hierarchy and heavy weight",
    elegant: "elegant typography with refined spacing and premium restraint",
  };

  const visualDescriptions: Record<BrandKitVisualStyle, string> = {
    minimal: "minimal composition with generous spacing and no clutter",
    luxury: "premium minimalism with refined balance and elevated finish",
    playful: "expressive composition with a confident modern edge",
  };

  return [
    backgroundDescriptions[backgroundStyle],
    fontDescriptions[fontStyle],
    visualDescriptions[visualStyle],
    `color palette led by ${primaryColor} and ${secondaryColor}`,
  ].join(", ");
}

function resolveLayoutBlock(templateType: VisualTemplateType): string {
  switch (templateType) {
    case "quote":
      return "centered bold text, large headline, generous spacing, no clutter, one dominant focal area";
    case "insight":
      return "title at top, 2 to 3 short bullet insights below, clean grid spacing, easy scan hierarchy";
    case "contrarian":
      return "single dramatic statement, oversized typography, intense spacing, built to stop scroll on mobile";
    case "carousel":
      return "big hook headline first, supporting subtext below, structured like a LinkedIn carousel cover slide";
    default:
      return "clean social-first layout with clear hierarchy";
  }
}

function resolveContentBlock(
  templateType: VisualTemplateType,
  content: VisualPromptContent,
): string {
  const headline = toPunchyLine(content.headline, 120);
  const supportingText = toPunchyLine(content.supportingText, 90);
  const bulletPoints = (content.bulletPoints ?? [])
    .map((point) => toPunchyLine(point, 72))
    .filter(Boolean)
    .slice(0, 3);

  if (templateType === "insight") {
    return [
      `Title: "${headline}"`,
      bulletPoints.length > 0
        ? `Points: ${bulletPoints.map((point) => `- ${point}`).join(" ")}`
        : undefined,
    ]
      .filter(Boolean)
      .join(" ");
  }

  if (templateType === "carousel") {
    return [
      `Headline: "${headline}"`,
      supportingText ? `Subtext: "${supportingText}"` : undefined,
    ]
      .filter(Boolean)
      .join(" ");
  }

  return `"${headline}"`;
}

function resolveBrandBlock(brandKit: BrandKitInput): string {
  const backgroundStyle = sanitizeEnum<BrandKitBackgroundStyle>(
    brandKit.backgroundStyle,
    ["dark", "light", "gradient"],
    DEFAULT_BRAND_KIT.backgroundStyle,
  );
  const fontStyle = sanitizeEnum<BrandKitFontStyle>(
    brandKit.fontStyle,
    ["modern", "bold", "elegant"],
    DEFAULT_BRAND_KIT.fontStyle,
  );
  const visualStyle = sanitizeEnum<BrandKitVisualStyle>(
    brandKit.visualStyle,
    ["minimal", "luxury", "playful"],
    DEFAULT_BRAND_KIT.visualStyle,
  );
  const tone = sanitizeEnum<BrandKitTone>(
    brandKit.tone,
    ["professional", "bold", "friendly"],
    DEFAULT_BRAND_KIT.tone,
  );
  const colorPalette = resolveDefaultColors(backgroundStyle);
  const primaryColor = sanitizeColor(brandKit.primaryColor, colorPalette.primaryColor);
  const secondaryColor = sanitizeColor(brandKit.secondaryColor, colorPalette.secondaryColor);

  return [
    `${tone} brand tone`,
    `${visualStyle} visual system`,
    `${backgroundStyle} background treatment`,
    `${fontStyle} type direction`,
    `use ${primaryColor} as the dominant brand color`,
    `use ${secondaryColor} for contrast or accent`,
    "LinkedIn-native composition, no watermark, no random decorative clutter",
  ].join(", ");
}

export function resolveBrandKit(
  input: BrandKitInput = {},
  overrides: Partial<Pick<BrandKit, "id" | "businessId" | "createdAt" | "updatedAt">> = {},
): BrandKit {
  const backgroundStyle = sanitizeEnum<BrandKitBackgroundStyle>(
    input.backgroundStyle,
    ["dark", "light", "gradient"],
    DEFAULT_BRAND_KIT.backgroundStyle,
  );
  const defaults = resolveDefaultColors(backgroundStyle);

  return {
    id: overrides.id ?? "brand-kit-default",
    businessId: overrides.businessId ?? "",
    primaryColor: sanitizeColor(input.primaryColor, defaults.primaryColor),
    secondaryColor: sanitizeColor(input.secondaryColor, defaults.secondaryColor),
    backgroundStyle,
    fontStyle: sanitizeEnum<BrandKitFontStyle>(
      input.fontStyle,
      ["modern", "bold", "elegant"],
      DEFAULT_BRAND_KIT.fontStyle,
    ),
    visualStyle: sanitizeEnum<BrandKitVisualStyle>(
      input.visualStyle,
      ["minimal", "luxury", "playful"],
      DEFAULT_BRAND_KIT.visualStyle,
    ),
    tone: sanitizeEnum<BrandKitTone>(
      input.tone,
      ["professional", "bold", "friendly"],
      DEFAULT_BRAND_KIT.tone,
    ),
    logoUrl: collapseWhitespace(input.logoUrl) || undefined,
    createdAt: overrides.createdAt ?? new Date(0).toISOString(),
    updatedAt: overrides.updatedAt ?? new Date(0).toISOString(),
  };
}

export function buildVisualPrompt(input: {
  templateType: VisualTemplateType;
  content: VisualPromptContent;
  brandKit?: BrandKitInput;
}): string {
  const resolvedBrandKit = resolveBrandKit(input.brandKit);

  return [
    "STYLE:",
    resolveStyleBlock(resolvedBrandKit),
    "",
    "LAYOUT:",
    resolveLayoutBlock(input.templateType),
    "",
    "CONTENT:",
    resolveContentBlock(input.templateType, input.content),
    "",
    "BRAND:",
    resolveBrandBlock(resolvedBrandKit),
    "",
    "QUALITY:",
    "ultra sharp, high resolution, visually balanced, social media ready, crisp typography, mobile-friendly framing",
  ].join("\n");
}
