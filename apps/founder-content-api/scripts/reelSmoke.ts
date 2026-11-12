/**
 * End-to-end Reel Studio check without the database or S3:
 * prompt → AI storyboard → TTS narration → Remotion render.
 *
 *   npx tsx --env-file=.env scripts/reelSmoke.ts "Explain Kafka to backend devs" --language=hinglish --out=/tmp/reel
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import type { ReelProject } from "../../../packages/shared-types/index.ts";
import { normalizeReelSettings } from "../src/services/reelStudio/reelProjectService.ts";
import { produceReelFiles } from "../src/services/reelStudio/reelRenderService.ts";
import { generateReelStoryboard } from "../src/services/reelStudio/reelStoryboardService.ts";

function readFlag(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

const prompt =
  process.argv.slice(2).find((arg) => !arg.startsWith("--")) ??
  "Explain how 100 microservices communicate, using a real-world example. Make it engaging for software engineers.";
const outDir = path.resolve(readFlag("out") ?? "reel-smoke");
const settings = normalizeReelSettings({
  language: readFlag("language"),
  durationSeconds: readFlag("duration") ? Number(readFlag("duration")) : undefined,
  style: readFlag("style"),
  audience: readFlag("audience"),
  voice: readFlag("voice"),
  brandHandle: readFlag("handle") ?? "@sudoprogrammer",
});

async function main(): Promise<void> {
  await fs.mkdir(outDir, { recursive: true });
  const startedAt = Date.now();
  console.log("Settings:", settings);

  const storyboard = await generateReelStoryboard(prompt, settings);
  await fs.writeFile(path.join(outDir, "storyboard.json"), JSON.stringify(storyboard, null, 2));
  console.log(`Storyboard: "${storyboard.title}" with ${storyboard.scenes.length} scenes (${Date.now() - startedAt} ms)`);

  const project: ReelProject = {
    id: "smoke",
    businessId: "smoke",
    prompt,
    settings,
    status: "rendering",
    workflowStage: "approved",
    storyboard,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  let lastLine = "";
  const produced = await produceReelFiles(project, outDir, (progress) => {
    const line = `${progress.stage} ${Math.floor(progress.percent / 10) * 10}%`;
    if (line !== lastLine) {
      lastLine = line;
      console.log(line);
    }
  });

  console.log(`Done in ${((Date.now() - startedAt) / 1000).toFixed(1)}s →`, produced.videoPath);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
