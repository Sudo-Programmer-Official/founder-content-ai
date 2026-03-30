import { recalculateAllEmailDomainReputations } from "../services/email/emailDeliverabilityService.ts";
import { drainQueuedEmailCampaigns, processQueuedEmailContactImportJobs } from "../services/email/emailService.ts";
import { processGrowthAutomationDueRuns } from "../services/growth/growthAutomationService.ts";
import { processQueuedIdeaUnderstandingJobs } from "../services/controlDashboardService.ts";
import { processDueScheduledPosts } from "../services/scheduledPostService.ts";
import { toErrorContext } from "../utils/http.ts";
import { logError, logInfo } from "../utils/logger.ts";

interface ScheduledPostWorkerResult {
  claimed: number;
  published: number;
  failed: number;
}

interface EmailCampaignWorkerResult {
  campaignsVisited: number;
  campaignsFinalized: number;
  recipientsClaimed: number;
  recipientsSent: number;
  recipientsFailed: number;
  recipientsUnsubscribed: number;
  requeuedRecipients: number;
}

interface GrowthAutomationWorkerResult {
  processedCount: number;
  sentCount: number;
  failedCount: number;
  skippedCount: number;
}

interface EmailContactImportWorkerResult {
  jobsClaimed: number;
  jobsCompleted: number;
  jobsFailed: number;
  contactsInserted: number;
  contactsUpdated: number;
  contactsSkipped: number;
  contactErrors: number;
}

interface IdeaUnderstandingWorkerResult {
  jobsClaimed: number;
  jobsCompleted: number;
  jobsFailed: number;
}

const DEFAULT_APP_WORKER_POLL_INTERVAL_MS = 5000;
const DEFAULT_APP_WORKER_DELIVERABILITY_INTERVAL_MS = 15 * 60 * 1000;
const DEFAULT_SCHEDULED_POST_BATCH_SIZE = 3;

function resolvePositiveIntegerEnv(envName: string, fallback: number): number {
  const rawValue = process.env[envName]?.trim();

  if (!rawValue) {
    return fallback;
  }

  const parsedValue = Number.parseInt(rawValue, 10);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : fallback;
}

function resolvePollIntervalMs(): number {
  return resolvePositiveIntegerEnv("APP_WORKER_POLL_INTERVAL_MS", DEFAULT_APP_WORKER_POLL_INTERVAL_MS);
}

function resolveDeliverabilityIntervalMs(): number {
  return resolvePositiveIntegerEnv(
    "APP_WORKER_DELIVERABILITY_INTERVAL_MS",
    DEFAULT_APP_WORKER_DELIVERABILITY_INTERVAL_MS,
  );
}

function resolveScheduledPostBatchSize(): number {
  return resolvePositiveIntegerEnv("SCHEDULED_POST_WORKER_BATCH_SIZE", DEFAULT_SCHEDULED_POST_BATCH_SIZE);
}

function resolveRunOnce(): boolean {
  return process.env.APP_WORKER_RUN_ONCE === "true";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function hasScheduledPostWork(result: ScheduledPostWorkerResult): boolean {
  return result.claimed > 0 || result.published > 0 || result.failed > 0;
}

function hasEmailCampaignWork(result: EmailCampaignWorkerResult): boolean {
  return (
    result.recipientsClaimed > 0 ||
    result.recipientsSent > 0 ||
    result.recipientsFailed > 0 ||
    result.recipientsUnsubscribed > 0 ||
    result.requeuedRecipients > 0
  );
}

function hasGrowthAutomationWork(result: GrowthAutomationWorkerResult): boolean {
  return (
    result.processedCount > 0 ||
    result.sentCount > 0 ||
    result.failedCount > 0 ||
    result.skippedCount > 0
  );
}

function hasEmailContactImportWork(result: EmailContactImportWorkerResult): boolean {
  return (
    result.jobsClaimed > 0 ||
    result.jobsCompleted > 0 ||
    result.jobsFailed > 0 ||
    result.contactsInserted > 0 ||
    result.contactsUpdated > 0 ||
    result.contactsSkipped > 0 ||
    result.contactErrors > 0
  );
}

function hasIdeaUnderstandingWork(result: IdeaUnderstandingWorkerResult): boolean {
  return result.jobsClaimed > 0 || result.jobsCompleted > 0 || result.jobsFailed > 0;
}

let shutdownRequested = false;

function requestShutdown(signal: string): void {
  if (shutdownRequested) {
    return;
  }

  shutdownRequested = true;
  logInfo("App worker shutdown requested.", { signal });
}

process.on("SIGTERM", () => requestShutdown("SIGTERM"));
process.on("SIGINT", () => requestShutdown("SIGINT"));

async function runScheduledPosts(): Promise<boolean> {
  try {
    const result = await processDueScheduledPosts(resolveScheduledPostBatchSize());

    if (hasScheduledPostWork(result)) {
      logInfo("Processed scheduled post jobs.", result);
      return true;
    }
  } catch (error) {
    logError("Shared worker failed while processing scheduled posts.", toErrorContext(error));
  }

  return false;
}

async function runEmailCampaigns(): Promise<boolean> {
  try {
    const result = await drainQueuedEmailCampaigns();

    if (hasEmailCampaignWork(result)) {
      logInfo("Processed email campaign jobs.", { ...result });
      return true;
    }
  } catch (error) {
    logError("Shared worker failed while processing email campaigns.", toErrorContext(error));
  }

  return false;
}

async function runEmailContactImports(): Promise<boolean> {
  try {
    const result = await processQueuedEmailContactImportJobs();

    if (hasEmailContactImportWork(result)) {
      logInfo("Processed email contact import jobs.", { ...result });
      return true;
    }
  } catch (error) {
    logError("Shared worker failed while processing email contact imports.", toErrorContext(error));
  }

  return false;
}

async function runIdeaUnderstanding(): Promise<boolean> {
  try {
    const result = await processQueuedIdeaUnderstandingJobs();

    if (hasIdeaUnderstandingWork(result)) {
      logInfo("Processed idea understanding jobs.", { ...result });
      return true;
    }
  } catch (error) {
    logError("Shared worker failed while processing idea understanding jobs.", toErrorContext(error));
  }

  return false;
}

async function runGrowthAutomation(): Promise<boolean> {
  try {
    const result = await processGrowthAutomationDueRuns();

    if (hasGrowthAutomationWork(result)) {
      logInfo("Processed growth automation jobs.", { ...result });
      return true;
    }
  } catch (error) {
    logError("Shared worker failed while processing growth automation.", toErrorContext(error));
  }

  return false;
}

async function runDeliverabilityRollups(): Promise<boolean> {
  try {
    const processedDomains = await recalculateAllEmailDomainReputations();

    if (processedDomains > 0) {
      logInfo("Recalculated email deliverability rollups.", { processedDomains });
      return true;
    }
  } catch (error) {
    logError("Shared worker failed while processing email deliverability.", toErrorContext(error));
  }

  return false;
}

export async function runAppWorker(): Promise<void> {
  const pollIntervalMs = resolvePollIntervalMs();
  const deliverabilityIntervalMs = resolveDeliverabilityIntervalMs();
  const runOnce = resolveRunOnce();
  let nextDeliverabilityAt = 0;

  logInfo("Shared app worker started.", {
    pollIntervalMs,
    deliverabilityIntervalMs,
    runOnce,
  });

  do {
    const passStartedAt = Date.now();
    const scheduledPostWork = await runScheduledPosts();
    const emailCampaignWork = await runEmailCampaigns();
    const emailContactImportWork = await runEmailContactImports();
    const ideaUnderstandingWork = await runIdeaUnderstanding();
    const growthAutomationWork = await runGrowthAutomation();

    let deliverabilityWork = false;

    if (passStartedAt >= nextDeliverabilityAt) {
      deliverabilityWork = await runDeliverabilityRollups();
      nextDeliverabilityAt = Date.now() + deliverabilityIntervalMs;
    }

    if (runOnce || shutdownRequested) {
      break;
    }

    if (
      !scheduledPostWork &&
      !emailCampaignWork &&
      !emailContactImportWork &&
      !ideaUnderstandingWork &&
      !growthAutomationWork &&
      !deliverabilityWork
    ) {
      await sleep(pollIntervalMs);
    }
  } while (!shutdownRequested);

  logInfo("Shared app worker stopped.");
}

if (process.argv[1]?.includes("appWorker.ts")) {
  runAppWorker().catch((error) => {
    logError("Shared app worker failed.", toErrorContext(error));
    process.exitCode = 1;
  });
}
