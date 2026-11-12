import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { ReelTitleScene } from "../../../../packages/shared-types/src/reel-studio";
import { Pill, SceneFrame, useEnter } from "../primitives";
import { fitFontSize, type ReelTheme } from "../theme";

export function TitleScene(props: { scene: ReelTitleScene; theme: ReelTheme; durationInFrames: number }) {
  const { scene, theme } = props;
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const kickerEnter = useEnter(0);
  const words = scene.title.split(/\s+/).filter(Boolean);
  const titleSize = fitFontSize(scene.title, 118, 72, 28);
  const subtitleDelay = 6 + words.length * 3 + 6;
  const subtitleEnter = useEnter(subtitleDelay);

  return (
    <SceneFrame durationInFrames={props.durationInFrames}>
      <div style={{ display: "flex", flexDirection: "column", gap: 44 }}>
        {scene.kicker ? (
          <div style={{ opacity: kickerEnter, transform: `translateY(${interpolate(kickerEnter, [0, 1], [20, 0])}px)` }}>
            <Pill theme={theme}>{scene.kicker}</Pill>
          </div>
        ) : null}

        <h1
          style={{
            margin: 0,
            fontFamily: theme.headingFont,
            fontWeight: 700,
            fontSize: titleSize,
            lineHeight: 1.05,
            letterSpacing: "-0.03em",
            color: theme.text,
          }}
        >
          {words.map((word, index) => {
            const progress = spring({ frame: frame - 6 - index * 3, fps, config: { damping: 14, mass: 0.6 } });
            const highlighted = index === words.length - 1 || index === words.length - 2;

            return (
              <span
                key={`${word}-${index}`}
                style={{
                  display: "inline-block",
                  marginRight: "0.24em",
                  opacity: progress,
                  transform: `translateY(${interpolate(progress, [0, 1], [50, 0])}px)`,
                  color: highlighted ? theme.accent : theme.text,
                  textShadow: highlighted && theme.dark ? theme.glow(`${theme.accent}99`) : "none",
                }}
              >
                {word}
              </span>
            );
          })}
        </h1>

        {scene.subtitle ? (
          <p
            style={{
              margin: 0,
              fontFamily: theme.bodyFont,
              fontWeight: 500,
              fontSize: fitFontSize(scene.subtitle, 48, 36, 60),
              lineHeight: 1.35,
              color: theme.textMuted,
              opacity: subtitleEnter,
              transform: `translateY(${interpolate(subtitleEnter, [0, 1], [24, 0])}px)`,
            }}
          >
            {scene.subtitle}
          </p>
        ) : null}
      </div>
    </SceneFrame>
  );
}
