<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { SocialAccount } from "../../../packages/shared-types";
import {
  requestMetaAuthSession,
  requestSelectMetaPage,
} from "../services/publishing-service";

const props = defineProps<{
  open: boolean;
  businessId?: string;
  session?: string;
  platform?: "facebook" | "instagram";
}>();

const emit = defineEmits<{
  close: [];
  connected: [account: SocialAccount];
  error: [message: string];
}>();

const isLoading = ref(false);
const isSubmittingPageId = ref("");
const feedbackMessage = ref("");
const pages = ref<
  Array<{
    pageId: string;
    pageName: string;
    pictureUrl?: string;
    tasks: string[];
    instagramBusinessAccountId?: string;
    instagramUsername?: string;
    instagramDisplayName?: string;
    instagramProfilePictureUrl?: string;
  }>
>([]);

const canLoad = computed(() => Boolean(props.open && props.businessId && props.session));
const targetPlatform = computed(() => props.platform ?? "instagram");
const requiresInstagram = computed(() => targetPlatform.value === "instagram");

function resolvePageSubtitle(page: {
  instagramUsername?: string;
  instagramDisplayName?: string;
}): string {
  if (page.instagramUsername?.trim()) {
    return `@${page.instagramUsername.trim()}`;
  }

  if (page.instagramDisplayName?.trim()) {
    return page.instagramDisplayName.trim();
  }

  return "Facebook publishing destination";
}

function resolvePrimaryStatus(page: {
  instagramBusinessAccountId?: string;
}): string {
  if (page.instagramBusinessAccountId) {
    return "Instagram linked";
  }

  return requiresInstagram.value ? "Instagram required" : "Facebook ready";
}

function resolveSupportCopy(page: {
  instagramBusinessAccountId?: string;
}): string {
  if (page.instagramBusinessAccountId) {
    return "You’ll be able to publish to this Page and its linked Instagram account.";
  }

  return requiresInstagram.value
    ? "This Page is missing a linked Instagram business account, so Instagram publishing stays locked."
    : "You’ll be able to publish directly to this Facebook Page.";
}

async function loadSessionPages(): Promise<void> {
  if (!canLoad.value || !props.businessId || !props.session) {
    pages.value = [];
    return;
  }

  isLoading.value = true;
  feedbackMessage.value = "";

  try {
    const response = await requestMetaAuthSession({
      businessId: props.businessId,
      session: props.session,
    });

    pages.value = response.pages;
  } catch (error) {
    pages.value = [];
    feedbackMessage.value =
      error instanceof Error ? error.message : "Unable to load Facebook Pages for this connection.";
    emit("error", feedbackMessage.value);
  } finally {
    isLoading.value = false;
  }
}

async function connectPage(pageId: string): Promise<void> {
  if (!props.businessId || !props.session) {
    return;
  }

  isSubmittingPageId.value = pageId;
  feedbackMessage.value = "";

  try {
    const response = await requestSelectMetaPage({
      businessId: props.businessId,
      session: props.session,
      pageId,
    });

    emit("connected", response.account);
  } catch (error) {
    feedbackMessage.value =
      error instanceof Error ? error.message : "Unable to connect the selected Facebook Page.";
    emit("error", feedbackMessage.value);
  } finally {
    isSubmittingPageId.value = "";
  }
}

watch(
  () => [props.open, props.businessId, props.session],
  () => {
    if (!props.open) {
      pages.value = [];
      feedbackMessage.value = "";
      isSubmittingPageId.value = "";
      return;
    }

    void loadSessionPages();
  },
  { immediate: true },
);
</script>

<template>
  <div v-if="open" class="meta-page-modal-overlay" @click.self="emit('close')">
    <article class="meta-page-modal">
      <div class="meta-page-modal-header">
        <div class="meta-page-modal-header-copy">
          <p class="workspace-eyebrow">Meta setup</p>
          <h3>Connect Facebook Page</h3>
          <p class="workspace-description compact">
            {{
              requiresInstagram
                ? "Choose the Page you want to publish through. If it has a linked Instagram business account, Instagram unlocks on the same connection."
                : "Choose the Page you want to publish content to. Instagram will also unlock automatically when the Page has a linked business account."
            }}
          </p>
        </div>
        <div class="meta-page-modal-header-actions">
          <p class="meta-page-trust-note">You can change this anytime in Settings.</p>
          <button type="button" class="workspace-secondary-button compact" @click="emit('close')">
            Close
          </button>
        </div>
      </div>

      <p v-if="isLoading" class="workspace-description compact">Loading available Pages...</p>
      <p v-else-if="feedbackMessage" class="meta-page-feedback danger">{{ feedbackMessage }}</p>
      <section v-else-if="pages.length === 0" class="meta-page-empty-state">
        <strong>No Facebook Pages were returned</strong>
        <p class="workspace-description compact">
          Try reconnecting with the Facebook profile that manages the Page you want to publish from.
        </p>
      </section>

      <div v-else class="meta-page-grid">
        <article
          v-for="page in pages"
          :key="page.pageId"
          class="meta-page-card"
          :data-connected-ig="Boolean(page.instagramBusinessAccountId)"
          :data-disabled="requiresInstagram && !page.instagramBusinessAccountId"
        >
          <div class="meta-page-card-header">
            <img
              v-if="page.pictureUrl"
              :src="page.pictureUrl"
              :alt="page.pageName"
              class="meta-page-avatar"
            />
            <div class="meta-page-card-title-group">
              <strong>{{ page.pageName }}</strong>
              <p class="meta-page-handle">{{ resolvePageSubtitle(page) }}</p>
            </div>
            <span class="meta-page-status-pill">{{ resolvePrimaryStatus(page) }}</span>
          </div>

          <div class="meta-page-status-list" aria-label="Connection readiness">
            <div class="meta-page-status-row">
              <span class="meta-page-status-dot" />
              <span>Facebook Page connected</span>
            </div>
            <div class="meta-page-status-row" :data-positive="Boolean(page.instagramBusinessAccountId)">
              <span class="meta-page-status-dot" />
              <span>
                {{
                  page.instagramBusinessAccountId
                    ? "Instagram business account linked"
                    : requiresInstagram
                      ? "Instagram business account not linked"
                      : "Ready to publish on Facebook"
                }}
              </span>
            </div>
            <div class="meta-page-status-row" :data-positive="!requiresInstagram || Boolean(page.instagramBusinessAccountId)">
              <span class="meta-page-status-dot" />
              <span>
                {{
                  !requiresInstagram || page.instagramBusinessAccountId
                    ? "Ready to publish content"
                    : "Instagram publishing stays locked until this Page is linked"
                }}
              </span>
            </div>
          </div>

          <p class="meta-page-support-copy">
            {{ resolveSupportCopy(page) }}
          </p>

          <button
            type="button"
            class="meta-page-cta"
            :disabled="Boolean(isSubmittingPageId) || (requiresInstagram && !page.instagramBusinessAccountId)"
            @click="connectPage(page.pageId)"
          >
            <span
              v-if="isSubmittingPageId === page.pageId"
              class="meta-page-button-spinner"
              aria-hidden="true"
            />
            {{
              isSubmittingPageId === page.pageId
                ? "Connecting Page..."
                : !requiresInstagram || page.instagramBusinessAccountId
                  ? "Continue with this Page"
                  : "Instagram link required"
            }}
          </button>
        </article>
      </div>
    </article>
  </div>
</template>

<style scoped>
.meta-page-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(18, 12, 8, 0.56);
  backdrop-filter: blur(8px);
}

.meta-page-modal {
  width: min(100%, 860px);
  max-height: min(90vh, 920px);
  overflow: auto;
  display: grid;
  gap: 18px;
  padding: 24px;
  border-radius: 28px;
  border: 1px solid var(--fc-border);
  background: linear-gradient(180deg, var(--fc-surface) 0%, var(--fc-surface-subtle) 100%);
  box-shadow: var(--fc-card-shadow);
}

.meta-page-modal-header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
}

.meta-page-modal-header-copy {
  display: grid;
  gap: 8px;
  max-width: 560px;
}

.meta-page-modal-header h3 {
  margin: 0;
}

.meta-page-modal-header-actions {
  display: grid;
  gap: 10px;
  justify-items: end;
}

.meta-page-trust-note {
  margin: 0;
  font-size: 0.88rem;
  color: color-mix(in srgb, var(--fc-text-muted, #6b7280) 90%, white 10%);
}

.meta-page-empty-state {
  display: grid;
  gap: 8px;
  padding: 18px 20px;
  border-radius: 20px;
  border: 1px dashed color-mix(in srgb, var(--fc-border) 74%, transparent);
  background: color-mix(in srgb, var(--fc-surface-subtle) 88%, white 12%);
}

.meta-page-grid {
  display: grid;
  gap: 16px;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
}

.meta-page-card {
  display: grid;
  gap: 16px;
  padding: 22px;
  border-radius: 20px;
  border: 1px solid color-mix(in srgb, var(--fc-border) 78%, white 22%);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.94) 0%, rgba(255, 250, 246, 0.98) 100%);
  box-shadow: 0 10px 28px rgba(41, 24, 14, 0.08);
  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease,
    border-color 0.2s ease;
}

.meta-page-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 16px 32px rgba(41, 24, 14, 0.1);
  border-color: color-mix(in srgb, var(--fc-accent) 22%, var(--fc-border));
}

.meta-page-card[data-connected-ig="true"] {
  border-color: color-mix(in srgb, var(--fc-success-text, #2c6b35) 22%, var(--fc-border));
  background:
    linear-gradient(
      180deg,
      color-mix(in srgb, var(--fc-success-bg, rgba(56, 142, 60, 0.1)) 34%, white 66%) 0%,
      rgba(255, 255, 255, 0.98) 100%
    );
}

.meta-page-card[data-disabled="true"] {
  border-style: dashed;
}

.meta-page-card-header {
  display: flex;
  gap: 12px;
  align-items: center;
}

.meta-page-card-title-group {
  display: grid;
  gap: 4px;
  min-width: 0;
  flex: 1;
}

.meta-page-card-header strong {
  display: block;
  line-height: 1.25;
}

.meta-page-handle {
  margin: 0;
  color: color-mix(in srgb, var(--fc-text-muted, #6b7280) 90%, white 10%);
  font-size: 0.94rem;
}

.meta-page-avatar {
  width: 52px;
  height: 52px;
  border-radius: 16px;
  object-fit: cover;
  border: 1px solid var(--fc-border);
  background: rgba(255, 255, 255, 0.84);
}

.meta-page-status-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 8px 12px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--fc-success-text, #166534) 12%, var(--fc-border));
  background: color-mix(in srgb, var(--fc-success-bg, #dcfce7) 78%, white 22%);
  color: var(--fc-success-text, #166534);
  font-size: 0.82rem;
  font-weight: 700;
  white-space: nowrap;
}

.meta-page-status-list {
  display: grid;
  gap: 10px;
  padding: 14px 16px;
  border-radius: 16px;
  border: 1px solid color-mix(in srgb, var(--fc-border) 86%, white 14%);
  background: color-mix(in srgb, var(--fc-surface-subtle) 90%, white 10%);
}

.meta-page-status-row {
  display: flex;
  align-items: center;
  gap: 10px;
  color: color-mix(in srgb, var(--fc-text, #1f2937) 90%, white 10%);
  font-size: 0.95rem;
  line-height: 1.4;
}

.meta-page-status-row[data-positive="false"] {
  color: color-mix(in srgb, var(--fc-warning-text, #8a5200) 88%, #5b3a19 12%);
}

.meta-page-status-dot {
  width: 10px;
  height: 10px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: var(--fc-success-text, #166534);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--fc-success-bg, #dcfce7) 72%, transparent);
}

.meta-page-status-row[data-positive="false"] .meta-page-status-dot {
  background: var(--fc-warning-text, #8a5200);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--fc-warning-bg, #fff1d6) 72%, transparent);
}

.meta-page-support-copy {
  margin: 0;
  color: color-mix(in srgb, var(--fc-text-muted, #6b7280) 88%, white 12%);
  font-size: 0.94rem;
  line-height: 1.5;
}

.meta-page-feedback.danger {
  margin: 0;
  color: var(--fc-danger-text, #9f2f2f);
}

.meta-page-cta {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  width: 100%;
  min-height: 48px;
  padding: 12px 18px;
  border: none;
  border-radius: 14px;
  background: linear-gradient(135deg, #ff6a3d 0%, #ff8a5c 100%);
  color: white;
  font-size: 0.98rem;
  font-weight: 700;
  letter-spacing: 0.01em;
  box-shadow: 0 12px 24px rgba(215, 102, 52, 0.28);
  transition:
    transform 0.18s ease,
    box-shadow 0.18s ease,
    opacity 0.18s ease;
}

.meta-page-cta:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 16px 28px rgba(215, 102, 52, 0.32);
}

.meta-page-cta:disabled {
  cursor: not-allowed;
  opacity: 0.58;
  box-shadow: none;
}

.meta-page-button-spinner {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.34);
  border-top-color: white;
  animation: meta-page-spin 0.75s linear infinite;
}

@keyframes meta-page-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 720px) {
  .meta-page-modal {
    padding: 20px;
    border-radius: 24px;
  }

  .meta-page-modal-header-actions {
    justify-items: start;
  }

  .meta-page-card-header {
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .meta-page-status-pill {
    order: 3;
  }
}
</style>
