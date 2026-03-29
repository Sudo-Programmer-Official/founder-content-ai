<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import type { ContentAsset, SocialAccount } from "../../../packages/shared-types";
import { useProductAccessContext } from "../access/product-access-context";
import { calculateContentScore } from "../composables/useContentScore";
import { getActivationDraft, type ActivationDraftRecord } from "../services/activation-flow-service";
import {
  requestLinkedInSocialAuthStart,
  requestPublishPost,
  requestSocialAccounts,
} from "../services/publishing-service";
import { appRoutes } from "../utils/routes";

const route = useRoute();
const router = useRouter();
const { bootstrap } = useProductAccessContext();

const draft = ref<ActivationDraftRecord | null>(null);
const feedbackMessage = ref("");
const socialAccounts = ref<SocialAccount[]>([]);
const isLoadingChannels = ref(false);
const isConnectingLinkedIn = ref(false);
const isPublishingToLinkedIn = ref(false);

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
const activeBusinessId = computed(() => bootstrap.value?.activeBusinessId ?? "");
const connectedLinkedInAccount = computed(() =>
  socialAccounts.value.find(
    (account) => account.platform === "linkedin" && account.status === "connected",
  ),
);
const connectedLinkedInLabel = computed(() => {
  const account = connectedLinkedInAccount.value;

  if (!account) {
    return "";
  }

  const linkedInName =
    typeof account.metadata?.linkedInName === "string" ? account.metadata.linkedInName.trim() : "";

  return linkedInName || account.accountEmail || account.platformUserId;
});
const linkedInPublishingStatus = computed(() => {
  if (!activeBusinessId.value) {
    return "Select a workspace to publish.";
  }

  if (connectedLinkedInAccount.value) {
    return connectedLinkedInLabel.value
      ? `Posting as ${connectedLinkedInLabel.value}`
      : "Posting optimized for LinkedIn";
  }

  return "Connect LinkedIn to publish directly.";
});

function loadDraft(): void {
  const draftId = typeof route.query.id === "string" ? route.query.id : "";
  draft.value = draftId ? getActivationDraft(draftId) : null;
}

async function copyPost(options?: { silent?: boolean }): Promise<boolean> {
  if (!postContent.value.trim() || typeof navigator === "undefined" || !navigator.clipboard) {
    return false;
  }

  try {
    await navigator.clipboard.writeText(postContent.value);

    if (!options?.silent) {
      feedbackMessage.value = "Ready to post. Copied to clipboard.";
    }

    return true;
  } catch {
    if (!options?.silent) {
      feedbackMessage.value = "The post is ready. Copy it manually if needed.";
    }

    return false;
  }
}

async function loadWorkspaceChannels(): Promise<void> {
  if (!activeBusinessId.value) {
    socialAccounts.value = [];
    return;
  }

  isLoadingChannels.value = true;

  try {
    const response = await requestSocialAccounts(activeBusinessId.value);
    socialAccounts.value = response.accounts;
  } catch {
    socialAccounts.value = [];
  } finally {
    isLoadingChannels.value = false;
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

async function connectLinkedIn(): Promise<void> {
  if (!activeBusinessId.value) {
    feedbackMessage.value = "Select a workspace before connecting LinkedIn.";
    return;
  }

  isConnectingLinkedIn.value = true;
  feedbackMessage.value = "";

  try {
    const response = await requestLinkedInSocialAuthStart({
      businessId: activeBusinessId.value,
      returnPath: route.fullPath,
    });
    window.location.assign(response.authorizationUrl);
  } catch (error) {
    isConnectingLinkedIn.value = false;
    feedbackMessage.value =
      error instanceof Error ? error.message : "Unable to start LinkedIn connection.";
  }
}

async function publishToLinkedIn(): Promise<void> {
  if (!draft.value) {
    return;
  }

  if (!activeBusinessId.value) {
    feedbackMessage.value = "Select a workspace before publishing.";
    return;
  }

  if (!connectedLinkedInAccount.value) {
    await connectLinkedIn();
    return;
  }

  isPublishingToLinkedIn.value = true;
  feedbackMessage.value = "";

  try {
    const response = await requestPublishPost({
      businessId: activeBusinessId.value,
      platform: "linkedin",
      contentText: postContent.value,
      assetId: draft.value.result.asset?.id,
      title: draft.value.result.idea.title,
    });

    feedbackMessage.value = `Posted to LinkedIn. ${response.externalPostUrl}`;
  } catch (error) {
    const copied = await copyPost({ silent: true });
    const baseMessage =
      error instanceof Error && error.message.trim() !== ""
        ? error.message
        : "Unable to publish to LinkedIn right now.";

    feedbackMessage.value = copied
      ? `${baseMessage} Optimized caption copied instead.`
      : baseMessage;
  } finally {
    isPublishingToLinkedIn.value = false;
  }
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

watch(
  () => activeBusinessId.value,
  () => {
    void loadWorkspaceChannels();
  },
  { immediate: true },
);

watch(
  () => [route.query.linkedin, route.query.message],
  async ([status, message]) => {
    if (typeof status !== "string" && typeof message !== "string") {
      return;
    }

    if (status === "connected") {
      feedbackMessage.value = "LinkedIn connected. Your post is ready to publish.";
      await loadWorkspaceChannels();
    } else if (status === "error") {
      feedbackMessage.value =
        typeof message === "string" && message.trim() !== ""
          ? message
          : "LinkedIn connection failed.";
    }

    const nextQuery = { ...route.query };
    delete nextQuery.linkedin;
    delete nextQuery.message;
    void router.replace({ query: nextQuery });
    isConnectingLinkedIn.value = false;
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

          <div class="linkedin-status-card" :data-connected="Boolean(connectedLinkedInAccount)">
            <div>
              <p class="panel-meta">LinkedIn publishing</p>
              <strong>
                {{
                  connectedLinkedInAccount
                    ? "Posting optimized for LinkedIn"
                    : "Direct publishing not connected"
                }}
              </strong>
              <p class="linkedin-status-copy">
                {{ isLoadingChannels ? "Checking workspace channel..." : linkedInPublishingStatus }}
              </p>
            </div>
          </div>

          <pre class="post-preview">{{ postContent }}</pre>

          <div class="result-actions">
            <button type="button" class="primary-action" @click="goToImprove">Improve</button>
            <button type="button" class="secondary-action" @click="copyPost">Copy for LinkedIn</button>
            <button
              type="button"
              class="secondary-action"
              :disabled="isPublishingToLinkedIn || isConnectingLinkedIn || !activeBusinessId"
              @click="connectedLinkedInAccount ? publishToLinkedIn() : connectLinkedIn()"
            >
              {{
                connectedLinkedInAccount
                  ? isPublishingToLinkedIn
                    ? "Posting..."
                    : "Post to LinkedIn"
                  : isConnectingLinkedIn
                    ? "Redirecting..."
                    : "Connect LinkedIn"
              }}
            </button>
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

.linkedin-status-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: 18px;
  padding: 16px 18px;
  border: 1px solid var(--fc-border);
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.55);
}

.linkedin-status-card[data-connected="true"] {
  background: rgba(56, 142, 60, 0.08);
  border-color: rgba(56, 142, 60, 0.18);
}

.linkedin-status-card strong {
  display: block;
  line-height: 1.25;
}

.linkedin-status-copy {
  margin: 6px 0 0;
  color: var(--fc-text-muted);
  line-height: 1.5;
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

.primary-action:disabled,
.secondary-action:disabled {
  opacity: 0.6;
  cursor: not-allowed;
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
