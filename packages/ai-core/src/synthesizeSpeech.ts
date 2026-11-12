interface OpenAISpeechErrorResponse {
  error?: {
    message?: string;
  };
}

export interface SynthesizeSpeechOptions {
  text: string;
  voice: string;
  /** Delivery guidance (accent, pace, tone). Only honoured by instruction-capable TTS models. */
  instructions?: string;
}

export interface SynthesizeSpeechResult {
  /** Raw 24 kHz, 16-bit, mono little-endian PCM. */
  pcm: Buffer;
  sampleRate: number;
  durationMs: number;
  model: string;
}

const OPENAI_AUDIO_SPEECH_URL = "https://api.openai.com/v1/audio/speech";
export const SPEECH_PCM_SAMPLE_RATE = 24000;
const PCM_BYTES_PER_SAMPLE = 2;
const DEFAULT_SPEECH_REQUEST_TIMEOUT_MS = 60_000;

function resolveSpeechRequestTimeoutMs(): number {
  const configured = Number(process.env.OPENAI_TTS_REQUEST_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0
    ? Math.min(Math.floor(configured), 300_000)
    : DEFAULT_SPEECH_REQUEST_TIMEOUT_MS;
}

function resolveSpeechModels(): string[] {
  const configured = [process.env.OPENAI_TTS_MODEL ?? "", "gpt-4o-mini-tts", "tts-1"]
    .map((value) => value.trim())
    .filter(Boolean);

  return [...new Set(configured)];
}

/**
 * Requests PCM rather than MP3 so callers can measure exact durations and
 * concatenate clips without decoding.
 */
export async function synthesizeSpeech(options: SynthesizeSpeechOptions): Promise<SynthesizeSpeechResult> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set.");
  }

  let lastError: Error | null = null;

  for (const model of resolveSpeechModels()) {
    const supportsInstructions = !model.startsWith("tts-1");
    let response: Response;

    try {
      response = await fetch(OPENAI_AUDIO_SPEECH_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          voice: options.voice,
          input: options.text,
          response_format: "pcm",
          ...(supportsInstructions && options.instructions ? { instructions: options.instructions } : {}),
        }),
        signal: AbortSignal.timeout(resolveSpeechRequestTimeoutMs()),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "request failed";
      lastError = new Error(`Speech synthesis request failed for model ${model}: ${message}`);
      continue;
    }

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as OpenAISpeechErrorResponse;
      lastError = new Error(
        `Speech synthesis failed with status ${response.status} for model ${model}: ${payload.error?.message ?? "unknown error"}`,
      );
      continue;
    }

    const pcm = Buffer.from(await response.arrayBuffer());

    if (pcm.byteLength === 0) {
      lastError = new Error(`Speech synthesis returned empty audio for model ${model}.`);
      continue;
    }

    return {
      pcm,
      sampleRate: SPEECH_PCM_SAMPLE_RATE,
      durationMs: Math.round((pcm.byteLength / (SPEECH_PCM_SAMPLE_RATE * PCM_BYTES_PER_SAMPLE)) * 1000),
      model,
    };
  }

  throw lastError ?? new Error("No speech model returned audio.");
}

/** Wraps mono 16-bit PCM in a WAV container. */
export function encodePcmAsWav(pcm: Buffer, sampleRate = SPEECH_PCM_SAMPLE_RATE): Buffer {
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * PCM_BYTES_PER_SAMPLE;

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.byteLength, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(PCM_BYTES_PER_SAMPLE, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.byteLength, 40);

  return Buffer.concat([header, pcm]);
}

export function createPcmSilence(durationMs: number, sampleRate = SPEECH_PCM_SAMPLE_RATE): Buffer {
  const samples = Math.max(0, Math.round((durationMs / 1000) * sampleRate));
  return Buffer.alloc(samples * PCM_BYTES_PER_SAMPLE);
}
