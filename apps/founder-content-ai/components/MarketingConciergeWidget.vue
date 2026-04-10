<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import type { PublicMarketingAssistantTopic } from "../../../packages/shared-types";
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
      return "24/7 lead concierge";
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
            <h2>Let’s figure out the best next step for your content engine.</h2>
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
            ×
          </button>
        </div>

        <div class="marketing-concierge-body">
          <div class="marketing-concierge-thread">
            <article class="marketing-bubble marketing-bubble-assistant">
              I’m the Founder Content Growth Concierge. Tell me what is slowing down your social
              pipeline or founder-led content system, and I’ll help route it to the right next step.
            </article>

            <article v-if="selectedPrompt" class="marketing-bubble marketing-bubble-user">
              {{ selectedPrompt.label }}
            </article>

            <article v-if="selectedPrompt" class="marketing-bubble marketing-bubble-assistant secondary">
              {{ selectedPrompt.response }}
            </article>

            <article v-if="successMessage" class="marketing-bubble marketing-bubble-assistant success">
              {{ successMessage }}
            </article>
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

          <form class="marketing-concierge-form" @submit.prevent="submitInquiry">
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
              Straight to the Founder Content team. If it is a fit, we will reply by email.
            </p>

            <p v-if="submissionError" class="marketing-concierge-error">{{ submissionError }}</p>

            <div class="marketing-concierge-actions">
              <span>Usually answered by email after review.</span>
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
  max-height: min(78vh, 760px);
  display: grid;
  overflow: hidden;
  border: 1px solid rgba(123, 90, 64, 0.14);
  border-radius: 28px;
  background:
    radial-gradient(circle at 12% 10%, rgba(223, 126, 69, 0.14) 0%, rgba(223, 126, 69, 0) 34%),
    linear-gradient(180deg, rgba(255, 252, 248, 0.98) 0%, rgba(248, 251, 247, 0.96) 100%);
  box-shadow: 0 30px 90px rgba(59, 39, 20, 0.18);
  backdrop-filter: blur(18px);
}

.marketing-concierge-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
  padding: 22px 22px 18px;
  border-bottom: 1px solid rgba(123, 90, 64, 0.08);
}

.marketing-concierge-header-copy h2 {
  margin: 8px 0 10px;
  color: #1d382f;
  font-size: clamp(1.7rem, 3vw, 2.15rem);
  line-height: 1.06;
}

.marketing-concierge-header-copy p:last-child {
  margin: 0;
  color: #5d6f67;
  font-size: 1rem;
  line-height: 1.65;
}

.marketing-concierge-eyebrow {
  margin: 0;
  color: #567064;
  font-size: 0.82rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.marketing-concierge-close {
  width: 42px;
  height: 42px;
  border: 0;
  border-radius: 14px;
  background: rgba(31, 56, 47, 0.08);
  color: #1d382f;
  font-size: 1.7rem;
  line-height: 1;
  cursor: pointer;
}

.marketing-concierge-body {
  overflow-y: auto;
  padding: 18px 22px 20px;
}

.marketing-concierge-thread {
  display: grid;
  gap: 12px;
}

.marketing-bubble {
  width: fit-content;
  max-width: min(100%, 320px);
  padding: 14px 16px;
  border-radius: 20px;
  font-size: 1rem;
  line-height: 1.6;
}

.marketing-bubble-assistant {
  background: linear-gradient(180deg, rgba(228, 238, 232, 0.92) 0%, rgba(221, 233, 226, 0.96) 100%);
  color: #1f382f;
}

.marketing-bubble-assistant.secondary {
  background: rgba(255, 252, 248, 0.94);
  border: 1px solid rgba(123, 90, 64, 0.1);
}

.marketing-bubble-assistant.success {
  background: linear-gradient(180deg, rgba(236, 246, 236, 0.98) 0%, rgba(230, 242, 230, 0.96) 100%);
}

.marketing-bubble-user {
  justify-self: end;
  background: linear-gradient(135deg, rgba(215, 102, 52, 0.94) 0%, rgba(198, 83, 34, 0.96) 100%);
  color: #fff8f3;
}

.marketing-concierge-prompts {
  display: grid;
  gap: 12px;
  margin-top: 16px;
}

.marketing-prompt {
  width: 100%;
  padding: 16px 18px;
  border: 1px solid rgba(123, 90, 64, 0.12);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.84);
  color: #233d34;
  font-size: 1rem;
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
  box-shadow: 0 16px 34px rgba(73, 50, 26, 0.08);
  transform: translateY(-1px);
}

.marketing-concierge-form {
  display: grid;
  gap: 14px;
  margin-top: 18px;
  padding-top: 18px;
  border-top: 1px solid rgba(123, 90, 64, 0.08);
}

.marketing-concierge-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.marketing-field {
  display: grid;
  gap: 8px;
}

.marketing-field span {
  color: #567064;
  font-size: 0.88rem;
  font-weight: 700;
}

.marketing-field input,
.marketing-field textarea {
  width: 100%;
  padding: 14px 16px;
  border: 1px solid rgba(123, 90, 64, 0.14);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.82);
  color: #223a31;
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
  color: #5d6f67;
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
}

.marketing-concierge-actions span {
  color: #5d6f67;
  font-size: 0.86rem;
  line-height: 1.5;
}

.marketing-concierge-submit {
  min-width: 146px;
  min-height: 52px;
  padding: 0 20px;
  border: 0;
  border-radius: 18px;
  background: linear-gradient(135deg, #2f4f45 0%, #3f685b 100%);
  color: #f5f7f4;
  font: inherit;
  font-weight: 800;
  cursor: pointer;
  box-shadow: 0 18px 36px rgba(47, 79, 69, 0.24);
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
  background: linear-gradient(135deg, rgba(46, 79, 69, 0.96) 0%, rgba(57, 93, 81, 0.98) 100%);
  color: #f5f7f4;
  font: inherit;
  font-weight: 800;
  letter-spacing: 0.01em;
  cursor: pointer;
  box-shadow: 0 20px 44px rgba(42, 63, 54, 0.28);
}

.marketing-concierge-toggle-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.14);
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
  .marketing-concierge-body {
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
