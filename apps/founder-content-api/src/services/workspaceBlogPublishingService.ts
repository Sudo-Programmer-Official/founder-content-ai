import path from "node:path";
import { spawn } from "node:child_process";
import type { QueryResultRow } from "pg";
import { exportWorkspaceBlogs } from "../../scripts/exportWorkspaceBlogs.ts";
import { HttpError } from "../utils/http.ts";
import { logInfo } from "../utils/logger.ts";
import { queryDb } from "./db/client.ts";

interface WorkspaceLookupRow extends QueryResultRow {
  id: string;
  slug: string;
  name: string;
}

export interface PublishWorkspaceBlogRequest {
  workspaceId: string;
  runBuild?: boolean;
}

export interface PublishWorkspaceBlogResponse {
  workspaceId: string;
  workspaceSlug: string;
  workspaceName: string;
  synced: boolean;
  built: boolean;
  websiteRoot: string;
}

function runCommand(input: {
  cmd: string;
  args: string[];
  cwd: string;
  env?: Record<string, string | undefined>;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(input.cmd, input.args, {
      cwd: input.cwd,
      stdio: "pipe",
      env: {
        ...process.env,
        ...(input.env ?? {}),
      },
      shell: process.platform === "win32",
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk ?? "");
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(stderr.trim() || `Command failed (${input.cmd} ${input.args.join(" ")})`));
    });
  });
}

async function loadWorkspaceById(workspaceId: string): Promise<WorkspaceLookupRow> {
  const result = await queryDb<WorkspaceLookupRow>(
    `
      select id, slug, name
      from businesses
      where id = $1
      limit 1
    `,
    [workspaceId],
  );

  if (result.rowCount === 0) {
    throw new HttpError(404, "workspace_not_found", "Workspace not found.");
  }

  return result.rows[0];
}

function resolveWebsiteRoot(): string {
  const configured = process.env.BLOG_WEBSITE_ROOT?.trim();
  if (configured) {
    return path.resolve(configured);
  }

  return path.resolve(process.cwd(), "..", "..", "sudo-programmer-official-website");
}

export async function publishWorkspaceBlogToWebsite(
  input: PublishWorkspaceBlogRequest,
): Promise<PublishWorkspaceBlogResponse> {
  const workspace = await loadWorkspaceById(input.workspaceId);
  const websiteRoot = resolveWebsiteRoot();
  const websiteAppDir = path.resolve(websiteRoot, "apps", "website");

  await exportWorkspaceBlogs({ workspace: workspace.slug });

  await runCommand({
    cmd: "npm",
    args: ["run", "sync:founder-content", "--", `--workspace=${workspace.slug}`],
    cwd: websiteAppDir,
    env: {
      FOUNDER_CONTENT_WORKSPACE: workspace.slug,
    },
  });

  if (input.runBuild) {
    await runCommand({
      cmd: "npm",
      args: ["run", "build"],
      cwd: websiteAppDir,
    });
  }

  logInfo("Published workspace blog to website.", {
    workspaceId: workspace.id,
    workspaceSlug: workspace.slug,
    runBuild: Boolean(input.runBuild),
    websiteRoot,
  });

  return {
    workspaceId: workspace.id,
    workspaceSlug: workspace.slug,
    workspaceName: workspace.name,
    synced: true,
    built: Boolean(input.runBuild),
    websiteRoot,
  };
}
