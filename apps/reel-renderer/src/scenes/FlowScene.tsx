import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { ReelFlowNode, ReelFlowScene } from "../../../../packages/shared-types/src/reel-studio";
import { ReelIcon } from "../icons";
import { Heading, SceneFrame, SIDE_PADDING, staggerDelay } from "../primitives";
import { fitFontSize, type ReelTheme } from "../theme";

const BOX_WIDTH = 1080 - SIDE_PADDING * 2;
const BOX_HEIGHT = 900;
const NODE_WIDTH = 240;
const HUB_WIDTH = 280;
const EDGE_INSET = 110;

interface Point {
  x: number;
  y: number;
}

function resolveHubId(scene: ReelFlowScene): string {
  const degree = new Map<string, number>();

  for (const edge of scene.edges) {
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
  }

  let hubId = scene.nodes[0]?.id ?? "";
  let best = -1;

  for (const node of scene.nodes) {
    const value = degree.get(node.id) ?? 0;
    if (value > best) {
      best = value;
      hubId = node.id;
    }
  }

  return hubId;
}

function layoutNodes(scene: ReelFlowScene): { positions: Map<string, Point>; hubId?: string } {
  const positions = new Map<string, Point>();
  const count = scene.nodes.length;

  if (scene.layout === "hub" && count > 2) {
    const hubId = resolveHubId(scene);
    const satellites = scene.nodes.filter((node) => node.id !== hubId);
    const center = { x: BOX_WIDTH / 2, y: BOX_HEIGHT / 2 };
    const radius = 330;
    positions.set(hubId, center);

    satellites.forEach((node, index) => {
      const angle = -Math.PI / 2 + (index / satellites.length) * Math.PI * 2;
      positions.set(node.id, {
        x: center.x + Math.cos(angle) * radius,
        y: center.y + Math.sin(angle) * radius * 1.05,
      });
    });

    return { positions, hubId };
  }

  const top = 90;
  const bottom = BOX_HEIGHT - 90;

  scene.nodes.forEach((node, index) => {
    const y = count === 1 ? BOX_HEIGHT / 2 : top + ((bottom - top) / (count - 1)) * index;
    const x = count <= 3 ? BOX_WIDTH / 2 : index % 2 === 0 ? BOX_WIDTH * 0.27 : BOX_WIDTH * 0.73;
    positions.set(node.id, { x, y });
  });

  return { positions };
}

function trimSegment(from: Point, to: Point): { start: Point; end: Point; length: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy) || 1;
  const ux = dx / distance;
  const uy = dy / distance;
  const inset = Math.min(EDGE_INSET, distance / 3);
  const start = { x: from.x + ux * inset, y: from.y + uy * inset };
  const end = { x: to.x - ux * inset, y: to.y - uy * inset };
  return { start, end, length: Math.hypot(end.x - start.x, end.y - start.y) };
}

function FlowNodeCard(props: { node: ReelFlowNode; point: Point; theme: ReelTheme; delay: number; isHub: boolean }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { theme, node, point, isHub } = props;
  const enter = spring({ frame: frame - props.delay, fps, config: { damping: 12, mass: 0.6 } });
  const width = isHub ? HUB_WIDTH : NODE_WIDTH;
  const iconBox = isHub ? 150 : 116;
  const pulse = isHub ? 1 + Math.sin(frame / 8) * 0.025 : 1;
  const accent = isHub ? theme.accentSecondary : theme.accent;

  return (
    <div
      style={{
        position: "absolute",
        left: point.x - width / 2,
        top: point.y - iconBox / 2 - 10,
        width,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 14,
        opacity: enter,
        transform: `scale(${interpolate(enter, [0, 1], [0.4, 1]) * pulse})`,
      }}
    >
      <div
        style={{
          width: iconBox,
          height: iconBox,
          borderRadius: isHub ? 32 : 26,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: theme.dark ? "#0b1030" : "#ffffff",
          border: `3px solid ${accent}`,
          boxShadow: theme.dark ? theme.glow(`${accent}77`) : "0 14px 30px rgba(20, 22, 28, 0.12)",
        }}
      >
        <ReelIcon name={node.icon} size={iconBox * 0.5} color={accent} strokeWidth={2.2} />
      </div>
      <span
        style={{
          padding: "8px 16px",
          borderRadius: 14,
          background: theme.dark ? "rgba(5, 7, 18, 0.85)" : "rgba(246, 243, 236, 0.92)",
          fontFamily: theme.bodyFont,
          fontWeight: 700,
          fontSize: fitFontSize(node.label, isHub ? 42 : 36, 26, 11),
          lineHeight: 1.15,
          textAlign: "center",
          color: theme.text,
        }}
      >
        {node.label}
      </span>
    </div>
  );
}

export function FlowScene(props: { scene: ReelFlowScene; theme: ReelTheme; durationInFrames: number }) {
  const { scene, theme, durationInFrames } = props;
  const frame = useCurrentFrame();
  const { positions, hubId } = layoutNodes(scene);
  const orderedNodes = hubId
    ? [...scene.nodes.filter((node) => node.id === hubId), ...scene.nodes.filter((node) => node.id !== hubId)]
    : scene.nodes;
  const nodeDelays = new Map(
    orderedNodes.map((node, index) => [node.id, staggerDelay(index, orderedNodes.length, durationInFrames, 0.4, 8)]),
  );
  const markerId = `arrow-${scene.id}`;

  return (
    <SceneFrame durationInFrames={durationInFrames}>
      <div style={{ display: "flex", flexDirection: "column", gap: 40 }}>
        <Heading theme={theme} text={scene.heading} size={fitFontSize(scene.heading, 68, 50, 26)} align="center" />

        <div style={{ position: "relative", width: BOX_WIDTH, height: BOX_HEIGHT }}>
          <svg width={BOX_WIDTH} height={BOX_HEIGHT} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
            <defs>
              <marker id={markerId} viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill={theme.accent} />
              </marker>
            </defs>

            {scene.edges.map((edge, index) => {
              const from = positions.get(edge.from);
              const to = positions.get(edge.to);

              if (!from || !to) {
                return null;
              }

              const { start, end, length } = trimSegment(from, to);
              const edgeDelay = Math.max(nodeDelays.get(edge.from) ?? 0, nodeDelays.get(edge.to) ?? 0) + 6;
              const draw = interpolate(frame, [edgeDelay, edgeDelay + 14], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              });
              const packets = draw >= 1 ? [0, 0.5] : [];

              return (
                <g key={`${edge.from}-${edge.to}-${index}`}>
                  <line
                    x1={start.x}
                    y1={start.y}
                    x2={end.x}
                    y2={end.y}
                    stroke={theme.accent}
                    strokeOpacity={theme.dark ? 0.75 : 0.6}
                    strokeWidth={6}
                    strokeLinecap="round"
                    strokeDasharray={length}
                    strokeDashoffset={length * (1 - draw)}
                    markerEnd={draw >= 1 ? `url(#${markerId})` : undefined}
                    style={{ filter: theme.dark ? `drop-shadow(0 0 8px ${theme.accent})` : "none" }}
                  />
                  {packets.map((offset) => {
                    const t = (((frame - edgeDelay) / 34 + offset + index * 0.17) % 1 + 1) % 1;
                    return (
                      <circle
                        key={offset}
                        cx={start.x + (end.x - start.x) * t}
                        cy={start.y + (end.y - start.y) * t}
                        r={11}
                        fill={theme.dark ? "#ffffff" : theme.accentSecondary}
                        style={{ filter: theme.dark ? `drop-shadow(0 0 10px ${theme.accent})` : "none" }}
                      />
                    );
                  })}
                  {edge.label && draw >= 1 ? (
                    <foreignObject x={(start.x + end.x) / 2 - 110} y={(start.y + end.y) / 2 - 24} width={220} height={48}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "center",
                        }}
                      >
                        <span
                          style={{
                            padding: "6px 14px",
                            borderRadius: 12,
                            background: theme.dark ? "#101736" : "#ffffff",
                            border: `2px solid ${theme.surfaceBorder}`,
                            fontFamily: theme.bodyFont,
                            fontWeight: 700,
                            fontSize: 22,
                            color: theme.textMuted,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {edge.label}
                        </span>
                      </div>
                    </foreignObject>
                  ) : null}
                </g>
              );
            })}
          </svg>

          {orderedNodes.map((node) => {
            const point = positions.get(node.id);
            return point ? (
              <FlowNodeCard
                key={node.id}
                node={node}
                point={point}
                theme={theme}
                delay={nodeDelays.get(node.id) ?? 0}
                isHub={node.id === hubId}
              />
            ) : null;
          })}
        </div>
      </div>
    </SceneFrame>
  );
}
