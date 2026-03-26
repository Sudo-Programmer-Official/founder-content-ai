import type {
  ApiError,
  TranscribeAudioRequest,
  TranscribeAudioResponse,
} from "../../../../packages/shared-types/index.ts";
import type { Request, Response } from "express";
import { safeLogEvent } from "../services/analytics/eventLoggingService.ts";
import { transcribeVoiceInput } from "../services/transcriptionService.ts";
import { handleApiError } from "../utils/http.ts";
import { logInfo } from "../utils/logger.ts";

export async function transcribeAudioInput(
  request: Request<unknown, TranscribeAudioResponse | ApiError, Partial<TranscribeAudioRequest>>,
  response: Response<TranscribeAudioResponse | ApiError>,
): Promise<void> {
  const startedAt = Date.now();

  try {
    const transcript = await transcribeVoiceInput({
      audioDataUrl: request.body?.audioDataUrl ?? "",
      durationSeconds: request.body?.durationSeconds,
    });

    await safeLogEvent("voice_transcribed", request.auth?.userId, undefined, {
      model: transcript.model,
      durationSeconds: transcript.durationSeconds,
      transcriptLength: transcript.text.length,
    });

    logInfo("Transcribed voice input.", {
      userId: request.auth?.userId,
      model: transcript.model,
      durationMs: Date.now() - startedAt,
      durationSeconds: transcript.durationSeconds,
      transcriptLength: transcript.text.length,
    });

    response.json(transcript);
  } catch (error) {
    await safeLogEvent("api_failed", request.auth?.userId, undefined, {
      route: "/api/transcribe",
      code: "transcription_failed",
    });

    handleApiError(response, error, {
      statusCode: 500,
      code: "transcription_failed",
      message: "Unable to transcribe audio right now.",
      logMessage: "Failed to transcribe audio input.",
    });
  }
}
