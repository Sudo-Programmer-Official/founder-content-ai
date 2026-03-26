import { processQueuedEmailCampaigns } from "../services/email/emailService.ts";
import { logError, logInfo } from "../utils/logger.ts";
import { toErrorContext } from "../utils/http.ts";

async function runEmailCampaignWorker(): Promise<void> {
  await processQueuedEmailCampaigns();
  logInfo("Processed queued email campaigns.");
}

runEmailCampaignWorker().catch((error) => {
  logError("Email campaign worker failed.", toErrorContext(error));
  process.exitCode = 1;
});
