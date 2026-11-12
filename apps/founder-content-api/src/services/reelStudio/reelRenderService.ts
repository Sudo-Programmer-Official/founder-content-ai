import { spawn } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SPEECH_PCM_SAMPLE_RATE,
  createPcmSilence,
  encodePcmAsWav,
  synthesizeSpeech,
} from "../../../../../packages/ai-core/src/synthesizeSpeech.ts";
import type {
  ReelCaptionCue,
  ReelLanguage,
  ReelProject,
  ReelRenderProgress,
  ReelRenderProps,
  ReelTimedScene,
} from "../../../../../packages/shared-types/index.ts";
import { claimQueuedJobs, markJobCompleted, markJobFailed, markJobTerminalFailed } from "../jobQueueService.ts";
import { logError, logInfo } from "../../utils/logger.ts";
import { buildReelStorageKey, storeReelMedia } from "./reelMediaStorage.ts";
import { REEL_RENDER_JOB_TYPE, loadReelProjectForRender, updateReelRenderState } from "./reelProjectService.ts";

const API_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const FPS = 30;
const WIDTH = 1080;
const HEIGHT = 1920;
/** Breath before each scene's narration, so speech starts after the transition lands. */
const LEAD_IN_MS = 200;
/** Pause after narration before the next scene cuts in. */
const TAIL_MS = 350;
const OUTRO_EXTRA_MS = 900;
const MIN_SCENE_MS = 2000;
const BYTES_PER_SAMPLE = 2;
const RENDER_TIMEOUT_MS = 20 * 60 * 1000;

const VOICE_INSTRUCTIONS: Record<ReelLanguage, string> = {
  english: "Energetic, clear explainer voice for a short social video. Confident, friendly, brisk pace.",
  spanish: "Speak in natural Latin American Spanish. Energetic, clear explainer voice for a short social video.",
  hindi: "Speak in natural Hindi with an Indian accent, like a friendly tech teacher. Pronounce English technical terms naturally. Energetic, brisk pace.",
  hinglish: "Speak in natural Hinglish (Hindi-English mix) with an Indian accent, like a friendly tech creator on Instagram. Energetic, conversational, brisk pace.",
};

export interface ReelRenderJobPayload {
  projectId?: string;
}

function resolveRendererDir(): string {
  return process.env.REEL_RENDERER_DIR?.trim() || path.resolve(API_ROOT, "../reel-renderer");
}

function msToFrames(ms: number): number {
  return Math.round((ms / 1000) * FPS);
}

/** Splits narration into short caption cues, timed by character share across the spoken audio. */
function buildCaptionCues(narration: string, speechStartMs: number, speechMs: number): ReelCaptionCue[] {
  const words = narration.split(/\s+/).filter(Boolean);

  if (words.length === 0 || speechMs <= 0) {
    return [];
  }

  const chunks: string[] = [];
  let current: string[] = [];

  for (const word of words) {
    current.push(word);
    const sentenceEnd = /[.!?।]$/.test(word);
    if (current.length >= 4 || (sentenceEnd && current.length >= 2)) {
      chunks.push(current.join(" "));
      current = [];
    }
  }

  if (current.length > 0) {
    chunks.push(current.join(" "));
  }

  const totalChars = chunks.reduce((sum, chunk) => sum + chunk.length, 0) || 1;
  let cursorMs = speechStartMs;

  return chunks.map((text) => {
    const chunkMs = (text.length / totalChars) * speechMs;
    const cue = { text, startFrame: msToFrames(cursorMs), endFrame: msToFrames(cursorMs + chunkMs) };
    cursorMs += chunkMs;
    return cue;
  });
}

interface NarrationTrack {
  wav: Buffer;
  timeline: ReelTimedScene[];
  durationInFrames: number;
  ttsModel: string;
}

async function synthesizeNarration(
  project: ReelProject,
  onProgress: (percent: number) => Promise<void>,
): Promise<NarrationTrack> {
  const scenes = project.storyboard.scenes;
  const clips: Array<{ pcm: Buffer; durationMs: number }> = [];
  let ttsModel = "";

  for (const [index, scene] of scenes.entries()) {
    logInfo("Synthesizing reel scene narration.", {
      projectId: project.id,
      sceneIndex: index + 1,
      sceneCount: scenes.length,
    });
    const speech = await synthesizeSpeech({
      text: scene.narration,
      voice: project.settings.voice,
      instructions: VOICE_INSTRUCTIONS[project.settings.language],
    });
    clips.push({ pcm: speech.pcm, durationMs: speech.durationMs });
    ttsModel = speech.model;
    logInfo("Synthesized reel scene narration.", {
      projectId: project.id,
      sceneIndex: index + 1,
      sceneCount: scenes.length,
      model: speech.model,
      durationMs: speech.durationMs,
    });
    await onProgress(Math.round(((index + 1) / scenes.length) * 100));
  }

  // Narration drives timing: every scene lasts exactly as long as its voice-over (plus breathing room).
  const timeline: ReelTimedScene[] = [];
  const segments: Buffer[] = [];
  let cursorFrames = 0;

  scenes.forEach((scene, index) => {
    const clip = clips[index];
    const isLast = index === scenes.length - 1;
    const sceneMs = Math.max(MIN_SCENE_MS, LEAD_IN_MS + clip.durationMs + TAIL_MS + (isLast ? OUTRO_EXTRA_MS : 0));
    const durationInFrames = msToFrames(sceneMs);
    const exactSceneMs = (durationInFrames / FPS) * 1000;

    timeline.push({
      sceneId: scene.id,
      startFrame: cursorFrames,
      durationInFrames,
      captions: buildCaptionCues(scene.narration, LEAD_IN_MS, clip.durationMs),
    });

    // Pad each clip to its frame-rounded scene length so audio and video never drift apart.
    const sceneSamples = Math.round((exactSceneMs / 1000) * SPEECH_PCM_SAMPLE_RATE);
    const segment = Buffer.alloc(sceneSamples * BYTES_PER_SAMPLE);
    const leadIn = createPcmSilence(LEAD_IN_MS);
    clip.pcm.copy(segment, leadIn.byteLength, 0, Math.min(clip.pcm.byteLength, segment.byteLength - leadIn.byteLength));
    segments.push(segment);
    cursorFrames += durationInFrames;
  });

  return {
    wav: encodePcmAsWav(Buffer.concat(segments)),
    timeline,
    durationInFrames: cursorFrames,
    ttsModel,
  };
}

function runRenderer(input: {
  propsPath: string;
  audioPath: string;
  outPath: string;
  posterPath: string;
  onProgress: (fraction: number) => void;
}): Promise<void> {
  const rendererDir = resolveRendererDir();
  const tsxBin = path.join(rendererDir, "node_modules", ".bin", "tsx");

  if (!existsSync(tsxBin)) {
    return Promise.reject(
      new Error(`Reel renderer is not installed. Run "npm install" in ${rendererDir} (or set REEL_RENDERER_DIR).`),
    );
  }

  return new Promise((resolve, reject) => {
    const child = spawn(
      tsxBin,
      ["scripts/render.ts", "--props", input.propsPath, "--audio", input.audioPath, "--out", input.outPath, "--poster", input.posterPath],
      { cwd: rendererDir, env: process.env, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stderr = "";
    let stdoutBuffer = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Reel render timed out."));
    }, RENDER_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() ?? "";

      for (const line of lines) {
        const match = line.match(/^PROGRESS ([\d.]+)/);
        if (match) {
          input.onProgress(Number(match[1]));
        }
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-4000);
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Reel renderer exited with code ${code}: ${stderr.trim().split("\n").slice(-6).join(" | ")}`));
      }
    });
  });
}

export interface ProducedReelFiles {
  videoPath: string;
  posterPath: string;
  durationInFrames: number;
  ttsModel: string;
}

/**
 * Voice → timeline → MP4 + poster, written into `workDir`. Has no database or storage side effects,
 * so it can be exercised directly (see scripts/reelSmoke.ts).
 */
export async function produceReelFiles(
  project: ReelProject,
  workDir: string,
  onProgress: (progress: ReelRenderProgress) => Promise<void> | void,
): Promise<ProducedReelFiles> {
  const narration = await synthesizeNarration(project, async (percent) => onProgress({ stage: "voice", percent }));

  await onProgress({ stage: "compose", percent: 0 });
  const renderProps: ReelRenderProps = {
    storyboard: project.storyboard,
    style: project.settings.style,
    language: project.settings.language,
    fps: FPS,
    width: WIDTH,
    height: HEIGHT,
    durationInFrames: narration.durationInFrames,
    timeline: narration.timeline,
    brandHandle: project.settings.brandHandle,
    showCaptions: project.settings.showCaptions,
  };
  const propsPath = path.join(workDir, "props.json");
  const audioPath = path.join(workDir, "voice.wav");
  const videoPath = path.join(workDir, "reel.mp4");
  const posterPath = path.join(workDir, "poster.jpg");
  await fs.writeFile(propsPath, JSON.stringify(renderProps));
  await fs.writeFile(audioPath, narration.wav);

  await runRenderer({
    propsPath,
    audioPath,
    outPath: videoPath,
    posterPath,
    onProgress: (fraction) => {
      void onProgress({ stage: "render", percent: Math.min(99, Math.floor(fraction * 100)) });
    },
  });

  return { videoPath, posterPath, durationInFrames: narration.durationInFrames, ttsModel: narration.ttsModel };
}

async function renderReelProject(project: ReelProject): Promise<void> {
  const startedAt = Date.now();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "reel-render-"));
  let currentStage: ReelRenderProgress["stage"] | null = null;
  let lastWrittenPercent = -1;
  let pendingWrite: Promise<void> = Promise.resolve();

  const reportProgress = (progress: ReelRenderProgress): Promise<void> => {
    if (progress.stage !== currentStage) {
      currentStage = progress.stage;
      lastWrittenPercent = -1;
    }

    // Renderer progress arrives many times a second; only persist steps of 5%.
    if (progress.percent < 100 && progress.percent - lastWrittenPercent < 5) {
      return pendingWrite;
    }

    lastWrittenPercent = progress.percent;
    pendingWrite = pendingWrite.then(() => updateReelRenderState(project.id, { progress })).catch(() => undefined);
    return pendingWrite;
  };

  try {
    await updateReelRenderState(project.id, { status: "rendering", progress: { stage: "voice", percent: 0 }, errorMessage: null });
    const produced = await produceReelFiles(project, tempDir, reportProgress);
    await reportProgress({ stage: "upload", percent: 0 });

    const renderId = Date.now().toString(36);
    const videoStorageKey = buildReelStorageKey(project.businessId, project.id, `reel-${renderId}.mp4`);
    const posterStorageKey = buildReelStorageKey(project.businessId, project.id, `poster-${renderId}.jpg`);
    await storeReelMedia({ storageKey: videoStorageKey, bytes: await fs.readFile(produced.videoPath), mimeType: "video/mp4" });
    await storeReelMedia({ storageKey: posterStorageKey, bytes: await fs.readFile(produced.posterPath), mimeType: "image/jpeg" });
    await pendingWrite;

    const durationMs = Math.round((produced.durationInFrames / FPS) * 1000);
    await updateReelRenderState(project.id, {
      status: "ready",
      progress: null,
      errorMessage: null,
      videoStorageKey,
      posterStorageKey,
      durationMs,
      markRendered: true,
      renderMeta: {
        fps: FPS,
        width: WIDTH,
        height: HEIGHT,
        sceneCount: project.storyboard.scenes.length,
        ttsModel: produced.ttsModel,
        renderMs: Date.now() - startedAt,
      },
    });
    logInfo("Rendered reel.", { projectId: project.id, durationMs, renderMs: Date.now() - startedAt });
  } finally {
    await pendingWrite;
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

export async function processQueuedReelRenderJobs(): Promise<{ jobsClaimed: number; jobsCompleted: number; jobsFailed: number }> {
  // One at a time: a render saturates the CPU on its own.
  const jobs = await claimQueuedJobs<ReelRenderJobPayload>({
    types: [REEL_RENDER_JOB_TYPE],
    batchSize: 1,
    lockedBy: `reel-render:${process.pid}`,
    // A crashed/stalled render should become retryable before the default
    // queue lease expires. Normal renders finish well within this window.
    staleAfterMinutes: 10,
  });
  let jobsCompleted = 0;
  let jobsFailed = 0;

  for (const job of jobs) {
    const projectId = typeof job.payload.projectId === "string" ? job.payload.projectId : "";
    const loaded = projectId ? await loadReelProjectForRender(projectId) : null;

    if (!loaded) {
      await markJobTerminalFailed(job.id, "Reel project no longer exists.");
      jobsFailed += 1;
      continue;
    }

    try {
      await renderReelProject(loaded.project);
      await markJobCompleted(job.id);
      jobsCompleted += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Reel render failed.";
      const willRetry = job.attempts < job.maxAttempts;
      logError("Reel render failed.", { projectId, attempt: job.attempts, willRetry, message });
      await markJobFailed(job.id, message);
      await updateReelRenderState(projectId, {
        status: willRetry ? "queued" : "failed",
        progress: willRetry ? { stage: "voice", percent: 0 } : null,
        errorMessage: willRetry ? `Retrying after error: ${message.slice(0, 300)}` : message.slice(0, 1000),
      });
      jobsFailed += 1;
    }
  }

  return { jobsClaimed: jobs.length, jobsCompleted, jobsFailed };
}
