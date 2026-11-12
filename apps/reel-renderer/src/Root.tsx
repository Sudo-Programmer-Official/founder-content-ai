import { Composition } from "remotion";
import type { ReelRenderProps } from "../../../packages/shared-types/src/reel-studio";
import { ReelComposition } from "./ReelComposition";
import { sampleRenderProps } from "./sample";

export const REEL_COMPOSITION_ID = "Reel";

export function RemotionRoot() {
  return (
    <Composition
      id={REEL_COMPOSITION_ID}
      component={ReelComposition}
      width={1080}
      height={1920}
      fps={30}
      durationInFrames={sampleRenderProps.durationInFrames}
      defaultProps={sampleRenderProps}
      calculateMetadata={({ props }: { props: ReelRenderProps }) => ({
        durationInFrames: props.durationInFrames,
        fps: props.fps,
        width: props.width,
        height: props.height,
      })}
    />
  );
}
