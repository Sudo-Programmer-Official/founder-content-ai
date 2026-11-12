import { bundle } from "@remotion/bundler";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const RENDERER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_DIRS = [path.join(RENDERER_ROOT, "src"), path.resolve(RENDERER_ROOT, "../../packages/shared-types/src")];

export function resolveBundleDir(): string {
  return process.env.REEL_RENDERER_BUNDLE_DIR?.trim() || path.join(RENDERER_ROOT, "build");
}

async function newestMtime(dir: string): Promise<number> {
  let newest = 0;
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      newest = Math.max(newest, await newestMtime(fullPath));
    } else {
      newest = Math.max(newest, (await fs.stat(fullPath)).mtimeMs);
    }
  }

  return newest;
}

async function isBundleFresh(bundleDir: string): Promise<boolean> {
  try {
    const builtAt = (await fs.stat(path.join(bundleDir, "index.html"))).mtimeMs;
    const sourceTimes = await Promise.all(SOURCE_DIRS.map((dir) => newestMtime(dir)));
    return Math.max(...sourceTimes) <= builtAt;
  } catch {
    return false;
  }
}

/** Webpack bundling takes several seconds, so renders reuse the last bundle unless sources changed. */
export async function ensureBundle(options: { force?: boolean } = {}): Promise<string> {
  const bundleDir = resolveBundleDir();

  if (!options.force && (await isBundleFresh(bundleDir))) {
    return bundleDir;
  }

  await bundle({
    entryPoint: path.join(RENDERER_ROOT, "src/index.ts"),
    outDir: bundleDir,
    enableCaching: true,
  });

  return bundleDir;
}
