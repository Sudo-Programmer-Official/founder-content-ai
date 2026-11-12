/**
 * Renders one reel. Invoked as a child process by the API's reel render worker:
 *
 *   tsx scripts/render.ts --props props.json --out reel.mp4 [--audio voice.wav] [--poster poster.jpg]
 *
 * Progress is written to stdout as `PROGRESS <0..1>` lines; failures exit non-zero with the reason on stderr.
 * Without --props it renders the built-in sample storyboard (handy for smoke tests).
 */
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { ReelRenderProps } from "../../../packages/shared-types/src/reel-studio";
import { sampleRenderProps } from "../src/sample.ts";
import { ensureBundle } from "./bundle-cache.ts";

const COMPOSITION_ID = "Reel";

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function resolveConcurrency(): number | null {
  const value = Number(process.env.REEL_RENDER_CONCURRENCY);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
}

async function main(): Promise<void> {
  const propsPath = readArg("props");
  const outPath = path.resolve(readArg("out") ?? "out/sample.mp4");
  const audioPath = readArg("audio");
  const posterPath = readArg("poster");
  const inputProps: ReelRenderProps = propsPath
    ? (JSON.parse(await fs.readFile(propsPath, "utf8")) as ReelRenderProps)
    : sampleRenderProps;

  const serveUrl = await ensureBundle({ force: process.argv.includes("--rebundle") });
  let stagedAudioPath: string | undefined;

  if (audioPath) {
    // staticFile() resolves against the bundle's public dir, so stage the narration there for this render.
    const audioName = `${crypto.randomUUID()}${path.extname(audioPath) || ".wav"}`;
    const audioDir = path.join(serveUrl, "public", "reel-audio");
    await fs.mkdir(audioDir, { recursive: true });
    stagedAudioPath = path.join(audioDir, audioName);
    await fs.copyFile(audioPath, stagedAudioPath);
    inputProps.audioFile = `reel-audio/${audioName}`;
  }

  try {
    const composition = await selectComposition({ serveUrl, id: COMPOSITION_ID, inputProps: { ...inputProps } });
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    let lastReported = -1;

    await renderMedia({
      composition,
      serveUrl,
      codec: "h264",
      crf: 20,
      audioCodec: "aac",
      outputLocation: outPath,
      inputProps: { ...inputProps },
      concurrency: resolveConcurrency(),
      onProgress: ({ progress }) => {
        const rounded = Math.floor(progress * 100);
        if (rounded !== lastReported) {
          lastReported = rounded;
          process.stdout.write(`PROGRESS ${progress.toFixed(3)}\n`);
        }
      },
    });

    if (posterPath) {
      await renderStill({
        composition,
        serveUrl,
        output: path.resolve(posterPath),
        frame: Math.min(45, composition.durationInFrames - 1),
        imageFormat: "jpeg",
        jpegQuality: 85,
        inputProps: { ...inputProps },
      });
    }

    process.stdout.write(`DONE ${outPath}\n`);
  } finally {
    if (stagedAudioPath) {
      await fs.rm(stagedAudioPath, { force: true });
    }
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
