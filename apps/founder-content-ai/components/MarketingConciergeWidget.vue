<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import type { PublicMarketingAssistantTopic } from "../../../packages/shared-types";
import { actionIcons, iconSizes, iconStrokeWidth } from "../src/icons";
import { requestCreatePublicMarketingInquiry } from "../services/public-marketing-service";

type ConciergePrompt = {
  id: string;
  label: string;
  prefill: string;
  response: string;
  topic: PublicMarketingAssistantTopic;
};

const prompts: ConciergePrompt[] = [
  {
    id: "social-pipeline",
    label: "I want to automate our social media pipeline.",
    prefill:
      "We want help automating our social media pipeline across content capture, post generation, scheduling, and publishing.",
    response:
      "That is exactly where Founder Content fits best. We can help structure the workflow from raw founder input to multi-platform publishing without adding more manual work.",
    topic: "social_media_automation",
  },
  {
    id: "founder-brand",
    label: "Can you help us build a founder-led content system?",
    prefill:
      "We want a founder-led content system that turns raw ideas into consistent posts without the usual bottlenecks.",
    response:
      "Yes. We can help turn founder notes, screenshots, and rough thinking into a repeatable brand system that keeps content moving week after week.",
    topic: "founder_brand_system",
  },
  {
    id: "growth-ops",
    label: "Do you also support growth or outreach automation?",
    prefill:
      "We are also exploring growth or outreach automation and want to understand which workflows Founder Content can support.",
    response:
      "Founder Content is strongest around content operations, but we also support adjacent growth workflows when they connect cleanly to the content engine. Tell us what you are trying to fix and we will point you in the right direction.",
    topic: "growth_automation",
  },
  {
    id: "service-fit",
    label: "Which service or setup is the right fit for us?",
    prefill:
      "We want help choosing the right Founder Content setup for our team and current stage.",
    response:
      "Share your stage, team size, and what is slowing publishing down today. We will help you figure out the cleanest next step instead of pushing a generic plan.",
    topic: "service_fit",
  },
];

const isOpen = ref(false);
const isSubmitting = ref(false);
const submissionError = ref("");
const successMessage = ref("");
const selectedPromptId = ref<string | null>(null);
const name = ref("");
const email = ref("");
const companyName = ref("");
const message = ref("");
const honeypot = ref("");

const selectedPrompt = computed(() => prompts.find((prompt) => prompt.id === selectedPromptId.value) ?? null);
const currentTopicLabel = computed(() => {
  switch (selectedPrompt.value?.topic) {
    case "social_media_automation":
      return "Social automation";
    case "founder_brand_system":
      return "Founder system";
    case "growth_automation":
      return "Growth automation";
    case "service_fit":
      return "Best-fit guidance";
    default:
      return "24/7 growth concierge";
  }
});

function applyPrompt(prompt: ConciergePrompt): void {
  selectedPromptId.value = prompt.id;

  if (!message.value.trim()) {
    message.value = prompt.prefill;
  }

  submissionError.value = "";
  successMessage.value = "";
  isOpen.value = true;
}

function toggleWidget(): void {
  isOpen.value = !isOpen.value;
}

function closeWidget(): void {
  isOpen.value = false;
}

function resetForm(): void {
  selectedPromptId.value = null;
  name.value = "";
  email.value = "";
  companyName.value = "";
  message.value = "";
  honeypot.value = "";
}

function validateForm(): string | null {
  if (name.value.trim().length < 2) {
    return "Please enter your name.";
  }

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/i.test(email.value.trim())) {
    return "Please enter a valid email address.";
  }

  if (message.value.trim().length < 12) {
    return "Tell us what you want to automate or improve.";
  }

  return null;
}

async function submitInquiry(): Promise<void> {
  const validationMessage = validateForm();

  if (validationMessage) {
    submissionError.value = validationMessage;
    return;
  }

  isSubmitting.value = true;
  submissionError.value = "";
  successMessage.value = "";

  try {
    await requestCreatePublicMarketingInquiry({
      name: name.value.trim(),
      email: email.value.trim(),
      companyName: companyName.value.trim() || undefined,
      message: message.value.trim(),
      topic: selectedPrompt.value?.topic ?? "other",
      selectedPrompt: selectedPrompt.value?.label,
      pageUrl: typeof window !== "undefined" ? window.location.href : undefined,
      honeypot: honeypot.value,
    });

    successMessage.value = "Thanks. Your note is in the Founder Content inbox and we will follow up by email.";
    resetForm();
  } catch (error) {
    submissionError.value =
      error instanceof Error
        ? error.message
        : "We could not submit your question right now. Please try again.";
  } finally {
    isSubmitting.value = false;
  }
}

onMounted(() => {
  if (window.matchMedia("(min-width: 1180px)").matches) {
    isOpen.value = true;
  }
});
</script>

<template>
  <teleport to="body">
    <div class="marketing-concierge" :class="{ open: isOpen }">
      <section v-if="isOpen" class="marketing-concierge-panel" aria-label="Growth Concierge">
        <div class="marketing-concierge-header">
          <div class="marketing-concierge-header-copy">
            <p class="marketing-concierge-eyebrow">{{ currentTopicLabel }}</p>
            <h2>Let’s find the best next step for your content system.</h2>
            <p>
              Ask about founder content automation, publishing systems, or the other growth
              workflows you want to tighten.
            </p>
          </div>

          <button
            type="button"
            class="marketing-concierge-close"
            aria-label="Close Growth Concierge"
            @click="closeWidget"
          >
            <component :is="actionIcons.close" :size="iconSizes.dense" :stroke-width="iconStrokeWidth" />
          </button>
        </div>

        <div class="marketing-concierge-body">
          <form class="marketing-concierge-form" @submit.prevent="submitInquiry">
            <div class="marketing-concierge-scroll">
              <div class="marketing-concierge-signal-row">
                <span>Founder Content team</span>
                <span>Email-first reply</span>
                <span>No login required</span>
              </div>

              <div class="marketing-concierge-thread">
                <article class="marketing-bubble marketing-bubble-assistant intro">
                  I’m the Founder Content Growth Concierge. Tell me what is slowing down your social
                  pipeline or founder-led content system, and I’ll help route it to the right next step.
                </article>

                <article v-if="selectedPrompt" class="marketing-concierge-context-card">
                  <p class="marketing-concierge-context-label">Selected question</p>
                  <strong>{{ selectedPrompt.label }}</strong>
                  <p>{{ selectedPrompt.response }}</p>
                </article>

                <article v-if="successMessage" class="marketing-bubble marketing-bubble-assistant success">
                  {{ successMessage }}
                </article>
              </div>

              <div class="marketing-concierge-prompt-header">
                <strong>Start with a common question</strong>
                <span>or skip this and type your own note below.</span>
              </div>

              <div class="marketing-concierge-prompts">
                <button
                  v-for="prompt in prompts"
                  :key="prompt.id"
                  type="button"
                  class="marketing-prompt"
                  :class="{ active: selectedPromptId === prompt.id }"
                  @click="applyPrompt(prompt)"
                >
                  {{ prompt.label }}
                </button>
              </div>

            <div class="marketing-concierge-form-grid">
              <label class="marketing-field">
                <span>Name</span>
                <input v-model="name" type="text" placeholder="Your name" autocomplete="name" />
              </label>

              <label class="marketing-field">
                <span>Work email</span>
                <input
                  v-model="email"
                  type="email"
                  placeholder="you@company.com"
                  autocomplete="email"
                />
              </label>
            </div>

            <label class="marketing-field">
              <span>Company or brand</span>
              <input
                v-model="companyName"
                type="text"
                placeholder="Optional, but helpful"
                autocomplete="organization"
              />
            </label>

            <label class="marketing-field">
              <span>What do you want to automate or improve?</span>
              <textarea
                v-model="message"
                rows="4"
                placeholder="Tell us where your current workflow breaks: ideas, writing, approvals, scheduling, publishing, or related growth systems."
              ></textarea>
            </label>

            <input
              v-model="honeypot"
              class="marketing-concierge-honeypot"
              type="text"
              tabindex="-1"
              autocomplete="off"
              aria-hidden="true"
            />

            <p class="marketing-concierge-note">
              Straight to the Founder Content team. If it is a fit, we will reply by email with the cleanest next step.
            </p>

            <p v-if="submissionError" class="marketing-concierge-error">{{ submissionError }}</p>
            </div>

            <div class="marketing-concierge-actions">
              <span>Usually answered by email after review, not routed into a generic sales queue.</span>
              <button type="submit" class="marketing-concierge-submit" :disabled="isSubmitting">
                {{ isSubmitting ? "Sending..." : "Send question" }}
              </button>
            </div>
          </form>
        </div>
      </section>

      <button type="button" class="marketing-concierge-toggle" @click="toggleWidget">
        <span class="marketing-concierge-toggle-mark">AI</span>
        <span>{{ isOpen ? "Close" : "Growth Concierge" }}</span>
      </button>
    </div>
  </teleport>
</template>

<style scoped>
.marketing-concierge {
  --marketing-concierge-accent: #d76634;
  --marketing-concierge-accent-strong: #b94b24;
  --marketing-concierge-accent-soft: rgba(215, 102, 52, 0.1);
  --marketing-concierge-ink: #1f1814;
  --marketing-concierge-muted: #5b4f47;
  --marketing-concierge-muted-soft: #78685d;
  --marketing-concierge-teal: #24474d;
  --marketing-concierge-surface: rgba(255, 251, 247, 0.98);
  --marketing-concierge-surface-strong: rgba(255, 245, 236, 0.96);
  position: fixed;
  right: 22px;
  bottom: calc(22px + env(safe-area-inset-bottom));
  z-index: 120;
  display: grid;
  justify-items: end;
  gap: 14px;
  pointer-events: none;
}

.marketing-concierge-panel,
.marketing-concierge-toggle {
  pointer-events: auto;
}

.marketing-concierge-panel {
  width: min(420px, calc(100vw - 28px));
  max-height: min(74vh, 740px);
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  overflow: hidden;
  border: 1px solid rgba(123, 90, 64, 0.14);
  border-radius: 28px;
  background:
    radial-gradient(circle at 14% 10%, rgba(215, 102, 52, 0.14) 0%, rgba(215, 102, 52, 0) 34%),
    linear-gradient(180deg, rgba(255, 252, 248, 0.98) 0%, rgba(255, 248, 241, 0.96) 100%);
  box-shadow: 0 30px 90px rgba(59, 39, 20, 0.18);
  backdrop-filter: blur(18px);
}

.marketing-concierge-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
  padding: 20px 20px 16px;
  border-bottom: 1px solid rgba(123, 90, 64, 0.08);
}

.marketing-concierge-header-copy h2 {
  margin: 8px 0 10px;
  color: var(--marketing-concierge-ink);
  font-size: clamp(1.7rem, 3vw, 2.15rem);
  line-height: 1.06;
}

.marketing-concierge-header-copy p:last-child {
  margin: 0;
  color: var(--marketing-concierge-muted);
  font-size: 0.98rem;
  line-height: 1.62;
}

.marketing-concierge-eyebrow {
  margin: 0;
  color: var(--marketing-concierge-teal);
  font-size: 0.82rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.marketing-concierge-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  border: 0;
  border-radius: 14px;
  background: rgba(36, 71, 77, 0.08);
  color: var(--marketing-concierge-teal);
  cursor: pointer;
}

.marketing-concierge-close :deep(svg) {
  display: block;
}

.marketing-concierge-body {
  min-height: 0;
  overflow: hidden;
}

.marketing-concierge-scroll {
  display: grid;
  gap: 14px;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 20px 18px;
}

.marketing-concierge-signal-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.marketing-concierge-signal-row span {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  background: rgba(36, 71, 77, 0.08);
  color: var(--marketing-concierge-teal);
  font-size: 0.8rem;
  font-weight: 700;
}

.marketing-concierge-thread {
  display: grid;
  gap: 10px;
}

.marketing-bubble {
  width: fit-content;
  max-width: min(100%, 336px);
  padding: 14px 16px;
  border-radius: 20px;
  font-size: 0.98rem;
  line-height: 1.62;
}

.marketing-bubble-assistant {
  background: linear-gradient(180deg, rgba(255, 244, 235, 0.98) 0%, rgba(255, 239, 227, 0.96) 100%);
  color: var(--marketing-concierge-ink);
}

.marketing-bubble-assistant.intro {
  border-top-left-radius: 12px;
}

.marketing-bubble-assistant.success {
  background: linear-gradient(180deg, rgba(241, 250, 246, 0.98) 0%, rgba(233, 246, 240, 0.96) 100%);
  color: var(--marketing-concierge-teal);
}

.marketing-concierge-context-card {
  display: grid;
  gap: 8px;
  padding: 14px 16px;
  border: 1px solid rgba(215, 102, 52, 0.16);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.88);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.8);
}

.marketing-concierge-context-card strong {
  color: var(--marketing-concierge-ink);
  font-size: 0.98rem;
  line-height: 1.45;
}

.marketing-concierge-context-card p:last-child {
  margin: 0;
  color: var(--marketing-concierge-muted);
  font-size: 0.93rem;
  line-height: 1.58;
}

.marketing-concierge-context-label {
  margin: 0;
  color: var(--marketing-concierge-accent-strong);
  font-size: 0.76rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.marketing-concierge-prompt-header {
  display: grid;
  gap: 4px;
}

.marketing-concierge-prompt-header strong {
  color: var(--marketing-concierge-ink);
  font-size: 0.96rem;
}

.marketing-concierge-prompt-header span {
  color: var(--marketing-concierge-muted);
  font-size: 0.88rem;
}

.marketing-concierge-prompts {
  display: grid;
  gap: 10px;
}

.marketing-prompt {
  width: 100%;
  padding: 14px 16px;
  border: 1px solid rgba(123, 90, 64, 0.12);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.84);
  color: var(--marketing-concierge-ink);
  font-size: 0.98rem;
  line-height: 1.45;
  text-align: left;
  cursor: pointer;
  transition:
    transform 180ms ease,
    border-color 180ms ease,
    box-shadow 180ms ease;
}

.marketing-prompt:hover,
.marketing-prompt.active {
  border-color: rgba(215, 102, 52, 0.34);
  background: rgba(255, 247, 241, 0.96);
  box-shadow: 0 16px 34px rgba(73, 50, 26, 0.08);
  transform: translateY(-1px);
}

.marketing-concierge-form {
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  gap: 14px;
  height: 100%;
  min-height: 0;
}

.marketing-concierge-form-grid {
  padding-top: 18px;
  border-top: 1px solid rgba(123, 90, 64, 0.08);
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.marketing-field {
  display: grid;
  gap: 8px;
}

.marketing-field span {
  color: var(--marketing-concierge-teal);
  font-size: 0.88rem;
  font-weight: 700;
}

.marketing-field input,
.marketing-field textarea {
  width: 100%;
  padding: 14px 16px;
  border: 1px solid rgba(123, 90, 64, 0.14);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.9);
  color: var(--marketing-concierge-ink);
  font: inherit;
  box-sizing: border-box;
  outline: none;
  transition:
    border-color 180ms ease,
    box-shadow 180ms ease;
}

.marketing-field input:focus,
.marketing-field textarea:focus {
  border-color: rgba(215, 102, 52, 0.42);
  box-shadow: 0 0 0 4px rgba(215, 102, 52, 0.08);
}

.marketing-field textarea {
  min-height: 126px;
  resize: vertical;
}

.marketing-concierge-note {
  margin: 0;
  color: var(--marketing-concierge-muted);
  font-size: 0.94rem;
  line-height: 1.6;
}

.marketing-concierge-error {
  margin: 0;
  color: #a64222;
  font-size: 0.94rem;
  font-weight: 600;
}

.marketing-concierge-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 14px 20px calc(16px + env(safe-area-inset-bottom));
  border-top: 1px solid rgba(123, 90, 64, 0.1);
  background:
    linear-gradient(180deg, rgba(255, 251, 247, 0.92) 0%, rgba(255, 248, 241, 0.98) 100%);
  box-shadow: 0 -18px 34px rgba(59, 39, 20, 0.08);
}

.marketing-concierge-actions span {
  color: var(--marketing-concierge-muted-soft);
  font-size: 0.86rem;
  line-height: 1.5;
}

.marketing-concierge-submit {
  min-width: 146px;
  min-height: 52px;
  padding: 0 20px;
  border: 0;
  border-radius: 18px;
  background: linear-gradient(135deg, var(--marketing-concierge-accent) 0%, var(--marketing-concierge-accent-strong) 100%);
  color: #fff8f3;
  font: inherit;
  font-weight: 800;
  cursor: pointer;
  box-shadow: 0 18px 36px rgba(185, 75, 36, 0.24);
}

.marketing-concierge-submit:disabled {
  opacity: 0.72;
  cursor: wait;
}

.marketing-concierge-honeypot {
  position: absolute;
  left: -9999px;
  opacity: 0;
  pointer-events: none;
}

.marketing-concierge-toggle {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-height: 58px;
  padding: 0 20px 0 14px;
  border: 0;
  border-radius: 999px;
  background: linear-gradient(135deg, rgba(215, 102, 52, 0.96) 0%, rgba(185, 75, 36, 0.98) 100%);
  color: #fff8f3;
  font: inherit;
  font-weight: 800;
  letter-spacing: 0.01em;
  cursor: pointer;
  box-shadow: 0 20px 44px rgba(185, 75, 36, 0.26);
}

.marketing-concierge-toggle-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.18);
  font-size: 0.88rem;
  font-weight: 900;
  letter-spacing: 0.08em;
}

@media (max-width: 720px) {
  .marketing-concierge {
    right: 12px;
    left: 12px;
    bottom: calc(12px + env(safe-area-inset-bottom));
  }

  .marketing-concierge-panel {
    width: 100%;
    max-height: min(76vh, 720px);
    border-radius: 24px;
  }

  .marketing-concierge-header,
  .marketing-concierge-scroll,
  .marketing-concierge-actions {
    padding-left: 18px;
    padding-right: 18px;
  }

  .marketing-concierge-form-grid {
    grid-template-columns: 1fr;
  }

  .marketing-concierge-actions {
    flex-direction: column;
    align-items: stretch;
  }

  .marketing-concierge-submit {
    width: 100%;
  }

  .marketing-concierge-toggle {
    align-self: end;
  }
}
</style>
