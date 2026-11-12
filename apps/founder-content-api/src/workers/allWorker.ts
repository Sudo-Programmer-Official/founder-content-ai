import { runAppWorker } from "./appWorker.ts";
import { runReelRenderWorker } from "./reelRenderWorker.ts";
import { toErrorContext } from "../utils/http.ts";
import { logError } from "../utils/logger.ts";

/** Runs the shared queues and Reel Studio renders in the existing Render worker. */
async function runAllWorkers(): Promise<void> {
  await Promise.all([runAppWorker(), runReelRenderWorker()]);
}

runAllWorkers().catch((error) => {
  logError("Combined worker failed.", toErrorContext(error));
  process.exitCode = 1;
  process.exit(1);
});
