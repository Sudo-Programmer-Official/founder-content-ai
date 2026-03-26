<script setup lang="ts">
import { provide, ref, watch } from "vue";
import type {
  MyFeaturesResponse,
  ProductFeatureKey,
  ProductFeatureMap,
} from "../../../packages/shared-types";
import { useAuthContext } from "../auth/auth-context";
import { requestProductAccessBootstrap } from "../services/product-access-service";
import { ProductAccessContextKey } from "./product-access-context";

const ACTIVE_BUSINESS_STORAGE_KEY = "founder-content-active-business-id";

const bootstrap = ref<MyFeaturesResponse | null>(null);
const activeBusinessId = ref("");
const isReady = ref(false);
const isLoading = ref(false);
const errorMessage = ref("");
const auth = useAuthContext();

function canUseBrowserStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function loadStoredBusinessId(): string {
  if (!canUseBrowserStorage()) {
    return "";
  }

  return window.localStorage.getItem(ACTIVE_BUSINESS_STORAGE_KEY)?.trim() ?? "";
}

function storeBusinessId(value: string): void {
  if (!canUseBrowserStorage()) {
    return;
  }

  if (!value) {
    window.localStorage.removeItem(ACTIVE_BUSINESS_STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(ACTIVE_BUSINESS_STORAGE_KEY, value);
}

function buildDisabledFeatureMap(): ProductFeatureMap {
  return {
    content_generation: false,
    capture_remix: false,
    visual_generation: false,
    scheduler: false,
    control_dashboard: false,
    brand_intelligence: false,
    outreach: false,
    email_campaigns: false,
    system_read_only: false,
  };
}

function buildAnonymousBootstrap(): MyFeaturesResponse {
  return {
    businessId: null,
    activeBusinessId: null,
    isPlatformAdmin: false,
    features: buildDisabledFeatureMap(),
  };
}

function isAuthFailure(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return /authentication is required|authorization: bearer/i.test(error.message);
}

async function refreshProductAccess(nextBusinessId?: string | null): Promise<MyFeaturesResponse | null> {
  if (!auth.isReady.value) {
    return bootstrap.value;
  }

  if (!auth.isAuthenticated.value) {
    bootstrap.value = buildAnonymousBootstrap();
    activeBusinessId.value = "";
    storeBusinessId("");
    errorMessage.value = "";
    isReady.value = true;
    return bootstrap.value;
  }

  isLoading.value = true;

  try {
    const response = await requestProductAccessBootstrap({
      businessId: nextBusinessId?.trim() || undefined,
    });
    bootstrap.value = response;
    activeBusinessId.value = response.activeBusinessId ?? "";
    storeBusinessId(activeBusinessId.value);
    errorMessage.value = "";
    return response;
  } catch (error) {
    bootstrap.value = buildAnonymousBootstrap();
    errorMessage.value =
      error instanceof Error && !isAuthFailure(error)
        ? error.message
        : "";
    return bootstrap.value;
  } finally {
    isLoading.value = false;
    isReady.value = true;
  }
}

async function setActiveBusinessId(nextBusinessId?: string | null): Promise<MyFeaturesResponse | null> {
  activeBusinessId.value = nextBusinessId?.trim() ?? "";
  storeBusinessId(activeBusinessId.value);
  return refreshProductAccess(activeBusinessId.value);
}

function isFeatureEnabled(featureKey: ProductFeatureKey, fallback = true): boolean {
  if (!bootstrap.value) {
    return fallback;
  }

  return bootstrap.value.features[featureKey];
}

provide(ProductAccessContextKey, {
  bootstrap,
  activeBusinessId,
  isReady,
  isLoading,
  errorMessage,
  refreshProductAccess,
  setActiveBusinessId,
  isFeatureEnabled,
});

activeBusinessId.value = loadStoredBusinessId();

watch(
  () => [auth.isReady.value, auth.sessionVersion.value] as const,
  async ([authIsReady]) => {
    if (!authIsReady) {
      return;
    }

    await refreshProductAccess(activeBusinessId.value);
  },
  { immediate: true },
);
</script>

<template>
  <slot />
</template>
