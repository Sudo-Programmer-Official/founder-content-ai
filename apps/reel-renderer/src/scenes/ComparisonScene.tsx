import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { ReelComparisonScene, ReelComparisonSide } from "../../../../packages/shared-types/src/reel-studio";
import { Heading, SceneFrame, staggerDelay, useEnter } from "../primitives";
import { fitFontSize, type ReelTheme } from "../theme";

function ComparisonCard(props: {
  side: ReelComparisonSide;
  theme: ReelTheme;
  color: string;
  baseDelay: number;
  durationInFrames: number;
  fromX: number;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { side, theme, color } = props;
  const enter = spring({ frame: frame - props.baseDelay, fps, config: { damping: 15, mass: 0.7 } });

  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        gap: 22,
        padding: "34px 30px",
        borderRadius: 30,
        background: theme.surface,
        border: `3px solid ${color}`,
        boxShadow: theme.dark ? theme.glow(`${color}44`) : "0 18px 40px rgba(20, 22, 28, 0.08)",
        opacity: enter,
        transform: `translateX(${interpolate(enter, [0, 1], [props.fromX, 0])}px)`,
      }}
    >
      <div
        style={{
          fontFamily: theme.headingFont,
          fontWeight: 700,
          fontSize: fitFontSize(side.title, 48, 34, 12),
          lineHeight: 1.1,
          color,
        }}
      >
        {side.title}
      </div>
      {side.points.map((point, index) => {
        const delay = props.baseDelay + 10 + staggerDelay(index, side.points.length, props.durationInFrames, 0.3, 0);
        const pointEnter = spring({ frame: frame - delay, fps, config: { damping: 18 } });

        return (
          <div
            key={`${index}-${point}`}
            style={{
              display: "flex",
              gap: 14,
              alignItems: "flex-start",
              fontFamily: theme.bodyFont,
              fontWeight: 500,
              fontSize: fitFontSize(point, 36, 28, 22),
              lineHeight: 1.3,
              color: theme.text,
              opacity: pointEnter,
            }}
          >
            <span style={{ color, fontWeight: 700 }}>•</span>
            <span>{point}</span>
          </div>
        );
      })}
    </div>
  );
}

export function ComparisonScene(props: { scene: ReelComparisonScene; theme: ReelTheme; durationInFrames: number }) {
  const { scene, theme, durationInFrames } = props;
  const vsEnter = useEnter(18, 10);
  const rightDelay = Math.round(durationInFrames * 0.3);

  return (
    <SceneFrame durationInFrames={durationInFrames}>
      <div style={{ display: "flex", flexDirection: "column", gap: 52 }}>
        <Heading theme={theme} text={scene.heading} size={fitFontSize(scene.heading, 72, 52, 26)} align="center" />
        <div style={{ position: "relative", display: "flex", gap: 36, alignItems: "stretch" }}>
          <ComparisonCard
            side={scene.left}
            theme={theme}
            color={theme.dark ? "#ff5c8a" : theme.textMuted}
            baseDelay={8}
            durationInFrames={durationInFrames}
            fromX={-120}
          />
          <ComparisonCard
            side={scene.right}
            theme={theme}
            color={theme.accent}
            baseDelay={rightDelay}
            durationInFrames={durationInFrames}
            fromX={120}
          />
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              width: 92,
              height: 92,
              marginLeft: -46,
              marginTop: -46,
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: theme.accentSecondary,
              color: "#ffffff",
              fontFamily: theme.headingFont,
              fontWeight: 700,
              fontSize: 34,
              boxShadow: theme.dark ? theme.glow(`${theme.accentSecondary}aa`) : "0 10px 24px rgba(47, 91, 255, 0.35)",
              transform: `scale(${vsEnter})`,
            }}
          >
            VS
          </div>
        </div>
      </div>
    </SceneFrame>
  );
}
