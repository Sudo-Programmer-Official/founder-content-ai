import { interpolate, useCurrentFrame } from "remotion";
import type { ReelOutroScene } from "../../../../packages/shared-types/src/reel-studio";
import { SceneFrame, useEnter } from "../primitives";
import { fitFontSize, type ReelTheme } from "../theme";

export function OutroScene(props: { scene: ReelOutroScene; theme: ReelTheme; durationInFrames: number; brandHandle?: string }) {
  const { scene, theme, durationInFrames } = props;
  const frame = useCurrentFrame();
  const titleEnter = useEnter(0);
  const ctaEnter = useEnter(14, 11);
  const handleEnter = useEnter(26);
  const pulse = 1 + Math.max(0, Math.sin((frame - 20) / 6)) * 0.04;

  return (
    <SceneFrame durationInFrames={durationInFrames}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 64, textAlign: "center" }}>
        <h2
          style={{
            margin: 0,
            fontFamily: theme.headingFont,
            fontWeight: 700,
            fontSize: fitFontSize(scene.title, 96, 62, 24),
            lineHeight: 1.08,
            letterSpacing: "-0.03em",
            color: theme.text,
            opacity: titleEnter,
            transform: `translateY(${interpolate(titleEnter, [0, 1], [40, 0])}px)`,
          }}
        >
          {scene.title}
        </h2>

        <div
          style={{
            padding: "30px 56px",
            borderRadius: 999,
            background: `linear-gradient(90deg, ${theme.accent}, ${theme.accentSecondary})`,
            color: theme.dark ? "#050712" : "#ffffff",
            fontFamily: theme.bodyFont,
            fontWeight: 700,
            fontSize: fitFontSize(scene.cta, 50, 36, 22),
            boxShadow: theme.dark ? theme.glow(`${theme.accent}88`) : "0 18px 40px rgba(255, 90, 54, 0.35)",
            opacity: ctaEnter,
            transform: `scale(${interpolate(ctaEnter, [0, 1], [0.5, 1]) * pulse})`,
          }}
        >
          {scene.cta}
        </div>

        {props.brandHandle ? (
          <div
            style={{
              fontFamily: theme.bodyFont,
              fontWeight: 700,
              fontSize: 44,
              color: theme.accent,
              textShadow: theme.dark ? theme.glow(`${theme.accent}77`) : "none",
              opacity: handleEnter,
            }}
          >
            {props.brandHandle}
          </div>
        ) : null}
      </div>
    </SceneFrame>
  );
}
