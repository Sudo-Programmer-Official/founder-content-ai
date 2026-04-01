<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import type { BrandTone, OnboardingUseCase } from "../../../packages/shared-types";
import { useProductAccessContext } from "../access/product-access-context";
import { useAuthContext } from "../auth/auth-context";
import { requestOnboardingWorkspace } from "../services/onboarding-service";
import { appRoutes } from "../utils/routes";

const route = useRoute();
const router = useRouter();
const auth = useAuthContext();
const { setActiveBusinessId } = useProductAccessContext();

const workspaceName = ref("");
const websiteUrl = ref("");
const selectedUseCase = ref<OnboardingUseCase>("personal_brand");
const isCreating = ref(false);
const errorMessage = ref("");
const hasTouchedWorkspaceName = ref(false);

const useCaseOptions: Array<{
  value: OnboardingUseCase;
  label: string;
  eyebrow: string;
  description: string;
}> = [
  {
    value: "personal_brand",
    label: "Personal brand",
    eyebrow: "Founder-led",
    description: "Build content around your own voice, proof, and reputation.",
  },
  {
    value: "business_marketing",
    label: "Startup",
    eyebrow: "Product-led",
    description: "Keep one product or company visible with a consistent content engine.",
  },
  {
    value: "agency_clients",
    label: "Agency",
    eyebrow: "Client-led",
    description: "Run repeatable content operations across multiple brands and offers.",
  },
];

const resolvedUserName = computed(
  () =>
    auth.currentUser.value?.fullName?.trim() ||
    auth.authSession.value?.displayName?.trim() ||
    "",
);

const suggestedWorkspaceName = computed(() => {
  if (resolvedUserName.value) {
    const primaryName = resolvedUserName.value.split(/\s+/)[0] || resolvedUserName.value;
    const suffix = /s$/i.test(primaryName) ? "'" : "'s";
    return `${primaryName}${suffix} Workspace`;
  }

  const email =
    auth.currentUser.value?.email?.trim() ||
    auth.authSession.value?.email?.trim() ||
    "";

  if (email.includes("@")) {
    const localPart = email.split("@")[0].replace(/[._-]+/g, " ").trim();
    const normalized = localPart.replace(/\b\w/g, (character) => character.toUpperCase());

    if (normalized) {
      return `${normalized} Workspace`;
    }
  }

  return "My Workspace";
});

const redirectTarget = computed(() => {
  const redirect = route.query.redirect;

  if (
    typeof redirect === "string" &&
    redirect.startsWith("/") &&
    redirect !== appRoutes.onboardingWorkspace &&
    !redirect.startsWith(`${appRoutes.onboardingWorkspace}?`)
  ) {
    return redirect;
  }

  return appRoutes.dashboard;
});

const selectedUseCaseDetails = computed(
  () => useCaseOptions.find((option) => option.value === selectedUseCase.value) ?? useCaseOptions[0],
);

function resolveToneForUseCase(value: OnboardingUseCase): BrandTone {
  if (value === "agency_clients") {
    return "bold";
  }

  if (value === "personal_brand") {
    return "friendly";
  }

  return "professional";
}

function resolveIndustryForUseCase(value: OnboardingUseCase): string {
  if (value === "agency_clients") {
    return "Agency";
  }

  if (value === "personal_brand") {
    return "Personal Brand";
  }

  return "Startup";
}

watch(
  suggestedWorkspaceName,
  (nextValue) => {
    if (!hasTouchedWorkspaceName.value && !workspaceName.value.trim()) {
      workspaceName.value = nextValue;
    }
  },
  { immediate: true },
);

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
      websiteUrl: websiteUrl.value.trim() || undefined,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      industry: resolveIndustryForUseCase(selectedUseCase.value),
      tone: resolveToneForUseCase(selectedUseCase.value),
    });

    await setActiveBusinessId(response.business.id);
    await router.replace(redirectTarget.value);
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "Unable to create your workspace.";
  } finally {
    isCreating.value = false;
  }
}
</script>

<template>
  <main class="workspace-onboarding-shell">
    <section class="workspace-onboarding-hero">
      <p class="workspace-onboarding-eyebrow">/onboarding/workspace</p>
      <h1>Create your workspace</h1>
      <p class="workspace-onboarding-copy">
        Workspaces keep your content, assets, publishing, and analytics organized. Create the first
        one now so the rest of the app has a clear home.
      </p>

      <div class="workspace-onboarding-benefits">
        <article class="workspace-benefit-card">
          <strong>Content stays scoped</strong>
          <p>Posts, hooks, assets, and brand context all stay attached to the right business.</p>
        </article>
        <article class="workspace-benefit-card">
          <strong>Analytics stay believable</strong>
          <p>Performance and publishing signals stop mixing across brands or experiments.</p>
        </article>
        <article class="workspace-benefit-card">
          <strong>Setup friction drops later</strong>
          <p>Your workspace becomes the default home for generation, repurpose, and scheduling.</p>
        </article>
      </div>
    </section>

    <section class="workspace-onboarding-card">
      <div class="workspace-onboarding-card-copy">
        <p class="workspace-onboarding-section-kicker">Step 1</p>
        <h2>Start with the business context</h2>
        <p>
          Pick what you’re building content for, then name the workspace. You can refine the rest
          later without hitting an empty app first.
        </p>
      </div>

      <form class="workspace-onboarding-form" @submit.prevent="void handleCreateWorkspace()">
        <div class="workspace-onboarding-use-cases">
          <button
            v-for="option in useCaseOptions"
            :key="option.value"
            type="button"
            class="workspace-use-case"
            :class="{ active: option.value === selectedUseCase }"
            @click="selectedUseCase = option.value"
          >
            <small>{{ option.eyebrow }}</small>
            <strong>{{ option.label }}</strong>
            <span>{{ option.description }}</span>
          </button>
        </div>

        <div class="workspace-onboarding-fields">
          <label class="workspace-onboarding-field">
            <span>Workspace name</span>
            <input
              v-model="workspaceName"
              type="text"
              autocomplete="organization"
              placeholder="Abhishek's Workspace"
              @input="hasTouchedWorkspaceName = true"
            />
          </label>

          <label class="workspace-onboarding-field">
            <span>Website URL <small>Optional</small></span>
            <input
              v-model="websiteUrl"
              type="url"
              autocomplete="url"
              placeholder="https://example.com"
            />
          </label>
        </div>

        <div class="workspace-onboarding-preview">
          <p class="workspace-onboarding-section-kicker">Selected setup</p>
          <strong>{{ selectedUseCaseDetails.label }}</strong>
          <span>{{ selectedUseCaseDetails.description }}</span>
        </div>

        <p v-if="errorMessage" class="workspace-onboarding-error">{{ errorMessage }}</p>

        <button class="workspace-onboarding-primary" type="submit" :disabled="isCreating">
          {{ isCreating ? "Creating workspace..." : "Create workspace" }}
        </button>
      </form>
    </section>
  </main>
</template>

<style scoped>
.workspace-onboarding-shell {
  min-height: 100vh;
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(0, 0.95fr);
  gap: 28px;
  padding: clamp(24px, 4vw, 40px);
  background:
    radial-gradient(circle at top left, rgba(255, 181, 120, 0.22), transparent 34%),
    linear-gradient(180deg, color-mix(in srgb, var(--fc-surface) 90%, white 10%) 0%, color-mix(in srgb, var(--fc-surface-subtle) 94%, white 6%) 100%);
}

.workspace-onboarding-hero,
.workspace-onboarding-card {
  border: 1px solid var(--fc-border);
  border-radius: 32px;
  background: color-mix(in srgb, var(--fc-surface) 90%, white 10%);
  box-shadow: var(--fc-card-shadow);
}

.workspace-onboarding-hero {
  display: grid;
  align-content: start;
  gap: 18px;
  padding: clamp(28px, 5vw, 52px);
}

.workspace-onboarding-card {
  display: grid;
  gap: 22px;
  padding: clamp(24px, 4vw, 40px);
}

.workspace-onboarding-eyebrow,
.workspace-onboarding-section-kicker {
  margin: 0;
  color: var(--fc-text-muted);
  font-size: 0.8rem;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.workspace-onboarding-hero h1,
.workspace-onboarding-card h2 {
  margin: 0;
  font-size: clamp(2.4rem, 5vw, 4.2rem);
  line-height: 0.98;
}

.workspace-onboarding-card h2 {
  font-size: clamp(1.7rem, 3vw, 2.4rem);
  line-height: 1.04;
}

.workspace-onboarding-copy,
.workspace-onboarding-card-copy p,
.workspace-benefit-card p,
.workspace-onboarding-preview span {
  margin: 0;
  color: var(--fc-text-muted);
  line-height: 1.7;
}

.workspace-onboarding-benefits {
  display: grid;
  gap: 14px;
}

.workspace-benefit-card,
.workspace-onboarding-preview {
  display: grid;
  gap: 8px;
  padding: 18px 20px;
  border: 1px solid var(--fc-border);
  border-radius: 22px;
  background: color-mix(in srgb, var(--fc-panel-bg) 84%, white 16%);
}

.workspace-benefit-card strong,
.workspace-onboarding-preview strong {
  font-size: 1rem;
}

.workspace-onboarding-card-copy {
  display: grid;
  gap: 10px;
}

.workspace-onboarding-form {
  display: grid;
  gap: 18px;
}

.workspace-onboarding-use-cases {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.workspace-use-case {
  display: grid;
  gap: 8px;
  min-height: 148px;
  padding: 18px;
  border: 1px solid var(--fc-border);
  border-radius: 24px;
  background: color-mix(in srgb, var(--fc-panel-bg) 82%, white 18%);
  color: var(--fc-text);
  text-align: left;
  cursor: pointer;
  transition:
    transform 140ms ease,
    border-color 140ms ease,
    box-shadow 140ms ease,
    background 140ms ease;
}

.workspace-use-case:hover,
.workspace-use-case.active {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--fc-accent) 32%, var(--fc-border));
  background: color-mix(in srgb, var(--fc-surface) 82%, rgba(255, 208, 167, 0.34));
  box-shadow: 0 18px 34px rgba(78, 50, 24, 0.08);
}

.workspace-use-case small {
  color: var(--fc-text-muted);
  font-size: 0.74rem;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.workspace-use-case strong {
  font-size: 1.08rem;
}

.workspace-use-case span {
  color: var(--fc-text-muted);
  font-size: 0.94rem;
  line-height: 1.55;
}

.workspace-onboarding-fields {
  display: grid;
  gap: 14px;
}

.workspace-onboarding-field {
  display: grid;
  gap: 8px;
}

.workspace-onboarding-field span {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 0.95rem;
  font-weight: 700;
}

.workspace-onboarding-field span small {
  color: var(--fc-text-muted);
  font-size: 0.8rem;
  font-weight: 700;
}

.workspace-onboarding-field input {
  min-height: 56px;
  padding: 0 18px;
  border: 1px solid var(--fc-border);
  border-radius: 18px;
  background: var(--fc-surface);
  color: var(--fc-text);
  font: inherit;
}

.workspace-onboarding-error {
  margin: 0;
  color: var(--fc-danger-text, #a33f2f);
  font-size: 0.94rem;
  font-weight: 700;
}

.workspace-onboarding-primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 52px;
  padding: 0 20px;
  border: 0;
  border-radius: 999px;
  background: linear-gradient(135deg, var(--fc-accent) 0%, var(--fc-accent-dark) 100%);
  box-shadow: var(--fc-accent-shadow);
  color: var(--fc-accent-contrast);
  font: inherit;
  font-weight: 800;
  cursor: pointer;
}

.workspace-onboarding-primary:disabled {
  cursor: wait;
  opacity: 0.72;
}

@media (max-width: 1080px) {
  .workspace-onboarding-shell {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 760px) {
  .workspace-onboarding-shell {
    padding: 18px;
  }

  .workspace-onboarding-use-cases {
    grid-template-columns: 1fr;
  }

  .workspace-use-case {
    min-height: auto;
  }
}
</style>
