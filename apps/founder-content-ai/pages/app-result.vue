<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import type { ContentAsset } from "../../../packages/shared-types";
import { calculateContentScore } from "../composables/useContentScore";
import { getActivationDraft, type ActivationDraftRecord } from "../services/activation-flow-service";
import { appRoutes } from "../utils/routes";

const route = useRoute();
const router = useRouter();

const draft = ref<ActivationDraftRecord | null>(null);
const feedbackMessage = ref("");

const postScore = computed(() =>
  draft.value
    ? calculateContentScore({
        id: draft.value.id,
        contentType: "post",
        contentBody: draft.value.result.post,
        status: "draft",
        pipelineStage: "review",
        sourceKind: draft.value.mode === "improve" ? "remix" : "capture",
        textContent: draft.value.result.post,
        createdAt: draft.value.createdAt,
      } satisfies ContentAsset).score
    : 0,
);

const quickSignals = computed(() => draft.value?.result.quickSignals);
const postContent = computed(() => draft.value?.result.post ?? "");
const hooks = computed(() => draft.value?.result.hooks ?? []);

function loadDraft(): void {
  const draftId = typeof route.query.id === "string" ? route.query.id : "";
  draft.value = draftId ? getActivationDraft(draftId) : null;
}

async function copyPost(): Promise<void> {
  if (!postContent.value.trim() || typeof navigator === "undefined" || !navigator.clipboard) {
    return;
  }

  try {
    await navigator.clipboard.writeText(postContent.value);
    feedbackMessage.value = "Ready to post. Copied to clipboard.";
  } catch {
    feedbackMessage.value = "The post is ready. Copy it manually if needed.";
  }
}

async function goToImprove(): Promise<void> {
  if (!draft.value) {
    return;
  }

  await router.push({
    path: appRoutes.appGenerate,
    query: {
      improve: draft.value.id,
    },
  });
}

async function goToOutreach(): Promise<void> {
  if (!draft.value) {
    return;
  }

  await router.push({
    path: appRoutes.appOutreach,
    query: {
      draftId: draft.value.id,
    },
  });
}

async function goToEmail(): Promise<void> {
  if (!draft.value) {
    return;
  }

  await router.push({
    path: appRoutes.appEmail,
    query: {
      draftId: draft.value.id,
    },
  });
}

function handleKeydown(event: KeyboardEvent): void {
  if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || !draft.value) {
    return;
  }

  const normalizedKey = event.key.toLowerCase();

  if (normalizedKey === "e") {
    event.preventDefault();
    void goToEmail();
    return;
  }

  if (normalizedKey === "o") {
    event.preventDefault();
    void goToOutreach();
  }
}

watch(
  () => route.query.id,
  () => {
    loadDraft();
  },
  { immediate: true },
);

onMounted(() => {
  window.addEventListener("keydown", handleKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleKeydown);
});
</script>

<template>
  <main class="result-shell">
    <template v-if="draft">
      <section class="result-hero">
        <p class="result-eyebrow">/app/result</p>
        <h1>Your post is ready.</h1>
        <p class="result-description">
          This is the activation moment: improve the draft, send it into outreach, or turn it into
          an email without rewriting from scratch.
        </p>
      </section>

      <section class="result-grid">
        <article class="result-post-card">
          <div class="result-card-header">
            <div>
              <p class="panel-meta">Generated post</p>
              <h2>{{ draft.result.idea.title }}</h2>
            </div>
            <div class="score-badge">Score {{ postScore }}/100</div>
          </div>

          <p v-if="quickSignals" class="signal-line">
            <span>{{ quickSignals.readyLabel }}</span>
            <span>{{ quickSignals.formatLabel }}</span>
          </p>

          <pre class="post-preview">{{ postContent }}</pre>

          <div class="result-actions">
            <button type="button" class="primary-action" @click="goToImprove">Improve</button>
            <button type="button" class="secondary-action" @click="copyPost">Copy</button>
            <button type="button" class="secondary-action" @click="goToOutreach">
              Send via Outreach
            </button>
            <button type="button" class="secondary-action" @click="goToEmail">
              Send via Email
            </button>
          </div>

          <p v-if="feedbackMessage" class="result-feedback">{{ feedbackMessage }}</p>
        </article>

        <aside class="result-side-rail">
          <article class="side-card">
            <p class="panel-meta">Hooks</p>
            <ul class="hook-list">
              <li v-for="hook in hooks" :key="hook">{{ hook }}</li>
            </ul>
          </article>

          <article class="side-card">
            <p class="panel-meta">Next actions</p>
            <ul class="next-action-list">
              <li>Improve if you want a stronger hook before sending.</li>
              <li>Use Outreach to push the draft into direct founder conversations.</li>
              <li>Use Email to turn the same idea into a quick campaign.</li>
            </ul>
            <p class="shortcut-note">Shortcuts: Cmd/Ctrl + Shift + O for outreach, + E for email.</p>
          </article>
        </aside>
      </section>
    </template>

    <section v-else class="result-empty-card">
      <p class="result-eyebrow">/app/result</p>
      <h1>No generated result found.</h1>
      <p class="result-description">
        Generate a post first, then this screen becomes the handoff into the rest of the product.
      </p>
      <router-link class="primary-action" :to="appRoutes.appGenerate">Generate your first post</router-link>
    </section>
  </main>
</template>

<style scoped>
.result-shell {
  width: min(100%, 1120px);
  margin: 0 auto;
  padding: 48px 20px 80px;
}

.result-hero {
  margin-bottom: 24px;
}

.result-eyebrow,
.panel-meta {
  margin: 0 0 10px;
  color: var(--fc-text-muted);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.result-hero h1,
.result-empty-card h1 {
  margin: 0;
  font-size: clamp(2.1rem, 4vw, 3.4rem);
  line-height: 1.02;
}

.result-description {
  max-width: 760px;
  margin: 16px 0 0;
  color: var(--fc-text-muted);
  line-height: 1.7;
}

.result-grid {
  display: grid;
  gap: 20px;
  grid-template-columns: minmax(0, 1.4fr) minmax(280px, 0.8fr);
}

.result-post-card,
.side-card,
.result-empty-card {
  border: 1px solid var(--fc-border);
  border-radius: 28px;
  background: linear-gradient(180deg, var(--fc-surface) 0%, var(--fc-surface-subtle) 100%);
  box-shadow: var(--fc-card-shadow);
}

.result-post-card,
.side-card {
  padding: clamp(22px, 3vw, 32px);
}

.result-empty-card {
  width: min(100%, 760px);
  margin: 0 auto;
  padding: clamp(24px, 4vw, 40px);
}

.result-card-header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
}

.result-card-header h2 {
  margin: 0;
  line-height: 1.1;
}

.score-badge {
  display: inline-flex;
  align-items: center;
  min-height: 38px;
  padding: 0 14px;
  border-radius: 999px;
  background: var(--fc-surface-subtle);
  border: 1px solid var(--fc-border);
  font-weight: 800;
}

.signal-line {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin: 18px 0 0;
}

.signal-line span {
  display: inline-flex;
  align-items: center;
  min-height: 34px;
  padding: 0 12px;
  border-radius: 999px;
  background: var(--fc-success-bg, rgba(56, 142, 60, 0.12));
  color: var(--fc-success-text, #2c6b35);
  font-size: 0.84rem;
  font-weight: 700;
}

.post-preview {
  margin: 20px 0 0;
  padding: 18px;
  border-radius: 20px;
  background: var(--fc-surface);
  border: 1px solid var(--fc-border);
  white-space: pre-wrap;
  font: inherit;
  line-height: 1.8;
}

.result-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 22px;
}

.primary-action,
.secondary-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 48px;
  padding: 0 18px;
  border-radius: 999px;
  font-weight: 800;
  text-decoration: none;
}

.primary-action {
  border: none;
  background: linear-gradient(135deg, var(--fc-accent) 0%, var(--fc-accent-dark) 100%);
  box-shadow: var(--fc-accent-shadow);
  color: var(--fc-accent-contrast);
  cursor: pointer;
}

.secondary-action {
  border: 1px solid var(--fc-border);
  background: transparent;
  color: var(--fc-text);
  cursor: pointer;
}

.result-feedback,
.shortcut-note {
  margin: 16px 0 0;
  color: var(--fc-text-muted);
  line-height: 1.6;
}

.result-side-rail {
  display: grid;
  gap: 20px;
}

.hook-list,
.next-action-list {
  display: grid;
  gap: 12px;
  padding-left: 18px;
  margin: 18px 0 0;
  color: var(--fc-text-muted);
  line-height: 1.6;
}

@media (max-width: 900px) {
  .result-grid {
    grid-template-columns: 1fr;
  }
}
</style>
