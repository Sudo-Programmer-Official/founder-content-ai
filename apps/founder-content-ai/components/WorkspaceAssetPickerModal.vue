<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { WorkspaceAsset, WorkspaceAssetType } from "../../../packages/shared-types";
import { requestWorkspaceAssets } from "../services/workspace-assets-service";

const props = withDefaults(
  defineProps<{
    open: boolean;
    businessId?: string;
    title?: string;
    assetType?: WorkspaceAssetType | "all";
    multiple?: boolean;
  }>(),
  {
    title: "Choose workspace assets",
    assetType: "all",
    multiple: false,
  },
);

const emit = defineEmits<{
  close: [];
  select: [assets: WorkspaceAsset[]];
}>();

const assets = ref<WorkspaceAsset[]>([]);
const search = ref("");
const isLoading = ref(false);
const feedback = ref("");
const selectedIds = ref<string[]>([]);

const selectedAssets = computed(() =>
  assets.value.filter((asset) => selectedIds.value.includes(asset.id)),
);

async function loadAssets(): Promise<void> {
  if (!props.open || !props.businessId) {
    assets.value = [];
    return;
  }

  isLoading.value = true;
  feedback.value = "";

  try {
    const response = await requestWorkspaceAssets({
      businessId: props.businessId,
      search: search.value.trim() || undefined,
      assetType: props.assetType,
    });
    assets.value = response.assets;

    if (response.assets.length === 0) {
      feedback.value = search.value.trim()
        ? "No assets matched this search."
        : "No reusable assets yet. Upload one from the Assets page first.";
    }
  } catch (error) {
    feedback.value = error instanceof Error ? error.message : "Unable to load workspace assets.";
  } finally {
    isLoading.value = false;
  }
}

function toggleAsset(assetId: string): void {
  if (!props.multiple) {
    selectedIds.value = [assetId];
    return;
  }

  if (selectedIds.value.includes(assetId)) {
    selectedIds.value = selectedIds.value.filter((candidate) => candidate !== assetId);
    return;
  }

  selectedIds.value = [...selectedIds.value, assetId];
}

function confirmSelection(): void {
  if (selectedAssets.value.length === 0) {
    return;
  }

  emit("select", selectedAssets.value);
  selectedIds.value = [];
}

watch(
  () => props.open,
  (value) => {
    if (!value) {
      selectedIds.value = [];
      search.value = "";
      feedback.value = "";
      return;
    }

    void loadAssets();
  },
);

watch(search, () => {
  if (!props.open) {
    return;
  }

  void loadAssets();
});
</script>

<template>
  <teleport to="body">
    <div v-if="open" class="asset-picker-shell" @click.self="emit('close')">
      <div class="asset-picker-modal">
        <header class="asset-picker-header">
          <div>
            <p class="picker-eyebrow">Asset picker</p>
            <h2>{{ title }}</h2>
            <p>Reuse logos, screenshots, and uploaded media without leaving the flow.</p>
          </div>
          <button type="button" class="picker-close" @click="emit('close')">Close</button>
        </header>

        <label class="picker-search">
          <span>Search assets</span>
          <input v-model="search" type="search" placeholder="Search by title, source, or tag" />
        </label>

        <p v-if="feedback" class="picker-feedback">{{ feedback }}</p>
        <p v-else-if="isLoading" class="picker-feedback">Loading workspace assets...</p>

        <div v-if="assets.length > 0" class="picker-grid">
          <button
            v-for="asset in assets"
            :key="asset.id"
            type="button"
            class="picker-asset-card"
            :class="{ selected: selectedIds.includes(asset.id) }"
            @click="toggleAsset(asset.id)"
          >
            <img
              v-if="asset.previewUrl && asset.mimeType.startsWith('image/')"
              :src="asset.previewUrl"
              :alt="asset.title || asset.assetType"
              class="picker-asset-preview"
            />
            <div v-else class="picker-asset-placeholder">
              {{ asset.assetType.toUpperCase() }}
            </div>
            <div class="picker-asset-copy">
              <strong>{{ asset.title || "Untitled asset" }}</strong>
              <span>{{ asset.assetType }} · {{ asset.sourceType }}</span>
              <span>{{ asset.usageCount }} uses</span>
            </div>
          </button>
        </div>

        <footer class="picker-footer">
          <div class="picker-selection-summary">
            <strong>{{ selectedAssets.length }}</strong>
            <span>{{ selectedAssets.length === 1 ? "asset selected" : "assets selected" }}</span>
          </div>
          <div class="picker-footer-actions">
            <button type="button" class="picker-secondary" @click="emit('close')">Cancel</button>
            <button
              type="button"
              class="picker-primary"
              :disabled="selectedAssets.length === 0"
              @click="confirmSelection"
            >
              {{ multiple ? "Use selected assets" : "Use asset" }}
            </button>
          </div>
        </footer>
      </div>
    </div>
  </teleport>
</template>

<style scoped>
.asset-picker-shell {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  background: rgba(17, 24, 39, 0.28);
  backdrop-filter: blur(8px);
}

.asset-picker-modal {
  width: min(960px, 100%);
  max-height: min(80vh, 920px);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1.5rem;
  border-radius: 28px;
  background: #fffaf5;
  box-shadow: 0 28px 80px rgba(15, 23, 42, 0.16);
}

.asset-picker-header,
.picker-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.picker-eyebrow {
  margin: 0 0 0.35rem;
  font-size: 0.82rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgba(83, 52, 36, 0.72);
}

.asset-picker-header h2 {
  margin: 0;
  font-size: 1.7rem;
}

.asset-picker-header p {
  margin: 0.35rem 0 0;
  color: rgba(83, 52, 36, 0.72);
}

.picker-close,
.picker-secondary,
.picker-primary {
  border: 1px solid rgba(214, 136, 64, 0.18);
  border-radius: 999px;
  padding: 0.85rem 1.2rem;
  font: inherit;
  cursor: pointer;
}

.picker-close,
.picker-secondary {
  background: #ffffff;
}

.picker-primary {
  background: #db6b2d;
  color: #fffaf5;
  box-shadow: 0 18px 34px rgba(219, 107, 45, 0.24);
}

.picker-primary:disabled {
  cursor: not-allowed;
  opacity: 0.55;
  box-shadow: none;
}

.picker-search {
  display: grid;
  gap: 0.45rem;
  font-weight: 600;
}

.picker-search span {
  font-size: 0.92rem;
  color: rgba(83, 52, 36, 0.74);
}

.picker-search input {
  width: 100%;
  border: 1px solid rgba(214, 136, 64, 0.18);
  border-radius: 16px;
  padding: 0.95rem 1rem;
  font: inherit;
  background: #ffffff;
}

.picker-feedback {
  margin: 0;
  color: rgba(83, 52, 36, 0.72);
}

.picker-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 1rem;
  overflow: auto;
  padding-right: 0.25rem;
}

.picker-asset-card {
  display: grid;
  gap: 0.75rem;
  padding: 0.8rem;
  border: 1px solid rgba(214, 136, 64, 0.14);
  border-radius: 22px;
  background: rgba(255, 255, 255, 0.9);
  text-align: left;
  cursor: pointer;
  transition:
    transform 160ms ease,
    box-shadow 160ms ease,
    border-color 160ms ease;
}

.picker-asset-card:hover,
.picker-asset-card.selected {
  transform: translateY(-2px);
  border-color: rgba(219, 107, 45, 0.36);
  box-shadow: 0 16px 34px rgba(219, 107, 45, 0.12);
}

.picker-asset-preview,
.picker-asset-placeholder {
  width: 100%;
  aspect-ratio: 1 / 1;
  border-radius: 18px;
  object-fit: cover;
  background: linear-gradient(135deg, rgba(255, 239, 227, 0.9), rgba(247, 227, 213, 0.96));
}

.picker-asset-placeholder {
  display: grid;
  place-items: center;
  font-size: 0.8rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  color: rgba(83, 52, 36, 0.66);
}

.picker-asset-copy {
  display: grid;
  gap: 0.2rem;
}

.picker-asset-copy strong {
  font-size: 1rem;
}

.picker-asset-copy span {
  font-size: 0.88rem;
  color: rgba(83, 52, 36, 0.68);
}

.picker-selection-summary {
  display: flex;
  align-items: baseline;
  gap: 0.4rem;
  color: rgba(83, 52, 36, 0.72);
}

.picker-selection-summary strong {
  font-size: 1.1rem;
  color: #2b1d16;
}

.picker-footer-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

@media (max-width: 720px) {
  .asset-picker-shell {
    padding: 1rem;
  }

  .asset-picker-modal {
    padding: 1.1rem;
    border-radius: 24px;
  }

  .asset-picker-header,
  .picker-footer {
    flex-direction: column;
    align-items: stretch;
  }

  .picker-footer-actions {
    justify-content: stretch;
  }
}
</style>
