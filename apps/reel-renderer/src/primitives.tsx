import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { ReelCaptionCue } from "../../../packages/shared-types/src/reel-studio";
import type { ReelTheme } from "./theme";

/** Vertical band (in px) where scene content lives, clear of Instagram's top and bottom chrome. */
export const SAFE_TOP = 250;
export const SAFE_BOTTOM = 1340;
export const SIDE_PADDING = 84;

export const EXIT_FRAMES = 8;

/** 0 → 1 spring that starts after `delay` frames. */
export function useEnter(delay = 0, damping = 16): number {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delay, fps, config: { damping, mass: 0.7 } });
}

/** Spreads `count` reveals across the first `share` of the scene. */
export function staggerDelay(index: number, count: number, durationInFrames: number, share = 0.6, start = 8): number {
  if (count <= 1) {
    return start;
  }

  const window = Math.max(durationInFrames * share - start, count * 6);
  return Math.round(start + (window / (count - 1)) * index);
}

export function SceneFrame(props: { durationInFrames: number; children: ReactNode }) {
  const frame = useCurrentFrame();
  const exit = interpolate(
    frame,
    [props.durationInFrames - EXIT_FRAMES, props.durationInFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  return (
    <AbsoluteFill
      style={{
        opacity: exit,
        transform: `scale(${interpolate(exit, [0, 1], [0.97, 1])})`,
      }}
    >
      <div
        style={{
          position: "absolute",
          top: SAFE_TOP,
          left: SIDE_PADDING,
          right: SIDE_PADDING,
          height: SAFE_BOTTOM - SAFE_TOP,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
        }}
      >
        {props.children}
      </div>
    </AbsoluteFill>
  );
}

export function Heading(props: { theme: ReelTheme; text: string; size?: number; delay?: number; align?: "left" | "center" }) {
  const enter = useEnter(props.delay ?? 0);

  return (
    <h2
      style={{
        margin: 0,
        fontFamily: props.theme.headingFont,
        fontWeight: 700,
        fontSize: props.size ?? 72,
        lineHeight: 1.12,
        letterSpacing: "-0.02em",
        color: props.theme.text,
        textAlign: props.align ?? "left",
        opacity: enter,
        transform: `translateY(${interpolate(enter, [0, 1], [36, 0])}px)`,
      }}
    >
      {props.text}
    </h2>
  );
}

export function Pill(props: { theme: ReelTheme; children: ReactNode; style?: CSSProperties }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 12,
        alignSelf: "flex-start",
        padding: "12px 26px",
        borderRadius: 999,
        background: props.theme.accent,
        color: props.theme.accentText,
        fontFamily: props.theme.bodyFont,
        fontWeight: 700,
        fontSize: 32,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        boxShadow: props.theme.dark ? props.theme.glow(`${props.theme.accent}88`) : "none",
        ...props.style,
      }}
    >
      {props.children}
    </span>
  );
}

export function Background(props: { theme: ReelTheme }) {
  const frame = useCurrentFrame();
  const { theme } = props;
  const driftA = Math.sin(frame / 90) * 120;
  const driftB = Math.cos(frame / 110) * 140;

  if (!theme.dark) {
    return (
      <AbsoluteFill style={{ background: theme.background, overflow: "hidden" }}>
        <div
          style={{
            position: "absolute",
            width: 900,
            height: 900,
            borderRadius: "50%",
            top: -320 + driftA * 0.4,
            right: -380,
            background: `${theme.accent}14`,
          }}
        />
        <div
          style={{
            position: "absolute",
            width: 700,
            height: 700,
            borderRadius: "50%",
            bottom: -260,
            left: -300 + driftB * 0.3,
            background: `${theme.accentSecondary}10`,
          }}
        />
      </AbsoluteFill>
    );
  }

  const gridOffset = (frame * 1.2) % 90;

  return (
    <AbsoluteFill style={{ background: theme.background, overflow: "hidden" }}>
      <AbsoluteFill
        style={{
          backgroundImage:
            `linear-gradient(${theme.accent}12 2px, transparent 2px), linear-gradient(90deg, ${theme.accent}12 2px, transparent 2px)`,
          backgroundSize: "90px 90px",
          backgroundPosition: `0 ${gridOffset}px`,
          maskImage: "radial-gradient(ellipse at center, black 30%, transparent 78%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          width: 1000,
          height: 1000,
          borderRadius: "50%",
          top: -300 + driftA,
          left: -420,
          background: `radial-gradient(circle, ${theme.accentSecondary}55 0%, transparent 65%)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          width: 1100,
          height: 1100,
          borderRadius: "50%",
          bottom: -420,
          right: -460 + driftB,
          background: `radial-gradient(circle, ${theme.accent}40 0%, transparent 65%)`,
        }}
      />
    </AbsoluteFill>
  );
}

export function ProgressBar(props: { theme: ReelTheme }) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const progress = Math.min(frame / Math.max(durationInFrames - 1, 1), 1);

  return (
    <div
      style={{
        position: "absolute",
        top: 120,
        left: SIDE_PADDING,
        right: SIDE_PADDING,
        height: 8,
        borderRadius: 8,
        background: props.theme.dark ? "rgba(255,255,255,0.12)" : "rgba(20,22,28,0.08)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: `${progress * 100}%`,
          height: "100%",
          borderRadius: 8,
          background: `linear-gradient(90deg, ${props.theme.accent}, ${props.theme.accentSecondary})`,
          boxShadow: props.theme.dark ? props.theme.glow(`${props.theme.accent}aa`) : "none",
        }}
      />
    </div>
  );
}

export function BrandChip(props: { theme: ReelTheme; handle: string }) {
  return (
    <div
      style={{
        position: "absolute",
        top: 152,
        left: SIDE_PADDING,
        fontFamily: props.theme.bodyFont,
        fontWeight: 700,
        fontSize: 30,
        color: props.theme.textMuted,
        letterSpacing: "0.02em",
      }}
    >
      {props.handle}
    </div>
  );
}

/** Caption band: one cue at a time, with the spoken word highlighted. */
export function Captions(props: { theme: ReelTheme; cues: ReelCaptionCue[] }) {
  const frame = useCurrentFrame();
  const cue = props.cues.find((entry) => frame >= entry.startFrame && frame < entry.endFrame);

  if (!cue) {
    return null;
  }

  const words = cue.text.split(/\s+/).filter(Boolean);
  const cueProgress = (frame - cue.startFrame) / Math.max(cue.endFrame - cue.startFrame, 1);
  const activeIndex = Math.min(Math.floor(cueProgress * words.length), words.length - 1);
  const pop = interpolate(frame - cue.startFrame, [0, 5], [0.92, 1], { extrapolateRight: "clamp" });
  const { theme } = props;

  return (
    <div
      style={{
        position: "absolute",
        top: 1420,
        left: SIDE_PADDING - 20,
        right: SIDE_PADDING - 20,
        display: "flex",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          transform: `scale(${pop})`,
          padding: "18px 30px",
          borderRadius: 24,
          background: theme.dark ? "rgba(3, 6, 18, 0.72)" : "rgba(20, 22, 28, 0.88)",
          fontFamily: theme.bodyFont,
          fontWeight: 700,
          fontSize: 50,
          lineHeight: 1.25,
          textAlign: "center",
          color: "#ffffff",
        }}
      >
        {words.map((word, index) => (
          <span
            key={`${cue.startFrame}-${index}`}
            style={{ color: index === activeIndex ? (theme.dark ? theme.accent : "#ffd23f") : "#ffffff" }}
          >
            {word}
            {index < words.length - 1 ? " " : ""}
          </span>
        ))}
      </div>
    </div>
  );
}
