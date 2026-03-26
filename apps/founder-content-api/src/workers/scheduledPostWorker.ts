import { processDueScheduledPosts } from "../services/scheduledPostService.ts";
import { logError, logInfo } from "../utils/logger.ts";

function resolveBatchSize(): number {
  const parsed = Number(process.env.SCHEDULED_POST_WORKER_BATCH_SIZE ?? 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 10;
}

export async function runScheduledPostWorker(): Promise<void> {
  const startedAt = Date.now();
  const result = await processDueScheduledPosts(resolveBatchSize());

  logInfo("Scheduled post worker run completed.", {
    claimed: result.claimed,
    published: result.published,
    failed: result.failed,
    durationMs: Date.now() - startedAt,
  });
}

if (process.argv[1]?.includes("scheduledPostWorker.ts")) {
  runScheduledPostWorker().catch((error) => {
    logError("Scheduled post worker crashed.", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    process.exitCode = 1;
  });
}
