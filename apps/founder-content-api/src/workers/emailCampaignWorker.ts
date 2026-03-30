import { drainQueuedEmailCampaigns } from "../services/email/emailService.ts";
import { logError, logInfo } from "../utils/logger.ts";
import { toErrorContext } from "../utils/http.ts";

function resolvePollIntervalMs(): number {
  const parsed = Number(process.env.EMAIL_CAMPAIGN_WORKER_POLL_INTERVAL_MS ?? 5000);
  return Number.isFinite(parsed) && parsed >= 1000 ? Math.floor(parsed) : 5000;
}

function resolveRunOnce(): boolean {
  return process.env.EMAIL_CAMPAIGN_WORKER_RUN_ONCE === "true";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function hasWork(result: {
  recipientsClaimed: number;
  recipientsSent: number;
  recipientsFailed: number;
  recipientsUnsubscribed: number;
  requeuedRecipients: number;
}): boolean {
  return (
    result.recipientsClaimed > 0 ||
    result.recipientsSent > 0 ||
    result.recipientsFailed > 0 ||
    result.recipientsUnsubscribed > 0 ||
    result.requeuedRecipients > 0
  );
}

let shutdownRequested = false;

function requestShutdown(signal: string): void {
  if (shutdownRequested) {
    return;
  }

  shutdownRequested = true;
  logInfo("Email campaign worker shutdown requested.", { signal });
}

process.on("SIGTERM", () => requestShutdown("SIGTERM"));
process.on("SIGINT", () => requestShutdown("SIGINT"));

async function runEmailCampaignWorker(): Promise<void> {
  const pollIntervalMs = resolvePollIntervalMs();
  const runOnce = resolveRunOnce();

  logInfo("Email campaign worker started.", {
    pollIntervalMs,
    runOnce,
  });

  do {
    const result = await drainQueuedEmailCampaigns();

    if (hasWork(result)) {
      logInfo("Processed queued email campaigns.", { ...result });
    }

    if (runOnce || shutdownRequested) {
      break;
    }

    await sleep(pollIntervalMs);
  } while (!shutdownRequested);

  logInfo("Email campaign worker stopped.");
}

if (process.argv[1]?.includes("emailCampaignWorker.ts")) {
  runEmailCampaignWorker().catch((error) => {
    logError("Email campaign worker failed.", toErrorContext(error));
    process.exitCode = 1;
  });
}
