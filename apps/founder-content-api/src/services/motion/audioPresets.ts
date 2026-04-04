import type {
  MotionAudioPreset,
  MotionAudioTrack,
  MotionTemplateId,
} from "../../../../../packages/shared-types/index.ts";

export interface MotionAudioPresetConfig {
  preset: MotionAudioPreset;
  track: MotionAudioTrack;
  assetFileName: string;
  volume: number;
  fadeIn: number;
  fadeOut: number;
  ducking: boolean;
}

export const MOTION_AUDIO_PRESETS: Record<MotionAudioPreset, MotionAudioPresetConfig> = {
  clean_modern: {
    preset: "clean_modern",
    track: "calm",
    assetFileName: "clean_modern_1.mp3",
    volume: 0.22,
    fadeIn: 0.4,
    fadeOut: 0.6,
    ducking: true,
  },
  high_energy_promo: {
    preset: "high_energy_promo",
    track: "upbeat",
    assetFileName: "promo_fast_1.mp3",
    volume: 0.28,
    fadeIn: 0.2,
    fadeOut: 0.5,
    ducking: true,
  },
  local_trust: {
    preset: "local_trust",
    track: "ambient",
    assetFileName: "warm_local_1.mp3",
    volume: 0.18,
    fadeIn: 0.5,
    fadeOut: 0.7,
    ducking: true,
  },
  luxury_minimal: {
    preset: "luxury_minimal",
    track: "ambient",
    assetFileName: "luxury_soft_1.mp3",
    volume: 0.15,
    fadeIn: 0.6,
    fadeOut: 1.0,
    ducking: true,
  },
  calm_wellness: {
    preset: "calm_wellness",
    track: "calm",
    assetFileName: "calm_wellness_1.mp3",
    volume: 0.14,
    fadeIn: 0.8,
    fadeOut: 1.2,
    ducking: true,
  },
};

export function getMotionAudioPresetConfig(preset: MotionAudioPreset): MotionAudioPresetConfig {
  return MOTION_AUDIO_PRESETS[preset];
}

export function resolveMotionAudioPresetForTemplate(templateId: MotionTemplateId): MotionAudioPreset {
  if (templateId === "offer_burst" || templateId === "caption_pulse") {
    return "high_energy_promo";
  }

  if (templateId === "local_awareness") {
    return "local_trust";
  }

  if (templateId === "testimonial_highlight") {
    return "luxury_minimal";
  }

  if (templateId === "story_pan" || templateId === "founder_story") {
    return "clean_modern";
  }

  return "calm_wellness";
}

export function resolveMotionAudioPresetFromTrack(track: MotionAudioTrack): MotionAudioPreset {
  if (track === "upbeat") {
    return "high_energy_promo";
  }

  if (track === "ambient") {
    return "local_trust";
  }

  return "clean_modern";
}
