import type { ReactNode } from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { ReelFlowScene, ReelIconName, ReelRealWorldPlan } from "../../../../packages/shared-types/src/reel-studio";
import { ReelIcon } from "../icons";
import { Pill, staggerDelay, useEnter } from "../primitives";
import type { ReelTheme } from "../theme";

export type RealWorldObjectDomain = "quote" | "delivery" | "support" | "commerce" | "booking" | "agent";

export interface GeneratedRealWorldObject {
  id: string;
  label: string;
  icon: ReelIconName;
  detail: string;
  role: string;
}

export interface RealWorldObjectPlan extends ReelRealWorldPlan {
  domain: RealWorldObjectDomain;
  objects: GeneratedRealWorldObject[];
}

function storyText(scene: ReelFlowScene): string {
  return `${scene.heading} ${scene.narration} ${scene.nodes.map((node) => node.label).join(" ")}`.toLowerCase();
}

function detectDomain(scene: ReelFlowScene): RealWorldObjectDomain {
  const text = storyText(scene);

  if (/quote|proposal|lead|sales|business|merchant|request a price|request quote/.test(text)) {
    return "quote";
  }
  if (/delivery|package|parcel|courier|restaurant|food order|grocery|shipment/.test(text)) {
    return "delivery";
  }
  if (/support|ticket|help desk|helpdesk|issue|incident|refund|complaint/.test(text)) {
    return "support";
  }
  if (/checkout|cart|payment|purchase|store|product|subscription|buy/.test(text)) {
    return "commerce";
  }
  if (/booking|appointment|calendar|reservation|availability|hotel|flight/.test(text)) {
    return "booking";
  }

  return "agent";
}

function claimLabel(scene: ReelFlowScene, used: Set<string>, pattern: RegExp, fallback: string): string {
  const node = scene.nodes.find((candidate) => !used.has(candidate.id) && pattern.test(candidate.label));

  if (!node) {
    return fallback;
  }

  used.add(node.id);
  return node.label;
}

function iconDetail(icon: ReelIconName): { role: string; detail: string } {
  switch (icon) {
    case "user":
    case "users":
      return { role: "PERSON", detail: "has a real need" };
    case "phone":
    case "browser":
      return { role: "APP", detail: "shows the live state" };
    case "search":
      return { role: "REQUEST", detail: "starts the workflow" };
    case "database":
      return { role: "RECORD", detail: "adds useful context" };
    case "mail":
      return { role: "MESSAGE", detail: "delivers the next step" };
    case "cart":
      return { role: "ORDER", detail: "holds the customer intent" };
    case "payment":
      return { role: "PAYMENT", detail: "confirms the transaction" };
    case "car":
      return { role: "VEHICLE", detail: "moves through the world" };
    case "map_pin":
      return { role: "PLACE", detail: "anchors the action" };
    case "check":
      return { role: "OUTCOME", detail: "confirms completion" };
    case "brain":
      return { role: "AGENT", detail: "decides what happens next" };
    default:
      return { role: "TOOL", detail: "changes the real state" };
  }
}

function object(id: string, label: string, icon: ReelIconName, detail: string, role: string): GeneratedRealWorldObject {
  return { id, label, icon, detail, role };
}

function makeConcreteLabel(label: string, fallback: string): string {
  if (/^midnight visit$/i.test(label) || /^customer journey$/i.test(label)) {
    return fallback;
  }
  if (/^business(?:\s+[a-z])?$/i.test(label)) {
    return "Local business";
  }
  if (/^request\s+quote$/i.test(label)) {
    return "Quote request";
  }
  return label || fallback;
}

/**
 * Turns the small flow vocabulary returned by the director into a concrete
 * story of people, objects, and state changes. This is deliberately
 * deterministic: an old storyboard without an `objects` field still renders
 * as a real-world scene instead of falling back to abstract boxes.
 */
export function generateRealWorldObjectPlan(scene: ReelFlowScene): RealWorldObjectPlan {
  if (scene.realWorld?.objects.length && scene.realWorld.objects.length >= 2) {
    return {
      domain: "agent",
      ...scene.realWorld,
      objects: scene.realWorld.objects,
    };
  }

  const domain = detectDomain(scene);
  const used = new Set<string>();

  if (domain === "quote") {
    const visitor = claimLabel(scene, used, /customer|user|visitor|client|midnight|visit/i, "Customer");
    const request = claimLabel(scene, used, /quote|request|inquiry|need|brief/i, "Quote request");
    const business = claimLabel(scene, used, /business|company|store|merchant|owner|team/i, "Business");
    return {
      domain,
      title: "A quote request, handled",
      status: "Quote workflow live",
      action: "Capture the request, qualify it, and route the right context to a business.",
      result: "The business receives a useful quote request instead of a blank lead.",
      objects: [
        object("customer", makeConcreteLabel(visitor, "Customer"), "user", "arrives with a need", "CUSTOMER"),
        object("request", makeConcreteLabel(request, "Quote request"), "search", "captures the important details", "REQUEST"),
        object("agent", "AI Agent", "brain", "qualifies and routes the request", "DECISION"),
        object("business", makeConcreteLabel(business, "Local business"), "browser", "gets context and can reply", "BUSINESS"),
      ],
    };
  }

  if (domain === "delivery") {
    const customer = claimLabel(scene, used, /customer|user|buyer|recipient/i, "Customer");
    const order = claimLabel(scene, used, /order|cart|food|package|parcel/i, "Order");
    const courier = claimLabel(scene, used, /courier|driver|rider|delivery/i, "Courier");
    const destination = claimLabel(scene, used, /destination|address|home|store|restaurant/i, "Destination");
    return {
      domain,
      title: "An order, moving in real time",
      status: "Delivery workflow live",
      action: "Read the order, choose the next action, and keep every participant in sync.",
      result: "The customer sees a reliable update while the package moves.",
      objects: [
        object("customer", customer, "user", "places the request", "CUSTOMER"),
        object("order", order, "cart", "contains the real item", "ORDER"),
        object("courier", courier, "car", "takes the next route", "COURIER"),
        object("destination", destination, "map_pin", "receives the delivery", "DESTINATION"),
      ],
    };
  }

  if (domain === "support") {
    const customer = claimLabel(scene, used, /customer|user|client|person/i, "Customer");
    const message = claimLabel(scene, used, /ticket|issue|request|message|question/i, "Support ticket");
    const agent = claimLabel(scene, used, /agent|assistant|support/i, "AI Agent");
    const outcome = claimLabel(scene, used, /resolve|refund|answer|result|reply|done/i, "Resolution");
    return {
      domain,
      title: "A support issue, resolved",
      status: "Support workflow live",
      action: "Understand the issue, look up context, and complete the next support action.",
      result: "The customer gets a useful answer, not another handoff.",
      objects: [
        object("customer", customer, "user", "reports a real problem", "CUSTOMER"),
        object("ticket", message, "mail", "keeps the conversation together", "TICKET"),
        object("agent", agent, "brain", "checks context and decides", "DECISION"),
        object("outcome", outcome, "check", "closes the loop", "OUTCOME"),
      ],
    };
  }

  if (domain === "commerce") {
    const shopper = claimLabel(scene, used, /customer|user|shopper|buyer/i, "Shopper");
    const cart = claimLabel(scene, used, /cart|product|item|order/i, "Cart");
    const payment = claimLabel(scene, used, /payment|checkout|billing/i, "Payment");
    const outcome = claimLabel(scene, used, /confirm|order|receipt|success|result/i, "Order confirmed");
    return {
      domain,
      title: "From cart to confirmation",
      status: "Checkout workflow live",
      action: "Keep the shopper, cart, payment, and confirmation aligned.",
      result: "A completed purchase with a clear customer-facing state.",
      objects: [
        object("shopper", shopper, "user", "chooses what they need", "SHOPPER"),
        object("cart", cart, "cart", "holds the selected item", "CART"),
        object("payment", payment, "payment", "authorizes the purchase", "PAYMENT"),
        object("outcome", outcome, "check", "confirms the next state", "OUTCOME"),
      ],
    };
  }

  if (domain === "booking") {
    const traveler = claimLabel(scene, used, /customer|user|traveler|guest|patient/i, "Traveler");
    const request = claimLabel(scene, used, /request|search|availability|calendar/i, "Availability");
    const reservation = claimLabel(scene, used, /booking|reservation|appointment|slot/i, "Reservation");
    const outcome = claimLabel(scene, used, /confirm|reminder|ticket|result/i, "Confirmation");
    return {
      domain,
      title: "A booking, completed",
      status: "Booking workflow live",
      action: "Find an available option, reserve it, and keep the person informed.",
      result: "The person leaves with a confirmed next step.",
      objects: [
        object("traveler", traveler, "user", "asks for a time or place", "PERSON"),
        object("availability", request, "search", "finds a usable option", "SEARCH"),
        object("reservation", reservation, "clock", "holds the selected slot", "BOOKING"),
        object("outcome", outcome, "check", "confirms the plan", "OUTCOME"),
      ],
    };
  }

  const generated = scene.nodes.slice(0, 4).map((node) => {
    const fallback = iconDetail(node.icon);
    return object(node.id, node.label, node.icon, fallback.detail, fallback.role);
  });
  const objects = generated.length >= 2 ? generated : [
    object("request", "Customer request", "user", "starts with a real need", "INPUT"),
    object("agent", "AI Agent", "brain", "decides what happens next", "DECISION"),
    object("result", "Completed action", "check", "changes the real state", "OUTCOME"),
  ];

  return {
    domain: "agent",
    title: "An AI agent, in action",
    status: "Agent workflow live",
    action: "Observe the request, use the right tool, and complete the next real-world action.",
    result: "The workflow ends with a state the customer can actually use.",
    objects,
  };
}

function VisualShell(props: { theme: ReelTheme; active: boolean; children: ReactNode }) {
  const frame = useCurrentFrame();
  const pulse = props.active ? 1 + Math.sin(frame * 0.16) * 0.035 : 1;

  return (
    <div
      style={{
        position: "relative",
        width: 132,
        height: 132,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 34,
        background: props.active ? `${props.theme.accent}22` : "rgba(5, 16, 27, 0.72)",
        border: `2px solid ${props.active ? props.theme.accent : props.theme.surfaceBorder}`,
        boxShadow: props.active ? `0 0 34px ${props.theme.accent}55` : "inset 0 0 24px rgba(255,255,255,0.03)",
        transform: `scale(${pulse})`,
      }}
    >
      {props.children}
    </div>
  );
}

function ObjectIllustration(props: { item: GeneratedRealWorldObject; theme: ReelTheme; active: boolean }) {
  const accent = props.active ? props.theme.accent : props.theme.accentSecondary;

  if (props.item.icon === "user" || props.item.icon === "users") {
    return (
      <VisualShell theme={props.theme} active={props.active}>
        <div style={{ position: "relative", width: 92, height: 96 }}>
          <div style={{ position: "absolute", top: 2, left: 31, width: 30, height: 30, borderRadius: "50%", background: accent, boxShadow: `0 0 18px ${accent}99` }} />
          <div style={{ position: "absolute", bottom: 4, left: 10, width: 72, height: 52, borderRadius: "42px 42px 20px 20px", background: `linear-gradient(180deg, ${accent}, ${props.theme.accentSecondary})`, boxShadow: `0 8px 20px ${accent}55` }} />
          <div style={{ position: "absolute", top: 16, left: 42, width: 8, height: 8, borderRadius: "50%", background: "#06121d" }} />
        </div>
      </VisualShell>
    );
  }

  if (props.item.icon === "browser" || props.item.icon === "phone") {
    return (
      <VisualShell theme={props.theme} active={props.active}>
        <div style={{ width: 92, height: 106, padding: 8, borderRadius: 16, background: "#07131f", border: `3px solid ${accent}`, boxShadow: `0 0 18px ${accent}44` }}>
          <div style={{ display: "flex", gap: 4, padding: "3px 2px 8px", borderBottom: "1px solid #31556a" }}>
            {[0, 1, 2].map((dot) => <span key={dot} style={{ width: 6, height: 6, borderRadius: "50%", background: dot === 0 ? "#fb923c" : accent }} />)}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 10 }}>
            <span style={{ width: "70%", height: 8, borderRadius: 8, background: accent }} />
            <span style={{ width: "92%", height: 18, borderRadius: 6, background: "#21465a" }} />
            <span style={{ width: "55%", height: 18, borderRadius: 6, background: `${accent}77` }} />
          </div>
        </div>
      </VisualShell>
    );
  }

  if (props.item.icon === "brain") {
    return (
      <VisualShell theme={props.theme} active={props.active}>
        <div style={{ position: "relative", width: 90, height: 90, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {[0, 1, 2].map((ring) => (
            <span key={ring} style={{ position: "absolute", width: 52 + ring * 16, height: 52 + ring * 16, border: `1px solid ${accent}${ring === 0 ? "cc" : "55"}`, borderRadius: "50%", transform: `rotate(${ring * 38 + 12}deg)` }} />
          ))}
          <ReelIcon name="brain" size={52} color={accent} strokeWidth={1.8} />
          <span style={{ position: "absolute", top: 8, right: 5, width: 10, height: 10, borderRadius: "50%", background: props.theme.accent, boxShadow: `0 0 15px ${props.theme.accent}` }} />
        </div>
      </VisualShell>
    );
  }

  return (
    <VisualShell theme={props.theme} active={props.active}>
      <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", width: 92, height: 92, borderRadius: 24, background: `${accent}18`, color: accent }}>
        <ReelIcon name={props.item.icon} size={58} color="currentColor" strokeWidth={1.8} />
        {props.active ? <span style={{ position: "absolute", right: -4, bottom: -4, width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "50%", background: props.theme.accent, color: "#06121d" }}><ReelIcon name="check" size={15} color="currentColor" strokeWidth={3} /></span> : null}
      </div>
    </VisualShell>
  );
}

function ObjectCard(props: { item: GeneratedRealWorldObject; theme: ReelTheme; index: number; count: number; active: boolean; completed: boolean; delay: number }) {
  const enter = useEnter(props.delay, 14);
  const accent = props.index % 2 === 1 ? props.theme.accentSecondary : props.theme.accent;
  const width = props.count <= 2 ? "42%" : props.count === 3 ? "30.5%" : "22.2%";
  const left = props.count <= 2 ? `${props.index * 50 + 4}%` : props.count === 3 ? `${props.index * 33 + 1.5}%` : `${props.index * 25 + 1.4}%`;
  const state = props.active ? "ON STAGE" : props.completed ? "DONE" : "NEXT";

  return (
    <div
      style={{
        position: "absolute",
        top: 52,
        left,
        width,
        height: 310,
        padding: "16px 14px 14px",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 9,
        borderRadius: 22,
        background: props.active ? "rgba(22, 55, 70, 0.98)" : "rgba(9, 25, 39, 0.94)",
        border: `2px solid ${props.active ? accent : props.theme.surfaceBorder}`,
        boxShadow: props.active ? `0 0 32px ${accent}55` : "0 18px 32px rgba(0,0,0,0.22)",
        opacity: enter,
        transform: `translateY(${interpolate(enter, [0, 1], [34, 0])}px) scale(${props.active ? 1.025 : 1})`,
      }}
    >
      <div style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, color: accent, fontFamily: props.theme.monoFont, fontSize: 12, letterSpacing: "0.06em" }}>
        <span>{props.item.role}</span>
        <span style={{ padding: "4px 6px", borderRadius: 7, background: `${accent}1c` }}>{state}</span>
      </div>
      <ObjectIllustration item={props.item} theme={props.theme} active={props.active} />
      <div style={{ width: "100%", color: props.theme.text, fontFamily: props.theme.bodyFont, fontSize: props.count <= 2 ? 25 : 21, lineHeight: 1.08, fontWeight: 700, textAlign: "center" }}>
        {props.item.label}
      </div>
      <div style={{ width: "100%", color: props.theme.textMuted, fontFamily: props.theme.bodyFont, fontSize: props.count <= 2 ? 17 : 15, lineHeight: 1.18, textAlign: "center" }}>
        {props.item.detail}
      </div>
    </div>
  );
}

export function RealWorldObjectScene(props: { plan: RealWorldObjectPlan; theme: ReelTheme; durationInFrames: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 14, mass: 0.7 } });
  const objects = props.plan.objects.slice(0, 4);
  const activeIndex = Math.min(objects.length - 1, Math.floor((frame / Math.max(props.durationInFrames, 1)) * objects.length));
  const draw = interpolate(frame, [18, Math.max(19, props.durationInFrames - 18)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const packet = interpolate(draw, [0, 1], [70, 835]);

  return (
    <div
      style={{
        position: "relative",
        height: 760,
        overflow: "hidden",
        borderRadius: 34,
        background: "linear-gradient(155deg, rgba(16, 37, 55, 0.98), rgba(5, 16, 27, 0.99))",
        border: `2px solid ${props.theme.surfaceBorder}`,
        boxShadow: "0 24px 60px rgba(0, 0, 0, 0.28)",
        opacity: enter,
        transform: `translateY(${interpolate(enter, [0, 1], [30, 0])}px)`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "22px 24px 0", color: props.theme.textMuted, fontFamily: props.theme.monoFont, fontSize: 18, letterSpacing: "0.06em", textTransform: "uppercase" }}>
        <Pill theme={props.theme} style={{ padding: "9px 16px", fontSize: 17, background: props.theme.accentSecondary, color: "#fffaf4" }}>
          <ReelIcon name="globe" size={21} color="currentColor" strokeWidth={2.4} />
          REAL OBJECTS
        </Pill>
        <span style={{ color: props.theme.accent }}>● {props.plan.status}</span>
      </div>

      <div style={{ position: "relative", height: 454, margin: "10px 22px 0", borderRadius: 26, overflow: "hidden", background: "rgba(5, 16, 27, 0.72)", border: `1px solid ${props.theme.surfaceBorder}` }}>
        <div style={{ position: "absolute", inset: 0, opacity: 0.22, backgroundImage: "linear-gradient(rgba(94,234,212,0.2) 1px, transparent 1px), linear-gradient(90deg, rgba(94,234,212,0.2) 1px, transparent 1px)", backgroundSize: "48px 48px", backgroundPosition: `${(frame * 0.6) % 48}px 0` }} />
        <svg viewBox="0 0 900 360" width="100%" height="100%" style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
          <defs>
            <filter id="real-object-glow" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="5" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>
          <path d="M 80 180 C 260 80, 335 280, 450 180 S 640 80, 820 180" fill="none" stroke="#28485b" strokeWidth="10" strokeLinecap="round" strokeDasharray="14 14" />
          <path d="M 80 180 C 260 80, 335 280, 450 180 S 640 80, 820 180" fill="none" stroke={props.theme.accent} strokeOpacity={0.68} strokeWidth="4" strokeLinecap="round" strokeDasharray="900" strokeDashoffset={900 * (1 - draw)} filter="url(#real-object-glow)" />
          <circle cx={packet} cy={180 + Math.sin((packet / 120) * Math.PI) * -58} r="10" fill="#ffffff" filter="url(#real-object-glow)" />
        </svg>
        {objects.map((item, index) => (
          <ObjectCard
            key={item.id}
            item={item}
            theme={props.theme}
            index={index}
            count={objects.length}
            active={index === activeIndex}
            completed={index < activeIndex}
            delay={staggerDelay(index, objects.length, props.durationInFrames, 0.62, 8)}
          />
        ))}
        <div style={{ position: "absolute", left: 18, right: 18, bottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "11px 14px", borderRadius: 14, background: "rgba(5, 16, 27, 0.92)", border: `1px solid ${props.theme.surfaceBorder}`, color: props.theme.textMuted, fontFamily: props.theme.bodyFont, fontSize: 18 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 9 }}><span style={{ width: 9, height: 9, borderRadius: "50%", background: props.theme.accent, boxShadow: `0 0 12px ${props.theme.accent}` }} />{props.plan.action}</span>
          <span style={{ color: props.theme.accent, fontFamily: props.theme.monoFont, fontSize: 15, whiteSpace: "nowrap" }}>STEP {activeIndex + 1}/{objects.length}</span>
        </div>
      </div>

      <div style={{ margin: "18px 22px 0", padding: "18px 20px", borderRadius: 20, background: `${props.theme.accent}18`, border: `1px solid ${props.theme.accent}66`, color: props.theme.text, fontFamily: props.theme.bodyFont }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, color: props.theme.accent, fontFamily: props.theme.monoFont, fontSize: 15, letterSpacing: "0.06em" }}>
          <ReelIcon name="check" size={22} color="currentColor" />
          REAL-WORLD OUTCOME
        </div>
        <div style={{ marginTop: 8, fontSize: 24, lineHeight: 1.15, fontWeight: 700 }}>{props.plan.result}</div>
      </div>
    </div>
  );
}
