import type { ReelRenderProps, ReelStoryboard, ReelTimedScene } from "../../../packages/shared-types/src/reel-studio";

/** Storyboard used by Remotion Studio and smoke renders; mirrors what the AI director emits. */
export const sampleStoryboard: ReelStoryboard = {
  title: "How 100 microservices talk without chaos",
  caption: "100 services, zero spaghetti. Here's how event streaming keeps them in sync.",
  hashtags: ["#microservices", "#systemdesign", "#kafka"],
  scenes: [
    {
      id: "s1",
      type: "title",
      kicker: "System design",
      title: "How do 100 microservices talk?",
      subtitle: "Without turning into spaghetti.",
      narration: "Imagine you have one hundred microservices. How do they talk without turning into spaghetti?",
    },
    {
      id: "s2",
      type: "comparison",
      heading: "Direct calls vs events",
      left: { title: "REST everywhere", points: ["Tight coupling", "Cascading failures", "N × N connections"] },
      right: { title: "Event stream", points: ["Loose coupling", "Retry and replay", "One shared backbone"] },
      narration: "Calling each other directly couples everything. One slow service and the whole chain fails.",
    },
    {
      id: "s3",
      type: "flow",
      heading: "Kafka as the backbone",
      layout: "hub",
      nodes: [
        { id: "kafka", label: "Kafka", icon: "queue" },
        { id: "orders", label: "Orders", icon: "cart" },
        { id: "payments", label: "Payments", icon: "payment" },
        { id: "email", label: "Email", icon: "mail" },
        { id: "analytics", label: "Analytics", icon: "chart" },
        { id: "inventory", label: "Inventory", icon: "database" },
      ],
      edges: [
        { from: "orders", to: "kafka", label: "OrderPlaced" },
        { from: "kafka", to: "payments" },
        { from: "kafka", to: "email" },
        { from: "kafka", to: "analytics" },
        { from: "kafka", to: "inventory" },
      ],
      narration: "Instead, services publish events to Kafka. Anyone who cares simply subscribes, at their own pace.",
    },
    {
      id: "s4",
      type: "code",
      heading: "Publishing an event",
      language: "typescript",
      code: "await producer.send({\n  topic: \"orders\",\n  messages: [{\n    key: order.id,\n    value: JSON.stringify(order),\n  }],\n});",
      narration: "Publishing is one call. The order service never needs to know who is listening.",
    },
    {
      id: "s5",
      type: "stat",
      value: "1000000+",
      label: "events per second",
      context: "A modest Kafka cluster handles this throughput.",
      narration: "And it scales. A modest cluster handles over a million events per second.",
    },
    {
      id: "s6",
      type: "outro",
      title: "Decouple with events.",
      cta: "Follow for more system design",
      narration: "Decouple with events. Follow for more system design in sixty seconds.",
    },
  ],
};

const FPS = 30;

/** Rough timeline from word counts, so the studio preview works without audio. */
export function estimateTimeline(storyboard: ReelStoryboard): { timeline: ReelTimedScene[]; durationInFrames: number } {
  let cursor = 0;
  const timeline = storyboard.scenes.map((scene) => {
    const words = scene.narration.split(/\s+/).filter(Boolean);
    const durationInFrames = Math.max(Math.round((words.length / 2.6) * FPS) + 12, 60);
    const entry: ReelTimedScene = {
      sceneId: scene.id,
      startFrame: cursor,
      durationInFrames,
      captions: [],
    };
    const chunkSize = 4;
    const chunkCount = Math.ceil(words.length / chunkSize);

    for (let index = 0; index < chunkCount; index += 1) {
      entry.captions.push({
        text: words.slice(index * chunkSize, (index + 1) * chunkSize).join(" "),
        startFrame: Math.round((index / chunkCount) * (durationInFrames - 12)),
        endFrame: Math.round(((index + 1) / chunkCount) * (durationInFrames - 12)),
      });
    }

    cursor += durationInFrames;
    return entry;
  });

  return { timeline, durationInFrames: cursor };
}

const estimated = estimateTimeline(sampleStoryboard);

export const sampleRenderProps: ReelRenderProps = {
  storyboard: sampleStoryboard,
  style: "neon_tech",
  language: "english",
  fps: FPS,
  width: 1080,
  height: 1920,
  durationInFrames: estimated.durationInFrames,
  timeline: estimated.timeline,
  brandHandle: "@sudoprogrammer",
  showCaptions: true,
};
