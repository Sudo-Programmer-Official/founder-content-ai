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
        <div>
          <p class="workspace-eyebrow">Meta setup</p>
          <h3>Select the Facebook Page</h3>
          <p class="workspace-description compact">
            {{
              requiresInstagram
                ? "Instagram is derived from the linked business account on the Facebook Page you choose here."
                : "Facebook publishing uses the Page you choose here. If the Page also has a linked Instagram business account, Instagram unlocks on the same connection."
            }}
          </p>
        </div>
        <button type="button" class="workspace-secondary-button compact" @click="emit('close')">
          Close
        </button>
      </div>

      <p v-if="isLoading" class="workspace-description compact">Loading available Pages...</p>
      <p v-else-if="feedbackMessage" class="meta-page-feedback danger">{{ feedbackMessage }}</p>
      <p v-else-if="pages.length === 0" class="workspace-description compact">
        No Facebook Pages were returned for this connection.
      </p>

      <div v-else class="meta-page-grid">
        <article
          v-for="page in pages"
          :key="page.pageId"
          class="meta-page-card"
          :data-connected-ig="Boolean(page.instagramBusinessAccountId)"
        >
          <div class="meta-page-card-header">
            <img
              v-if="page.pictureUrl"
              :src="page.pictureUrl"
              :alt="page.pageName"
              class="meta-page-avatar"
            />
            <div>
              <strong>{{ page.pageName }}</strong>
              <p class="workspace-description compact">
                {{
                  page.instagramDisplayName || page.instagramUsername || (requiresInstagram
                    ? "No linked Instagram business account"
                    : "Facebook Page ready")
                }}
              </p>
            </div>
          </div>

          <div class="meta-page-chip-row">
            <span class="workspace-chip">Facebook Page</span>
            <span class="workspace-chip">
              {{
                page.instagramBusinessAccountId
                  ? "Instagram ready"
                  : requiresInstagram
                    ? "Instagram unavailable"
                    : "Page only"
              }}
            </span>
          </div>

          <p class="workspace-description compact">
            {{ page.tasks.length > 0 ? `Tasks: ${page.tasks.join(", ")}` : "Meta did not return Page task metadata." }}
          </p>

          <button
            type="button"
            class="workspace-primary-button"
            :disabled="Boolean(isSubmittingPageId) || (requiresInstagram && !page.instagramBusinessAccountId)"
            @click="connectPage(page.pageId)"
          >
            {{
              isSubmittingPageId === page.pageId
                ? "Connecting..."
                : !requiresInstagram || page.instagramBusinessAccountId
                  ? "Use this Page"
                  : "Instagram required"
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

.meta-page-modal-header h3 {
  margin: 0;
}

.meta-page-grid {
  display: grid;
  gap: 14px;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
}

.meta-page-card {
  display: grid;
  gap: 14px;
  padding: 18px;
  border-radius: 22px;
  border: 1px solid var(--fc-border);
  background: rgba(255, 255, 255, 0.72);
}

.meta-page-card[data-connected-ig="true"] {
  border-color: color-mix(in srgb, var(--fc-success-text, #2c6b35) 16%, var(--fc-border));
  background: color-mix(in srgb, var(--fc-success-bg, rgba(56, 142, 60, 0.12)) 56%, white 44%);
}

.meta-page-card-header {
  display: flex;
  gap: 12px;
  align-items: center;
}

.meta-page-card-header strong {
  display: block;
  line-height: 1.25;
}

.meta-page-avatar {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  object-fit: cover;
  border: 1px solid var(--fc-border);
}

.meta-page-chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.meta-page-feedback.danger {
  margin: 0;
  color: var(--fc-danger-text, #9f2f2f);
}
</style>
