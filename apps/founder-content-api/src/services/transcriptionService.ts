import type { TranscribeAudioRequest, TranscribeAudioResponse } from "../../../../packages/shared-types/index.ts";
import { transcribeAudio } from "../../../../packages/ai-core/src/index.ts";
import { HttpError } from "../utils/http.ts";

const SUPPORTED_AUDIO_MIME_TYPES = new Set([
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/x-m4a",
  "audio/m4a",
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/aac",
  "audio/flac",
]);

const MINIMUM_AUDIO_BYTES = 1024;

function parseAudioDataUrl(audioDataUrl: string): { buffer: Uint8Array; mimeType: string } {
  const trimmedValue = audioDataUrl.trim();
  const match = trimmedValue.match(/^data:([^;,]+)(?:;[^,]*)?;base64,(.+)$/i);

  if (!match) {
    throw new HttpError(400, "bad_request", "audioDataUrl must be a valid base64 audio data URL.");
  }

  const mimeType = match[1]?.trim().toLowerCase() || "";
  const base64Payload = match[2]?.trim() || "";

  if (!mimeType.startsWith("audio/")) {
    throw new HttpError(400, "bad_request", "audioDataUrl must contain an audio mime type.");
  }

  if (!SUPPORTED_AUDIO_MIME_TYPES.has(mimeType)) {
    throw new HttpError(400, "bad_request", `Unsupported audio mime type: ${mimeType}.`);
  }

  const buffer = Buffer.from(base64Payload, "base64");

  if (!buffer.length || buffer.length < MINIMUM_AUDIO_BYTES) {
    throw new HttpError(
      400,
      "audio_too_short",
      "Recording too short. Hold the mic for at least a second and try again.",
    );
  }

  return {
    buffer: new Uint8Array(buffer),
    mimeType,
  };
}

function resolveFileName(mimeType: string): string {
  if (mimeType.includes("ogg")) {
    return "speech.ogg";
  }

  if (mimeType.includes("wav")) {
    return "speech.wav";
  }

  if (mimeType.includes("mp4") || mimeType.includes("m4a") || mimeType.includes("aac")) {
    return "speech.m4a";
  }

  if (mimeType.includes("mpeg") || mimeType.includes("mp3")) {
    return "speech.mp3";
  }

  if (mimeType.includes("flac")) {
    return "speech.flac";
  }

  return "speech.webm";
}

export async function transcribeVoiceInput(
  input: TranscribeAudioRequest,
): Promise<TranscribeAudioResponse> {
  const audioDataUrl = input.audioDataUrl?.trim();

  if (!audioDataUrl) {
    throw new HttpError(400, "bad_request", "audioDataUrl is required.");
  }

  const parsedAudio = parseAudioDataUrl(audioDataUrl);
  const transcript = await transcribeAudio({
    audioBuffer: parsedAudio.buffer,
    mimeType: parsedAudio.mimeType,
    fileName: resolveFileName(parsedAudio.mimeType),
  });

  return {
    text: transcript.text,
    model: transcript.model,
    durationSeconds: input.durationSeconds,
  };
}
