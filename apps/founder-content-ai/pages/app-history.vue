<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import type { PublishAttempt, PublishAttemptPlatform, PublishAttemptStatus } from "../../../packages/shared-types";
import { useProductAccessContext } from "../access/product-access-context";
import HistorySkeleton from "../components/skeletons/HistorySkeleton.vue";
import { ApiRequestError } from "../services/api-client";
import {
  requestPublishAttemptDetail,
  requestPublishAttempts,
  requestRetryFailedPublishAttempt,
} from "../services/publishing-service";
import { resolveExternalPostLabel, resolveSocialPlatformLabel } from "../utils/social-platforms";

const route = useRoute();
const router = useRouter();
const {
  activeBusinessId,
  refreshProductAccess,
} = useProductAccessContext();

const publishAttempts = ref<PublishAttempt[]>([]);
const selectedAttemptId = ref("");
const selectedAttemptDetail = ref<PublishAttempt | null>(null);
const isLoading = ref(true);
const isLoadingDetail = ref(false);
const isRetrying = ref(false);
const errorMessage = ref("");
const feedbackMessage = ref("");
const listViewMode = ref<"table" | "grid">("table");
const currentPage = ref(1);
const pageSize = ref(12);
const PAGE_SIZE_OPTIONS = [12, 24, 48] as const;

const resolvedBusinessId = computed(() => activeBusinessId.value || "");
const selectedAttempt = computed<PublishAttempt | null>(() => {
  if (selectedAttemptDetail.value && selectedAttemptDetail.value.id === selectedAttemptId.value) {
    return selectedAttemptDetail.value;
  }

  return publishAttempts.value.find((attempt) => attempt.id === selectedAttemptId.value) ?? null;
});
const selectedFailedPlatforms = computed(() =>
  (selectedAttempt.value?.platforms ?? []).filter((platform) => platform.status === "failed"),
);
const canRetryFailedPlatforms = computed(() =>
  Boolean(resolvedBusinessId.value)
  && Boolean(selectedAttempt.value)
  && selectedFailedPlatforms.value.length > 0
  && !isRetrying.value,
);
const totalPages = computed(() =>
  Math.max(1, Math.ceil(publishAttempts.value.length / pageSize.value)),
);
const paginatedAttempts = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value;
  return publishAttempts.value.slice(start, start + pageSize.value);
});
const paginationSummary = computed(() => {
  if (publishAttempts.value.length === 0) {
    return "Showing 0 of 0";
  }

  const start = (currentPage.value - 1) * pageSize.value + 1;
  const end = Math.min(currentPage.value * pageSize.value, publishAttempts.value.length);
  return `Showing ${start}-${end} of ${publishAttempts.value.length}`;
});

function formatTimestamp(value: string | undefined): string {
  if (!value) {
    return "Unknown";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatExcerpt(value: string | undefined): string {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();

  if (!normalized) {
    return "No publish copy stored for this attempt.";
  }

  if (normalized.length <= 220) {
    return normalized;
  }

  return `${normalized.slice(0, 220).trimEnd()}...`;
}

function resolveAttemptStatusTone(status: PublishAttemptStatus): "success" | "warning" | "danger" | "default" {
  switch (status) {
    case "success":
      return "success";
    case "partial":
    case "processing":
      return "warning";
    case "failed":
      return "danger";
    default:
      return "default";
  }
}

function resolveAttemptStatusLabel(status: PublishAttemptStatus): string {
  switch (status) {
    case "success":
      return "Successful";
    case "partial":
      return "Partial";
    case "failed":
      return "Failed";
    default:
      return "Processing";
  }
}

function resolveAttemptSourceLabel(sourceKind: PublishAttempt["sourceKind"]): string {
  switch (sourceKind) {
    case "retry":
      return "Retry";
    case "scheduled":
      return "Scheduled";
    default:
      return "Manual";
  }
}

function resolvePlatformStatusLabel(platform: PublishAttemptPlatform): string {
  if (platform.status === "success") {
    return "Posted";
  }

  if (platform.status === "failed") {
    return "Failed";
  }

  return "Processing";
}

function countFailedPlatforms(platforms: PublishAttemptPlatform[]): number {
  return platforms.filter((platform) => platform.status === "failed").length;
}

function selectAttempt(attemptId: string): void {
  selectedAttemptId.value = attemptId;
  selectedAttemptDetail.value = null;

  void router.replace({
    query: {
      ...route.query,
      attempt: attemptId,
    },
  });
}

function goToPreviousPage(): void {
  currentPage.value = Math.max(1, currentPage.value - 1);
}

function goToNextPage(): void {
  currentPage.value = Math.min(totalPages.value, currentPage.value + 1);
}

function toFriendlyErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiRequestError && error.message.trim()) {
    return error.message.trim();
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  return fallback;
}

async function loadPublishHistory(): Promise<void> {
  if (!resolvedBusinessId.value) {
    publishAttempts.value = [];
    selectedAttemptId.value = "";
    selectedAttemptDetail.value = null;
    isLoading.value = false;
    return;
  }

  isLoading.value = true;
  errorMessage.value = "";

  try {
    const response = await requestPublishAttempts(resolvedBusinessId.value);
    publishAttempts.value = response.publishAttempts;

    const requestedAttemptId =
      typeof route.query.attempt === "string"
        ? route.query.attempt.trim()
        : "";
    const nextAttemptId =
      (requestedAttemptId && response.publishAttempts.some((attempt) => attempt.id === requestedAttemptId)
        ? requestedAttemptId
        : response.publishAttempts[0]?.id) ?? "";

    selectedAttemptId.value = nextAttemptId;
  } catch (error) {
    publishAttempts.value = [];
    selectedAttemptId.value = "";
    selectedAttemptDetail.value = null;
    errorMessage.value = toFriendlyErrorMessage(error, "Unable to load publish history right now.");
  } finally {
    isLoading.value = false;
  }
}

async function loadSelectedAttemptDetail(): Promise<void> {
  if (!resolvedBusinessId.value || !selectedAttemptId.value) {
    selectedAttemptDetail.value = null;
    return;
  }

  isLoadingDetail.value = true;

  try {
    const response = await requestPublishAttemptDetail(selectedAttemptId.value, resolvedBusinessId.value);
    selectedAttemptDetail.value = response.publishAttempt;
  } catch (error) {
    selectedAttemptDetail.value = null;
    errorMessage.value = toFriendlyErrorMessage(error, "Unable to load publish attempt detail.");
  } finally {
    isLoadingDetail.value = false;
  }
}

async function retryFailedPlatforms(): Promise<void> {
  if (!resolvedBusinessId.value || !selectedAttempt.value) {
    return;
  }

  isRetrying.value = true;
  errorMessage.value = "";
  feedbackMessage.value = "";

  try {
    const response = await requestRetryFailedPublishAttempt(selectedAttempt.value.id, {
      businessId: resolvedBusinessId.value,
    });

    feedbackMessage.value = "Retried the failed platforms. Successful channels were left untouched.";
    selectedAttemptDetail.value = response.publishAttempt;
    selectedAttemptId.value = response.publishAttempt.id;
    await loadPublishHistory();
    selectAttempt(response.publishAttempt.id);
  } catch (error) {
    errorMessage.value = toFriendlyErrorMessage(error, "Unable to retry the failed platforms.");
  } finally {
    isRetrying.value = false;
  }
}

watch(
  () => resolvedBusinessId.value,
  async () => {
    await refreshProductAccess(resolvedBusinessId.value || null);
    await loadPublishHistory();
  },
  { immediate: true },
);

watch(
  () => route.query.attempt,
  (value) => {
    if (typeof value !== "string") {
      return;
    }

    if (value !== selectedAttemptId.value) {
      selectedAttemptId.value = value;
    }
  },
);

watch(
  () => [resolvedBusinessId.value, selectedAttemptId.value],
  () => {
    void loadSelectedAttemptDetail();
  },
  { immediate: true },
);

watch(
  () => [publishAttempts.value.length, pageSize.value] as const,
  () => {
    if (currentPage.value > totalPages.value) {
      currentPage.value = totalPages.value;
    }
  },
);
</script>

<template>
  <section class="history-page">
    <header class="history-header">
      <div>
        <p class="history-eyebrow">Publish History</p>
        <h1>Track every publish action across platforms.</h1>
        <p class="history-copy">
          Manual posts, scheduled dispatches, failures, and retries now live in one ledger.
        </p>
      </div>

      <button
        v-if="canRetryFailedPlatforms"
        type="button"
        class="history-retry-button"
        :disabled="isRetrying"
        @click="void retryFailedPlatforms()"
      >
        {{ isRetrying ? "Retrying failed..." : "Retry failed only" }}
      </button>
    </header>

    <p v-if="feedbackMessage" class="history-feedback history-feedback-success">{{ feedbackMessage }}</p>
    <p v-if="errorMessage" class="history-feedback history-feedback-error">{{ errorMessage }}</p>

    <HistorySkeleton v-if="isLoading" />

    <div v-else class="history-layout">
      <section class="history-list-card">
        <div class="history-list-header">
          <div>
            <p class="history-eyebrow">Attempts</p>
            <strong>{{ publishAttempts.length }} total</strong>
          </div>
          <div class="history-list-controls">
            <label class="history-control-field">
              <span>View</span>
              <select v-model="listViewMode">
                <option value="table">Table</option>
                <option value="grid">Grid</option>
              </select>
            </label>
            <label class="history-control-field">
              <span>Rows</span>
              <select v-model.number="pageSize">
                <option v-for="size in PAGE_SIZE_OPTIONS" :key="size" :value="size">{{ size }}</option>
              </select>
            </label>
          </div>
        </div>

        <div v-if="publishAttempts.length === 0" class="history-empty-state">
          <strong>No publish attempts yet.</strong>
          <p>Once you publish or schedule content, the ledger will show each action and platform result here.</p>
        </div>

        <div v-else-if="listViewMode === 'grid'" class="history-list-grid">
          <button
            v-for="attempt in paginatedAttempts"
            :key="attempt.id"
            type="button"
            class="history-list-row"
            :data-active="attempt.id === selectedAttemptId"
            @click="selectAttempt(attempt.id)"
          >
            <div class="history-list-row-top">
              <span class="history-source-chip">{{ resolveAttemptSourceLabel(attempt.sourceKind) }}</span>
              <span class="history-status-chip" :data-tone="resolveAttemptStatusTone(attempt.status)">
                {{ resolveAttemptStatusLabel(attempt.status) }}
              </span>
            </div>

            <strong>{{ attempt.title || "Publish attempt" }}</strong>
            <p>{{ formatExcerpt(attempt.contentText) }}</p>

            <div class="history-platform-chip-row">
              <span
                v-for="platform in attempt.platforms"
                :key="`${attempt.id}-${platform.platform}`"
                class="history-platform-chip"
                :data-status="platform.status"
              >
                {{ resolveSocialPlatformLabel(platform.platform) }} · {{ resolvePlatformStatusLabel(platform) }}
              </span>
            </div>

            <span class="history-timestamp">{{ formatTimestamp(attempt.createdAt) }}</span>
          </button>
        </div>

        <div v-else class="history-table-wrap">
          <table class="history-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Source</th>
                <th>Status</th>
                <th>Platforms</th>
                <th>Title</th>
                <th>Failures</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="attempt in paginatedAttempts"
                :key="attempt.id"
                :data-active="attempt.id === selectedAttemptId"
                @click="selectAttempt(attempt.id)"
              >
                <td>{{ formatTimestamp(attempt.createdAt) }}</td>
                <td>
                  <span class="history-source-chip">{{ resolveAttemptSourceLabel(attempt.sourceKind) }}</span>
                </td>
                <td>
                  <span class="history-status-chip" :data-tone="resolveAttemptStatusTone(attempt.status)">
                    {{ resolveAttemptStatusLabel(attempt.status) }}
                  </span>
                </td>
                <td>{{ attempt.platforms.map((platform) => resolveSocialPlatformLabel(platform.platform)).join(", ") }}</td>
                <td>{{ attempt.title || "Publish attempt" }}</td>
                <td>{{ countFailedPlatforms(attempt.platforms) }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="publishAttempts.length > 0" class="history-pagination">
          <span class="history-pagination-summary">{{ paginationSummary }}</span>
          <div class="history-pagination-actions">
            <button type="button" class="history-page-button" :disabled="currentPage === 1" @click="goToPreviousPage">
              Previous
            </button>
            <span class="history-page-index">Page {{ currentPage }} / {{ totalPages }}</span>
            <button
              type="button"
              class="history-page-button"
              :disabled="currentPage === totalPages"
              @click="goToNextPage"
            >
              Next
            </button>
          </div>
        </div>
      </section>

      <section class="history-detail-card">
        <div v-if="!selectedAttempt" class="history-empty-state history-detail-empty">
          <strong>Select a publish attempt.</strong>
          <p>Choose an attempt from the ledger to inspect platform results and retry failures.</p>
        </div>

        <template v-else>
          <div class="history-detail-header">
            <div>
              <p class="history-eyebrow">{{ resolveAttemptSourceLabel(selectedAttempt.sourceKind) }} publish</p>
              <h2>{{ selectedAttempt.title || "Publish attempt" }}</h2>
              <p class="history-copy">{{ formatExcerpt(selectedAttempt.contentText) }}</p>
            </div>

            <div class="history-detail-meta">
              <span class="history-status-chip" :data-tone="resolveAttemptStatusTone(selectedAttempt.status)">
                {{ resolveAttemptStatusLabel(selectedAttempt.status) }}
              </span>
              <span>{{ formatTimestamp(selectedAttempt.createdAt) }}</span>
            </div>
          </div>

          <div v-if="isLoadingDetail" class="history-detail-loading">Loading attempt detail...</div>

          <div v-else class="history-detail-grid">
            <article
              v-for="platform in selectedAttempt.platforms"
              :key="platform.id"
              class="history-platform-detail"
              :data-status="platform.status"
            >
              <div class="history-platform-detail-top">
                <div>
                  <p class="history-eyebrow">{{ resolveSocialPlatformLabel(platform.platform) }}</p>
                  <strong>{{ resolvePlatformStatusLabel(platform) }}</strong>
                </div>
                <span class="history-platform-badge" :data-status="platform.status">
                  {{ platform.status }}
                </span>
              </div>

              <p v-if="platform.status === 'success'" class="history-platform-message">
                Posted successfully{{ platform.externalPostId ? ` · ${platform.externalPostId}` : "" }}.
              </p>
              <p v-else-if="platform.errorMessage" class="history-platform-message">
                {{ platform.errorMessage }}
              </p>
              <p v-else class="history-platform-message">
                This platform is still processing.
              </p>

              <div class="history-platform-stats">
                <span>{{ platform.mediaSummary.imageCount }} images</span>
                <span>{{ platform.mediaSummary.videoCount }} videos</span>
                <span>{{ platform.mediaSummary.slideCount }} slides</span>
              </div>

              <a
                v-if="platform.externalPostUrl"
                :href="platform.externalPostUrl"
                target="_blank"
                rel="noreferrer"
                class="history-link"
              >
                {{ resolveExternalPostLabel(platform.platform) }}
              </a>
            </article>
          </div>
        </template>
      </section>
    </div>
  </section>
</template>

<style scoped>
.history-page {
  display: grid;
  gap: 1.5rem;
}

.history-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}

.history-eyebrow {
  margin: 0 0 0.35rem;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgba(78, 45, 20, 0.68);
}

.history-header h1,
.history-detail-header h2 {
  margin: 0;
  font-size: clamp(1.8rem, 2vw, 2.4rem);
  line-height: 1.05;
  color: #2a211b;
}

.history-copy {
  margin: 0.45rem 0 0;
  max-width: 60ch;
  color: rgba(78, 45, 20, 0.72);
}

.history-retry-button {
  border: none;
  border-radius: 999px;
  padding: 0.95rem 1.25rem;
  background: linear-gradient(135deg, #ff6a3d, #ff8a5c);
  color: #fff;
  font-weight: 700;
  cursor: pointer;
}

.history-retry-button:disabled {
  cursor: wait;
  opacity: 0.7;
}

.history-feedback {
  margin: 0;
  border-radius: 1rem;
  padding: 0.9rem 1rem;
  font-weight: 600;
}

.history-feedback-success {
  background: rgba(33, 146, 76, 0.1);
  color: #1c7a43;
}

.history-feedback-error {
  background: rgba(181, 58, 58, 0.1);
  color: #8f2f2f;
}

.history-layout {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1.25rem;
}

.history-list-card,
.history-detail-card {
  border: 1px solid rgba(184, 151, 122, 0.26);
  border-radius: 1.6rem;
  background: rgba(255, 250, 245, 0.92);
  box-shadow: 0 20px 44px rgba(122, 82, 47, 0.08);
}

.history-list-card {
  display: grid;
  gap: 0.85rem;
  padding: 1.1rem;
  align-content: start;
}

.history-list-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 0.9rem;
}

.history-list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.8rem;
}

.history-list-controls {
  display: flex;
  gap: 0.6rem;
  flex-wrap: wrap;
}

.history-control-field {
  display: grid;
  gap: 0.25rem;
  font-size: 0.78rem;
  color: rgba(78, 45, 20, 0.72);
}

.history-control-field select {
  min-height: 36px;
  border: 1px solid rgba(184, 151, 122, 0.3);
  border-radius: 0.65rem;
  background: #fff;
  color: #2a211b;
  padding: 0 0.55rem;
}

.history-table-wrap {
  overflow: auto;
  border: 1px solid rgba(184, 151, 122, 0.2);
  border-radius: 1rem;
  background: #fff;
}

.history-table {
  width: 100%;
  border-collapse: collapse;
  min-width: 760px;
}

.history-table th,
.history-table td {
  padding: 0.72rem 0.75rem;
  border-bottom: 1px solid rgba(184, 151, 122, 0.16);
  text-align: left;
  vertical-align: middle;
}

.history-table th {
  font-size: 0.78rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(78, 45, 20, 0.68);
  background: rgba(255, 250, 245, 0.92);
}

.history-table tbody tr {
  cursor: pointer;
}

.history-table tbody tr:hover,
.history-table tbody tr[data-active="true"] {
  background: rgba(255, 106, 61, 0.07);
}

.history-pagination {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.8rem;
}

.history-pagination-summary,
.history-page-index {
  color: rgba(78, 45, 20, 0.68);
  font-size: 0.84rem;
}

.history-pagination-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.history-page-button {
  min-height: 36px;
  border: 1px solid rgba(184, 151, 122, 0.32);
  border-radius: 0.7rem;
  padding: 0 0.8rem;
  background: #fff;
  color: #2a211b;
  font-weight: 600;
  cursor: pointer;
}

.history-page-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.history-list-row {
  display: grid;
  gap: 0.7rem;
  width: 100%;
  min-height: 230px;
  border: 1px solid rgba(184, 151, 122, 0.22);
  border-radius: 1.2rem;
  padding: 1rem;
  background: #fff;
  text-align: left;
  cursor: pointer;
  transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
}

.history-list-row:hover,
.history-list-row[data-active="true"] {
  transform: translateY(-1px);
  border-color: rgba(255, 106, 61, 0.35);
  box-shadow: 0 16px 30px rgba(122, 82, 47, 0.08);
}

.history-list-row strong {
  color: #2a211b;
}

.history-list-row p {
  margin: 0;
  color: rgba(78, 45, 20, 0.68);
}

.history-list-row-top,
.history-detail-meta,
.history-platform-detail-top,
.history-platform-stats,
.history-platform-chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.55rem;
  align-items: center;
}

.history-source-chip,
.history-status-chip,
.history-platform-chip,
.history-platform-badge {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 0.32rem 0.68rem;
  font-size: 0.78rem;
  font-weight: 700;
}

.history-source-chip,
.history-platform-chip {
  background: rgba(123, 79, 36, 0.08);
  color: rgba(78, 45, 20, 0.72);
}

.history-status-chip[data-tone="success"],
.history-platform-badge[data-status="success"],
.history-platform-chip[data-status="success"] {
  background: rgba(33, 146, 76, 0.12);
  color: #1c7a43;
}

.history-status-chip[data-tone="warning"],
.history-platform-badge[data-status="processing"] {
  background: rgba(206, 140, 31, 0.14);
  color: #8d5d08;
}

.history-status-chip[data-tone="danger"],
.history-platform-badge[data-status="failed"],
.history-platform-chip[data-status="failed"] {
  background: rgba(181, 58, 58, 0.12);
  color: #8f2f2f;
}

.history-status-chip[data-tone="default"] {
  background: rgba(123, 79, 36, 0.08);
  color: rgba(78, 45, 20, 0.72);
}

.history-timestamp {
  color: rgba(78, 45, 20, 0.56);
  font-size: 0.82rem;
}

.history-detail-card {
  padding: 1.3rem;
  display: grid;
  gap: 1rem;
}

.history-detail-header {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
}

.history-detail-loading,
.history-empty-state {
  border: 1px dashed rgba(184, 151, 122, 0.38);
  border-radius: 1.2rem;
  padding: 1.15rem;
  background: rgba(255, 255, 255, 0.68);
  color: rgba(78, 45, 20, 0.7);
}

.history-empty-state strong {
  display: block;
  color: #2a211b;
}

.history-empty-state p {
  margin: 0.35rem 0 0;
}

.history-detail-grid {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
}

.history-platform-detail {
  display: grid;
  gap: 0.85rem;
  border: 1px solid rgba(184, 151, 122, 0.2);
  border-radius: 1.2rem;
  padding: 1rem;
  background: #fff;
}

.history-platform-message {
  margin: 0;
  color: rgba(78, 45, 20, 0.72);
}

.history-platform-stats {
  color: rgba(78, 45, 20, 0.58);
  font-size: 0.84rem;
}

.history-link {
  color: #cf5d28;
  font-weight: 700;
  text-decoration: none;
}

.history-link:hover {
  text-decoration: underline;
}

@media (max-width: 960px) {
  .history-header,
  .history-detail-header {
    grid-template-columns: 1fr;
    display: grid;
  }

  .history-retry-button {
    width: 100%;
  }

  .history-list-grid {
    grid-template-columns: 1fr;
  }

  .history-pagination {
    align-items: stretch;
  }
}
</style>
