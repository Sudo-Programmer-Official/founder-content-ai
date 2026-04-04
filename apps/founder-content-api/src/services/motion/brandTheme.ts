import type {
  BrandKit,
  BrandKitAccentStyle,
  BrandKitBrandPlacement,
} from "../../../../../packages/shared-types/index.ts";

export interface MotionBrandTheme {
  accentColor: string;
  accentTextColor: string;
  gradientStart: string;
  gradientEnd: string;
  surfaceColor: string;
  surfaceOpacity: number;
  subtleSurfaceColor: string;
  subtleSurfaceOpacity: number;
  textColor: string;
  brandPlacement: BrandKitBrandPlacement;
  accentStyle: BrandKitAccentStyle;
}

const DEFAULT_ACCENT_COLOR = "#5B48F6";
const DEFAULT_SURFACE_COLOR = "#0F172A";
const DEFAULT_TEXT_COLOR = "#FFFFFF";

function normalizeHexColor(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim();

  if (/^#[0-9a-fA-F]{6}$/.test(normalized)) {
    return normalized.toUpperCase();
  }

  if (/^#[0-9a-fA-F]{3}$/.test(normalized)) {
    const [, r, g, b] = normalized;
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }

  return null;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16),
  };
}

function toHexColor(rgb: { r: number; g: number; b: number }): string {
  return `#${[rgb.r, rgb.g, rgb.b]
    .map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0"))
    .join("")}`.toUpperCase();
}

function mixHexColors(base: string, target: string, ratio: number): string {
  const clampedRatio = Math.max(0, Math.min(1, ratio));
  const baseRgb = hexToRgb(base);
  const targetRgb = hexToRgb(target);

  return toHexColor({
    r: baseRgb.r + ((targetRgb.r - baseRgb.r) * clampedRatio),
    g: baseRgb.g + ((targetRgb.g - baseRgb.g) * clampedRatio),
    b: baseRgb.b + ((targetRgb.b - baseRgb.b) * clampedRatio),
  });
}

function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const channels = [r, g, b].map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });

  return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2]);
}

function resolveAccentColor(brandKit?: BrandKit): string {
  const primary = normalizeHexColor(brandKit?.primaryColor);
  const secondary = normalizeHexColor(brandKit?.secondaryColor);

  if (!primary && !secondary) {
    return DEFAULT_ACCENT_COLOR;
  }

  if (!primary) {
    return secondary ?? DEFAULT_ACCENT_COLOR;
  }

  const primaryLuminance = relativeLuminance(primary);

  if (primaryLuminance < 0.14) {
    if (secondary && relativeLuminance(secondary) < 0.92) {
      return secondary;
    }

    return mixHexColors(primary, "#FFFFFF", 0.28);
  }

  return primary;
}

function resolveSurfaceColor(brandKit?: BrandKit): string {
  const primary = normalizeHexColor(brandKit?.primaryColor);

  if (!primary) {
    return DEFAULT_SURFACE_COLOR;
  }

  return brandKit?.backgroundStyle === "light"
    ? mixHexColors(primary, "#FFFFFF", 0.84)
    : mixHexColors(primary, "#0B1120", 0.44);
}

export function resolveMotionBrandTheme(brandKit?: BrandKit): MotionBrandTheme {
  const accentColor = resolveAccentColor(brandKit);
  const accentTextColor = relativeLuminance(accentColor) > 0.58 ? "#111827" : "#FFFFFF";
  const surfaceColor = resolveSurfaceColor(brandKit);
  const gradientStart = accentColor;
  const gradientEnd = mixHexColors(accentColor, "#0B1120", 0.22);
  const textColor =
    brandKit?.backgroundStyle === "light" && relativeLuminance(surfaceColor) > 0.84
      ? "#0F172A"
      : DEFAULT_TEXT_COLOR;

  return {
    accentColor,
    accentTextColor,
    gradientStart,
    gradientEnd,
    surfaceColor,
    surfaceOpacity: brandKit?.backgroundStyle === "light" ? 0.9 : 0.78,
    subtleSurfaceColor:
      brandKit?.backgroundStyle === "light"
        ? mixHexColors(surfaceColor, "#FFFFFF", 0.08)
        : surfaceColor,
    subtleSurfaceOpacity: brandKit?.backgroundStyle === "light" ? 0.82 : 0.56,
    textColor,
    brandPlacement: brandKit?.brandPlacement ?? "top_left",
    accentStyle: brandKit?.accentStyle ?? "highlight_box",
  };
}
