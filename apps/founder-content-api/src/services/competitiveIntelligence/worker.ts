import { getFetchBatchSize } from "./fetchUtils.ts";
import { claimDueCompetitorSources, processClaimedCompetitorSource } from "./service.ts";

export interface FetchWorkerCycleResult {
  claimedCount: number;
}

export async function runCompetitorFetchWorkerCycle(
  batchSize = getFetchBatchSize(),
): Promise<FetchWorkerCycleResult> {
  const claimedSources = claimDueCompetitorSources(batchSize);

  for (const source of claimedSources) {
    await processClaimedCompetitorSource(source.id);
  }

  return {
    claimedCount: claimedSources.length,
  };
}
