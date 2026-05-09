import { exportWorkspaceBlogs } from "../../scripts/exportWorkspaceBlogs.ts";
import { toErrorContext } from "../utils/http.ts";
import { logError, logInfo } from "../utils/logger.ts";

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;

function resolvePositiveIntegerEnv(envName: string, fallback: number): number {
  const rawValue = process.env[envName]?.trim();

  if (!rawValue) {
    return fallback;
  }

  const parsed = Number.parseInt(rawValue, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveRunOnce(): boolean {
  return process.env.BLOG_EXPORT_WORKER_RUN_ONCE === "true";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let shutdownRequested = false;

function requestShutdown(signal: string): void {
  if (shutdownRequested) {
    return;
  }

  shutdownRequested = true;
  logInfo("Workspace blog export worker shutdown requested.", { signal });
}

process.on("SIGTERM", () => requestShutdown("SIGTERM"));
process.on("SIGINT", () => requestShutdown("SIGINT"));

async function runOnce(): Promise<void> {
  const startedAt = Date.now();
  const workspace = process.env.BLOG_EXPORT_WORKSPACE?.trim() || undefined;
  const outDir = process.env.BLOG_EXPORT_OUT_DIR?.trim() || undefined;
  const all = !workspace;

  await exportWorkspaceBlogs({ workspace, outDir, all });

  logInfo("Workspace blog export run completed.", {
    workspace: workspace ?? "all",
    outDir: outDir ?? "default",
    durationMs: Date.now() - startedAt,
  });
}

async function runWorker(): Promise<void> {
  const runOnceMode = resolveRunOnce();
  const intervalMs = resolvePositiveIntegerEnv("BLOG_EXPORT_WORKER_INTERVAL_MS", DEFAULT_INTERVAL_MS);

  logInfo("Workspace blog export worker started.", {
    runOnce: runOnceMode,
    intervalMs,
    workspace: process.env.BLOG_EXPORT_WORKSPACE ?? "all",
  });

  do {
    try {
      await runOnce();
    } catch (error) {
      logError("Workspace blog export worker run failed.", toErrorContext(error));
    }

    if (runOnceMode || shutdownRequested) {
      break;
    }

    await sleep(intervalMs);
  } while (!shutdownRequested);
}

if (process.argv[1]?.includes("workspaceBlogExportWorker.ts")) {
  runWorker().catch((error) => {
    logError("Workspace blog export worker crashed.", toErrorContext(error));
    process.exitCode = 1;
  });
}
