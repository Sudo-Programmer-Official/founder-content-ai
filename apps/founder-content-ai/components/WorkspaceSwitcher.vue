<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import type { BusinessMembership } from "../../../packages/shared-types";
import { useProductAccessContext } from "../access/product-access-context";
import { useAuthContext } from "../auth/auth-context";
import { requestMyBusinesses } from "../services/admin-analytics-service";
import { requestOnboardingWorkspace } from "../services/onboarding-service";

const route = useRoute();
const auth = useAuthContext();
const { bootstrap, activeBusinessId, setActiveBusinessId } = useProductAccessContext();

const rootElement = ref<HTMLElement | null>(null);
const isOpen = ref(false);
const isLoading = ref(false);
const isSwitching = ref(false);
const isCreating = ref(false);
const isCreateFormOpen = ref(false);
const workspaces = ref<BusinessMembership[]>([]);
const errorMessage = ref("");
const workspaceName = ref("");
const workspaceWebsiteUrl = ref("");

const resolvedBusinessId = computed(
  () => bootstrap.value?.activeBusinessId || activeBusinessId.value || "",
);

const currentWorkspace = computed(
  () =>
    workspaces.value.find(
      (membership) => membership.businessId === resolvedBusinessId.value,
    ) ?? null,
);

const currentWorkspaceLabel = computed(
  () =>
    currentWorkspace.value?.business.brandName ||
    currentWorkspace.value?.business.name ||
    "Select workspace",
);

const currentWorkspaceMeta = computed(() => {
  if (currentWorkspace.value) {
    return `${currentWorkspace.value.role} workspace`;
  }

  if (workspaces.value.length > 0) {
    return "Switch brand context across the app.";
  }

  return "Create your first workspace.";
});

const currentWorkspaceInitial = computed(
  () => currentWorkspaceLabel.value.trim().charAt(0).toUpperCase() || "W",
);

function formatWorkspaceLabel(membership: BusinessMembership): string {
  return membership.business.brandName || membership.business.name;
}

function resetCreateForm(): void {
  workspaceName.value = "";
  workspaceWebsiteUrl.value = "";
  isCreateFormOpen.value = false;
}

function closePanel(): void {
  isOpen.value = false;
  resetCreateForm();
  errorMessage.value = "";
}

async function loadWorkspaces(): Promise<void> {
  if (!auth.isAuthenticated.value) {
    workspaces.value = [];
    closePanel();
    return;
  }

  isLoading.value = true;

  try {
    const response = await requestMyBusinesses();
    workspaces.value = response.businesses;
    errorMessage.value = "";

    if (!resolvedBusinessId.value && response.businesses[0]?.businessId) {
      await setActiveBusinessId(response.businesses[0].businessId);
    }
  } catch (error) {
    workspaces.value = [];
    errorMessage.value =
      error instanceof Error ? error.message : "Unable to load workspaces.";
  } finally {
    isLoading.value = false;
  }
}

async function handleWorkspaceSelect(businessId: string): Promise<void> {
  if (!businessId || businessId === resolvedBusinessId.value || isSwitching.value) {
    closePanel();
    return;
  }

  isSwitching.value = true;
  errorMessage.value = "";

  try {
    await setActiveBusinessId(businessId);
    closePanel();
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "Unable to switch workspaces.";
  } finally {
    isSwitching.value = false;
  }
}

async function handleCreateWorkspace(): Promise<void> {
  if (!workspaceName.value.trim()) {
    errorMessage.value = "Workspace name is required.";
    return;
  }

  isCreating.value = true;
  errorMessage.value = "";

  try {
    const response = await requestOnboardingWorkspace({
      name: workspaceName.value.trim(),
      websiteUrl: workspaceWebsiteUrl.value.trim() || undefined,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    });
    await loadWorkspaces();
    await setActiveBusinessId(response.business.id);
    closePanel();
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "Unable to create workspace.";
  } finally {
    isCreating.value = false;
  }
}

function handleDocumentPointerDown(event: PointerEvent): void {
  if (!isOpen.value || !rootElement.value) {
    return;
  }

  const target = event.target as Node | null;

  if (target && !rootElement.value.contains(target)) {
    closePanel();
  }
}

onMounted(() => {
  document.addEventListener("pointerdown", handleDocumentPointerDown);
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", handleDocumentPointerDown);
});

watch(
  () => [auth.isReady.value, auth.sessionVersion.value] as const,
  ([authIsReady]) => {
    if (!authIsReady) {
      return;
    }

    void loadWorkspaces();
  },
  { immediate: true },
);

watch(
  () => route.fullPath,
  () => {
    closePanel();
  },
);

watch(
  () => resolvedBusinessId.value,
  (businessId) => {
    if (businessId && !workspaces.value.some((membership) => membership.businessId === businessId)) {
      void loadWorkspaces();
    }
  },
);
</script>

<template>
  <div ref="rootElement" class="workspace-switcher">
    <button
      type="button"
      class="workspace-switcher-trigger"
      :aria-expanded="isOpen"
      aria-haspopup="dialog"
      @click="isOpen = !isOpen"
    >
      <span class="workspace-switcher-avatar">{{ currentWorkspaceInitial }}</span>
      <span class="workspace-switcher-copy">
        <strong>{{ currentWorkspaceLabel }}</strong>
        <small>{{ currentWorkspaceMeta }}</small>
      </span>
      <span class="workspace-switcher-chevron" :class="{ open: isOpen }">⌄</span>
    </button>

    <div v-if="isOpen" class="workspace-switcher-panel" role="dialog" aria-label="Workspace switcher">
      <div class="workspace-switcher-panel-header">
        <div>
          <p class="workspace-switcher-kicker">Workspace</p>
          <strong>Switch brand context</strong>
        </div>
        <button
          type="button"
          class="workspace-switcher-inline-action"
          :disabled="isCreating"
          @click="isCreateFormOpen = !isCreateFormOpen"
        >
          {{ isCreateFormOpen ? "Close" : "New workspace" }}
        </button>
      </div>

      <p v-if="errorMessage" class="workspace-switcher-feedback error">{{ errorMessage }}</p>
      <p v-else-if="isSwitching" class="workspace-switcher-feedback">Switching workspace...</p>

      <div v-if="isLoading" class="workspace-switcher-empty">
        Loading workspaces...
      </div>

      <template v-else>
        <ul v-if="workspaces.length > 0" class="workspace-switcher-list">
          <li v-for="membership in workspaces" :key="membership.id">
            <button
              type="button"
              class="workspace-switcher-option"
              :class="{ active: membership.businessId === resolvedBusinessId }"
              :disabled="isSwitching || isCreating"
              @click="void handleWorkspaceSelect(membership.businessId)"
            >
              <span class="workspace-switcher-option-avatar">
                {{ formatWorkspaceLabel(membership).trim().charAt(0).toUpperCase() || "W" }}
              </span>
              <span class="workspace-switcher-option-copy">
                <strong>{{ formatWorkspaceLabel(membership) }}</strong>
                <small>
                  {{ membership.role }} · {{ membership.business.websiteUrl || "No website yet" }}
                </small>
              </span>
              <span
                v-if="membership.businessId === resolvedBusinessId"
                class="workspace-switcher-active-pill"
              >
                Current
              </span>
            </button>
          </li>
        </ul>

        <div v-else class="workspace-switcher-empty">
          No workspace yet. Create one to start using brand-scoped content.
        </div>
      </template>

      <form
        v-if="isCreateFormOpen"
        class="workspace-create-form"
        @submit.prevent="void handleCreateWorkspace()"
      >
        <label class="workspace-create-field">
          <span>Workspace name</span>
          <input
            v-model="workspaceName"
            type="text"
            placeholder="PlanCraft AI"
            autocomplete="organization"
          />
        </label>

        <label class="workspace-create-field">
          <span>Website URL</span>
          <input
            v-model="workspaceWebsiteUrl"
            type="url"
            placeholder="https://example.com"
            autocomplete="url"
          />
        </label>

        <div class="workspace-create-actions">
          <button type="submit" class="workspace-create-primary" :disabled="isCreating">
            {{ isCreating ? "Creating..." : "Create workspace" }}
          </button>
          <button
            type="button"
            class="workspace-create-secondary"
            :disabled="isCreating"
            @click="resetCreateForm"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.workspace-switcher {
  position: relative;
  min-width: min(100%, 280px);
}

.workspace-switcher-trigger {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  width: 100%;
  min-height: 52px;
  padding: 8px 14px 8px 10px;
  border: 1px solid var(--fc-border);
  border-radius: 20px;
  background: color-mix(in srgb, var(--fc-panel-bg) 84%, white 16%);
  color: var(--fc-text);
  cursor: pointer;
}

.workspace-switcher-avatar,
.workspace-switcher-option-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  border-radius: 14px;
  background: color-mix(in srgb, var(--fc-accent) 18%, var(--fc-surface));
  color: var(--fc-text);
  font-size: 0.88rem;
  font-weight: 800;
  letter-spacing: 0.04em;
}

.workspace-switcher-copy,
.workspace-switcher-option-copy {
  display: grid;
  min-width: 0;
  text-align: left;
}

.workspace-switcher-copy strong,
.workspace-switcher-option-copy strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workspace-switcher-copy small,
.workspace-switcher-option-copy small {
  color: var(--fc-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workspace-switcher-chevron {
  color: var(--fc-text-muted);
  font-size: 1.1rem;
  line-height: 1;
  transition: transform 140ms ease;
}

.workspace-switcher-chevron.open {
  transform: rotate(180deg);
}

.workspace-switcher-panel {
  position: absolute;
  top: calc(100% + 10px);
  right: 0;
  z-index: 50;
  display: grid;
  gap: 14px;
  width: min(420px, calc(100vw - 32px));
  padding: 16px;
  border: 1px solid var(--fc-border);
  border-radius: 24px;
  background: color-mix(in srgb, var(--fc-surface) 92%, white 8%);
  box-shadow: 0 24px 60px rgba(52, 36, 24, 0.16);
}

.workspace-switcher-panel-header {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 16px;
}

.workspace-switcher-kicker {
  margin: 0 0 4px;
  color: var(--fc-text-muted);
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.workspace-switcher-inline-action,
.workspace-create-secondary,
.workspace-create-primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 40px;
  padding: 0 14px;
  border-radius: 999px;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}

.workspace-switcher-inline-action,
.workspace-create-secondary {
  border: 1px solid var(--fc-border);
  background: var(--fc-surface);
  color: var(--fc-text);
}

.workspace-create-primary {
  border: 0;
  background: linear-gradient(135deg, var(--fc-accent) 0%, var(--fc-accent-dark) 100%);
  box-shadow: var(--fc-accent-shadow);
  color: var(--fc-accent-contrast);
}

.workspace-switcher-feedback {
  margin: 0;
  color: var(--fc-text-muted);
  font-size: 0.9rem;
}

.workspace-switcher-feedback.error {
  color: var(--fc-error-text);
}

.workspace-switcher-list {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.workspace-switcher-option {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  width: 100%;
  padding: 10px;
  border: 1px solid var(--fc-border);
  border-radius: 18px;
  background: color-mix(in srgb, var(--fc-panel-bg) 82%, white 18%);
  color: var(--fc-text);
  cursor: pointer;
  text-align: left;
  transition:
    transform 140ms ease,
    border-color 140ms ease,
    background 140ms ease;
}

.workspace-switcher-option:hover,
.workspace-switcher-option.active {
  border-color: color-mix(in srgb, var(--fc-accent) 24%, var(--fc-border));
  background: color-mix(in srgb, var(--fc-surface-subtle) 84%, white 16%);
  transform: translateY(-1px);
}

.workspace-switcher-active-pill {
  padding: 6px 10px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--fc-accent) 12%, var(--fc-surface));
  color: var(--fc-accent-dark);
  font-size: 0.75rem;
  font-weight: 800;
}

.workspace-switcher-empty {
  padding: 14px 0 4px;
  color: var(--fc-text-muted);
  line-height: 1.5;
}

.workspace-create-form {
  display: grid;
  gap: 12px;
  padding-top: 14px;
  border-top: 1px solid var(--fc-border);
}

.workspace-create-field {
  display: grid;
  gap: 8px;
}

.workspace-create-field span {
  color: var(--fc-text-muted);
  font-size: 0.82rem;
  font-weight: 700;
}

.workspace-create-field input {
  min-height: 46px;
  width: 100%;
  padding: 0 14px;
  border: 1px solid var(--fc-border);
  border-radius: 16px;
  background: var(--fc-surface);
  color: var(--fc-text);
  font: inherit;
}

.workspace-create-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

@media (max-width: 720px) {
  .workspace-switcher {
    width: 100%;
    min-width: 0;
  }

  .workspace-switcher-panel {
    left: 0;
    right: auto;
    width: min(100%, 100vw - 32px);
  }
}
</style>
