import type { TranscribeAudioRequest, TranscribeAudioResponse } from "../../../packages/shared-types";
import { apiPost } from "./api-client";

export async function requestAudioTranscription(
  input: TranscribeAudioRequest,
): Promise<TranscribeAudioResponse> {
  return apiPost<TranscribeAudioRequest, TranscribeAudioResponse>("/transcribe", input);
}
