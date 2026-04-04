import type {
  MotionAudioPreset,
  MotionAudioTrack,
  MotionTemplateAspectRatio,
  MotionTemplateId,
} from "../../../../../packages/shared-types/index.ts";
import { getMotionAudioPresetConfig } from "./audioPresets.ts";

export type MotionTextBoxVariant = "problem" | "promo" | "calm" | "subtle";

export interface MotionTextAnimationConfig {
  introStart: number;
  introDuration: number;
  pulseAfter?: number;
  slideOffsetY?: number;
}

export interface MotionTextStyleConfig {
  maxLength: number;
  maxLineLength: number;
  maxLines: number;
  fontSize: number;
  lineHeight: number;
  variant: MotionTextBoxVariant;
  animation: MotionTextAnimationConfig;
}

export interface MotionTemplateConfig {
  centered: boolean;
  brandTop: number;
  brandAnimation: MotionTextAnimationConfig;
  headlineTopRatio: number;
  audio: MotionTemplateAudioConfig;
  headline: MotionTextStyleConfig;
  subheadline: MotionTextStyleConfig;
  cta: MotionTextStyleConfig;
}

export interface MotionTemplateAudioConfig {
  enabled: boolean;
  preset: MotionAudioPreset;
  track: MotionAudioTrack;
  volume: number;
  fadeIn: number;
  fadeOut: number;
  ducking: boolean;
}

function createAudioConfig(
  preset: MotionAudioPreset,
  overrides?: Partial<Omit<MotionTemplateAudioConfig, "preset" | "track">>,
): MotionTemplateAudioConfig {
  const presetConfig = getMotionAudioPresetConfig(preset);

  return {
    enabled: true,
    preset,
    track: presetConfig.track,
    volume: presetConfig.volume,
    fadeIn: presetConfig.fadeIn,
    fadeOut: presetConfig.fadeOut,
    ducking: presetConfig.ducking,
    ...overrides,
  };
}

export function getMotionTemplateConfig(
  templateId: MotionTemplateId,
  aspectRatio: MotionTemplateAspectRatio,
): MotionTemplateConfig {
  const isPortrait = aspectRatio === "portrait";

  if (templateId === "offer_burst") {
    return {
      centered: true,
      brandTop: isPortrait ? 48 : 34,
      brandAnimation: { introStart: 0.08, introDuration: 0.24, slideOffsetY: 0 },
      headlineTopRatio: 0.5,
      audio: createAudioConfig("high_energy_promo", {
        volume: 0.28,
        fadeIn: 0.12,
        fadeOut: 0.28,
      }),
      headline: {
        maxLength: 96,
        maxLineLength: isPortrait ? 15 : 17,
        maxLines: 3,
        fontSize: isPortrait ? 72 : 64,
        lineHeight: isPortrait ? 78 : 70,
        variant: "promo",
        animation: { introStart: 0.24, introDuration: 0.34, slideOffsetY: 42 },
      },
      subheadline: {
        maxLength: 120,
        maxLineLength: 30,
        maxLines: 2,
        fontSize: isPortrait ? 26 : 24,
        lineHeight: isPortrait ? 32 : 30,
        variant: "subtle",
        animation: { introStart: 0.82, introDuration: 0.28, slideOffsetY: 18 },
      },
      cta: {
        maxLength: 28,
        maxLineLength: 22,
        maxLines: 1,
        fontSize: 24,
        lineHeight: 30,
        variant: "promo",
        animation: { introStart: 1.75, introDuration: 0.2, pulseAfter: 2.05, slideOffsetY: 0 },
      },
    };
  }

  if (templateId === "testimonial_highlight") {
    return {
      centered: true,
      brandTop: isPortrait ? 54 : 34,
      brandAnimation: { introStart: 0.14, introDuration: 0.28, slideOffsetY: 0 },
      headlineTopRatio: 0.57,
      audio: createAudioConfig("luxury_minimal"),
      headline: {
        maxLength: 120,
        maxLineLength: isPortrait ? 18 : 22,
        maxLines: 3,
        fontSize: isPortrait ? 56 : 48,
        lineHeight: isPortrait ? 62 : 54,
        variant: "calm",
        animation: { introStart: 0.52, introDuration: 0.44, slideOffsetY: 26 },
      },
      subheadline: {
        maxLength: 120,
        maxLineLength: 32,
        maxLines: 2,
        fontSize: 24,
        lineHeight: 30,
        variant: "subtle",
        animation: { introStart: 1.18, introDuration: 0.34, slideOffsetY: 14 },
      },
      cta: {
        maxLength: 28,
        maxLineLength: 22,
        maxLines: 1,
        fontSize: 21,
        lineHeight: 28,
        variant: "promo",
        animation: { introStart: 2.95, introDuration: 0.22, pulseAfter: 3.2, slideOffsetY: 0 },
      },
    };
  }

  if (templateId === "local_awareness") {
    return {
      centered: false,
      brandTop: isPortrait ? 54 : 34,
      brandAnimation: { introStart: 0.1, introDuration: 0.24, slideOffsetY: 0 },
      headlineTopRatio: 0.56,
      audio: createAudioConfig("local_trust"),
      headline: {
        maxLength: 104,
        maxLineLength: isPortrait ? 16 : 18,
        maxLines: 3,
        fontSize: isPortrait ? 64 : 56,
        lineHeight: isPortrait ? 70 : 62,
        variant: "problem",
        animation: { introStart: 0.32, introDuration: 0.34, slideOffsetY: 38 },
      },
      subheadline: {
        maxLength: 132,
        maxLineLength: 28,
        maxLines: 3,
        fontSize: 24,
        lineHeight: 30,
        variant: "subtle",
        animation: { introStart: 0.92, introDuration: 0.28, slideOffsetY: 20 },
      },
      cta: {
        maxLength: 28,
        maxLineLength: 22,
        maxLines: 1,
        fontSize: 22,
        lineHeight: 28,
        variant: "promo",
        animation: { introStart: 2.2, introDuration: 0.2, pulseAfter: 2.55, slideOffsetY: 0 },
      },
    };
  }

  if (templateId === "founder_story") {
    return {
      centered: false,
      brandTop: isPortrait ? 54 : 34,
      brandAnimation: { introStart: 0.12, introDuration: 0.28, slideOffsetY: 0 },
      headlineTopRatio: 0.6,
      audio: createAudioConfig("clean_modern"),
      headline: {
        maxLength: 116,
        maxLineLength: isPortrait ? 17 : 19,
        maxLines: 3,
        fontSize: isPortrait ? 58 : 50,
        lineHeight: isPortrait ? 64 : 56,
        variant: "calm",
        animation: { introStart: 0.38, introDuration: 0.46, slideOffsetY: 22 },
      },
      subheadline: {
        maxLength: 136,
        maxLineLength: 32,
        maxLines: 3,
        fontSize: 23,
        lineHeight: 29,
        variant: "subtle",
        animation: { introStart: 1.12, introDuration: 0.38, slideOffsetY: 14 },
      },
      cta: {
        maxLength: 24,
        maxLineLength: 20,
        maxLines: 1,
        fontSize: 20,
        lineHeight: 26,
        variant: "subtle",
        animation: { introStart: 3.4, introDuration: 0.2, slideOffsetY: 0 },
      },
    };
  }

  if (templateId === "caption_pulse") {
    return {
      centered: true,
      brandTop: isPortrait ? 54 : 34,
      brandAnimation: { introStart: 0.1, introDuration: 0.3, slideOffsetY: 0 },
      headlineTopRatio: 0.54,
      audio: createAudioConfig("high_energy_promo", {
        fadeIn: 0.12,
        fadeOut: 0.3,
      }),
      headline: {
        maxLength: 110,
        maxLineLength: isPortrait ? 16 : 18,
        maxLines: 3,
        fontSize: isPortrait ? 68 : 60,
        lineHeight: isPortrait ? 74 : 66,
        variant: "problem",
        animation: { introStart: 0.42, introDuration: 0.4, slideOffsetY: 34 },
      },
      subheadline: {
        maxLength: 140,
        maxLineLength: 34,
        maxLines: 3,
        fontSize: 24,
        lineHeight: 30,
        variant: "subtle",
        animation: { introStart: 1.05, introDuration: 0.34, slideOffsetY: 22 },
      },
      cta: {
        maxLength: 32,
        maxLineLength: 24,
        maxLines: 1,
        fontSize: 22,
        lineHeight: 28,
        variant: "promo",
        animation: { introStart: 2.7, introDuration: 0.25, pulseAfter: 2.95, slideOffsetY: 0 },
      },
    };
  }

  if (templateId === "story_pan") {
    return {
      centered: true,
      brandTop: isPortrait ? 54 : 34,
      brandAnimation: { introStart: 0.1, introDuration: 0.3, slideOffsetY: 0 },
      headlineTopRatio: 0.58,
      audio: createAudioConfig("clean_modern", {
        volume: 0.24,
        fadeIn: 0.24,
        fadeOut: 0.45,
      }),
      headline: {
        maxLength: 110,
        maxLineLength: isPortrait ? 18 : 20,
        maxLines: 3,
        fontSize: isPortrait ? 60 : 54,
        lineHeight: isPortrait ? 66 : 60,
        variant: "promo",
        animation: { introStart: 0.42, introDuration: 0.4, slideOffsetY: 34 },
      },
      subheadline: {
        maxLength: 140,
        maxLineLength: 34,
        maxLines: 3,
        fontSize: 24,
        lineHeight: 30,
        variant: "subtle",
        animation: { introStart: 1.05, introDuration: 0.34, slideOffsetY: 22 },
      },
      cta: {
        maxLength: 32,
        maxLineLength: 24,
        maxLines: 1,
        fontSize: 22,
        lineHeight: 28,
        variant: "promo",
        animation: { introStart: 2.45, introDuration: 0.25, pulseAfter: 2.95, slideOffsetY: 0 },
      },
    };
  }

  return {
    centered: false,
    brandTop: isPortrait ? 54 : 34,
    brandAnimation: { introStart: 0.1, introDuration: 0.3, slideOffsetY: 0 },
    headlineTopRatio: 0.63,
    audio: createAudioConfig("calm_wellness"),
    headline: {
      maxLength: 110,
      maxLineLength: isPortrait ? 18 : 20,
      maxLines: 3,
      fontSize: isPortrait ? 54 : 48,
      lineHeight: isPortrait ? 60 : 54,
      variant: "calm",
      animation: { introStart: 0.42, introDuration: 0.4, slideOffsetY: 34 },
    },
    subheadline: {
      maxLength: 140,
      maxLineLength: 34,
      maxLines: 3,
      fontSize: 24,
      lineHeight: 30,
      variant: "subtle",
      animation: { introStart: 1.05, introDuration: 0.34, slideOffsetY: 22 },
    },
    cta: {
      maxLength: 32,
      maxLineLength: 24,
      maxLines: 1,
      fontSize: 22,
      lineHeight: 28,
      variant: "promo",
      animation: { introStart: 3.05, introDuration: 0.25, pulseAfter: 3.35, slideOffsetY: 0 },
    },
  };
}
