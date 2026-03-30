<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import type {
  ContentAiEditPreview,
  ContentAsset,
  PostAsset,
  RepurposeContentResponse,
  SocialAccount,
} from "../../../packages/shared-types";
import { useProductAccessContext } from "../access/product-access-context";
import { calculateContentScore } from "../composables/useContentScore";
import {
  getActivationDraft,
  replaceActivationDraft,
  type ActivationDraftRecord,
} from "../services/activation-flow-service";
import {
  requestContentAiEditPreview,
  requestPipelineItem,
  requestUpdatePipelineItem,
} from "../services/control-dashboard-service";
import {
  requestLinkedInSocialAuthStart,
  requestPublishPost,
  requestSocialAccounts,
} from "../services/publishing-service";
import {
  requestCreatePostAsset,
  requestDeletePostAsset,
  requestMediaUploadUrl,
  requestPostAssets,
} from "../services/post-assets-service";
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
const isLoadingPostAssets = ref(false);
const isUploadingPostAssets = ref(false);
const removingPostAssetId = ref("");
const mediaFeedback = ref("");
const postAssets = ref<PostAsset[]>([]);
const aiEditInstruction = ref("");
const aiEditPreview = ref<ContentAiEditPreview | null>(null);
const aiEditFeedback = ref("");
const isPreviewingAiEdit = ref(false);
const isApplyingAiEdit = ref(false);

const AI_QUICK_COMMANDS = [
  { label: "Make sharper", value: "Make this sharper and more punchy." },
  { label: "Remove AI tone", value: "Remove AI-sounding phrasing and make it sound more human." },
  { label: "Shorten", value: "Shorten this without changing the core message." },
  { label: "Founder voice", value: "Make this sound more like a founder talking to another founder." },
  { label: "Remove emojis", value: "Remove emojis and keep the tone clean and direct." },
] as const;

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
const hasPersistedAsset = computed(() => Boolean(draft.value?.result.asset?.id));
const persistedPostId = computed(() => draft.value?.result.asset?.id ?? "");
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

  if (account.selectedIdentity?.displayName) {
    return account.selectedIdentity.displayName;
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

function getPublishFailureMessage(error: unknown): string {
  const rawMessage =
    error instanceof Error && error.message.trim() !== ""
      ? error.message.trim()
      : "Unable to publish to LinkedIn right now.";

  if (rawMessage.includes("status 404")) {
    return "Direct LinkedIn publishing is not live on the backend yet. Redeploy the API and try again.";
  }

  return rawMessage;
}

function buildDraftFromAsset(asset: ContentAsset): ActivationDraftRecord | null {
  if (!asset.contentBody || typeof asset.contentBody !== "object") {
    return null;
  }

  const body = asset.contentBody as Partial<RepurposeContentResponse> & {
    idea?: { title?: string; angle?: string };
    quickSignals?: RepurposeContentResponse["quickSignals"];
  };
  const post =
    typeof body.post === "string" && body.post.trim() !== ""
      ? body.post.trim()
      : asset.textContent?.trim() || "";

  if (!post) {
    return null;
  }

  return {
    id: asset.id,
    input: post,
    mode: asset.sourceKind === "remix" ? "improve" : "generate",
    createdAt: asset.updatedAt ?? asset.createdAt,
    result: {
      inputType: body.inputType ?? "text",
      intent: body.intent ?? (asset.sourceKind === "remix" ? "reference" : "capture"),
      sourceText: typeof body.sourceText === "string" ? body.sourceText : post,
      idea: {
        title:
          typeof body.idea?.title === "string" && body.idea.title.trim() !== ""
            ? body.idea.title
            : asset.title || "Saved draft",
        angle:
          typeof body.idea?.angle === "string" && body.idea.angle.trim() !== ""
            ? body.idea.angle
            : "Refine and publish this workspace draft.",
      },
      hooks: Array.isArray(body.hooks) ? body.hooks.filter((hook): hook is string => typeof hook === "string") : [],
      post,
      variations: Array.isArray(body.variations) ? body.variations : [],
      carouselDraft:
        body.carouselDraft && typeof body.carouselDraft === "object"
          ? body.carouselDraft
          : {
              title: asset.title || "Saved draft",
              subtitle: "Refine and publish this workspace draft.",
              slides: [],
            },
      quickSignals:
        body.quickSignals && typeof body.quickSignals === "object"
          ? body.quickSignals
          : {
              readyLabel: "Saved as draft",
              formatLabel: "This post is persisted and ready for the next action.",
            },
      captionFooterCredit:
        typeof body.captionFooterCredit === "string" ? body.captionFooterCredit : "",
      asset,
    },
  };
}

async function loadDraft(): Promise<void> {
  const draftId = typeof route.query.id === "string" ? route.query.id : "";

  if (!draftId) {
    draft.value = null;
    return;
  }

  const storedDraft = getActivationDraft(draftId);

  if (storedDraft) {
    draft.value = storedDraft;
    return;
  }

  if (!activeBusinessId.value) {
    draft.value = null;
    return;
  }

  try {
    const response = await requestPipelineItem(activeBusinessId.value, draftId);
    draft.value = buildDraftFromAsset(response.asset);
  } catch {
    draft.value = null;
  }
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

function clearAiEditPreview(): void {
  aiEditPreview.value = null;
  aiEditFeedback.value = "";
}

async function previewAiEdit(commandOverride?: string): Promise<void> {
  if (!draft.value) {
    return;
  }

  if (!activeBusinessId.value) {
    aiEditFeedback.value = "Select a workspace before requesting AI edits.";
    return;
  }

  const instruction = (commandOverride ?? aiEditInstruction.value).trim();

  if (!instruction) {
    aiEditFeedback.value = "Describe the change you want first.";
    return;
  }

  aiEditInstruction.value = instruction;
  aiEditFeedback.value = "";
  aiEditPreview.value = null;
  isPreviewingAiEdit.value = true;

  try {
    const response = await requestContentAiEditPreview({
      businessId: activeBusinessId.value,
      assetId: draft.value.result.asset?.id,
      textContent: postContent.value,
      instruction,
    });

    aiEditPreview.value = response.preview;
  } catch (error) {
    aiEditFeedback.value =
      error instanceof Error ? error.message : "Unable to preview AI edits right now.";
  } finally {
    isPreviewingAiEdit.value = false;
  }
}

async function applyAiEditPreview(): Promise<void> {
  if (!draft.value || !aiEditPreview.value) {
    return;
  }

  const suggestedText = aiEditPreview.value.suggestedText.trim();

  if (!suggestedText) {
    aiEditFeedback.value = "The suggested edit did not contain usable content.";
    return;
  }

  isApplyingAiEdit.value = true;
  aiEditFeedback.value = "";

  try {
    let nextAsset = draft.value.result.asset;

    if (activeBusinessId.value && draft.value.result.asset?.id) {
      const response = await requestUpdatePipelineItem({
        businessId: activeBusinessId.value,
        assetId: draft.value.result.asset.id,
        textContent: suggestedText,
      });

      nextAsset = response.asset;
    }

    const nextDraft = replaceActivationDraft({
      ...draft.value,
      result: {
        ...draft.value.result,
        post: suggestedText,
        asset: nextAsset,
      },
    });

    draft.value = nextDraft;
    aiEditPreview.value = null;
    feedbackMessage.value = "Changes applied and saved to this draft.";
  } catch (error) {
    aiEditFeedback.value =
      error instanceof Error ? error.message : "Unable to apply AI changes right now.";
  } finally {
    isApplyingAiEdit.value = false;
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

async function loadPostAssets(): Promise<void> {
  if (!activeBusinessId.value || !persistedPostId.value) {
    postAssets.value = [];
    return;
  }

  isLoadingPostAssets.value = true;

  try {
    const response = await requestPostAssets(activeBusinessId.value, persistedPostId.value);
    postAssets.value = response.assets;
  } catch (error) {
    postAssets.value = [];
    mediaFeedback.value =
      error instanceof Error ? error.message : "Unable to load attached media.";
  } finally {
    isLoadingPostAssets.value = false;
  }
}

async function handleMediaSelection(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);

  if (!files.length) {
    return;
  }

  if (!activeBusinessId.value || !persistedPostId.value) {
    mediaFeedback.value = "Save this draft first, then attach media.";
    input.value = "";
    return;
  }

  isUploadingPostAssets.value = true;
  mediaFeedback.value = "";

  try {
    for (const file of files) {
      const uploadTarget = await requestMediaUploadUrl({
        businessId: activeBusinessId.value,
        postId: persistedPostId.value,
        fileType: file.type,
        fileName: file.name,
        sizeBytes: file.size,
      });

      const uploadResponse = await fetch(uploadTarget.uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": file.type,
        },
        body: file,
      });

      if (!uploadResponse.ok) {
        throw new Error("Upload to storage failed. Check bucket CORS and try again.");
      }

      await requestCreatePostAsset({
        businessId: activeBusinessId.value,
        postId: persistedPostId.value,
        storageKey: uploadTarget.storageKey,
        storageUrl: uploadTarget.storageUrl,
        mimeType: file.type,
        sizeBytes: file.size,
        source: "upload",
      });
    }

    await loadPostAssets();
    mediaFeedback.value = `${files.length} image${files.length === 1 ? "" : "s"} attached to this draft.`;
  } catch (error) {
    mediaFeedback.value =
      error instanceof Error ? error.message : "Unable to attach media right now.";
  } finally {
    isUploadingPostAssets.value = false;
    input.value = "";
  }
}

async function removePostAsset(assetId: string): Promise<void> {
  if (!activeBusinessId.value) {
    return;
  }

  removingPostAssetId.value = assetId;
  mediaFeedback.value = "";

  try {
    await requestDeletePostAsset(activeBusinessId.value, assetId);
    postAssets.value = postAssets.value.filter((asset) => asset.id !== assetId);
    mediaFeedback.value = "Media removed from this draft.";
  } catch (error) {
    mediaFeedback.value =
      error instanceof Error ? error.message : "Unable to remove this asset.";
  } finally {
    removingPostAssetId.value = "";
  }
}

async function goToImprove(): Promise<void> {
  if (!draft.value) {
    return;
  }

  await router.push({
    path: appRoutes.appGenerate,
    query: {
      postId: draft.value.id,
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
      prefill: postContent.value,
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
      prefill: postContent.value,
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
    const baseMessage = getPublishFailureMessage(error);

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
  () => [route.query.id, activeBusinessId.value],
  () => {
    void loadDraft();
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
  () => [activeBusinessId.value, persistedPostId.value],
  () => {
    void loadPostAssets();
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
        <p v-if="hasPersistedAsset" class="result-persistence-note">
          Saved as a draft in this workspace. Improve it, send it, or publish it without creating a
          duplicate post.
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

          <section v-if="hasPersistedAsset" class="media-panel">
            <div class="media-panel-header">
              <div>
                <p class="panel-meta">Media</p>
                <strong>Attach images for LinkedIn</strong>
                <p class="ai-command-copy">
                  Keep the workflow text-first. Add up to 10 images only when the post needs visual support.
                </p>
              </div>

              <label class="media-upload-button">
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/gif"
                  multiple
                  :disabled="isUploadingPostAssets"
                  @change="void handleMediaSelection($event)"
                />
                {{ isUploadingPostAssets ? "Uploading..." : "Add media" }}
              </label>
            </div>

            <p v-if="mediaFeedback" class="result-feedback">{{ mediaFeedback }}</p>
            <p v-else-if="isLoadingPostAssets" class="result-feedback">Loading attached media...</p>

            <div v-if="postAssets.length > 0" class="media-grid">
              <article v-for="asset in postAssets" :key="asset.id" class="media-card">
                <img
                  v-if="asset.previewUrl"
                  :src="asset.previewUrl"
                  :alt="`Attached media ${asset.orderIndex + 1}`"
                  class="media-preview"
                />
                <div class="media-meta">
                  <span>{{ asset.mimeType }}</span>
                  <strong>{{ Math.max(1, Math.round(asset.sizeBytes / 1024)) }} KB</strong>
                </div>
                <button
                  type="button"
                  class="secondary-action media-remove-button"
                  :disabled="removingPostAssetId === asset.id"
                  @click="void removePostAsset(asset.id)"
                >
                  {{ removingPostAssetId === asset.id ? "Removing..." : "Remove" }}
                </button>
              </article>
            </div>

            <p v-else class="result-feedback subtle">
              No media attached yet. This post will publish as text until you add images.
            </p>
          </section>

          <section class="ai-command-panel">
            <div class="ai-command-header">
              <div>
                <p class="panel-meta">AI editor</p>
                <strong>Ask AI to improve this draft</strong>
                <p class="ai-command-copy">
                  Preview the change first. Nothing overwrites the post until you apply it.
                </p>
              </div>
            </div>

            <div class="ai-command-row">
              <input
                v-model="aiEditInstruction"
                type="text"
                class="ai-command-input"
                placeholder="Try: make this sharper, remove emojis, or shorten the ending"
                @keydown.enter.prevent="void previewAiEdit()"
              />
              <button
                type="button"
                class="secondary-action ai-command-submit"
                :disabled="isPreviewingAiEdit || isApplyingAiEdit || !activeBusinessId"
                @click="void previewAiEdit()"
              >
                {{ isPreviewingAiEdit ? "Thinking..." : "Preview change" }}
              </button>
            </div>

            <div class="ai-command-chips">
              <button
                v-for="command in AI_QUICK_COMMANDS"
                :key="command.value"
                type="button"
                class="ai-command-chip"
                :disabled="isPreviewingAiEdit || isApplyingAiEdit || !activeBusinessId"
                @click="void previewAiEdit(command.value)"
              >
                {{ command.label }}
              </button>
            </div>

            <p v-if="aiEditFeedback" class="result-feedback">{{ aiEditFeedback }}</p>

            <div v-if="isPreviewingAiEdit" class="ai-edit-preview-card loading">
              Generating a scoped suggestion...
            </div>

            <div v-else-if="aiEditPreview" class="ai-edit-preview-card">
              <p class="ai-edit-summary">{{ aiEditPreview.summary }}</p>
              <p class="ai-edit-scope">{{ aiEditPreview.scopeHint }}</p>

              <div class="ai-edit-diff">
                <article class="ai-edit-diff-card">
                  <p class="panel-meta">Before</p>
                  <pre>{{ aiEditPreview.beforeExcerpt }}</pre>
                </article>
                <article class="ai-edit-diff-card updated">
                  <p class="panel-meta">After</p>
                  <pre>{{ aiEditPreview.afterExcerpt }}</pre>
                </article>
              </div>

              <div class="ai-edit-actions">
                <button
                  type="button"
                  class="primary-action"
                  :disabled="isApplyingAiEdit"
                  @click="void applyAiEditPreview()"
                >
                  {{ isApplyingAiEdit ? "Applying..." : "Apply changes" }}
                </button>
                <button type="button" class="secondary-action" @click="clearAiEditPreview">
                  Keep original
                </button>
              </div>
            </div>
          </section>

          <div class="result-actions">
            <button type="button" class="primary-action" @click="goToImprove">Improve</button>
            <button type="button" class="secondary-action" @click="void copyPost()">
              Copy for LinkedIn
            </button>
            <button
              type="button"
              class="secondary-action"
              :disabled="
                isPublishingToLinkedIn ||
                isConnectingLinkedIn ||
                isUploadingPostAssets ||
                !activeBusinessId
              "
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

.result-persistence-note {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 12px 0 0;
  padding: 10px 14px;
  border: 1px solid color-mix(in srgb, var(--fc-accent) 18%, var(--fc-border));
  border-radius: 999px;
  background: color-mix(in srgb, var(--fc-accent-soft) 72%, white 28%);
  color: var(--fc-text-muted);
  font-size: 0.95rem;
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

.ai-command-panel {
  margin-top: 20px;
  padding: 18px;
  border-radius: 22px;
  border: 1px solid var(--fc-border);
  background: rgba(255, 255, 255, 0.6);
}

.ai-command-copy,
.ai-edit-scope {
  margin: 6px 0 0;
  color: var(--fc-text-muted);
  line-height: 1.55;
}

.ai-command-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  margin-top: 14px;
}

.ai-command-input {
  min-height: 48px;
  width: 100%;
  padding: 0 16px;
  border-radius: 16px;
  border: 1px solid var(--fc-border);
  background: var(--fc-surface);
  color: var(--fc-text);
  font: inherit;
}

.media-panel {
  display: grid;
  gap: 16px;
  margin-top: 20px;
  padding: 18px;
  border: 1px solid var(--fc-border);
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.52);
}

.media-panel-header {
  display: flex;
  flex-wrap: wrap;
  align-items: start;
  justify-content: space-between;
  gap: 14px;
}

.media-panel-header strong {
  display: block;
}

.media-upload-button {
  position: relative;
  display: inline-flex;
  align-items: center;
  min-height: 42px;
  padding: 0 18px;
  border-radius: 999px;
  border: 1px solid var(--fc-border);
  background: var(--fc-surface);
  font-weight: 700;
  cursor: pointer;
}

.media-upload-button input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

.media-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 14px;
}

.media-card {
  display: grid;
  gap: 10px;
  padding: 12px;
  border-radius: 18px;
  border: 1px solid var(--fc-border);
  background: var(--fc-surface);
}

.media-preview {
  width: 100%;
  aspect-ratio: 1 / 1;
  object-fit: cover;
  border-radius: 14px;
  border: 1px solid color-mix(in srgb, var(--fc-border) 90%, transparent);
}

.media-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 0.84rem;
  color: var(--fc-text-muted);
}

.media-remove-button {
  justify-self: start;
}

.ai-command-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 14px;
}

.ai-command-chip {
  min-height: 38px;
  padding: 0 14px;
  border-radius: 999px;
  border: 1px solid var(--fc-border);
  background: transparent;
  color: var(--fc-text);
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}

.ai-command-submit {
  min-width: 160px;
}

.ai-edit-preview-card {
  margin-top: 16px;
  padding: 18px;
  border-radius: 20px;
  border: 1px solid var(--fc-border);
  background: var(--fc-surface);
}

.ai-edit-preview-card.loading {
  color: var(--fc-text-muted);
}

.ai-edit-summary {
  margin: 0;
  font-weight: 800;
  line-height: 1.5;
}

.ai-edit-diff {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  margin-top: 16px;
}

.ai-edit-diff-card {
  padding: 16px;
  border-radius: 18px;
  border: 1px solid var(--fc-border);
  background: var(--fc-surface-subtle);
}

.ai-edit-diff-card.updated {
  border-color: color-mix(in srgb, var(--fc-accent) 18%, var(--fc-border));
  background: color-mix(in srgb, var(--fc-accent-soft) 44%, white 56%);
}

.ai-edit-diff-card pre {
  margin: 0;
  white-space: pre-wrap;
  font: inherit;
  line-height: 1.7;
}

.ai-edit-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 18px;
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

.result-feedback.subtle {
  margin-top: 0;
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

  .ai-command-row,
  .ai-edit-diff {
    grid-template-columns: 1fr;
  }
}
</style>
