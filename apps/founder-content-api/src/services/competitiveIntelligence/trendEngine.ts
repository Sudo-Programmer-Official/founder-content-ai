import { randomUUID } from "node:crypto";
import type {
  HookType,
  SourceItem,
  SourceItemAnalysis,
  TrendSignal,
} from "../../../../../packages/shared-types/index.ts";

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function getWindowItems(
  items: SourceItem[],
  analysesByItemId: Map<string, SourceItemAnalysis>,
  now: Date,
  windowDays: 7 | 30,
) {
  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  const currentStart = now.getTime() - windowMs;
  const previousStart = currentStart - windowMs;

  const current = items.filter((item) => {
    const publishedAt = new Date(item.publishedAt).getTime();
    return publishedAt >= currentStart && publishedAt <= now.getTime() && analysesByItemId.has(item.id);
  });

  const previous = items.filter((item) => {
    const publishedAt = new Date(item.publishedAt).getTime();
    return publishedAt >= previousStart && publishedAt < currentStart && analysesByItemId.has(item.id);
  });

  return { current, previous };
}

function toHookTypeList(hookTypes: HookType[]): HookType[] {
  const counts = new Map<HookType, number>();

  for (const hookType of hookTypes) {
    counts.set(hookType, (counts.get(hookType) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
    .map(([hookType]) => hookType);
}

export function buildTrendSignals(
  businessId: string,
  items: SourceItem[],
  analyses: SourceItemAnalysis[],
  now = new Date(),
): { trends7d: TrendSignal[]; trends30d: TrendSignal[] } {
  const analysesByItemId = new Map(analyses.map((analysis) => [analysis.sourceItemId, analysis]));

  function buildForWindow(windowDays: 7 | 30): TrendSignal[] {
    const { current, previous } = getWindowItems(items, analysesByItemId, now, windowDays);
    const currentByTopic = new Map<string, SourceItem[]>();
    const previousByTopic = new Map<string, number>();

    for (const item of current) {
      const topic = analysesByItemId.get(item.id)?.topic ?? "General strategy";
      const bucket = currentByTopic.get(topic) ?? [];
      bucket.push(item);
      currentByTopic.set(topic, bucket);
    }

    for (const item of previous) {
      const topic = analysesByItemId.get(item.id)?.topic ?? "General strategy";
      previousByTopic.set(topic, (previousByTopic.get(topic) ?? 0) + 1);
    }

    const generatedAt = now.toISOString();

    return Array.from(currentByTopic.entries())
      .map(([topic, topicItems]) => {
        const previousCount = previousByTopic.get(topic) ?? 0;
        const sourceItemCount = topicItems.length;
        const engagementSum = topicItems.reduce(
          (total, item) => total + Math.max(item.engagementScore, 0.25),
          0,
        );
        const hookTypes = topicItems
          .map((item) => analysesByItemId.get(item.id)?.hookType)
          .filter((value): value is HookType => Boolean(value));
        const momentum = round((sourceItemCount - previousCount) / Math.max(previousCount, 1));
        const engagementWeightedTrendScore = round(
          engagementSum * (1 + Math.max(momentum, 0)) + sourceItemCount * 0.35,
        );

        return {
          id: randomUUID(),
          businessId,
          topic,
          windowDays,
          sourceItemCount,
          momentum,
          engagementWeightedTrendScore,
          sampleHookTypes: toHookTypeList(hookTypes),
          generatedAt,
        } satisfies TrendSignal;
      })
      .sort((left, right) => right.engagementWeightedTrendScore - left.engagementWeightedTrendScore);
  }

  return {
    trends7d: buildForWindow(7),
    trends30d: buildForWindow(30),
  };
}
