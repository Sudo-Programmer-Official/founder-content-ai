import type {
  BrandKit,
  BrandKitAccentStyle,
  BrandKitBackgroundStyle,
  BrandKitBrandPlacement,
  BrandKitFontStyle,
  BrandKitInput,
  BrandKitTone,
  BrandKitVisualStyle,
  MediaSuggestionType,
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
  accentStyle: "highlight_box",
  brandPlacement: "top_left",
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

function sanitizePhrase(value: string | undefined, maxLength = 72): string {
  const normalized = collapseWhitespace(value)
    .replace(/^[\s"'()[\]]+/, "")
    .replace(/[\s"'()[\].,!?;:]+$/, "")
    .trim();

  if (!normalized) {
    return "";
  }

  return truncateAtWordBoundary(normalized, maxLength);
}

function extractHighlightCandidate(value: string): string {
  const normalized = collapseWhitespace(value);

  if (!normalized) {
    return "";
  }

  const preferredPatterns = [
    /\babout\s+(.+)$/i,
    /\bwithout\s+(.+)$/i,
    /\bwith(?:out)?\s+(.+)$/i,
    /\bthan\s+(.+)$/i,
    /\binto\s+(.+)$/i,
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

  const tailLengths = [4, 3, 2];

  for (const size of tailLengths) {
    const candidate = sanitizePhrase(words.slice(-size).join(" "), 64);

    if (candidate.split(/\s+/).length >= 2) {
      return candidate;
    }
  }

  return sanitizePhrase(normalized, 64);
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
  const accentStyle = sanitizeEnum<BrandKitAccentStyle>(
    brandKit.accentStyle,
    ["highlight_box", "underline", "bold"],
    DEFAULT_BRAND_KIT.accentStyle,
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
  const accentDescriptions: Record<BrandKitAccentStyle, string> = {
    highlight_box: "highlight phrases land inside a restrained contrast block",
    underline: "highlight phrases use a sharp underline rather than a box",
    bold: "highlight phrases rely on oversized bold emphasis instead of extra containers",
  };

  return [
    backgroundDescriptions[backgroundStyle],
    fontDescriptions[fontStyle],
    visualDescriptions[visualStyle],
    accentDescriptions[accentStyle],
    `color palette led by ${primaryColor} and ${secondaryColor}`,
  ].join(", ");
}

function resolveLayoutBlock(
  templateType: VisualTemplateType,
  brandKit: BrandKitInput,
  options?: {
    generatedMediaType?: MediaSuggestionType;
    brandSignatureMode?: "subtle" | "closing";
    slideVisualRole?: "hook" | "problem" | "story" | "breakdown" | "takeaway";
  },
): string {
  const brandPlacement = sanitizeEnum<BrandKitBrandPlacement>(
    brandKit.brandPlacement,
    ["top_left", "bottom_right", "side_label"],
    DEFAULT_BRAND_KIT.brandPlacement,
  );
  const accentStyle = sanitizeEnum<BrandKitAccentStyle>(
    brandKit.accentStyle,
    ["highlight_box", "underline", "bold"],
    DEFAULT_BRAND_KIT.accentStyle,
  );
  const brandPlacementDescription: Record<BrandKitBrandPlacement, string> = {
    top_left: "small brand signature locked to the top-left corner",
    bottom_right: "small brand signature locked to the bottom-right corner",
    side_label: "vertical side label locked to one edge",
  };
  const accentDescription: Record<BrandKitAccentStyle, string> = {
    highlight_box: "one highlighted phrase inside a contrast box",
    underline: "one highlighted phrase with an accent underline",
    bold: "one highlighted phrase using oversized bold emphasis",
  };
  const carouselRoleDescription: Record<
    NonNullable<typeof options>["slideVisualRole"] extends infer TValue
      ? Exclude<TValue, undefined>
      : never,
    string
  > = {
    hook: "hook slide with oversized headline, highest contrast, minimal supporting copy, and when the hook splits into setup and punchline use a thin low-opacity divider line between the two text blocks",
    problem: "problem slide with a bold tension statement and concise support",
    story: "story slide with smaller text, more whitespace, and calmer pacing",
    breakdown: "breakdown slide with structured layout and restrained emphasis",
    takeaway: "takeaway slide with a strong close and decisive finish",
  };

  if (options?.generatedMediaType === "photo_overlay") {
    return `realistic social photography background, authentic environment, clean negative space reserved for a later headline card, no typography baked into the photo, no interface chrome, no caption paragraphs, mobile-first crop, trustworthy and polished`;
  }

  switch (templateType) {
    case "quote":
      return `contrast quote card, ${brandPlacementDescription[brandPlacement]}, neutral intro line, ${accentDescription[accentStyle]}, optional closing line below, maximum 4 text blocks, keep content padding and brand padding aligned`;
    case "insight":
      return `editorial insight card, ${brandPlacementDescription[brandPlacement]}, title at top, 2 to 3 short bullet insights below, one emphasized key phrase, clean grid spacing, obvious scan hierarchy, keep the brand off the bottom center`;
    case "contrarian":
      return `split emphasis layout, ${brandPlacementDescription[brandPlacement]}, quiet setup copy on one side, oversized emphasis phrase on the opposite side, hard contrast, built to stop scroll on mobile`;
    case "carousel":
      return `premium LinkedIn carousel slide, footer brand signature locked to the bottom-right corner on every slide, ${options?.slideVisualRole ? carouselRoleDescription[options.slideVisualRole] : "one dominant headline, optional supporting line, optional 2 to 3 compact bullets"}, controlled spacing, same typography system across every slide, subtle footer branding on every slide using the workspace brand label, maximum one accent phrase and some slides can skip the accent entirely, footer branding must stay low-prominence and clear of the main content area${options?.slideVisualRole === "hook" ? ", keep the divider elegant: 1 to 2 pixels, low opacity, and roughly half the text width rather than full bleed" : ""}${options?.brandSignatureMode === "closing" ? ", this is the final slide so keep the footer in the same bottom-right position but make it slightly larger, higher-contrast, and accent-led without overpowering the copy" : ""}`;
    default:
      return "clean social-first layout with clear hierarchy";
  }
}

function resolveContentBlock(
  templateType: VisualTemplateType,
  content: VisualPromptContent,
  options?: {
    generatedMediaType?: MediaSuggestionType;
  },
): string {
  const headline = toPunchyLine(content.headline, 120);
  const supportingText = toPunchyLine(content.supportingText, 90);
  const bulletPoints = (content.bulletPoints ?? [])
    .map((point) => toPunchyLine(point, 72))
    .filter(Boolean)
    .slice(0, 3);
  const highlightText = sanitizePhrase(
    content.highlightText ?? extractHighlightCandidate(content.headline || content.supportingText || ""),
    64,
  );
  const eyebrowText = sanitizePhrase(content.eyebrowText, 36);
  const footerText = sanitizePhrase(content.footerText, 42);
  const closingText = toPunchyLine(content.closingText, 72);
  const sceneDescription = collapseWhitespace(content.sceneDescription);

  if (options?.generatedMediaType === "photo_overlay") {
    return [
      sceneDescription ? `Scene subject only, never rendered as text: "${truncateAtWordBoundary(sceneDescription, 180)}"` : undefined,
      `Reserved headline copy for later overlay treatment: "${truncateAtWordBoundary(headline, 96)}"`,
      supportingText ? `Optional micro support for later overlay treatment only: "${truncateAtWordBoundary(supportingText, 52)}"` : undefined,
      closingText ? `Optional CTA chip for later overlay treatment only: "${truncateAtWordBoundary(closingText, 28)}"` : undefined,
      eyebrowText ? `Optional eyebrow label for later overlay treatment only: "${eyebrowText}"` : undefined,
      footerText ? `Mandatory later brand signature label: "${footerText}"` : undefined,
      "Generate the background photo only.",
      "Do not render any words, logos, labels, UI chrome, CTA buttons, watermark text, or paragraph copy into the photo itself.",
      "Protect a clean lower-third safe area so post-production overlay text fits comfortably inside the frame.",
    ]
      .filter(Boolean)
      .join(" ");
  }

  if (templateType === "insight") {
    return [
      `Title: "${headline}"`,
      highlightText ? `Highlight phrase: "${highlightText}"` : undefined,
      bulletPoints.length > 0
        ? `Points: ${bulletPoints.map((point) => `- ${point}`).join(" ")}`
        : undefined,
      footerText ? `Footer: "${footerText}"` : undefined,
    ]
      .filter(Boolean)
      .join(" ");
  }

  if (templateType === "carousel") {
    return [
      `Headline: "${headline}"`,
      highlightText ? `Accent phrase: "${highlightText}"` : undefined,
      supportingText ? `Subtext: "${supportingText}"` : undefined,
      bulletPoints.length > 0
        ? `Bullets: ${bulletPoints.map((point) => `- ${point}`).join(" ")}`
        : undefined,
      footerText ? `Mandatory footer brand label (bottom-right): "${footerText}"` : undefined,
    ]
      .filter(Boolean)
      .join(" ");
  }

  if (templateType === "contrarian") {
    return [
      eyebrowText ? `Eyebrow: "${eyebrowText}"` : undefined,
      `Setup: "${headline}"`,
      highlightText ? `Emphasis phrase: "${highlightText}"` : undefined,
      supportingText ? `Optional support: "${supportingText}"` : undefined,
      footerText ? `Footer: "${footerText}"` : undefined,
    ]
      .filter(Boolean)
      .join(" ");
  }

  return [
    eyebrowText ? `Eyebrow: "${eyebrowText}"` : undefined,
    `Intro: "${headline}"`,
    highlightText ? `Highlight phrase: "${highlightText}"` : undefined,
    closingText || supportingText ? `Closing: "${closingText || supportingText}"` : undefined,
    footerText ? `Footer: "${footerText}"` : undefined,
  ]
    .filter(Boolean)
    .join(" ");
}

function resolveCustomStyleBlock(content: VisualPromptContent): string | undefined {
  const customStylePrompt = sanitizePhrase(content.customStylePrompt, 160);

  if (!customStylePrompt) {
    return undefined;
  }

  return [
    `Honor this extra visual direction: "${customStylePrompt}"`,
    "Treat it as art direction and composition guidance, not as extra text that must be rendered verbatim.",
    "Keep the output branded, readable, and suitable for a polished social post.",
  ].join(" ");
}

function resolveBrandBlock(
  brandKit: BrandKitInput,
  options?: {
    brandSignatureMode?: "subtle" | "closing";
    slideVisualRole?: "hook" | "problem" | "story" | "breakdown" | "takeaway";
  },
): string {
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
  const accentStyle = sanitizeEnum<BrandKitAccentStyle>(
    brandKit.accentStyle,
    ["highlight_box", "underline", "bold"],
    DEFAULT_BRAND_KIT.accentStyle,
  );
  const brandPlacement = sanitizeEnum<BrandKitBrandPlacement>(
    brandKit.brandPlacement,
    ["top_left", "bottom_right", "side_label"],
    DEFAULT_BRAND_KIT.brandPlacement,
  );
  const colorPalette = resolveDefaultColors(backgroundStyle);
  const primaryColor = sanitizeColor(brandKit.primaryColor, colorPalette.primaryColor);
  const secondaryColor = sanitizeColor(brandKit.secondaryColor, colorPalette.secondaryColor);

  return [
    `${tone} brand tone`,
    `${visualStyle} visual system`,
    `${backgroundStyle} background treatment`,
    `${fontStyle} type direction`,
    `${accentStyle} accent treatment`,
    options?.slideVisualRole
      ? "carousel footer branding locked to the bottom-right"
      : `${brandPlacement} brand placement`,
    `use ${primaryColor} as the dominant brand color`,
    `use ${secondaryColor} for contrast or accent`,
    brandKit.logoUrl
      ? "include a small restrained brand mark or logo in the chosen placement"
      : "use a tiny brand mark rather than a large logo",
    options?.brandSignatureMode === "closing"
      ? "keep branding consistent with the rest of the deck, but let this closing slide carry a slightly stronger bottom-right footer signature"
      : "keep branding low-prominence, consistent, and present on every slide as a subtle bottom-right footer rather than a watermark",
    options?.slideVisualRole === "story"
      ? "story slides should protect whitespace and readability over decorative treatment"
      : options?.slideVisualRole === "breakdown"
        ? "breakdown slides should feel structured and easy to scan"
        : undefined,
    "LinkedIn-native composition, control attention flow through contrast and hierarchy, align brand spacing with content spacing, never place the brand centered at the bottom",
  ]
    .filter(Boolean)
    .join(", ");
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
    accentStyle: sanitizeEnum<BrandKitAccentStyle>(
      input.accentStyle,
      ["highlight_box", "underline", "bold"],
      DEFAULT_BRAND_KIT.accentStyle,
    ),
    brandPlacement: sanitizeEnum<BrandKitBrandPlacement>(
      input.brandPlacement,
      ["top_left", "bottom_right", "side_label"],
      DEFAULT_BRAND_KIT.brandPlacement,
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
  renderContext?: {
    generatedMediaType?: MediaSuggestionType;
    brandSignatureMode?: "subtle" | "closing";
    slideVisualRole?: "hook" | "problem" | "story" | "breakdown" | "takeaway";
    highlightMode?: "none" | "single";
  };
}): string {
  const resolvedBrandKit = resolveBrandKit(input.brandKit);
  const customStyleBlock = resolveCustomStyleBlock(input.content);

  return [
    "STYLE:",
    resolveStyleBlock(resolvedBrandKit),
    customStyleBlock ? `Additional direction: ${customStyleBlock}` : undefined,
    "",
    "LAYOUT:",
    resolveLayoutBlock(input.templateType, resolvedBrandKit, input.renderContext),
    "",
    "CONTENT:",
    resolveContentBlock(input.templateType, input.content, input.renderContext),
    "",
    "BRAND:",
    resolveBrandBlock(resolvedBrandKit, input.renderContext),
    "",
    "QUALITY:",
    input.renderContext?.generatedMediaType === "photo_overlay"
      ? "ultra sharp, high resolution, visually balanced, realistic photography, authentic lighting, natural textures, trustworthy expressions, clean overlay space, mobile-friendly framing, no uncanny faces or hands, no generic stock-business look, no bottom-centered branding"
      :
    input.templateType === "carousel"
      ? `ultra sharp, high resolution, visually balanced, social media ready, crisp typography, mobile-friendly framing, high hierarchy, strong contrast, intentional restraint, text-first composition, no bottom-centered branding, subtle branding on every slide, maximum one accent phrase per slide${input.renderContext?.highlightMode === "none" ? ", do not add a highlight treatment on this slide" : ""}`
      : "ultra sharp, high resolution, visually balanced, social media ready, crisp typography, mobile-friendly framing, high hierarchy, strong contrast, intentional restraint, text-first composition, no bottom-centered branding",
  ]
    .filter((section): section is string => Boolean(section))
    .join("\n");
}
