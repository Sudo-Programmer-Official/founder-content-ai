<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type {
  BusinessMediaProfile,
  BusinessMediaProfileType,
  DecisionRuleSummary,
  MediaRecommendationContentType,
  MediaRecommendationGoal,
  MediaPresetSummary,
  PromptTemplateSummary,
  WorkspaceAsset,
  WorkspaceAssetType,
  WorkspaceAssetSourceType,
  WorkspaceBrandKitSummary,
  WorkspaceMediaOptimizationSurfaceSummary,
  WorkspaceMediaResolutionResponse,
} from "../../../packages/shared-types";
import { requestUpdateBrandKit } from "../services/brand-kit-service";
import { useProductAccessContext } from "../access/product-access-context";
import {
  requestUpdateBusinessMediaProfile,
  requestUpdateWorkspaceMediaOverride,
  requestWorkspaceMediaIntelligence,
  requestWorkspaceMediaResolution,
} from "../services/media-intelligence-service";
import {
  requestCreateWorkspaceAsset,
  requestDeleteWorkspaceAsset,
  requestRecordWorkspaceAssetUsage,
  requestWorkspaceAssetDownload,
  requestWorkspaceAssetUploadUrl,
  requestWorkspaceAssets,
} from "../services/workspace-assets-service";

const { bootstrap, isReady } = useProductAccessContext();

const activeBusinessId = computed(() => bootstrap.value?.activeBusinessId ?? "");
const selectedType = ref<WorkspaceAssetType | "all">("all");
const selectedSource = ref<WorkspaceAssetSourceType | "all">("all");
const search = ref("");
const assets = ref<WorkspaceAsset[]>([]);
const brandKit = ref<WorkspaceBrandKitSummary | undefined>(undefined);
const mediaProfile = ref<BusinessMediaProfile | null>(null);
const mediaPresets = ref<MediaPresetSummary[]>([]);
const promptTemplates = ref<PromptTemplateSummary[]>([]);
const decisionRules = ref<DecisionRuleSummary[]>([]);
const optimizationSummaries = ref<WorkspaceMediaOptimizationSurfaceSummary[]>([]);
const resolutionPreview = ref<WorkspaceMediaResolutionResponse | null>(null);
const feedback = ref("");
const mediaIntelligenceFeedback = ref("");
const isLoading = ref(false);
const isUploading = ref(false);
const isSavingMediaProfile = ref(false);
const isLoadingResolution = ref(false);
const deletingAssetId = ref("");
const savingBrandLogoAssetId = ref("");
const togglingPresetId = ref("");
const savingPromptOverridePresetId = ref("");
const resolutionContentType = ref<MediaRecommendationContentType>("post");
const resolutionGoal = ref<MediaRecommendationGoal>("authority");
const hasUploadedAssetsMode = ref<"auto" | "yes" | "no">("auto");
const presetTemplateSelections = ref<Record<string, string>>({});

const BUSINESS_TYPE_OPTIONS: Array<{ value: BusinessMediaProfileType; label: string }> = [
  { value: "general", label: "General" },
  { value: "saas", label: "SaaS" },
  { value: "daycare", label: "Daycare" },
  { value: "fitness", label: "Fitness" },
];

const filteredAssets = computed(() => assets.value);
const imageCount = computed(() => assets.value.filter((asset) => asset.assetType === "image").length);
const videoCount = computed(() => assets.value.filter((asset) => asset.assetType === "video").length);
const logoCount = computed(() => assets.value.filter((asset) => asset.assetType === "logo").length);
const documentCount = computed(() => assets.value.filter((asset) => asset.assetType === "document").length);
const totalUsageCount = computed(() =>
  assets.value.reduce((total, asset) => total + asset.usageCount, 0),
);
const currentWorkspaceLogoAssetId = computed(() => brandKit.value?.logoAssetId || "");

const enabledPresetCount = computed(
  () => mediaPresets.value.filter((preset) => preset.isEnabledForWorkspace).length,
);
const activeRuleCount = computed(() => decisionRules.value.filter((rule) => rule.isActive).length);
const mediaPromptTemplates = computed(() =>
  promptTemplates.value.filter((template) => template.category === "media"),
);
const hasUploadedAssetsOverride = computed<boolean | undefined>(() => {
  if (hasUploadedAssetsMode.value === "yes") {
    return true;
  }

  if (hasUploadedAssetsMode.value === "no") {
    return false;
  }

  return undefined;
});
const activeOptimizationSummary = computed(() =>
  optimizationSummaries.value.find((summary) => summary.surface === resolutionContentType.value),
);
const resolutionSummaryCards = computed(() => {
  if (!resolutionPreview.value) {
    return [];
  }

  const topPerformer =
    activeOptimizationSummary.value?.topPreset?.mediaPresetName
    || (activeOptimizationSummary.value?.topMediaType
      ? activeOptimizationSummary.value.topMediaType.mediaType.replace(/_/g, " ")
      : "No signal yet");

  return [
    {
      label: "Selected preset",
      value: resolutionPreview.value.selectedPreset?.name || "No preset match",
    },
    {
      label: "Preferred action",
      value: humanizePreferredAction(resolutionPreview.value.preferredAction),
    },
    {
      label: "Matched rules",
      value: String(resolutionPreview.value.matchedRules.length),
    },
    {
      label: "Asset context",
      value: resolutionPreview.value.hasUploadedAssets ? "Assets available" : "No uploaded assets",
    },
    {
      label: "Top performer",
      value: topPerformer,
    },
  ];
});

const preferredMediaMode = computed(() => {
  if (!mediaProfile.value) {
    return "Not configured";
  }

  if (mediaProfile.value.preferExistingAssets) {
    return "Reuse existing assets first";
  }

  if (mediaProfile.value.preferTextVisuals) {
    return "Text visuals first";
  }

  return "Balanced";
});

async function loadAssets(): Promise<void> {
  if (!isReady.value || !activeBusinessId.value) {
    return;
  }

  isLoading.value = true;
  feedback.value = "";

  try {
    const response = await requestWorkspaceAssets({
      businessId: activeBusinessId.value,
      assetType: selectedType.value,
      sourceType: selectedSource.value,
      search: search.value.trim() || undefined,
    });
    assets.value = response.assets;
    brandKit.value = response.brandKit;

    if (response.assets.length === 0) {
      feedback.value = search.value.trim()
        ? "No assets matched this view."
        : "No reusable assets yet. Upload logos, screenshots, or docs to start the hub.";
    }
  } catch (error) {
    feedback.value = error instanceof Error ? error.message : "Unable to load workspace assets.";
  } finally {
    isLoading.value = false;
  }
}

async function loadMediaIntelligence(): Promise<void> {
  if (!isReady.value || !activeBusinessId.value) {
    return;
  }

  try {
    const response = await requestWorkspaceMediaIntelligence(activeBusinessId.value);
    mediaProfile.value = response.profile;
    mediaPresets.value = response.presets;
    promptTemplates.value = response.promptTemplates;
    decisionRules.value = response.decisionRules;
    optimizationSummaries.value = response.optimizationSummaries;
    presetTemplateSelections.value = Object.fromEntries(
      response.presets.map((preset) => [preset.id, preset.customPromptTemplateId || ""]),
    );
    await loadResolutionPreview();
  } catch (error) {
    mediaIntelligenceFeedback.value =
      error instanceof Error ? error.message : "Unable to load media intelligence settings.";
  }
}

async function loadResolutionPreview(): Promise<void> {
  if (!isReady.value || !activeBusinessId.value) {
    resolutionPreview.value = null;
    return;
  }

  isLoadingResolution.value = true;

  try {
    resolutionPreview.value = await requestWorkspaceMediaResolution({
      businessId: activeBusinessId.value,
      contentType: resolutionContentType.value,
      goal: resolutionGoal.value,
      hasUploadedAssets: hasUploadedAssetsOverride.value,
    });
  } catch (error) {
    mediaIntelligenceFeedback.value =
      error instanceof Error ? error.message : "Unable to resolve workspace media configuration.";
  } finally {
    isLoadingResolution.value = false;
  }
}

async function handleAssetUpload(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement | null;
  const files = Array.from(input?.files ?? []);

  if (!files.length || !activeBusinessId.value) {
    return;
  }

  isUploading.value = true;
  feedback.value = "";

  try {
    for (const file of files) {
      const assetType: WorkspaceAssetType = file.type === "application/pdf"
        ? "document"
        : file.type === "video/mp4"
          ? "video"
        : file.type.includes("svg")
          ? "logo"
          : "image";
      const uploadTarget = await requestWorkspaceAssetUploadUrl({
        businessId: activeBusinessId.value,
        fileType: file.type,
        fileName: file.name,
        sizeBytes: file.size,
        assetType,
      });

      const uploadResponse = await fetch(uploadTarget.uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": file.type,
        },
        body: file,
      });

      if (!uploadResponse.ok) {
        throw new Error("Asset upload failed. Check storage configuration and try again.");
      }

      await requestCreateWorkspaceAsset({
        businessId: activeBusinessId.value,
        storageKey: uploadTarget.storageKey,
        storageUrl: uploadTarget.storageUrl,
        mimeType: file.type,
        sizeBytes: file.size,
        title: file.name.replace(/\.[a-z0-9]+$/i, ""),
        assetType,
        sourceType: "upload",
      });
    }

    await loadAssets();
    feedback.value = `${files.length} asset${files.length === 1 ? "" : "s"} added to the workspace hub.`;
  } catch (error) {
    feedback.value = error instanceof Error ? error.message : "Unable to upload workspace assets.";
  } finally {
    isUploading.value = false;
    if (input) {
      input.value = "";
    }
  }
}

async function archiveAsset(assetId: string): Promise<void> {
  if (!activeBusinessId.value) {
    return;
  }

  deletingAssetId.value = assetId;
  feedback.value = "";

  try {
    await requestDeleteWorkspaceAsset(activeBusinessId.value, assetId);
    await loadAssets();
    feedback.value = "Asset archived from the hub.";
  } catch (error) {
    feedback.value = error instanceof Error ? error.message : "Unable to archive this asset.";
  } finally {
    deletingAssetId.value = "";
  }
}

async function downloadAsset(asset: WorkspaceAsset): Promise<void> {
  if (!activeBusinessId.value || typeof window === "undefined") {
    return;
  }

  feedback.value = "";

  try {
    const response = await requestWorkspaceAssetDownload(activeBusinessId.value, asset.id);
    window.open(response.downloadUrl, "_blank", "noopener,noreferrer");
  } catch (error) {
    feedback.value = error instanceof Error ? error.message : "Unable to prepare asset download.";
  }
}

function canUseAssetAsWorkspaceLogo(asset: WorkspaceAsset): boolean {
  return asset.mimeType.startsWith("image/");
}

function isCurrentWorkspaceLogo(asset: WorkspaceAsset): boolean {
  return currentWorkspaceLogoAssetId.value === asset.id;
}

async function setWorkspaceLogo(asset: WorkspaceAsset): Promise<void> {
  if (!activeBusinessId.value) {
    return;
  }

  const logoUrl = asset.storageUrl?.trim() || asset.previewUrl?.trim();

  if (!logoUrl) {
    feedback.value = "This asset does not have a usable image URL for the workspace logo.";
    return;
  }

  savingBrandLogoAssetId.value = asset.id;
  feedback.value = "";

  try {
    await requestUpdateBrandKit({
      businessId: activeBusinessId.value,
      brandKit: {
        logoUrl,
      },
    });
    await requestRecordWorkspaceAssetUsage(asset.id, {
      businessId: activeBusinessId.value,
      usageSurface: "brand_kit",
      metadata: {
        slot: "logo",
      },
    }).catch(() => undefined);
    await loadAssets();
    feedback.value = `${asset.title || "Selected asset"} is now the workspace logo. Email signatures and generated visuals will reuse it.`;
  } catch (error) {
    feedback.value = error instanceof Error ? error.message : "Unable to update the workspace logo.";
  } finally {
    savingBrandLogoAssetId.value = "";
  }
}

async function clearWorkspaceLogo(): Promise<void> {
  if (!activeBusinessId.value || !brandKit.value?.logoUrl) {
    return;
  }

  savingBrandLogoAssetId.value = "__clear__";
  feedback.value = "";

  try {
    await requestUpdateBrandKit({
      businessId: activeBusinessId.value,
      brandKit: {
        logoUrl: "",
      },
    });
    await loadAssets();
    feedback.value = "Workspace logo removed. Generated visuals and email signatures will stop reusing it until a new logo is selected.";
  } catch (error) {
    feedback.value = error instanceof Error ? error.message : "Unable to remove the workspace logo.";
  } finally {
    savingBrandLogoAssetId.value = "";
  }
}

async function saveMediaProfile(): Promise<void> {
  if (!activeBusinessId.value || !mediaProfile.value) {
    return;
  }

  isSavingMediaProfile.value = true;
  mediaIntelligenceFeedback.value = "";

  try {
    const response = await requestUpdateBusinessMediaProfile({
      businessId: activeBusinessId.value,
      businessType: mediaProfile.value.businessType,
      preferExistingAssets: mediaProfile.value.preferExistingAssets,
      preferTextVisuals: mediaProfile.value.preferTextVisuals,
      allowGeneratedIllustrations: mediaProfile.value.allowGeneratedIllustrations,
      avoidRealisticPeople: mediaProfile.value.avoidRealisticPeople,
      allowScreenshotHighlights: mediaProfile.value.allowScreenshotHighlights,
    });

    mediaProfile.value = response.profile;
    mediaIntelligenceFeedback.value = "Media profile updated.";
    await loadResolutionPreview();
  } catch (error) {
    mediaIntelligenceFeedback.value =
      error instanceof Error ? error.message : "Unable to update media profile.";
  } finally {
    isSavingMediaProfile.value = false;
  }
}

async function togglePresetOverride(preset: MediaPresetSummary): Promise<void> {
  if (!activeBusinessId.value) {
    return;
  }

  togglingPresetId.value = preset.id;
  mediaIntelligenceFeedback.value = "";

  try {
    const response = await requestUpdateWorkspaceMediaOverride({
      businessId: activeBusinessId.value,
      mediaPresetId: preset.id,
      isEnabled: !preset.isEnabledForWorkspace,
      customPromptTemplateId: preset.customPromptTemplateId,
      customSettings: preset.customSettings,
    });

    mediaPresets.value = mediaPresets.value.map((candidate) =>
      candidate.id === response.preset.id ? response.preset : candidate,
    );
    presetTemplateSelections.value = {
      ...presetTemplateSelections.value,
      [response.preset.id]: response.preset.customPromptTemplateId || "",
    };
    mediaIntelligenceFeedback.value = `${response.preset.name} ${response.preset.isEnabledForWorkspace ? "enabled" : "disabled"} for this workspace.`;
    await loadResolutionPreview();
  } catch (error) {
    mediaIntelligenceFeedback.value =
      error instanceof Error ? error.message : "Unable to update preset override.";
  } finally {
    togglingPresetId.value = "";
  }
}

async function savePresetPromptOverride(
  preset: MediaPresetSummary,
  customPromptTemplateId: string,
): Promise<void> {
  if (!activeBusinessId.value) {
    return;
  }

  savingPromptOverridePresetId.value = preset.id;
  mediaIntelligenceFeedback.value = "";

  try {
    const response = await requestUpdateWorkspaceMediaOverride({
      businessId: activeBusinessId.value,
      mediaPresetId: preset.id,
      isEnabled: preset.isEnabledForWorkspace,
      customPromptTemplateId: customPromptTemplateId || undefined,
      customSettings: preset.customSettings,
    });

    mediaPresets.value = mediaPresets.value.map((candidate) =>
      candidate.id === response.preset.id ? response.preset : candidate,
    );
    presetTemplateSelections.value = {
      ...presetTemplateSelections.value,
      [response.preset.id]: response.preset.customPromptTemplateId || "",
    };
    mediaIntelligenceFeedback.value = customPromptTemplateId
      ? `Prompt override saved for ${response.preset.name}.`
      : `Prompt override cleared for ${response.preset.name}.`;
    await loadResolutionPreview();
  } catch (error) {
    mediaIntelligenceFeedback.value =
      error instanceof Error ? error.message : "Unable to update prompt override.";
  } finally {
    savingPromptOverridePresetId.value = "";
  }
}

function handlePresetTemplateSelection(preset: MediaPresetSummary, event: Event): void {
  const target = event.target as HTMLSelectElement | null;
  void savePresetPromptOverride(preset, target?.value || "");
}

function humanizePreferredAction(value: string | undefined): string {
  if (!value) {
    return "Balanced";
  }

  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (segment) => segment.toUpperCase());
}

function humanizeRuleScope(value: DecisionRuleSummary["ruleScope"]): string {
  switch (value) {
    case "business_type":
      return "Business type";
    case "workspace":
      return "Workspace";
    default:
      return "Global";
  }
}

function humanizeMediaType(value: string | undefined): string {
  if (!value) {
    return "No signal yet";
  }

  return value.replace(/_/g, " ");
}

function formatScore(value: number | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "No score yet";
  }

  return `${Math.round(value * 100)} / 100`;
}

function humanizeConfidenceBand(value: string | undefined): string {
  if (!value) {
    return "Low";
  }

  return value.charAt(0).toUpperCase() + value.slice(1);
}

watch(
  () => [isReady.value, activeBusinessId.value, selectedType.value, selectedSource.value] as const,
  () => {
    void loadAssets();
  },
  { immediate: true },
);

watch(
  () => [isReady.value, activeBusinessId.value] as const,
  () => {
    void loadMediaIntelligence();
  },
  { immediate: true },
);

watch(
  () => [isReady.value, activeBusinessId.value, resolutionContentType.value, resolutionGoal.value, hasUploadedAssetsMode.value] as const,
  () => {
    void loadResolutionPreview();
  },
  { immediate: true },
);
</script>

<template>
  <section class="assets-page">
    <header class="assets-header workspace-card">
      <div>
        <p class="page-eyebrow">Workspace asset hub</p>
        <h1>Assets</h1>
        <p>
          Keep logos, screenshots, and reusable media in one place so posts, email, and visual
          generation all pull from the same library.
        </p>
      </div>

      <label class="assets-upload-button">
        <input
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml,video/mp4,application/pdf"
          multiple
          :disabled="isUploading"
          @change="void handleAssetUpload($event)"
        />
        {{ isUploading ? "Uploading..." : "Upload assets" }}
      </label>
    </header>

    <section class="assets-stats">
      <article class="stat-card">
        <span>Total assets</span>
        <strong>{{ assets.length }}</strong>
      </article>
      <article class="stat-card">
        <span>Images</span>
        <strong>{{ imageCount }}</strong>
      </article>
      <article class="stat-card">
        <span>Logos</span>
        <strong>{{ logoCount }}</strong>
      </article>
      <article class="stat-card">
        <span>Videos</span>
        <strong>{{ videoCount }}</strong>
      </article>
      <article class="stat-card">
        <span>Documents</span>
        <strong>{{ documentCount }}</strong>
      </article>
      <article class="stat-card">
        <span>Total reuse</span>
        <strong>{{ totalUsageCount }}</strong>
      </article>
    </section>

    <section class="assets-toolbar workspace-card">
      <label>
        <span>Search</span>
        <input v-model="search" type="search" placeholder="Search titles, sources, or tags" @input="void loadAssets()" />
      </label>

      <label>
        <span>Type</span>
        <select v-model="selectedType">
          <option value="all">All assets</option>
          <option value="image">Images</option>
          <option value="video">Videos</option>
          <option value="logo">Logos</option>
          <option value="document">Documents</option>
          <option value="screenshot">Screenshots</option>
        </select>
      </label>

      <label>
        <span>Source</span>
        <select v-model="selectedSource">
          <option value="all">All sources</option>
          <option value="upload">Uploads</option>
          <option value="post_asset">Posts</option>
          <option value="brand_kit">Brand kit</option>
          <option value="generated">Generated</option>
        </select>
      </label>
    </section>

    <section v-if="brandKit" class="workspace-card brand-kit-summary">
      <div class="brand-kit-copy">
        <p class="page-eyebrow">Workspace brand kit</p>
        <h2>Colors and logo stay connected to the asset hub</h2>
        <p>Visual generation can reuse the same identity without asking users to upload the same logo again.</p>
        <p class="panel-note brand-kit-note">
          Upload a logo into Assets, then click <strong>Set as workspace logo</strong>. The same logo will be reused in
          image generation, email signatures, and future brand surfaces.
        </p>
        <div class="brand-kit-actions">
          <button
            v-if="brandKit.logoUrl"
            type="button"
            class="asset-link"
            :disabled="savingBrandLogoAssetId === '__clear__'"
            @click="void clearWorkspaceLogo()"
          >
            {{ savingBrandLogoAssetId === "__clear__" ? "Removing..." : "Remove workspace logo" }}
          </button>
        </div>
      </div>
      <div class="brand-kit-swatches">
        <div class="swatch-card">
          <span>Primary</span>
          <div class="swatch-chip" :style="{ background: brandKit.primaryColor }"></div>
          <strong>{{ brandKit.primaryColor }}</strong>
        </div>
        <div class="swatch-card">
          <span>Secondary</span>
          <div class="swatch-chip" :style="{ background: brandKit.secondaryColor }"></div>
          <strong>{{ brandKit.secondaryColor }}</strong>
        </div>
        <div class="swatch-card logo-card">
          <span>Logo asset</span>
          <img v-if="brandKit.logoUrl" :src="brandKit.logoUrl" alt="Workspace logo" />
          <strong>{{ brandKit.logoAssetId ? "Connected across the workspace" : "Not set" }}</strong>
        </div>
      </div>
    </section>

    <section v-if="mediaProfile" class="workspace-card media-intelligence-panel">
      <div class="media-panel-copy">
        <div>
          <p class="page-eyebrow">Media intelligence</p>
          <h2>Guide visual decisions without opening unsafe or off-brand paths</h2>
          <p>
            These rules shape recommendation trays across post and email flows. The hard safety
            guardrails stay enforced in the backend.
          </p>
        </div>
        <div class="media-intelligence-summary">
          <span class="workspace-chip">{{ preferredMediaMode }}</span>
          <span class="workspace-chip">{{ enabledPresetCount }} preset{{ enabledPresetCount === 1 ? "" : "s" }} active</span>
          <span class="workspace-chip">{{ activeRuleCount }} rule{{ activeRuleCount === 1 ? "" : "s" }} loaded</span>
        </div>
      </div>

      <div class="media-profile-grid">
        <label class="media-profile-field">
          <span>Business type</span>
          <select v-model="mediaProfile.businessType">
            <option v-for="option in BUSINESS_TYPE_OPTIONS" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
        </label>

        <label class="media-toggle-card">
          <input v-model="mediaProfile.preferExistingAssets" type="checkbox" />
          <div>
            <strong>Prefer existing assets</strong>
            <p>Recommend reusable screenshots, logos, and uploads before generating something new.</p>
          </div>
        </label>

        <label class="media-toggle-card">
          <input v-model="mediaProfile.preferTextVisuals" type="checkbox" />
          <div>
            <strong>Prefer text visuals</strong>
            <p>Push quote, stat, and framework cards above heavier visual formats.</p>
          </div>
        </label>

        <label class="media-toggle-card">
          <input v-model="mediaProfile.allowGeneratedIllustrations" type="checkbox" />
          <div>
            <strong>Allow generated illustrations</strong>
            <p>Enable safe generated card styles. Human-photo overlays still stay constrained by profile safety.</p>
          </div>
        </label>

        <label class="media-toggle-card">
          <input v-model="mediaProfile.avoidRealisticPeople" type="checkbox" />
          <div>
            <strong>Avoid realistic people</strong>
            <p>Hardens recommendations toward safer brand graphics and away from human-photo styles.</p>
          </div>
        </label>

        <label class="media-toggle-card">
          <input v-model="mediaProfile.allowScreenshotHighlights" type="checkbox" />
          <div>
            <strong>Allow screenshot highlights</strong>
            <p>Permit screenshot-led visuals when the workspace has UI or dashboard captures worth surfacing.</p>
          </div>
        </label>
      </div>

      <div class="media-panel-actions">
        <button type="button" class="assets-upload-button save-button" :disabled="isSavingMediaProfile" @click="void saveMediaProfile()">
          {{ isSavingMediaProfile ? "Saving..." : "Save media rules" }}
        </button>
        <p class="panel-note">Hardcoded safety guardrails still block unsafe categories and copyrighted scraping.</p>
      </div>

      <p v-if="mediaIntelligenceFeedback" class="assets-feedback">{{ mediaIntelligenceFeedback }}</p>
    </section>

    <section v-if="mediaProfile" class="workspace-card media-resolution-panel">
      <div class="panel-header">
        <div>
          <p class="page-eyebrow">Resolution preview</p>
          <h2>See what the engine will choose before generation happens</h2>
          <p>Preview the resolved preset, rule matches, and prompt mapping for the current workspace context.</p>
        </div>
        <span class="workspace-chip">
          {{ isLoadingResolution ? "Resolving..." : resolutionPreview?.selectedPreset?.uiLabel || "Live preview" }}
        </span>
      </div>

      <div class="resolution-toolbar">
        <label class="media-profile-field">
          <span>Content type</span>
          <select v-model="resolutionContentType">
            <option value="post">Post</option>
            <option value="email">Email</option>
          </select>
        </label>
        <label class="media-profile-field">
          <span>Goal</span>
          <select v-model="resolutionGoal">
            <option value="authority">Authority</option>
            <option value="engagement">Engagement</option>
            <option value="conversion">Conversion</option>
          </select>
        </label>
        <label class="media-profile-field">
          <span>Asset context</span>
          <select v-model="hasUploadedAssetsMode">
            <option value="auto">Auto-detect</option>
            <option value="yes">Simulate assets available</option>
            <option value="no">Simulate no assets</option>
          </select>
        </label>
      </div>

      <div v-if="resolutionPreview" class="resolution-summary-grid">
        <article
          v-for="card in resolutionSummaryCards"
          :key="card.label"
          class="resolution-summary-card"
        >
          <span>{{ card.label }}</span>
          <strong>{{ card.value }}</strong>
        </article>
      </div>

      <div v-if="resolutionPreview" class="resolution-detail-grid">
        <article class="resolution-detail-card">
          <p class="page-eyebrow">Media order</p>
          <div class="asset-tags">
            <span v-for="mediaType in resolutionPreview.orderedMediaTypes" :key="mediaType">
              {{ mediaType.replace(/_/g, " ") }}
            </span>
          </div>
          <p v-if="resolutionPreview.disallowedMediaTypes.length > 0" class="panel-note">
            Disallowed: {{ resolutionPreview.disallowedMediaTypes.map((value) => value.replace(/_/g, " ")).join(", ") }}
          </p>
        </article>

        <article class="resolution-detail-card">
          <p class="page-eyebrow">Matched rules</p>
          <div v-if="resolutionPreview.matchedRules.length > 0" class="resolution-rule-list">
            <div v-for="rule in resolutionPreview.matchedRules" :key="rule.id" class="resolution-rule-card">
              <strong>{{ rule.ruleName }}</strong>
              <span>{{ humanizeRuleScope(rule.ruleScope) }} · Priority {{ rule.priority }}</span>
            </div>
          </div>
          <p v-else class="panel-note">No extra rule match for this context.</p>
        </article>

        <article class="resolution-detail-card">
          <p class="page-eyebrow">Prompt mapping</p>
          <div v-if="resolutionPreview.promptSelections.length > 0" class="resolution-template-list">
            <div
              v-for="selection in resolutionPreview.promptSelections"
              :key="selection.mediaType"
              class="resolution-template-card"
            >
              <strong>{{ selection.mediaType.replace(/_/g, " ") }}</strong>
              <span>{{ selection.promptTemplateName || "No template mapped" }}</span>
              <small>{{ selection.source === "workspace_override" ? "Workspace override" : "Preset default" }}</small>
            </div>
          </div>
        </article>

        <article class="resolution-detail-card">
          <p class="page-eyebrow">Performance optimization</p>
          <div v-if="resolutionPreview.selectedPresetPerformance" class="performance-summary-card">
            <strong>
              {{ resolutionPreview.selectedPresetPerformance.mediaPresetName || resolutionPreview.selectedPreset?.name || "Selected preset" }}
            </strong>
            <span>
              Weight {{ resolutionPreview.selectedPresetPerformance.performanceWeight.toFixed(1) }}
              · Score {{ formatScore(resolutionPreview.selectedPresetPerformance.avgScore) }}
            </span>
            <small>
              {{ humanizeConfidenceBand(resolutionPreview.selectedPresetPerformance.confidenceBand) }}
              confidence · {{ resolutionPreview.selectedPresetPerformance.impressions }} impressions
            </small>
          </div>
          <p v-else class="panel-note">No preset-level performance signal for this surface yet.</p>

          <div
            v-if="resolutionPreview.boostedMediaTypes.length > 0 || resolutionPreview.deprioritizedMediaTypes.length > 0"
            class="performance-chip-groups"
          >
            <div v-if="resolutionPreview.boostedMediaTypes.length > 0" class="performance-chip-group">
              <span class="performance-chip-label">Boosted</span>
              <div class="asset-tags">
                <span v-for="mediaType in resolutionPreview.boostedMediaTypes" :key="`boosted-${mediaType}`">
                  {{ humanizeMediaType(mediaType) }}
                </span>
              </div>
            </div>
            <div v-if="resolutionPreview.deprioritizedMediaTypes.length > 0" class="performance-chip-group">
              <span class="performance-chip-label">Deprioritized</span>
              <div class="asset-tags">
                <span v-for="mediaType in resolutionPreview.deprioritizedMediaTypes" :key="`deprioritized-${mediaType}`">
                  {{ humanizeMediaType(mediaType) }}
                </span>
              </div>
            </div>
          </div>

          <div v-if="activeOptimizationSummary" class="optimization-snapshot">
            <div class="optimization-stat">
              <span>Best preset</span>
              <strong>{{ activeOptimizationSummary.topPreset?.mediaPresetName || "No winner yet" }}</strong>
            </div>
            <div class="optimization-stat">
              <span>Best media type</span>
              <strong>{{ humanizeMediaType(activeOptimizationSummary.topMediaType?.mediaType) }}</strong>
            </div>
            <div class="optimization-stat">
              <span>Weak signal</span>
              <strong>
                {{
                  activeOptimizationSummary.weakMediaTypes[0]
                    ? humanizeMediaType(activeOptimizationSummary.weakMediaTypes[0].mediaType)
                    : "Nothing flagged"
                }}
              </strong>
            </div>
          </div>
        </article>
      </div>
    </section>

    <section v-if="mediaPresets.length > 0" class="workspace-card media-preset-panel">
      <div class="panel-header">
        <div>
          <p class="page-eyebrow">Preset overrides</p>
          <h2>Control which media modes this workspace can use</h2>
        </div>
      </div>

      <div class="preset-grid">
        <article v-for="preset in mediaPresets" :key="preset.id" class="preset-card">
          <div class="preset-card-topline">
            <span>{{ preset.uiLabel || preset.name }}</span>
            <span>{{ preset.priority }}</span>
          </div>
          <h3>{{ preset.name }}</h3>
          <p>{{ preset.description || "No extra description for this preset yet." }}</p>
          <div class="asset-tags">
            <span v-for="mediaType in preset.mediaTypes" :key="`${preset.id}-${mediaType}`">{{ mediaType.replace(/_/g, " ") }}</span>
          </div>
          <label class="preset-template-field">
            <span>Prompt template</span>
            <select
              :value="presetTemplateSelections[preset.id] ?? ''"
              :disabled="savingPromptOverridePresetId === preset.id"
              @change="handlePresetTemplateSelection(preset, $event)"
            >
              <option value="">Use preset default</option>
              <option
                v-for="template in mediaPromptTemplates"
                :key="`${preset.id}-${template.id}`"
                :value="template.id"
              >
                {{ template.name }}
              </option>
            </select>
            <small>
              {{
                preset.customPromptTemplateId
                  ? "Workspace override active"
                  : "Following the preset default mapping"
              }}
            </small>
          </label>
          <button
            type="button"
            class="asset-remove preset-toggle"
            :class="{ active: preset.isEnabledForWorkspace }"
            :disabled="togglingPresetId === preset.id"
            @click="void togglePresetOverride(preset)"
          >
            {{
              togglingPresetId === preset.id
                ? "Updating..."
                : preset.isEnabledForWorkspace
                  ? "Disable for workspace"
                  : "Enable for workspace"
            }}
          </button>
        </article>
      </div>
    </section>

    <p v-if="feedback" class="assets-feedback workspace-card">{{ feedback }}</p>
    <p v-else-if="isLoading" class="assets-feedback workspace-card">Loading workspace assets...</p>

    <section v-if="filteredAssets.length > 0" class="asset-grid">
      <article v-for="asset in filteredAssets" :key="asset.id" class="workspace-card asset-card">
        <video
          v-if="asset.previewUrl && asset.mimeType.startsWith('video/')"
          :src="asset.previewUrl"
          class="asset-preview"
          controls
          muted
          playsinline
          preload="metadata"
        />
        <img
          v-else-if="asset.previewUrl && asset.mimeType.startsWith('image/')"
          :src="asset.previewUrl"
          :alt="asset.title || asset.assetType"
          class="asset-preview"
        />
        <div v-else class="asset-preview placeholder">
          {{ asset.assetType.toUpperCase() }}
        </div>

        <div class="asset-card-copy">
          <div class="asset-card-topline">
            <span>{{ asset.assetType }}</span>
            <span>{{ asset.sourceType }}</span>
          </div>
          <h3>{{ asset.title || "Untitled asset" }}</h3>
          <p>{{ asset.mimeType }} · {{ Math.max(1, Math.round(asset.sizeBytes / 1024)) }} KB</p>
          <div class="asset-tags">
            <span>{{ asset.usageCount }} uses</span>
            <span v-if="asset.sourceReferenceId">linked</span>
            <span v-if="isCurrentWorkspaceLogo(asset)">workspace logo</span>
          </div>
        </div>

        <div class="asset-card-actions">
          <button
            v-if="canUseAssetAsWorkspaceLogo(asset)"
            type="button"
            class="asset-link asset-brand-logo-action"
            :class="{ active: isCurrentWorkspaceLogo(asset) }"
            :disabled="Boolean(savingBrandLogoAssetId) || isCurrentWorkspaceLogo(asset)"
            @click="void setWorkspaceLogo(asset)"
          >
            {{
              isCurrentWorkspaceLogo(asset)
                ? "Current logo"
                : savingBrandLogoAssetId === asset.id
                  ? "Saving..."
                  : "Set as workspace logo"
            }}
          </button>
          <a
            class="asset-link"
            :href="asset.previewUrl || asset.storageUrl"
            target="_blank"
            rel="noreferrer"
          >
            Open
          </a>
          <button
            type="button"
            class="asset-link asset-download"
            @click="void downloadAsset(asset)"
          >
            Download
          </button>
          <button
            type="button"
            class="asset-remove"
            :disabled="deletingAssetId === asset.id || isCurrentWorkspaceLogo(asset)"
            :title="isCurrentWorkspaceLogo(asset) ? 'Remove or replace the workspace logo before archiving this asset.' : undefined"
            @click="void archiveAsset(asset.id)"
          >
            {{
              isCurrentWorkspaceLogo(asset)
                ? "In use as logo"
                : deletingAssetId === asset.id
                  ? "Archiving..."
                  : "Archive"
            }}
          </button>
        </div>
      </article>
    </section>
  </section>
</template>

<style scoped>
.assets-page {
  display: grid;
  gap: 1.25rem;
}

.workspace-card {
  padding: 1.5rem;
  border: 1px solid rgba(214, 136, 64, 0.14);
  border-radius: 28px;
  background: rgba(255, 250, 245, 0.94);
  box-shadow: 0 20px 48px rgba(15, 23, 42, 0.08);
}

.assets-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}

.page-eyebrow {
  margin: 0 0 0.35rem;
  font-size: 0.82rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgba(83, 52, 36, 0.72);
}

.assets-header h1,
.brand-kit-summary h2,
.media-intelligence-panel h2,
.media-preset-panel h2 {
  margin: 0;
  font-size: clamp(2rem, 4vw, 3rem);
}

.assets-header p,
.brand-kit-summary p,
.media-intelligence-panel p,
.media-preset-panel p {
  margin: 0.5rem 0 0;
  max-width: 56rem;
  color: rgba(83, 52, 36, 0.74);
}

.assets-upload-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 180px;
  border-radius: 999px;
  background: #db6b2d;
  color: #fffaf5;
  padding: 0.95rem 1.4rem;
  font-weight: 700;
  box-shadow: 0 18px 34px rgba(219, 107, 45, 0.24);
  cursor: pointer;
}

.assets-upload-button input {
  display: none;
}

.assets-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 1rem;
}

.stat-card {
  padding: 1rem 1.15rem;
  border-radius: 22px;
  background: rgba(255, 250, 245, 0.94);
  border: 1px solid rgba(214, 136, 64, 0.12);
  box-shadow: 0 16px 34px rgba(15, 23, 42, 0.06);
}

.stat-card span {
  display: block;
  font-size: 0.85rem;
  color: rgba(83, 52, 36, 0.68);
}

.stat-card strong {
  display: block;
  margin-top: 0.4rem;
  font-size: 1.9rem;
}

.assets-toolbar {
  display: grid;
  grid-template-columns: minmax(0, 1.5fr) repeat(2, minmax(180px, 220px));
  gap: 1rem;
}

.assets-toolbar label {
  display: grid;
  gap: 0.45rem;
  font-weight: 600;
}

.assets-toolbar span {
  font-size: 0.92rem;
  color: rgba(83, 52, 36, 0.74);
}

.assets-toolbar input,
.assets-toolbar select {
  width: 100%;
  border: 1px solid rgba(214, 136, 64, 0.18);
  border-radius: 16px;
  padding: 0.95rem 1rem;
  font: inherit;
  background: #ffffff;
}

.brand-kit-summary {
  display: grid;
  gap: 1.25rem;
}

.brand-kit-note {
  max-width: 44rem;
}

.brand-kit-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-top: 0.25rem;
}

.media-intelligence-panel,
.media-resolution-panel,
.media-preset-panel {
  display: grid;
  gap: 1.25rem;
}

.media-panel-copy,
.panel-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}

.media-intelligence-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.workspace-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.45rem 0.8rem;
  border-radius: 999px;
  background: rgba(249, 237, 227, 0.88);
  color: rgba(83, 52, 36, 0.8);
  font-size: 0.82rem;
  font-weight: 700;
}

.media-profile-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 1rem;
}

.media-profile-field {
  display: grid;
  gap: 0.45rem;
  font-weight: 600;
}

.media-profile-field span,
.panel-note {
  color: rgba(83, 52, 36, 0.74);
}

.media-profile-field select {
  width: 100%;
  border: 1px solid rgba(214, 136, 64, 0.18);
  border-radius: 16px;
  padding: 0.95rem 1rem;
  font: inherit;
  background: #ffffff;
}

.media-toggle-card {
  display: flex;
  align-items: flex-start;
  gap: 0.85rem;
  padding: 1rem;
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid rgba(214, 136, 64, 0.12);
}

.media-toggle-card input {
  margin-top: 0.2rem;
}

.media-toggle-card strong,
.preset-card h3 {
  display: block;
  margin: 0;
}

.media-toggle-card p,
.preset-card p {
  margin: 0.35rem 0 0;
}

.media-panel-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.resolution-toolbar {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1rem;
}

.resolution-summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 1rem;
}

.resolution-summary-card,
.resolution-detail-card {
  padding: 1rem;
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid rgba(214, 136, 64, 0.12);
  display: grid;
  gap: 0.55rem;
}

.resolution-summary-card span {
  font-size: 0.85rem;
  color: rgba(83, 52, 36, 0.68);
}

.resolution-summary-card strong {
  font-size: 1.05rem;
}

.resolution-detail-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 1rem;
}

.resolution-rule-list,
.resolution-template-list,
.performance-chip-groups,
.optimization-snapshot {
  display: grid;
  gap: 0.75rem;
}

.resolution-rule-card,
.resolution-template-card,
.performance-summary-card,
.optimization-stat {
  display: grid;
  gap: 0.25rem;
  padding: 0.85rem 0.95rem;
  border-radius: 16px;
  background: rgba(255, 250, 245, 0.92);
  border: 1px solid rgba(214, 136, 64, 0.12);
}

.resolution-rule-card span,
.resolution-template-card span,
.resolution-template-card small,
.performance-summary-card span,
.performance-summary-card small,
.optimization-stat span {
  color: rgba(83, 52, 36, 0.68);
}

.performance-chip-group {
  display: grid;
  gap: 0.4rem;
}

.performance-chip-label {
  font-size: 0.82rem;
  font-weight: 700;
  color: rgba(83, 52, 36, 0.68);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.save-button {
  min-width: 220px;
}

.preset-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 1rem;
}

.preset-card {
  padding: 1rem;
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid rgba(214, 136, 64, 0.12);
  display: grid;
  gap: 0.75rem;
}

.preset-template-field {
  display: grid;
  gap: 0.4rem;
}

.preset-template-field span,
.preset-template-field small {
  color: rgba(83, 52, 36, 0.68);
}

.preset-template-field select {
  width: 100%;
  border: 1px solid rgba(214, 136, 64, 0.18);
  border-radius: 14px;
  padding: 0.8rem 0.9rem;
  font: inherit;
  background: #ffffff;
}

.preset-card-topline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  color: rgba(83, 52, 36, 0.66);
  font-size: 0.82rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.preset-toggle.active {
  background: #db6b2d;
  border-color: #db6b2d;
  color: #fffaf5;
}

.brand-kit-swatches {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 1rem;
}

.swatch-card {
  padding: 1rem;
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid rgba(214, 136, 64, 0.12);
  display: grid;
  gap: 0.65rem;
}

.swatch-card span {
  font-size: 0.85rem;
  color: rgba(83, 52, 36, 0.66);
}

.swatch-chip {
  width: 100%;
  height: 56px;
  border-radius: 16px;
  border: 1px solid rgba(15, 23, 42, 0.08);
}

.logo-card img {
  width: 100%;
  max-height: 72px;
  object-fit: contain;
  border-radius: 16px;
  background: linear-gradient(135deg, rgba(255, 239, 227, 0.9), rgba(247, 227, 213, 0.96));
  padding: 0.85rem;
}

.assets-feedback {
  margin: 0;
  color: rgba(83, 52, 36, 0.74);
}

.asset-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 1rem;
  align-items: start;
}

.asset-card {
  display: grid;
  gap: 0.95rem;
  min-width: 0;
  overflow: hidden;
}

.asset-preview {
  width: 100%;
  aspect-ratio: 1 / 1;
  border-radius: 20px;
  object-fit: cover;
  background: linear-gradient(135deg, rgba(255, 239, 227, 0.9), rgba(247, 227, 213, 0.96));
}

.asset-preview.placeholder {
  display: grid;
  place-items: center;
  font-size: 0.8rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  color: rgba(83, 52, 36, 0.66);
}

.asset-card-copy {
  display: grid;
  gap: 0.4rem;
  min-width: 0;
}

.asset-card-topline,
.asset-tags,
.asset-card-copy p {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  margin: 0;
  color: rgba(83, 52, 36, 0.68);
  min-width: 0;
}

.asset-card-topline span,
.asset-tags span {
  padding: 0.3rem 0.55rem;
  border-radius: 999px;
  background: rgba(249, 237, 227, 0.88);
  font-size: 0.82rem;
  max-width: 100%;
  overflow-wrap: anywhere;
}

.asset-card-copy h3 {
  margin: 0;
  font-size: 1.05rem;
  min-width: 0;
  overflow-wrap: anywhere;
}

.asset-card-actions {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
  gap: 0.75rem;
  align-items: stretch;
}

.asset-link,
.asset-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-width: 0;
  border: 1px solid rgba(214, 136, 64, 0.18);
  border-radius: 999px;
  background: #ffffff;
  padding: 0.75rem 1rem;
  font: inherit;
  color: #2b1d16;
  text-decoration: none;
  cursor: pointer;
  text-align: center;
  overflow-wrap: anywhere;
}

.asset-brand-logo-action.active {
  background: rgba(219, 107, 45, 0.12);
  border-color: rgba(219, 107, 45, 0.3);
  color: #8d4218;
}

@media (max-width: 900px) {
  .assets-header,
  .assets-toolbar,
  .media-panel-copy,
  .panel-header,
  .media-panel-actions {
    grid-template-columns: 1fr;
    display: grid;
  }

  .save-button {
    width: 100%;
  }
}
</style>
