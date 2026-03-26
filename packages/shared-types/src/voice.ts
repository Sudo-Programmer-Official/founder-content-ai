export interface TranscribeAudioRequest {
  audioDataUrl: string;
  durationSeconds?: number;
}

export interface TranscribeAudioResponse {
  text: string;
  model: string;
  durationSeconds?: number;
}
