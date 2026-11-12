import { processQueuedReelRenderJobs } from "../services/reelStudio/reelRenderService.ts";
import { assertReelMediaStorageConfiguredForRuntime } from "../services/reelStudio/reelMediaStorage.ts";
import { recordWorkerFailure, recordWorkerHeartbeat } from "../services/workerRuntimeService.ts";
import { toErrorContext } from "../utils/http.ts";
import { logError, logInfo } from "../utils/logger.ts";

/**
 * Dedicated worker for Reel Studio renders. Kept out of the shared app worker
 * because a single render holds the CPU for minutes and would delay scheduled posts.
 */

const DEFAULT_POLL_INTERVAL_MS = 4000;
const REEL_RENDER_WORKER_TYPE = "reel_render_worker";

function resolvePollIntervalMs(): number {
  const parsed = Number.parseInt(process.env.REEL_RENDER_WORKER_POLL_INTERVAL_MS?.trim() ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_POLL_INTERVAL_MS;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

let shutdownRequested = false;

process.on("SIGTERM", () => {
  shutdownRequested = true;
});
process.on("SIGINT", () => {
  shutdownRequested = true;
});

export async function runReelRenderWorker(): Promise<void> {
  const pollIntervalMs = resolvePollIntervalMs();
  const runOnce = process.env.REEL_RENDER_WORKER_RUN_ONCE === "true";
  const serviceName = process.env.RENDER_SERVICE_NAME?.trim() || "reel-render-worker";

  assertReelMediaStorageConfiguredForRuntime();

  logInfo("Reel render worker started.", { pollIntervalMs, runOnce });

  do {
    let hadWork = false;

    try {
      const result = await processQueuedReelRenderJobs();
      hadWork = result.jobsClaimed > 0;

      if (hadWork) {
        logInfo("Processed reel render jobs.", { ...result });
      }
    } catch (error) {
      logError("Reel render worker pass failed.", toErrorContext(error));
    }

    await recordWorkerHeartbeat({
      workerKey: serviceName,
      workerType: REEL_RENDER_WORKER_TYPE,
      serviceName,
      hadWork,
      metadata: { pollIntervalMs, runOnce, pid: process.pid },
    });

    if (runOnce || shutdownRequested) {
      break;
    }

    if (!hadWork) {
      await sleep(pollIntervalMs);
    }
  } while (!shutdownRequested);

  logInfo("Reel render worker stopped.");
}

if (process.argv[1]?.includes("reelRenderWorker.ts")) {
  runReelRenderWorker().catch((error) => {
    const serviceName = process.env.RENDER_SERVICE_NAME?.trim() || "reel-render-worker";
    logError("Reel render worker failed.", toErrorContext(error));
    void recordWorkerFailure({
      workerKey: serviceName,
      workerType: REEL_RENDER_WORKER_TYPE,
      serviceName,
      errorMessage: error instanceof Error ? error.message : "Unknown reel render worker failure.",
      metadata: { pid: process.pid },
    });
    process.exitCode = 1;
  });
}
