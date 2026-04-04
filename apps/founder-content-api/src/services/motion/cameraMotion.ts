import type {
  MotionTemplateAspectRatio,
  MotionTemplateId,
} from "../../../../../packages/shared-types/index.ts";

export interface MotionBackgroundFilterInput {
  templateId: MotionTemplateId;
  width: number;
  height: number;
  totalFrames: number;
  durationSeconds: number;
  aspectRatio: MotionTemplateAspectRatio;
  renderFps: number;
}

export function formatMotionSeconds(value: number): string {
  return value.toFixed(2);
}

export function buildCameraMotion(input: MotionBackgroundFilterInput): string {
  const {
    templateId,
    width,
    height,
    totalFrames,
    durationSeconds,
    aspectRatio,
    renderFps,
  } = input;
  const clampedFrames = Math.max(totalFrames - 1, 1);
  const fadeOutStart = Math.max(durationSeconds - 0.35, 0.1).toFixed(2);
  let animationFilter = "";

  if (templateId === "caption_pulse") {
    animationFilter =
      `zoompan=z='1+0.024*sin(on/10)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':` +
      `d=1:s=${width}x${height}:fps=${renderFps}`;
  } else if (templateId === "founder_story") {
    animationFilter =
      `zoompan=z='min(zoom+0.00024,1.05)':x='iw/2-(iw/zoom/2)+5*sin(on/28)':y='ih/2-(ih/zoom/2)':` +
      `d=1:s=${width}x${height}:fps=${renderFps}`;
  } else if (templateId === "offer_burst") {
    animationFilter =
      `zoompan=z='min(zoom+0.00072,1.14)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':` +
      `d=1:s=${width}x${height}:fps=${renderFps}`;
  } else if (templateId === "testimonial_highlight") {
    animationFilter =
      aspectRatio === "portrait"
        ? `zoompan=z='1.05':x='iw/2-(iw/zoom/2)':y='(ih-ih/zoom)*(0.35+0.15*sin(on/18))':d=1:s=${width}x${height}:fps=${renderFps}`
        : `zoompan=z='1.04':x='(iw-iw/zoom)*(0.28+0.12*sin(on/18))':y='ih/2-(ih/zoom/2)':d=1:s=${width}x${height}:fps=${renderFps}`;
  } else if (templateId === "local_awareness") {
    animationFilter =
      aspectRatio === "portrait"
        ? `zoompan=z='1.08':x='iw/2-(iw/zoom/2)+16*sin(on/22)':y='(ih-ih/zoom)*(on/${clampedFrames})':d=1:s=${width}x${height}:fps=${renderFps}`
        : `zoompan=z='1.08':x='(iw-iw/zoom)*(on/${clampedFrames})':y='ih/2-(ih/zoom/2)+10*sin(on/22)':d=1:s=${width}x${height}:fps=${renderFps}`;
  } else if (templateId === "story_pan") {
    animationFilter =
      aspectRatio === "portrait"
        ? `zoompan=z='1.12':x='iw/2-(iw/zoom/2)':y='(ih-ih/zoom)*(on/${clampedFrames})':d=1:s=${width}x${height}:fps=${renderFps}`
        : `zoompan=z='1.10':x='(iw-iw/zoom)*(on/${clampedFrames})':y='ih/2-(ih/zoom/2)':d=1:s=${width}x${height}:fps=${renderFps}`;
  } else {
    animationFilter =
      `zoompan=z='min(zoom+0.00038,1.07)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':` +
      `d=1:s=${width}x${height}:fps=${renderFps}`;
  }

  return [
    animationFilter,
    "setsar=1",
    "format=yuv420p",
    "fade=t=in:st=0:d=0.25",
    `fade=t=out:st=${fadeOutStart}:d=0.35`,
  ].join(",");
}
