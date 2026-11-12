import { loadFont as loadJetBrainsMono } from "@remotion/google-fonts/JetBrainsMono";
import { loadFont as loadNotoSansDevanagari } from "@remotion/google-fonts/NotoSansDevanagari";
import { loadFont as loadPoppins } from "@remotion/google-fonts/Poppins";
import { loadFont as loadSpaceGrotesk } from "@remotion/google-fonts/SpaceGrotesk";
import type { ReelVisualStyle } from "../../../packages/shared-types/src/reel-studio";

const spaceGrotesk = loadSpaceGrotesk("normal", { weights: ["500", "700"], subsets: ["latin", "latin-ext"] });
const poppins = loadPoppins("normal", { weights: ["500", "700"], subsets: ["latin", "latin-ext", "devanagari"] });
const devanagari = loadNotoSansDevanagari("normal", { weights: ["500", "700"], subsets: ["devanagari"] });
const mono = loadJetBrainsMono("normal", { weights: ["500"], subsets: ["latin"] });

export interface ReelTheme {
  id: ReelVisualStyle;
  dark: boolean;
  background: string;
  text: string;
  textMuted: string;
  accent: string;
  accentSecondary: string;
  accentText: string;
  surface: string;
  surfaceBorder: string;
  /** Applied to accent-coloured text and lines; empty for flat styles. */
  glow: (color: string) => string;
  headingFont: string;
  bodyFont: string;
  monoFont: string;
  codeBackground: string;
}

export const THEMES: Record<ReelVisualStyle, ReelTheme> = {
  neon_tech: {
    id: "neon_tech",
    dark: true,
    background: "#050712",
    text: "#f5f7ff",
    textMuted: "#9aa4c7",
    accent: "#22e4ff",
    accentSecondary: "#b45cff",
    accentText: "#03121a",
    surface: "rgba(16, 22, 48, 0.78)",
    surfaceBorder: "rgba(34, 228, 255, 0.35)",
    glow: (color) => `0 0 18px ${color}, 0 0 42px ${color}66`,
    headingFont: `${spaceGrotesk.fontFamily}, ${devanagari.fontFamily}, sans-serif`,
    bodyFont: `${spaceGrotesk.fontFamily}, ${devanagari.fontFamily}, sans-serif`,
    monoFont: `${mono.fontFamily}, monospace`,
    codeBackground: "rgba(6, 10, 26, 0.92)",
  },
  minimal_motion: {
    id: "minimal_motion",
    dark: false,
    background: "#f6f3ec",
    text: "#14161c",
    textMuted: "#5d6170",
    accent: "#ff5a36",
    accentSecondary: "#2f5bff",
    accentText: "#ffffff",
    surface: "#ffffff",
    surfaceBorder: "rgba(20, 22, 28, 0.1)",
    glow: () => "none",
    headingFont: `${poppins.fontFamily}, ${devanagari.fontFamily}, sans-serif`,
    bodyFont: `${poppins.fontFamily}, ${devanagari.fontFamily}, sans-serif`,
    monoFont: `${mono.fontFamily}, monospace`,
    codeBackground: "#14161c",
  },
};

export function getTheme(style: ReelVisualStyle): ReelTheme {
  return THEMES[style] ?? THEMES.neon_tech;
}

/** Shrinks type for longer strings so headings never overflow the 9:16 frame. */
export function fitFontSize(text: string, base: number, min: number, comfortableChars: number): number {
  const length = [...text].length;

  if (length <= comfortableChars) {
    return base;
  }

  return Math.max(min, Math.round(base * Math.sqrt(comfortableChars / length)));
}
