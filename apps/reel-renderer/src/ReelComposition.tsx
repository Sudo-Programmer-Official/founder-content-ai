import { AbsoluteFill, Html5Audio, Sequence, staticFile } from "remotion";
import type { ReelRenderProps, ReelScene } from "../../../packages/shared-types/src/reel-studio";
import { Background, BrandChip, Captions, ProgressBar } from "./primitives";
import { BulletsScene } from "./scenes/BulletsScene";
import { CodeScene } from "./scenes/CodeScene";
import { ComparisonScene } from "./scenes/ComparisonScene";
import { FlowScene } from "./scenes/FlowScene";
import { OutroScene } from "./scenes/OutroScene";
import { StatScene } from "./scenes/StatScene";
import { TitleScene } from "./scenes/TitleScene";
import { getTheme, type ReelTheme } from "./theme";

function SceneSwitch(props: { scene: ReelScene; theme: ReelTheme; durationInFrames: number; brandHandle?: string }) {
  const { scene, theme, durationInFrames } = props;

  switch (scene.type) {
    case "title":
      return <TitleScene scene={scene} theme={theme} durationInFrames={durationInFrames} />;
    case "bullets":
      return <BulletsScene scene={scene} theme={theme} durationInFrames={durationInFrames} />;
    case "flow":
      return <FlowScene scene={scene} theme={theme} durationInFrames={durationInFrames} />;
    case "stat":
      return <StatScene scene={scene} theme={theme} durationInFrames={durationInFrames} />;
    case "comparison":
      return <ComparisonScene scene={scene} theme={theme} durationInFrames={durationInFrames} />;
    case "code":
      return <CodeScene scene={scene} theme={theme} durationInFrames={durationInFrames} />;
    case "outro":
      return <OutroScene scene={scene} theme={theme} durationInFrames={durationInFrames} brandHandle={props.brandHandle} />;
    default:
      return null;
  }
}

export function ReelComposition(props: ReelRenderProps) {
  const theme = getTheme(props.style);
  const scenesById = new Map(props.storyboard.scenes.map((scene) => [scene.id, scene]));

  return (
    <AbsoluteFill style={{ background: theme.background }}>
      <Background theme={theme} />

      {props.timeline.map((entry) => {
        const scene = scenesById.get(entry.sceneId);

        if (!scene) {
          return null;
        }

        return (
          <Sequence key={entry.sceneId} from={entry.startFrame} durationInFrames={entry.durationInFrames} name={`${scene.type}:${scene.id}`}>
            <SceneSwitch scene={scene} theme={theme} durationInFrames={entry.durationInFrames} brandHandle={props.brandHandle} />
          </Sequence>
        );
      })}

      {props.showCaptions
        ? props.timeline.map((entry) => (
            <Sequence key={`captions-${entry.sceneId}`} from={entry.startFrame} durationInFrames={entry.durationInFrames}>
              <Captions theme={theme} cues={entry.captions} />
            </Sequence>
          ))
        : null}

      <ProgressBar theme={theme} />
      {props.brandHandle ? <BrandChip theme={theme} handle={props.brandHandle} /> : null}
      {props.audioFile ? <Html5Audio src={staticFile(props.audioFile)} /> : null}
    </AbsoluteFill>
  );
}
