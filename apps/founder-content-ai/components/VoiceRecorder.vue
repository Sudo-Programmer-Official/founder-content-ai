<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import { requestAudioTranscription } from "../services/voice-service";

type RecorderState = "idle" | "recording" | "transcribing" | "done" | "error";

const props = withDefaults(
  defineProps<{
    disabled?: boolean;
    title?: string;
    hint?: string;
  }>(),
  {
    disabled: false,
    title: "Speak instead of typing",
    hint: "Record one quick idea, then review the transcript before you use it.",
  },
);

const emit = defineEmits<{
  (event: "transcribed", value: string): void;
  (event: "state-change", value: RecorderState): void;
}>();

const state = ref<RecorderState>("idle");
const transcript = ref("");
const errorMessage = ref("");
const durationSeconds = ref(0);

let mediaRecorder: MediaRecorder | null = null;
let mediaStream: MediaStream | null = null;
let tickTimer: number | null = null;
let recordedChunks: BlobPart[] = [];

const isRecordingSupported = computed(
  () =>
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function" &&
    typeof MediaRecorder !== "undefined",
);

const isBusy = computed(() => state.value === "recording" || state.value === "transcribing");
const primaryLabel = computed(() => {
  if (props.disabled) {
    return "Voice input disabled";
  }

  if (!isRecordingSupported.value) {
    return "Voice input unavailable";
  }

  if (state.value === "recording") {
    return "Stop recording";
  }

  if (state.value === "transcribing") {
    return "Transcribing";
  }

  return "Start recording";
});

const statusText = computed(() => {
  if (state.value === "recording") {
    return `Listening... ${formatDuration(durationSeconds.value)}`;
  }

  if (state.value === "transcribing") {
    return "Transcribing your idea...";
  }

  if (state.value === "error") {
    return errorMessage.value || "Unable to process that recording.";
  }

  if (transcript.value) {
    return transcript.value;
  }

  return props.hint;
});

function emitState(nextState: RecorderState) {
  state.value = nextState;
  emit("state-change", nextState);
}

function formatDuration(value: number): string {
  const mins = Math.floor(value / 60);
  const secs = value % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function resolveMimeType(): string | undefined {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];

  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
    return undefined;
  }

  return candidates.find((value) => MediaRecorder.isTypeSupported(value));
}

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error("Unable to read the recorded audio."));
    };

    reader.onerror = () => reject(new Error("Unable to read the recorded audio."));
    reader.readAsDataURL(blob);
  });
}

function stopTimers() {
  if (tickTimer !== null) {
    window.clearInterval(tickTimer);
    tickTimer = null;
  }
}

function releaseStream() {
  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }
}

function resetRecorder() {
  stopTimers();
  releaseStream();
  mediaRecorder = null;
  recordedChunks = [];
  durationSeconds.value = 0;
  transcript.value = "";
  errorMessage.value = "";
  emitState("idle");
}

async function finalizeRecording(blob: Blob) {
  emitState("transcribing");
  errorMessage.value = "";

  try {
    const audioDataUrl = await readBlobAsDataUrl(blob);
    const response = await requestAudioTranscription({
      audioDataUrl,
      durationSeconds: durationSeconds.value,
    });
    transcript.value = response.text;
    emit("transcribed", response.text);
    emitState("done");
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "Unable to transcribe the recorded audio.";
    emitState("error");
  } finally {
    releaseStream();
    mediaRecorder = null;
    recordedChunks = [];
    stopTimers();
  }
}

async function startRecording() {
  if (props.disabled || !isRecordingSupported.value || isBusy.value) {
    return;
  }

  errorMessage.value = "";
  transcript.value = "";
  durationSeconds.value = 0;
  recordedChunks = [];

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = resolveMimeType();
    mediaRecorder = mimeType
      ? new MediaRecorder(mediaStream, { mimeType })
      : new MediaRecorder(mediaStream);

    mediaRecorder.addEventListener("dataavailable", (event: BlobEvent) => {
      if (event.data && event.data.size > 0) {
        recordedChunks.push(event.data);
      }
    });

    mediaRecorder.addEventListener("stop", () => {
      const blob = new Blob(recordedChunks, {
        type: mediaRecorder?.mimeType || "audio/webm",
      });

      if (!blob.size) {
        errorMessage.value = "No audio was captured. Try again.";
        emitState("error");
        releaseStream();
        stopTimers();
        mediaRecorder = null;
        recordedChunks = [];
        return;
      }

      void finalizeRecording(blob);
    });

    mediaRecorder.start();
    emitState("recording");
    tickTimer = window.setInterval(() => {
      durationSeconds.value += 1;
    }, 1000);
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "Unable to access the microphone right now.";
    emitState("error");
    releaseStream();
  }
}

async function stopRecording() {
  if (state.value !== "recording" || !mediaRecorder) {
    return;
  }

  stopTimers();
  mediaRecorder.stop();
}

async function handlePrimaryAction() {
  if (state.value === "recording") {
    await stopRecording();
    return;
  }

  if (state.value === "done" || state.value === "error") {
    resetRecorder();
  }

  await startRecording();
}

onBeforeUnmount(() => {
  stopTimers();
  releaseStream();
});
</script>

<template>
  <div class="voice-recorder" :class="[`voice-recorder--${state}`]">
    <div class="voice-recorder__copy">
      <p class="voice-recorder__title">{{ title }}</p>
      <p class="voice-recorder__status">{{ statusText }}</p>
    </div>

    <div class="voice-recorder__actions">
      <button
        type="button"
        class="voice-recorder__button"
        :disabled="props.disabled || (!isRecordingSupported && state !== 'done' && state !== 'error') || state === 'transcribing'"
        @click="handlePrimaryAction"
      >
        <span v-if="state === 'recording'">Stop</span>
        <span v-else-if="state === 'transcribing'">...</span>
        <span v-else-if="state === 'done'">Again</span>
        <span v-else-if="state === 'error'">Retry</span>
        <span v-else>Record</span>
      </button>

      <span class="voice-recorder__label">{{ primaryLabel }}</span>
    </div>
  </div>
</template>

<style scoped>
.voice-recorder {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 18px;
  border: 1px solid var(--fc-border);
  border-radius: calc(var(--fc-radius-panel) - 4px);
  background: color-mix(in srgb, var(--fc-panel-bg) 90%, var(--fc-surface-muted));
}

.voice-recorder--recording {
  border-color: color-mix(in srgb, var(--fc-accent) 58%, transparent);
  box-shadow: 0 16px 30px rgba(185, 75, 36, 0.12);
}

.voice-recorder--error {
  border-color: color-mix(in srgb, var(--fc-error-text) 40%, transparent);
}

.voice-recorder__copy {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.voice-recorder__title {
  margin: 0;
  font-weight: 800;
  color: var(--fc-text);
}

.voice-recorder__status {
  margin: 0;
  color: var(--fc-text-muted);
  line-height: 1.5;
  white-space: pre-wrap;
}

.voice-recorder__actions {
  display: grid;
  justify-items: end;
  gap: 6px;
}

.voice-recorder__button {
  min-width: 88px;
  min-height: 42px;
  padding: 0 16px;
  border: 0;
  border-radius: 999px;
  background: linear-gradient(135deg, var(--fc-accent) 0%, var(--fc-accent-dark) 100%);
  color: var(--fc-accent-contrast);
  font-weight: 800;
  cursor: pointer;
}

.voice-recorder__button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.voice-recorder__label {
  color: var(--fc-text-muted);
  font-size: 0.84rem;
}

@media (max-width: 720px) {
  .voice-recorder {
    grid-template-columns: 1fr;
    align-items: start;
    display: grid;
  }

  .voice-recorder__actions {
    justify-items: start;
  }
}
</style>
