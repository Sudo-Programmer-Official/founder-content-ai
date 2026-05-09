import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { exportWorkspaceBlogs } from "./exportWorkspaceBlogs.ts";

function getArgValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const entry = process.argv.find((arg) => arg.startsWith(prefix));
  return entry ? entry.slice(prefix.length) : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const apiRoot = path.resolve(__dirname, "..");
const founderContentRepoRoot = path.resolve(apiRoot, "..", "..");
const defaultWebsiteRepoPath = path.resolve(founderContentRepoRoot, "..", "sudo-programmer-official-website");

function runCommand(input: {
  cmd: string;
  args: string[];
  cwd: string;
  env?: Record<string, string | undefined>;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(input.cmd, input.args, {
      cwd: input.cwd,
      stdio: "inherit",
      env: {
        ...process.env,
        ...(input.env ?? {}),
      },
      shell: process.platform === "win32",
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Command failed (${input.cmd} ${input.args.join(" ")}) with exit code ${code ?? "unknown"}.`));
    });
  });
}

async function main(): Promise<void> {
  const workspace = getArgValue("workspace") || process.env.BLOG_EXPORT_WORKSPACE || "sudo-programmer";
  const websiteRoot = path.resolve(
    getArgValue("websiteRoot") ||
      process.env.BLOG_WEBSITE_ROOT ||
      defaultWebsiteRepoPath,
  );
  const websiteAppDir = path.resolve(websiteRoot, "apps", "website");
  const runBuild = hasFlag("build") || process.env.BLOG_PUBLISH_RUN_BUILD === "true";

  console.log(`[publish] Exporting workspace blogs for '${workspace}'...`);
  await exportWorkspaceBlogs({ workspace });

  console.log(`[publish] Syncing founder-content into website at ${websiteAppDir} ...`);
  await runCommand({
    cmd: "npm",
    args: ["run", "sync:founder-content", "--", `--workspace=${workspace}`],
    cwd: websiteAppDir,
    env: {
      FOUNDER_CONTENT_WORKSPACE: workspace,
    },
  });

  if (runBuild) {
    console.log("[publish] Building website...");
    await runCommand({
      cmd: "npm",
      args: ["run", "build"],
      cwd: websiteAppDir,
    });
  }

  console.log(`[publish] Completed for workspace '${workspace}'.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
