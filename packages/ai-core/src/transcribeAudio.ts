interface OpenAITranscriptionResponse {
  text?: string;
  error?: {
    message?: string;
    code?: string;
    type?: string;
  };
}

export interface TranscribeAudioOptions {
  audioBuffer: Uint8Array | ArrayBuffer;
  mimeType?: string;
  fileName?: string;
}

export interface TranscribeAudioResult {
  text: string;
  model: string;
}

const OPENAI_AUDIO_TRANSCRIPTIONS_URL = "https://api.openai.com/v1/audio/transcriptions";

function resolveModelList(): string[] {
  const configured = [
    process.env.OPENAI_TRANSCRIBE_MODEL ?? "",
    ...(process.env.OPENAI_TRANSCRIBE_FALLBACKS ?? "")
      .split(",")
      .map((value) => value.trim()),
    "gpt-4o-mini-transcribe",
    "gpt-4o-transcribe",
    "whisper-1",
  ]
    .map((value) => value.trim())
    .filter(Boolean);

  return [...new Set(configured)];
}

function toUint8Array(value: Uint8Array | ArrayBuffer): Uint8Array {
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

function sanitizeTranscriptText(value: string | undefined): string {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) {
    return "";
  }

  const meaningful = text.replace(/[^\p{L}\p{N}]+/gu, "");
  return meaningful ? text : "";
}

function buildApiErrorMessage(
  statusCode: number,
  payload: OpenAITranscriptionResponse,
  model: string,
): string {
  const message = payload.error?.message ?? "OpenAI transcription request failed.";
  return `Transcription failed with status ${statusCode} for model ${model}: ${message}`;
}

export async function transcribeAudio(
  options: TranscribeAudioOptions,
): Promise<TranscribeAudioResult> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set.");
  }

  const audioBuffer = toUint8Array(options.audioBuffer);
  const mimeType = options.mimeType?.trim() || "audio/webm";
  const fileName = options.fileName?.trim() || "speech.webm";
  const models = resolveModelList();
  let lastError: Error | null = null;

  for (const model of models) {
    const formData = new FormData();
    formData.append("file", new Blob([audioBuffer], { type: mimeType }), fileName);
    formData.append("model", model);

    const response = await fetch(OPENAI_AUDIO_TRANSCRIPTIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
    });

    const responseData = (await response.json()) as OpenAITranscriptionResponse;

    if (!response.ok) {
      lastError = new Error(buildApiErrorMessage(response.status, responseData, model));
      continue;
    }

    const text = sanitizeTranscriptText(responseData.text);

    if (!text) {
      lastError = new Error(`Transcription returned empty text for model ${model}.`);
      continue;
    }

    return {
      text,
      model,
    };
  }

  throw lastError ?? new Error("No transcription model returned usable text.");
}
