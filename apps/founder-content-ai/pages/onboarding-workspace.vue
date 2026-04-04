<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import type {
  BrandTone,
  OnboardingBusinessType,
  OnboardingUseCase,
} from "../../../packages/shared-types";
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
const businessLocation = ref("");
const selectedUseCase = ref<OnboardingUseCase>("business_marketing");
const selectedBusinessType = ref<OnboardingBusinessType>("daycare");
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
    value: "business_marketing",
    label: "Grow my business",
    eyebrow: "Business mode",
    description: "Generate campaigns, offers, and local marketing that drive customers.",
  },
  {
    value: "personal_brand",
    label: "Build my personal brand",
    eyebrow: "Creator mode",
    description: "Build content around your own voice, proof, and reputation.",
  },
  {
    value: "agency_clients",
    label: "Manage multiple clients",
    eyebrow: "Client mode",
    description: "Run repeatable content operations across multiple brands and offers.",
  },
];

const businessTypeOptions: Array<{
  value: OnboardingBusinessType;
  label: string;
  description: string;
}> = [
  {
    value: "daycare",
    label: "Daycare",
    description: "Fill open spots, drive local discovery, and promote trust fast.",
  },
  {
    value: "salon",
    label: "Salon",
    description: "Promote services, offers, and local appointment demand.",
  },
  {
    value: "fitness",
    label: "Fitness",
    description: "Drive memberships, classes, and local campaign momentum.",
  },
  {
    value: "other",
    label: "Other",
    description: "Use business mode for another local or service business.",
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
const selectedBusinessTypeDetails = computed(
  () => businessTypeOptions.find((option) => option.value === selectedBusinessType.value) ?? businessTypeOptions[0],
);
const isBusinessUseCase = computed(() => selectedUseCase.value === "business_marketing");
const cardTitle = computed(() =>
  isBusinessUseCase.value ? "Let’s help you get more customers" : "Choose how this workspace should operate",
);
const cardDescription = computed(() =>
  isBusinessUseCase.value
    ? "Pick the growth mode first, tell us what kind of business this is, and add the few details the system needs to generate local campaigns."
    : "Pick the operating mode, name the workspace, and refine the rest later without landing in an empty app.",
);
const workspaceNameLabel = computed(() => {
  if (selectedUseCase.value === "agency_clients") {
    return "Agency name";
  }

  if (selectedUseCase.value === "personal_brand") {
    return "Brand name";
  }

  return "Business name";
});
const workspaceNamePlaceholder = computed(() => {
  if (selectedUseCase.value === "agency_clients") {
    return "North Star Creative";
  }

  if (selectedUseCase.value === "personal_brand") {
    return "Jenny Chopra";
  }

  return "Daycare Spots";
});
const selectedSetupSummary = computed(() => {
  if (!isBusinessUseCase.value) {
    return selectedUseCaseDetails.value.description;
  }

  return [
    selectedBusinessTypeDetails.value.label,
    businessLocation.value.trim() ? `Local focus: ${businessLocation.value.trim()}` : "",
    "Business mode will start from customer outcomes instead of creator-style ideas.",
  ]
    .filter(Boolean)
    .join(" ");
});

function resolveToneForUseCase(value: OnboardingUseCase): BrandTone {
  if (value === "agency_clients") {
    return "bold";
  }

  if (value === "personal_brand") {
    return "friendly";
  }

  return "professional";
}

function resolveIndustryForWorkspace(
  useCase: OnboardingUseCase,
  businessType: OnboardingBusinessType,
): string {
  if (useCase === "agency_clients") {
    return "Agency";
  }

  if (useCase === "personal_brand") {
    return "Personal Brand";
  }

  if (businessType === "daycare") {
    return "Daycare";
  }

  if (businessType === "salon") {
    return "Salon";
  }

  if (businessType === "fitness") {
    return "Fitness";
  }

  return "Other";
}

watch(
  [suggestedWorkspaceName, selectedUseCase],
  ([nextValue, nextUseCase]) => {
    if (!hasTouchedWorkspaceName.value && !workspaceName.value.trim()) {
      workspaceName.value = nextUseCase === "business_marketing" ? "" : nextValue;
    }
  },
  { immediate: true },
);

async function handleCreateWorkspace(): Promise<void> {
  if (!workspaceName.value.trim()) {
    errorMessage.value = `${workspaceNameLabel.value} is required.`;
    return;
  }

  if (isBusinessUseCase.value && !businessLocation.value.trim()) {
    errorMessage.value = "Location is required for business mode.";
    return;
  }

  isCreating.value = true;
  errorMessage.value = "";

  try {
    const response = await requestOnboardingWorkspace({
      name: workspaceName.value.trim(),
      useCase: selectedUseCase.value,
      businessType: isBusinessUseCase.value ? selectedBusinessType.value : undefined,
      websiteUrl: websiteUrl.value.trim() || undefined,
      location: isBusinessUseCase.value ? businessLocation.value.trim() : undefined,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      industry: resolveIndustryForWorkspace(selectedUseCase.value, selectedBusinessType.value),
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
        This step decides how the system should think. Pick the growth mode first, then give the
        workspace just enough context to generate the right kind of content.
      </p>

      <div class="workspace-onboarding-benefits">
        <article class="workspace-benefit-card">
          <strong>Mode drives behavior</strong>
          <p>Business mode starts from customers and offers. Creator mode starts from voice and ideas.</p>
        </article>
        <article class="workspace-benefit-card">
          <strong>Brand context stays scoped</strong>
          <p>Posts, assets, publishing, and analytics stay attached to the right business or brand.</p>
        </article>
        <article class="workspace-benefit-card">
          <strong>Local context becomes usable</strong>
          <p>Website and location make local campaigns, offers, and trust-driven visuals much sharper.</p>
        </article>
      </div>
    </section>

    <section class="workspace-onboarding-card">
      <div class="workspace-onboarding-card-copy">
        <p class="workspace-onboarding-section-kicker">Step 1</p>
        <h2>{{ cardTitle }}</h2>
        <p>{{ cardDescription }}</p>
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

        <div v-if="isBusinessUseCase" class="workspace-business-type-section">
          <div class="workspace-business-type-copy">
            <p class="workspace-onboarding-section-kicker">Step 2</p>
            <h3>What kind of business is this?</h3>
          </div>
          <div class="workspace-business-types">
            <button
              v-for="option in businessTypeOptions"
              :key="option.value"
              type="button"
              class="workspace-use-case compact"
              :class="{ active: option.value === selectedBusinessType }"
              @click="selectedBusinessType = option.value"
            >
              <strong>{{ option.label }}</strong>
              <span>{{ option.description }}</span>
            </button>
          </div>
        </div>

        <div class="workspace-onboarding-fields">
          <label class="workspace-onboarding-field">
            <span>{{ workspaceNameLabel }}</span>
            <input
              v-model="workspaceName"
              type="text"
              autocomplete="organization"
              :placeholder="workspaceNamePlaceholder"
              @input="hasTouchedWorkspaceName = true"
            />
          </label>

          <label class="workspace-onboarding-field">
            <span>Website <small>Optional</small></span>
            <input
              v-model="websiteUrl"
              type="url"
              autocomplete="url"
              placeholder="https://example.com"
            />
          </label>

          <label v-if="isBusinessUseCase" class="workspace-onboarding-field">
            <span>Location</span>
            <input
              v-model="businessLocation"
              type="text"
              autocomplete="address-level1"
              placeholder="Dallas, TX"
            />
          </label>
        </div>

        <div class="workspace-onboarding-preview">
          <p class="workspace-onboarding-section-kicker">Selected setup</p>
          <strong>{{ selectedUseCaseDetails.label }}</strong>
          <span>{{ selectedSetupSummary }}</span>
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

.workspace-business-type-section {
  display: grid;
  gap: 12px;
}

.workspace-business-type-copy {
  display: grid;
  gap: 6px;
}

.workspace-business-type-copy h3 {
  margin: 0;
  font-size: 1.05rem;
}

.workspace-business-types {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
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

.workspace-use-case.compact {
  min-height: 124px;
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

  .workspace-business-types {
    grid-template-columns: 1fr;
  }

  .workspace-use-case {
    min-height: auto;
  }
}
</style>
