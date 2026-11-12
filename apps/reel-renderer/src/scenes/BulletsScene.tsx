import { interpolate, useCurrentFrame, useVideoConfig, spring } from "remotion";
import type { ReelBulletsScene } from "../../../../packages/shared-types/src/reel-studio";
import { Heading, SceneFrame, staggerDelay } from "../primitives";
import { fitFontSize, type ReelTheme } from "../theme";

export function BulletsScene(props: { scene: ReelBulletsScene; theme: ReelTheme; durationInFrames: number }) {
  const { scene, theme, durationInFrames } = props;
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const bulletSize = scene.bullets.length > 3 ? 44 : 50;

  return (
    <SceneFrame durationInFrames={durationInFrames}>
      <div style={{ display: "flex", flexDirection: "column", gap: 56 }}>
        <Heading theme={theme} text={scene.heading} size={fitFontSize(scene.heading, 76, 56, 26)} />

        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          {scene.bullets.map((bullet, index) => {
            const delay = staggerDelay(index, scene.bullets.length, durationInFrames, 0.5, 12);
            const enter = spring({ frame: frame - delay, fps, config: { damping: 15, mass: 0.7 } });
            const isLatest =
              frame >= delay &&
              (index === scene.bullets.length - 1 ||
                frame < staggerDelay(index + 1, scene.bullets.length, durationInFrames, 0.5, 12));

            return (
              <div
                key={`${index}-${bullet}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 30,
                  padding: "30px 34px",
                  borderRadius: 28,
                  background: theme.surface,
                  border: `2px solid ${isLatest ? theme.accent : theme.surfaceBorder}`,
                  boxShadow: isLatest && theme.dark
                    ? theme.glow(`${theme.accent}55`)
                    : theme.dark
                      ? "none"
                      : "0 18px 40px rgba(20, 22, 28, 0.08)",
                  opacity: enter,
                  transform: `translateX(${interpolate(enter, [0, 1], [-80, 0])}px)`,
                }}
              >
                <span
                  style={{
                    flexShrink: 0,
                    width: 72,
                    height: 72,
                    borderRadius: 20,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: index % 2 === 0 ? theme.accent : theme.accentSecondary,
                    color: theme.dark ? "#050712" : "#ffffff",
                    fontFamily: theme.headingFont,
                    fontWeight: 700,
                    fontSize: 38,
                  }}
                >
                  {index + 1}
                </span>
                <span
                  style={{
                    fontFamily: theme.bodyFont,
                    fontWeight: 500,
                    fontSize: fitFontSize(bullet, bulletSize, 34, 34),
                    lineHeight: 1.3,
                    color: theme.text,
                  }}
                >
                  {bullet}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </SceneFrame>
  );
}
