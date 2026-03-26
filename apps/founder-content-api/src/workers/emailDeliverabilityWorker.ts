import { recalculateAllEmailDomainReputations } from "../services/email/emailDeliverabilityService.ts";
import { logError, logInfo } from "../utils/logger.ts";
import { toErrorContext } from "../utils/http.ts";

async function runEmailDeliverabilityWorker(): Promise<void> {
  const processedDomains = await recalculateAllEmailDomainReputations();
  logInfo("Recalculated email deliverability rollups.", {
    processedDomains,
  });
}

runEmailDeliverabilityWorker().catch((error) => {
  logError("Email deliverability worker failed.", toErrorContext(error));
  process.exitCode = 1;
});
