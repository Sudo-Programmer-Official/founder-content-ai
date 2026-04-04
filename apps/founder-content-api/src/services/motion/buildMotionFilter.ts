import type {
  BrandKit,
  MotionTemplateAspectRatio,
  MotionTemplateMetadata,
} from "../../../../../packages/shared-types/index.ts";
import { buildCameraMotion, formatMotionSeconds } from "./cameraMotion.ts";
import { buildMotionOverlayPlans, type MotionOverlayLayerPlan } from "./textAnimations.ts";
import { getMotionTemplateConfig } from "./templates.ts";

const DEFAULT_MOTION_RENDER_FPS = 24;

export interface MotionFilterBuildInput {
  width: number;
  height: number;
  aspectRatio: MotionTemplateAspectRatio;
  durationMs: number;
  template: MotionTemplateMetadata;
  brandKit?: BrandKit;
}

export interface MotionFilterBuildResult {
  renderFps: number;
  durationSeconds: number;
  overlayLayers: MotionOverlayLayerPlan[];
  filterGraph: string;
}

export function resolveMotionRenderFps(): number {
  const parsed = Number(process.env.MOTION_RENDER_FPS ?? DEFAULT_MOTION_RENDER_FPS);

  if (!Number.isFinite(parsed)) {
    return DEFAULT_MOTION_RENDER_FPS;
  }

  return Math.min(Math.max(Math.floor(parsed), 12), 30);
}

export async function buildMotionFilter(input: MotionFilterBuildInput): Promise<MotionFilterBuildResult> {
  const renderFps = resolveMotionRenderFps();
  const durationSeconds = Number((input.durationMs / 1000).toFixed(2));
  const totalFrames = Math.max(Math.round((input.durationMs / 1000) * renderFps), 1);
  const config = getMotionTemplateConfig(input.template.id, input.aspectRatio);
  const overlayLayers = await buildMotionOverlayPlans({
    width: input.width,
    height: input.height,
    aspectRatio: input.aspectRatio,
    template: input.template,
    config,
    brandKit: input.brandKit,
  });

  const filterGraph: string[] = [
    `[0:v]${buildCameraMotion({
      templateId: input.template.id,
      width: input.width,
      height: input.height,
      totalFrames,
      durationSeconds,
      aspectRatio: input.aspectRatio,
      renderFps,
    })}[bg0]`,
  ];
  let previousLabel = "bg0";

  overlayLayers.forEach((layer, index) => {
    const inputIndex = index + 1;
    const layerLabel = `layer${index}`;
    const pulseFilter =
      typeof layer.pulseAfter === "number"
        ? `,scale=w='round(iw*(1+0.028*gte(t,${formatMotionSeconds(layer.pulseAfter)})*abs(sin(2*PI*(t-${formatMotionSeconds(layer.pulseAfter)})/1.4))))':h='round(ih*(1+0.028*gte(t,${formatMotionSeconds(layer.pulseAfter)})*abs(sin(2*PI*(t-${formatMotionSeconds(layer.pulseAfter)})/1.4))))':eval=frame`
        : "";
    filterGraph.push(
      `[${inputIndex}:v]format=rgba,fade=t=in:st=${formatMotionSeconds(layer.introStart)}:d=${formatMotionSeconds(layer.introDuration)}:alpha=1${pulseFilter}[${layerLabel}]`,
    );
    const nextLabel = `bg${index + 1}`;
    filterGraph.push(
      `[${previousLabel}][${layerLabel}]overlay=x='${layer.xExpression}':y='${layer.yExpression}':shortest=1:format=auto[${nextLabel}]`,
    );
    previousLabel = nextLabel;
  });

  return {
    renderFps,
    durationSeconds,
    overlayLayers,
    filterGraph: filterGraph.join(";"),
  };
}
