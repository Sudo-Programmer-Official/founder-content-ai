import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { ReelProject, ReelVideoQuality } from "../../../../../packages/shared-types/index.ts";

const INTERACTIONS_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";
const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;
const execFileAsync = promisify(execFile);
const QUALITY_TO_RESOLUTION: Record<ReelVideoQuality, string> = {
  draft: "360p",
  standard: "720p",
  high: "1080p",
};

interface GeminiInteractionPayload {
  id?: string;
  status?: string;
  output_video?: {
    data?: string;
    mime_type?: string;
  };
  steps?: Array<{
    content?: Array<{
      type?: string;
      data?: string;
      mime_type?: string;
    }>;
  }>;
  error?: { message?: string };
}

function resolveGeminiApiKey(): string {
  return process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim() || "";
}

function resolveVideoModel(): string {
  return process.env.GEMINI_VIDEO_MODEL?.trim() || "gemini-omni-1.2-flash";
}

export function isCinematicReelConfigured(): boolean {
  const apiKey = resolveGeminiApiKey();
  return Boolean(apiKey && apiKey !== "your_api_key_here");
}

function splitDuration(totalSeconds: number, shotCount: number): number[] {
  const count = Math.max(1, Math.min(shotCount, Math.floor(totalSeconds / 3), 8));
  const base = Math.floor(totalSeconds / count);
  const remainder = totalSeconds % count;
  return Array.from({ length: count }, (_item, index) => base + (index < remainder ? 1 : 0));
}

function extractVideo(payload: GeminiInteractionPayload): { data: string; mimeType: string } | null {
  if (payload.output_video?.data) {
    return {
      data: payload.output_video.data,
      mimeType: payload.output_video.mime_type || "video/mp4",
    };
  }

  for (const step of [...(payload.steps ?? [])].reverse()) {
    const video = (step.content ?? []).find((item) => item.type === "video" && item.data);
    if (video?.data) {
      return { data: video.data, mimeType: video.mime_type || "video/mp4" };
    }
  }

  return null;
}

async function callGeminiVideo(input: {
  prompt: string;
  durationSeconds: number;
  quality: ReelVideoQuality;
}): Promise<{ bytes: Buffer; model: string }> {
  const apiKey = resolveGeminiApiKey();
  if (!apiKey || apiKey === "your_api_key_here") {
    throw new Error("Gemini cinematic video is not configured. Set GEMINI_API_KEY on the FounderContent API and Reel Worker.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(INTERACTIONS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        model: resolveVideoModel(),
        input: input.prompt,
        response_format: {
          type: "video",
          aspect_ratio: "9:16",
          duration: `${input.durationSeconds}s`,
          resolution: QUALITY_TO_RESOLUTION[input.quality],
        },
      }),
      signal: controller.signal,
    });
    const payload = (await response.json().catch(() => ({}))) as GeminiInteractionPayload;

    if (!response.ok) {
      throw new Error(payload.error?.message || `Gemini returned HTTP ${response.status}.`);
    }

    const video = extractVideo(payload);
    if (!video) {
      throw new Error("Gemini returned no playable video data.");
    }

    return { bytes: Buffer.from(video.data, "base64"), model: resolveVideoModel() };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Gemini cinematic generation timed out. Try a shorter duration or Draft quality.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function buildShotPrompt(project: ReelProject, index: number, totalShots: number): string {
  const scene = project.storyboard.scenes[index];
  const sceneText = scene?.narration || project.prompt;

  return [
    `Create shot ${index + 1} of ${totalShots} for a cinematic vertical explainer video.`,
    `Original creative brief: ${project.prompt}`,
    `This shot's narrative beat: ${sceneText}`,
    "Keep the same subject, palette, lighting, and camera language across the sequence.",
    "Use one primary visual action and natural scene sound that supports the narration.",
    `If spoken audio is available, narrate this beat clearly: "${sceneText}"`,
    "Do not render dense readable text, code, metrics, captions, logos, or UI labels into the footage; text is handled separately by the brand-safe compositor.",
  ].join("\n\n");
}

async function concatenateVideos(videos: Buffer[], workDir: string): Promise<Buffer> {
  const shotPaths: string[] = [];
  for (const [index, bytes] of videos.entries()) {
    const shotPath = path.join(workDir, `cinematic-shot-${String(index + 1).padStart(2, "0")}.mp4`);
    await fs.writeFile(shotPath, bytes);
    shotPaths.push(shotPath);
  }

  const concatPath = path.join(workDir, "cinematic-concat.txt");
  await fs.writeFile(concatPath, shotPaths.map((filePath) => `file '${filePath.replaceAll("'", "'\\''")}'`).join("\n"));
  const outputPath = path.join(workDir, "cinematic-reel.mp4");

  try {
    await execFileAsync("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", concatPath, "-c", "copy", "-movflags", "+faststart", outputPath], { maxBuffer: 2 * 1024 * 1024 });
  } catch {
    await execFileAsync("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", concatPath, "-c:v", "libx264", "-c:a", "aac", "-movflags", "+faststart", outputPath], { maxBuffer: 2 * 1024 * 1024 });
  }

  return fs.readFile(outputPath);
}

export async function produceCinematicReelFiles(input: {
  project: ReelProject;
  workDir: string;
  quality: ReelVideoQuality;
  onProgress: (percent: number) => Promise<void> | void;
}): Promise<{ videoPath: string; posterPath: string; durationInFrames: number; model: string; shotCount: number; resolution: string }> {
  const totalSeconds = input.project.settings.durationSeconds;
  const durations = splitDuration(totalSeconds, input.project.storyboard.scenes.length);
  const videos: Buffer[] = [];
  let model = resolveVideoModel();

  for (const [index, durationSeconds] of durations.entries()) {
    const shot = await callGeminiVideo({
      prompt: buildShotPrompt(input.project, index, durations.length),
      durationSeconds,
      quality: input.quality,
    });
    model = shot.model;
    videos.push(shot.bytes);
    await input.onProgress(Math.round(((index + 1) / durations.length) * 100));
  }

  const videoPath = path.join(input.workDir, "reel.mp4");
  const posterPath = path.join(input.workDir, "poster.jpg");
  const videoBytes = videos.length === 1 ? videos[0] : await concatenateVideos(videos, input.workDir);
  await fs.writeFile(videoPath, videoBytes);
  await execFileAsync("ffmpeg", ["-y", "-ss", "0", "-i", videoPath, "-frames:v", "1", "-q:v", "3", posterPath], { maxBuffer: 2 * 1024 * 1024 });

  return {
    videoPath,
    posterPath,
    durationInFrames: totalSeconds * 30,
    model,
    shotCount: durations.length,
    resolution: QUALITY_TO_RESOLUTION[input.quality],
  };
}
