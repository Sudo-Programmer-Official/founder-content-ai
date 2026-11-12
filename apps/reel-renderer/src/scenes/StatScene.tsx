import { interpolate, useCurrentFrame } from "remotion";
import type { ReelStatScene } from "../../../../packages/shared-types/src/reel-studio";
import { SceneFrame, useEnter } from "../primitives";
import { fitFontSize, type ReelTheme } from "../theme";

/** Splits "99.9%" into prefix/number/suffix so the number can count up. */
function parseStatValue(value: string): { prefix: string; number: number; decimals: number; suffix: string } | null {
  const match = value.match(/^([^\d-]*)(-?\d[\d,]*(?:\.\d+)?)(.*)$/);

  if (!match) {
    return null;
  }

  const numeric = Number(match[2].replace(/,/g, ""));

  if (!Number.isFinite(numeric)) {
    return null;
  }

  return {
    prefix: match[1],
    number: numeric,
    decimals: match[2].split(".")[1]?.length ?? 0,
    suffix: match[3],
  };
}

/** Sized from the final formatted value (with separators) so the count-up never outgrows the frame. */
function statFontSize(finalText: string): number {
  return Math.round(Math.min(260, 1500 / Math.max([...finalText].length, 1)));
}

export function StatScene(props: { scene: ReelStatScene; theme: ReelTheme; durationInFrames: number }) {
  const { scene, theme, durationInFrames } = props;
  const frame = useCurrentFrame();
  const enter = useEnter(0, 12);
  const labelEnter = useEnter(16);
  const contextEnter = useEnter(28);
  const parsed = parseStatValue(scene.value);
  const countFrames = Math.min(36, Math.round(durationInFrames * 0.4));
  const countProgress = interpolate(frame, [4, 4 + countFrames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: (t) => 1 - Math.pow(1 - t, 3),
  });
  const displayValue = parsed
    ? `${parsed.prefix}${(parsed.number * countProgress).toLocaleString("en-US", {
        minimumFractionDigits: parsed.decimals,
        maximumFractionDigits: parsed.decimals,
      })}${parsed.suffix}`
    : scene.value;

  return (
    <SceneFrame durationInFrames={durationInFrames}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 36, textAlign: "center" }}>
        <div
          style={{
            fontFamily: theme.headingFont,
            fontWeight: 700,
            fontSize: statFontSize(parsed ? `${parsed.prefix}${parsed.number.toLocaleString("en-US", { minimumFractionDigits: parsed.decimals })}${parsed.suffix}` : scene.value),
            lineHeight: 1,
            letterSpacing: "-0.04em",
            color: theme.accent,
            textShadow: theme.dark ? theme.glow(`${theme.accent}aa`) : "none",
            opacity: enter,
            transform: `scale(${interpolate(enter, [0, 1], [0.6, 1])})`,
          }}
        >
          {displayValue}
        </div>
        <div
          style={{
            fontFamily: theme.headingFont,
            fontWeight: 700,
            fontSize: fitFontSize(scene.label, 64, 44, 24),
            lineHeight: 1.15,
            color: theme.text,
            opacity: labelEnter,
            transform: `translateY(${interpolate(labelEnter, [0, 1], [30, 0])}px)`,
          }}
        >
          {scene.label}
        </div>
        {scene.context ? (
          <div
            style={{
              maxWidth: 820,
              fontFamily: theme.bodyFont,
              fontWeight: 500,
              fontSize: fitFontSize(scene.context, 42, 32, 60),
              lineHeight: 1.35,
              color: theme.textMuted,
              opacity: contextEnter,
            }}
          >
            {scene.context}
          </div>
        ) : null}
      </div>
    </SceneFrame>
  );
}
