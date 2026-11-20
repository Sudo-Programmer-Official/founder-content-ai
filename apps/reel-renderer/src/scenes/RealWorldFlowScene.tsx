import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { ReelFlowScene } from "../../../../packages/shared-types/src/reel-studio";
import { ReelIcon } from "../icons";
import { Heading, Pill, SceneFrame, SIDE_PADDING, useEnter } from "../primitives";
import { fitFontSize, type ReelTheme } from "../theme";
import { generateRealWorldObjectPlan, RealWorldObjectScene } from "./RealWorldObjectScene";

const PANEL_WIDTH = 1080 - SIDE_PADDING * 2;
const ROUTE_POINTS = [
  { x: 70, y: 392 },
  { x: 210, y: 360 },
  { x: 340, y: 405 },
  { x: 486, y: 278 },
  { x: 640, y: 322 },
  { x: 820, y: 138 },
];

type Point = (typeof ROUTE_POINTS)[number];

function pointOnPolyline(points: Point[], progress: number): Point {
  const clamped = Math.max(0, Math.min(1, progress));
  const lengths = points.slice(1).map((point, index) => Math.hypot(point.x - points[index].x, point.y - points[index].y));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  let remaining = total * clamped;

  for (let index = 0; index < lengths.length; index += 1) {
    const length = lengths[index];
    if (remaining <= length) {
      const from = points[index];
      const to = points[index + 1];
      const ratio = length === 0 ? 0 : remaining / length;
      return { x: from.x + (to.x - from.x) * ratio, y: from.y + (to.y - from.y) * ratio };
    }
    remaining -= length;
  }

  return points[points.length - 1];
}

function storyText(scene: ReelFlowScene): string {
  const plan = scene.realWorld;
  return [
    scene.heading,
    scene.narration,
    ...scene.nodes.flatMap((node) => [node.label, node.icon]),
    ...(plan
      ? [
          plan.title,
          plan.status,
          plan.action,
          plan.result,
          ...plan.objects.flatMap((object) => [object.label, object.detail, object.role, object.icon]),
        ]
      : []),
  ]
    .join(" ")
    .toLowerCase();
}

/**
 * Keep the bespoke map/car treatment for transport stories only.
 *
 * Generic workflows often contain words such as "destination", "route", or
 * "driver" in a technical sense. A single broad keyword used to turn an A/B
 * or agent story into a ride-hailing screen. Require explicit transport intent
 * or a meaningful transport pair instead.
 */
export function hasRideContext(scene: ReelFlowScene): boolean {
  const text = storyText(scene);

  if (/\b(uber|lyft|ride[ -]?hailing|rideshare|taxi|cab)\b/.test(text)) {
    return true;
  }

  // When the director supplied a concrete plan, its objects are the strongest
  // signal of the intended domain. Do not let an incidental word in narration
  // override an otherwise generic A/B, support, commerce, or agent plan.
  if (scene.realWorld?.objects.length && scene.realWorld.objects.length >= 2) {
    const planText = scene.realWorld.objects
      .flatMap((object) => [object.label, object.detail, object.role, object.icon])
      .join(" ")
      .toLowerCase();
    const planHasTransportActor = /\b(rider|passenger|driver|captain|courier|vehicle|car)\b/.test(planText);
    const planHasTransportState = /\b(pick[ -]?up|drop[ -]?off|eta|trip|destination|route|gps|en route)\b/.test(planText);
    const planHasDeliveryObject = /\b(delivery|package|parcel|shipment|order)\b/.test(planText);
    const planHasDeliveryState = /\b(courier|driver|address|tracking|eta|destination|drop[ -]?off)\b/.test(planText);

    if (!(planHasTransportActor && planHasTransportState) && !(planHasDeliveryObject && planHasDeliveryState)) {
      return false;
    }
  }

  const hasTransportActor = /\b(rider|passenger|driver|captain|courier|vehicle|car)\b/.test(text);
  const hasTransportState = /\b(pick[ -]?up|drop[ -]?off|eta|trip|destination|route|gps|on the way|en route)\b/.test(text);
  const hasDeliveryObject = /\b(delivery|package|parcel|shipment|order)\b/.test(text);
  const hasDeliveryState = /\b(courier|driver|address|tracking|eta|destination|drop[ -]?off)\b/.test(text);

  return (hasTransportActor && hasTransportState) || (hasDeliveryObject && hasDeliveryState);
}

function firstMatchingLabel(scene: ReelFlowScene, pattern: RegExp, fallback: string): string {
  return scene.nodes.find((node) => pattern.test(node.label))?.label ?? fallback;
}

function ScenarioHeader(props: { theme: ReelTheme; ride: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 18 }}>
      <Pill
        theme={props.theme}
        style={{
          padding: "10px 20px",
          fontSize: 22,
          letterSpacing: "0.08em",
          background: props.ride ? props.theme.accent : props.theme.accentSecondary,
          color: props.ride ? props.theme.accentText : "#fffaf4",
        }}
      >
        <ReelIcon name={props.ride ? "car" : "globe"} size={26} color="currentColor" strokeWidth={2.4} />
        {props.ride ? "LIVE RIDE" : "REAL-WORLD STORY"}
      </Pill>
      <span
        style={{
          color: props.theme.textMuted,
          fontFamily: props.theme.monoFont,
          fontSize: 19,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
        }}
      >
        Real-world view
      </span>
    </div>
  );
}

function MapPin(props: { theme: ReelTheme; point: Point; color: string; label: string; delay: number }) {
  const enter = useEnter(props.delay);
  const labelOnLeft = props.point.x > 650;
  const anchorTransform = labelOnLeft ? "translate(-100%, -100%)" : "translate(-50%, -100%)";
  return (
    <div
      style={{
        position: "absolute",
        left: props.point.x,
        top: props.point.y,
        display: "flex",
        flexDirection: labelOnLeft ? "row-reverse" : "row",
        alignItems: "center",
        gap: 8,
        opacity: enter,
        transform: `${anchorTransform} scale(${interpolate(enter, [0, 1], [0.6, 1])})`,
      }}
    >
      <div
        style={{
          width: 52,
          height: 52,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: "50% 50% 50% 0",
          background: props.color,
          color: "#06121d",
          transform: "rotate(-45deg)",
          boxShadow: `0 8px 22px ${props.color}77`,
        }}
      >
        <div style={{ transform: "rotate(45deg)" }}>
          <ReelIcon name="map_pin" size={26} color="currentColor" strokeWidth={2.4} />
        </div>
      </div>
      <span
        style={{
          padding: "7px 12px",
          borderRadius: 10,
          background: "rgba(5, 16, 27, 0.88)",
          border: `1px solid ${props.theme.surfaceBorder}`,
          color: props.theme.text,
          fontFamily: props.theme.bodyFont,
          fontSize: 21,
          fontWeight: 700,
          whiteSpace: "nowrap",
        }}
      >
        {props.label}
      </span>
    </div>
  );
}

function RideCar(props: { theme: ReelTheme; point: Point; nextPoint: Point; progress: number }) {
  const angle = Math.atan2(props.nextPoint.y - props.point.y, props.nextPoint.x - props.point.x) * (180 / Math.PI);
  const pulse = 1 + Math.sin(props.progress * Math.PI * 8) * 0.035;

  return (
    <div
      style={{
        position: "absolute",
        left: props.point.x,
        top: props.point.y,
        width: 112,
        height: 76,
        transform: `translate(-50%, -50%) rotate(${angle}deg) scale(${pulse})`,
        transformOrigin: "center",
        filter: `drop-shadow(0 10px 12px rgba(0,0,0,0.42)) drop-shadow(0 0 12px ${props.theme.accent}aa)`,
      }}
    >
      <svg viewBox="0 0 112 76" width="112" height="76" aria-label="moving car">
        <rect x="8" y="13" width="96" height="50" rx="21" fill="#071a28" stroke={props.theme.accent} strokeWidth="4" />
        <path d="M30 18h50l13 18H19Z" fill="#d9f7f2" stroke="#7aaeb4" strokeWidth="2" />
        <path d="M35 21h18v12H27ZM58 21h18l9 12H58Z" fill="#396276" />
        <rect x="37" y="37" width="38" height="16" rx="8" fill={props.theme.accent} />
        <circle cx="25" cy="62" r="9" fill="#020a11" stroke="#89a7b4" strokeWidth="3" />
        <circle cx="87" cy="62" r="9" fill="#020a11" stroke="#89a7b4" strokeWidth="3" />
        <circle cx="20" cy="38" r="4" fill="#fb923c" />
        <circle cx="92" cy="38" r="4" fill="#fff4d6" />
      </svg>
    </div>
  );
}

function RideScenario(props: { scene: ReelFlowScene; theme: ReelTheme; durationInFrames: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 14, mass: 0.7 } });
  const routeProgress = interpolate(frame, [18, props.durationInFrames - 18], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const carPoint = pointOnPolyline(ROUTE_POINTS, routeProgress);
  const nextCarPoint = pointOnPolyline(ROUTE_POINTS, Math.min(1, routeProgress + 0.035));
  const routePath = ROUTE_POINTS.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  const rider = firstMatchingLabel(props.scene, /rider|user|customer/i, "Rider");
  const driver = firstMatchingLabel(props.scene, /driver|captain|courier|provider/i, "Driver");
  const destination = firstMatchingLabel(props.scene, /destination|drop|result|home/i, "Destination");
  const steps = props.scene.nodes.slice(0, 4).map((node) => node.label);
  const statusIndex = Math.min(3, Math.floor((frame / Math.max(props.durationInFrames, 1)) * 4));
  const statuses = ["Driver matched", "Picking up rider", "En route", "Destination updated"];
  const etaSeconds = Math.max(42, Math.round(interpolate(frame, [0, props.durationInFrames], [192, 42], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })));
  const eta = `${String(Math.floor(etaSeconds / 60)).padStart(2, "0")}:${String(etaSeconds % 60).padStart(2, "0")}`;

  return (
    <div
      style={{
        position: "relative",
        height: 760,
        overflow: "hidden",
        borderRadius: 34,
        background: "linear-gradient(155deg, rgba(16, 37, 55, 0.96), rgba(5, 16, 27, 0.98))",
        border: `2px solid ${props.theme.surfaceBorder}`,
        boxShadow: "0 24px 60px rgba(0, 0, 0, 0.28)",
        opacity: enter,
        transform: `translateY(${interpolate(enter, [0, 1], [30, 0])}px)`,
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 22,
          left: 22,
          right: 22,
          height: 132,
          padding: "20px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 20,
          borderRadius: 24,
          background: "rgba(232, 246, 247, 0.96)",
          color: "#0a1b2a",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div
            style={{
              width: 68,
              height: 68,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 20,
              background: props.theme.accent,
            }}
          >
            <ReelIcon name="car" size={38} color="#05201f" strokeWidth={2.3} />
          </div>
          <div>
            <div style={{ fontFamily: props.theme.bodyFont, fontSize: 28, fontWeight: 700 }}>{statuses[statusIndex]}</div>
            <div style={{ marginTop: 5, fontFamily: props.theme.bodyFont, fontSize: 22, color: "#436174" }}>
              {driver} · {statusIndex >= 2 ? "on route" : "3 min away"}
            </div>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontFamily: props.theme.monoFont, fontSize: 20, color: "#436174" }}>LIVE ETA</div>
          <div style={{ fontFamily: props.theme.headingFont, fontSize: 38, fontWeight: 700, color: "#0a1b2a" }}>{eta}</div>
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          top: 178,
          left: 22,
          right: 22,
          bottom: 22,
          overflow: "hidden",
          borderRadius: 26,
          backgroundColor: "#10283a",
          backgroundImage:
            "linear-gradient(28deg, transparent 47%, rgba(119, 171, 187, 0.12) 48% 51%, transparent 52%), linear-gradient(112deg, transparent 45%, rgba(119, 171, 187, 0.1) 46% 50%, transparent 51%), linear-gradient(rgba(119, 171, 187, 0.08) 2px, transparent 2px), linear-gradient(90deg, rgba(119, 171, 187, 0.08) 2px, transparent 2px)",
          backgroundSize: "280px 220px, 340px 250px, 74px 74px, 74px 74px",
        }}
      >
        <svg viewBox="0 0 900 500" width="100%" height="100%" style={{ position: "absolute", inset: 0 }}>
            <defs>
              <filter id="ride-map-shadow" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="8" stdDeviation="8" floodColor="#02070d" floodOpacity="0.42" />
              </filter>
            </defs>
            <rect width="900" height="500" fill="#10283a" />
            <g opacity="0.72" fill="#1b3a4c" stroke="#2d5363" strokeWidth="2" filter="url(#ride-map-shadow)">
              <rect x="42" y="52" width="128" height="82" rx="8" />
              <rect x="206" y="36" width="92" height="122" rx="8" />
              <rect x="344" y="54" width="136" height="78" rx="8" />
              <rect x="560" y="40" width="118" height="96" rx="8" />
              <rect x="730" y="58" width="126" height="72" rx="8" />
              <rect x="55" y="205" width="106" height="74" rx="8" />
              <rect x="228" y="220" width="130" height="92" rx="8" />
              <rect x="510" y="204" width="118" height="90" rx="8" />
              <rect x="696" y="218" width="154" height="74" rx="8" />
            </g>
            <g fill="none" stroke="#6e9aa6" strokeLinecap="round" opacity="0.42">
              <path d="M-20 176 C 150 122, 210 206, 356 164 S 620 122, 930 178" strokeWidth="18" />
              <path d="M-28 176 C 150 122, 210 206, 356 164 S 620 122, 930 178" stroke="#b9ded8" strokeWidth="3" strokeDasharray="14 14" />
              <path d="M140 -20 C 180 110, 124 220, 184 520" strokeWidth="16" />
              <path d="M140 -20 C 180 110, 124 220, 184 520" stroke="#b9ded8" strokeWidth="3" strokeDasharray="14 14" />
              <path d="M474 -18 C 426 100, 540 242, 470 520" strokeWidth="18" />
              <path d="M474 -18 C 426 100, 540 242, 470 520" stroke="#b9ded8" strokeWidth="3" strokeDasharray="14 14" />
              <path d="M760 -20 C 700 120, 780 226, 720 520" strokeWidth="14" />
            </g>
            <g fill="#9fc0c7" opacity="0.72" fontFamily={props.theme.monoFont} fontSize="16" letterSpacing="2">
              <text x="54" y="184">MARKET ST</text>
              <text x="570" y="192">5TH AVE</text>
              <text x="696" y="338">DOWNTOWN</text>
            </g>
            <path d="M 55 395 L 210 360 L 342 405 L 486 278 L 640 322 L 840 135" fill="none" stroke="#426278" strokeWidth="36" strokeLinecap="round" strokeLinejoin="round" opacity="0.72" />
            <path d="M 55 395 L 210 360 L 342 405 L 486 278 L 640 322 L 840 135" fill="none" stroke="#d1f4ed" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="18 18" opacity="0.75" />
            <path d={routePath} fill="none" stroke={props.theme.accent} strokeWidth="14" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="1500" strokeDashoffset={1500 * (1 - routeProgress)} style={{ filter: `drop-shadow(0 0 10px ${props.theme.accent})` }} />
            <circle cx={ROUTE_POINTS[0].x} cy={ROUTE_POINTS[0].y} r="18" fill="#fb923c" opacity="0.3" />
            <circle cx={ROUTE_POINTS[0].x} cy={ROUTE_POINTS[0].y} r="8" fill="#fb923c" />
            <circle cx={ROUTE_POINTS[ROUTE_POINTS.length - 1].x} cy={ROUTE_POINTS[ROUTE_POINTS.length - 1].y} r="18" fill="#5eead4" opacity="0.3" />
            <circle cx={ROUTE_POINTS[ROUTE_POINTS.length - 1].x} cy={ROUTE_POINTS[ROUTE_POINTS.length - 1].y} r="8" fill="#5eead4" />
          </svg>

        <MapPin theme={props.theme} point={ROUTE_POINTS[0]} color={props.theme.accentSecondary} label={rider} delay={8} />
        <MapPin theme={props.theme} point={ROUTE_POINTS[ROUTE_POINTS.length - 1]} color={props.theme.accent} label={destination} delay={15} />

        <RideCar theme={props.theme} point={carPoint} nextPoint={nextCarPoint} progress={routeProgress} />

        <div
          style={{
            position: "absolute",
            top: 20,
            left: 20,
            padding: "10px 15px",
            borderRadius: 12,
            background: "rgba(5, 16, 27, 0.82)",
            border: `1px solid ${props.theme.surfaceBorder}`,
            color: props.theme.text,
            fontFamily: props.theme.bodyFont,
            fontSize: 22,
            fontWeight: 700,
          }}
        >
          {rider} → {destination}
        </div>

        <div
          style={{
            position: "absolute",
            top: 20,
            right: 20,
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "9px 13px",
            borderRadius: 12,
            background: "rgba(5, 16, 27, 0.82)",
            border: `1px solid ${props.theme.surfaceBorder}`,
            color: props.theme.text,
            fontFamily: props.theme.monoFont,
            fontSize: 17,
            letterSpacing: "0.04em",
          }}
        >
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: props.theme.accent, boxShadow: `0 0 12px ${props.theme.accent}` }} />
          GPS LIVE
        </div>

        <div
          style={{
            position: "absolute",
            left: 20,
            right: 20,
            bottom: 18,
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "12px 14px",
            borderRadius: 16,
            background: "rgba(5, 16, 27, 0.88)",
            border: `1px solid ${props.theme.surfaceBorder}`,
          }}
        >
          {steps.map((step, index) => (
            <div key={`${step}-${index}`} style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
              <div
                style={{
                  width: 28,
                  height: 28,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  borderRadius: "50%",
                  background: index <= Math.floor(routeProgress * steps.length) ? props.theme.accent : "#28465e",
                  color: "#06121d",
                  fontFamily: props.theme.monoFont,
                  fontSize: 16,
                  fontWeight: 700,
                }}
              >
                {index + 1}
              </div>
              <span style={{ overflow: "hidden", color: props.theme.textMuted, fontFamily: props.theme.bodyFont, fontSize: 18, textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {step}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ProductAppScenario(props: { scene: ReelFlowScene; theme: ReelTheme; durationInFrames: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 14, mass: 0.7 } });
  const nodes = props.scene.nodes.slice(0, 4);
  const activeIndex = Math.min(nodes.length - 1, Math.floor((frame / Math.max(props.durationInFrames, 1)) * nodes.length));
  const request = firstMatchingLabel(props.scene, /customer|user|request|inquiry|order/i, "Customer request");
  const tool = firstMatchingLabel(props.scene, /tool|database|crm|search|service|api/i, "Tool call");
  const outcome = firstMatchingLabel(props.scene, /result|reply|answer|resolved|action|follow/i, "Outcome");
  const statuses = ["Request received", "Context gathered", "Tool call running", "Action completed"];
  const pulse = 1 + Math.sin(frame * 0.12) * 0.03;

  return (
    <div
      style={{
        position: "relative",
        height: 760,
        padding: 24,
        display: "flex",
        flexDirection: "column",
        gap: 18,
        borderRadius: 34,
        background: "linear-gradient(155deg, rgba(16, 37, 55, 0.96), rgba(5, 16, 27, 0.98))",
        border: `2px solid ${props.theme.surfaceBorder}`,
        boxShadow: "0 24px 60px rgba(0, 0, 0, 0.28)",
        opacity: enter,
        transform: `translateY(${interpolate(enter, [0, 1], [30, 0])}px)`,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", color: props.theme.textMuted, fontFamily: props.theme.monoFont, fontSize: 19, letterSpacing: "0.05em", textTransform: "uppercase" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 11, height: 11, borderRadius: "50%", background: props.theme.accent, boxShadow: `0 0 14px ${props.theme.accent}` }} />
          Live product view
        </span>
        <span style={{ color: props.theme.accent }}>● {statuses[activeIndex]}</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "0.95fr 1.2fr", gap: 18, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 18, borderRadius: 26, background: "#d7edf0", color: "#0a1b2a" }}>
          <div style={{ width: 300, minHeight: 456, padding: 14, borderRadius: 34, background: "#07131f", border: "8px solid #26465a", boxShadow: "0 18px 34px rgba(0,0,0,0.28)", transform: `scale(${pulse})` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 10px 16px", borderBottom: "1px solid #31556a" }}>
              <div style={{ width: 35, height: 35, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "50%", background: props.theme.accentSecondary, color: "#06121d", fontFamily: props.theme.bodyFont, fontSize: 18, fontWeight: 800 }}>U</div>
              <div>
                <div style={{ color: "#f5ffff", fontFamily: props.theme.bodyFont, fontSize: 20, fontWeight: 700 }}>Customer app</div>
                <div style={{ color: "#8ca9b7", fontFamily: props.theme.monoFont, fontSize: 13 }}>ONLINE</div>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "20px 8px" }}>
              <div style={{ alignSelf: "flex-start", maxWidth: 220, padding: "13px 15px", borderRadius: "17px 17px 17px 5px", background: "#e8f6f7", color: "#0a1b2a", fontFamily: props.theme.bodyFont, fontSize: 19, lineHeight: 1.2 }}>
                {request} needs help.
              </div>
              <div style={{ alignSelf: "flex-end", maxWidth: 230, padding: "13px 15px", borderRadius: "17px 17px 5px 17px", background: `${props.theme.accent}e6`, color: "#06121d", fontFamily: props.theme.bodyFont, fontSize: 18, fontWeight: 700, lineHeight: 1.2 }}>
                I’ll check that and take care of it.
              </div>
              <div style={{ marginTop: 12, padding: "15px 14px", borderRadius: 18, background: "#112a3b", border: `1px solid ${props.theme.accent}77` }}>
                <div style={{ color: props.theme.accent, fontFamily: props.theme.monoFont, fontSize: 14, letterSpacing: "0.06em" }}>LIVE RESULT</div>
                <div style={{ marginTop: 8, color: "#f5ffff", fontFamily: props.theme.bodyFont, fontSize: 20, fontWeight: 700 }}>{outcome}</div>
                <div style={{ marginTop: 5, color: "#8ca9b7", fontFamily: props.theme.bodyFont, fontSize: 16 }}>Updated just now</div>
              </div>
            </div>
          </div>
        </div>

        <div style={{ position: "relative", padding: 22, borderRadius: 26, background: "rgba(9, 23, 36, 0.94)", border: `1px solid ${props.theme.surfaceBorder}`, overflow: "hidden" }}>
          <div style={{ position: "absolute", inset: 0, opacity: 0.24, backgroundImage: "linear-gradient(rgba(94,234,212,0.22) 1px, transparent 1px), linear-gradient(90deg, rgba(94,234,212,0.22) 1px, transparent 1px)", backgroundSize: "48px 48px" }} />
          <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <div style={{ width: 58, height: 58, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 18, background: `${props.theme.accentSecondary}22`, color: props.theme.accentSecondary }}>
                  <ReelIcon name="brain" size={34} color="currentColor" />
                </div>
                <div>
                  <div style={{ color: props.theme.text, fontFamily: props.theme.bodyFont, fontSize: 28, fontWeight: 700 }}>Agent in action</div>
                  <div style={{ marginTop: 4, color: props.theme.textMuted, fontFamily: props.theme.bodyFont, fontSize: 19 }}>Observe → decide → act</div>
                </div>
              </div>
              <span style={{ padding: "7px 10px", borderRadius: 10, background: `${props.theme.accent}22`, color: props.theme.accent, fontFamily: props.theme.monoFont, fontSize: 14 }}>TRACE 04</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {nodes.map((node, index) => (
                <div key={node.id} style={{ position: "relative", display: "flex", alignItems: "center", gap: 14, padding: "16px 18px", borderRadius: 18, background: index === activeIndex ? `${props.theme.accent}22` : "rgba(255,255,255,0.05)", border: `1px solid ${index === activeIndex ? props.theme.accent : "rgba(148, 200, 220, 0.13)"}`, color: props.theme.text, fontFamily: props.theme.bodyFont, fontSize: 23, fontWeight: 700, transform: `translateX(${index === activeIndex ? 8 : 0}px)` }}>
                  <ReelIcon name={node.icon} size={28} color={index <= activeIndex ? props.theme.accent : props.theme.textMuted} />
                  <span style={{ flex: 1 }}>{node.label}</span>
                  <span style={{ color: index === activeIndex ? props.theme.accent : props.theme.textMuted, fontFamily: props.theme.monoFont, fontSize: 16 }}>{index < activeIndex ? "DONE" : index === activeIndex ? "RUNNING" : "QUEUED"}</span>
                </div>
              ))}
            </div>
            <div style={{ marginTop: "auto", padding: "16px 18px", borderRadius: 18, background: "rgba(232,246,247,0.95)", color: "#0a1b2a" }}>
              <div style={{ color: "#436174", fontFamily: props.theme.monoFont, fontSize: 16, letterSpacing: "0.06em" }}>TOOL CALL</div>
              <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 12, fontFamily: props.theme.bodyFont, fontSize: 24, fontWeight: 700 }}>
                <ReelIcon name="service" size={28} color="#0a1b2a" />
                {tool}
                <span style={{ marginLeft: "auto", color: "#0a7f76", fontFamily: props.theme.monoFont, fontSize: 15 }}>200 OK</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "17px 20px", borderRadius: 18, background: `${props.theme.accent}18`, border: `1px solid ${props.theme.accent}66`, color: props.theme.text, fontFamily: props.theme.bodyFont, fontSize: 23, fontWeight: 700 }}>
        <span>{activeIndex === nodes.length - 1 ? "The real-world action is complete" : "The agent is moving the request forward"}</span>
        <ReelIcon name="check" size={30} color={props.theme.accent} strokeWidth={2.4} />
      </div>
    </div>
  );
}

export function RealWorldFlowScene(props: { scene: ReelFlowScene; theme: ReelTheme; durationInFrames: number }) {
  const ride = hasRideContext(props.scene);
  const objectPlan = generateRealWorldObjectPlan(props.scene);
  const genericHeading = /^(customer journey|workflow|process|how it works|user journey)$/i.test(props.scene.heading.trim());
  const heading = genericHeading ? objectPlan.title : props.scene.heading;

  return (
    <SceneFrame durationInFrames={props.durationInFrames}>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <ScenarioHeader theme={props.theme} ride={ride} />
        <Heading theme={props.theme} text={heading} size={fitFontSize(heading, 64, 48, 28)} align="left" />
        {ride ? <RideScenario scene={props.scene} theme={props.theme} durationInFrames={props.durationInFrames} /> : <RealWorldObjectScene plan={objectPlan} theme={props.theme} durationInFrames={props.durationInFrames} />}
      </div>
    </SceneFrame>
  );
}
