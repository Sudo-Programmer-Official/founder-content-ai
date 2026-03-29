import { processGrowthAutomationDueRuns } from "../services/growth/growthAutomationService.ts";
import { logError, logInfo } from "../utils/logger.ts";
import { toErrorContext } from "../utils/http.ts";

async function runGrowthAutomationWorker(): Promise<void> {
  const result = await processGrowthAutomationDueRuns();
  logInfo("Processed growth automation step runs.", result);
}

runGrowthAutomationWorker().catch((error) => {
  logError("Growth automation worker failed.", toErrorContext(error));
  process.exitCode = 1;
});
