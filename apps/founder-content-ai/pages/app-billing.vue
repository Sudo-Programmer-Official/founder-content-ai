<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute } from "vue-router";
import type {
  BillingOverviewResponse,
  BillingPlanOption,
} from "../../../packages/shared-types";
import { useProductAccessContext } from "../access/product-access-context";
import { ApiRequestError } from "../services/api-client";
import {
  requestBillingOverview,
  requestCreateBillingCheckoutSession,
  requestCreateBillingPortalSession,
} from "../services/billing-service";
import { appRoutes } from "../utils/routes";

const route = useRoute();
const { bootstrap, activeBusinessId, refreshProductAccess } = useProductAccessContext();

const overview = ref<BillingOverviewResponse | null>(null);
const isLoading = ref(false);
const errorMessage = ref("");
const feedbackMessage = ref("");
const activePlanAction = ref("");
const isOpeningPortal = ref(false);

const resolvedBusinessId = computed(
  () => bootstrap.value?.activeBusinessId?.trim() || activeBusinessId.value?.trim() || "",
);

const currentPlanLabel = computed(() => overview.value?.currentPlanLabel ?? "Free");
const currentPlanCode = computed(() => overview.value?.currentPlanCode ?? "free");
const subscription = computed(() => overview.value?.subscription);
const planCards = computed(() => overview.value?.plans ?? []);
const usageCards = computed(() => {
  const limits = overview.value?.usage;

  if (!limits) {
    return [];
  }

  return [
    {
      label: "Posts today",
      value: `${limits.postsUsed} / ${formatLimit(limits.postsLimit)}`,
      detail: `${limits.postsRemaining} remaining before the daily cap resets.`,
    },
    {
      label: "Scheduled queue",
      value:
        limits.scheduledQueueLimit === null || limits.scheduledQueueLimit >= 100000
          ? `${limits.scheduledQueueUsed} queued`
          : `${limits.scheduledQueueUsed} / ${formatLimit(limits.scheduledQueueLimit)}`,
      detail:
        limits.scheduledQueueRemaining === null
          ? "Unlimited queue depth on this plan."
          : `${limits.scheduledQueueRemaining} queue slot${limits.scheduledQueueRemaining === 1 ? "" : "s"} remaining.`,
    },
    {
      label: "Email credits",
      value: `${limits.emailsUsed} / ${formatLimit(limits.emailsLimit)}`,
      detail: `${limits.emailsRemaining} sends remaining today.`,
    },
    {
      label: "Outreach credits",
      value: `${limits.outreachUsed} / ${formatLimit(limits.outreachLimit)}`,
      detail: `${limits.outreachRemaining} touches remaining today.`,
    },
  ];
});
const canOpenPortal = computed(() => Boolean(subscription.value?.portalAvailable));
const paidWorkspace = computed(() => currentPlanCode.value !== "free");

function readQueryString(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return typeof value[0] === "string" ? value[0] : undefined;
  }

  return typeof value === "string" ? value : undefined;
}

function formatLimit(value: number | null | undefined): string {
  if (value === null || value === undefined || value >= 100000) {
    return "Unlimited";
  }

  return String(value);
}

function formatSubscriptionStatus(value: string | undefined): string {
  if (!value) {
    return "No Stripe subscription";
  }

  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function applyRouteFeedback(): {
  checkoutState?: string;
  portalState?: string;
} {
  const checkoutState = readQueryString(route.query.checkout);
  const portalState = readQueryString(route.query.portal);

  feedbackMessage.value = "";

  if (checkoutState === "success") {
    feedbackMessage.value = "Billing updated. Refreshing workspace access now.";
    return { checkoutState, portalState };
  }

  if (checkoutState === "canceled") {
    feedbackMessage.value = "Checkout was canceled before any billing change was made.";
    return { checkoutState, portalState };
  }

  if (portalState === "return") {
    feedbackMessage.value = "Returned from billing management. Workspace access has been refreshed.";
    return { checkoutState, portalState };
  }

  return { checkoutState, portalState };
}

async function loadOverview(options?: {
  refreshAccess?: boolean;
}): Promise<void> {
  const businessId = resolvedBusinessId.value;

  if (!businessId) {
    overview.value = null;
    return;
  }

  isLoading.value = true;
  errorMessage.value = "";

  try {
    const [nextOverview] = await Promise.all([
      requestBillingOverview(businessId),
      options?.refreshAccess ? refreshProductAccess(businessId) : Promise.resolve(null),
    ]);
    overview.value = nextOverview;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Unable to load billing.";
  } finally {
    isLoading.value = false;
  }
}

function getPlanActionLabel(plan: BillingPlanOption): string {
  if (plan.current) {
    return "Current plan";
  }

  if (plan.planCode === "custom") {
    return "Contact support";
  }

  if (paidWorkspace.value && canOpenPortal.value) {
    return plan.ctaLabel;
  }

  return plan.ctaLabel;
}

function planActionDisabled(plan: BillingPlanOption): boolean {
  if (plan.current) {
    return true;
  }

  if (plan.planCode === "custom") {
    return false;
  }

  if (paidWorkspace.value) {
    return !canOpenPortal.value;
  }

  return !plan.priceId;
}

async function openBillingPortal(): Promise<void> {
  const businessId = resolvedBusinessId.value;

  if (!businessId || !canOpenPortal.value) {
    errorMessage.value = "Billing management is not available for this workspace yet.";
    return;
  }

  isOpeningPortal.value = true;
  errorMessage.value = "";

  try {
    const response = await requestCreateBillingPortalSession({
      businessId,
      returnPath: appRoutes.appBilling,
    });
    window.location.href = response.url;
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "Unable to open billing management.";
  } finally {
    isOpeningPortal.value = false;
  }
}

async function handlePlanAction(plan: BillingPlanOption): Promise<void> {
  if (plan.current) {
    return;
  }

  if (plan.planCode === "custom") {
    window.location.href = "mailto:support@foundercontent.ai?subject=FounderContent%20Custom%20Plan";
    return;
  }

  if (paidWorkspace.value) {
    await openBillingPortal();
    return;
  }

  if (!plan.priceId) {
    errorMessage.value = "This billing plan is not configured in Stripe yet.";
    return;
  }

  const businessId = resolvedBusinessId.value;

  if (!businessId) {
    errorMessage.value = "Select a workspace before starting checkout.";
    return;
  }

  activePlanAction.value = plan.planCode;
  errorMessage.value = "";

  try {
    const response = await requestCreateBillingCheckoutSession({
      businessId,
      priceId: plan.priceId,
      returnPath: appRoutes.appBilling,
    });
    window.location.href = response.url;
  } catch (error) {
    if (error instanceof ApiRequestError && error.code === "billing_portal_required") {
      await openBillingPortal();
      return;
    }

    errorMessage.value = error instanceof Error ? error.message : "Unable to start checkout.";
  } finally {
    activePlanAction.value = "";
  }
}

watch(
  () => resolvedBusinessId.value,
  () => {
    void loadOverview();
  },
  { immediate: true },
);

watch(
  () => [readQueryString(route.query.checkout), readQueryString(route.query.portal)] as const,
  ([checkoutState, portalState]) => {
    const handledState =
      checkoutState === "success" || portalState === "return"
        ? {
            refreshAccess: true,
          }
        : undefined;

    applyRouteFeedback();

    if (checkoutState || portalState) {
      void loadOverview(handledState);
    }
  },
  { immediate: true },
);
</script>

<template>
  <main class="billing-shell">
    <section class="billing-hero">
      <div>
        <p class="billing-kicker">/app/billing</p>
        <h1>Turn usage into a real subscription system.</h1>
        <p class="billing-description">
          Keep plan limits visible, send upgrades through Stripe, and give this workspace one clear place to manage billing.
        </p>
      </div>

      <div class="billing-hero-actions">
        <article class="billing-current-plan-card">
          <p class="billing-card-label">Current plan</p>
          <strong>{{ currentPlanLabel }}</strong>
          <p>
            {{
              overview?.workspaceName
                ? `${overview.workspaceName} stays on this plan until Stripe says otherwise.`
                : "Select a workspace to see the active plan."
            }}
          </p>
        </article>

        <button
          v-if="canOpenPortal"
          type="button"
          class="billing-primary-button"
          :disabled="isOpeningPortal"
          @click="void openBillingPortal()"
        >
          {{ isOpeningPortal ? "Opening billing..." : "Manage subscription" }}
        </button>
      </div>
    </section>

    <p v-if="feedbackMessage" class="billing-feedback success">{{ feedbackMessage }}</p>
    <p v-if="errorMessage" class="billing-feedback error">{{ errorMessage }}</p>

    <section class="billing-grid">
      <article class="billing-panel">
        <div class="billing-panel-header">
          <div>
            <p class="billing-card-label">Usage snapshot</p>
            <h2>Make limits explicit before the user hits friction.</h2>
          </div>
          <span v-if="subscription" class="billing-status-chip">
            {{ formatSubscriptionStatus(subscription.status) }}
          </span>
        </div>

        <p class="billing-panel-copy">
          These numbers come from the same access layer that enforces posting and scheduling limits in the product.
        </p>

        <div v-if="isLoading" class="billing-usage-grid">
          <article v-for="placeholder in 4" :key="placeholder" class="billing-usage-card loading">
            <span></span>
          </article>
        </div>

        <div v-else-if="usageCards.length > 0" class="billing-usage-grid">
          <article
            v-for="card in usageCards"
            :key="card.label"
            class="billing-usage-card"
          >
            <p class="billing-card-label">{{ card.label }}</p>
            <strong>{{ card.value }}</strong>
            <p>{{ card.detail }}</p>
          </article>
        </div>

        <p v-else class="billing-empty-state">
          Usage appears once the active workspace has access loaded.
        </p>

        <div v-if="subscription" class="billing-subscription-meta">
          <article class="billing-meta-card">
            <p class="billing-card-label">Renewal window</p>
            <strong>{{ subscription.currentPeriodEnd ? new Date(subscription.currentPeriodEnd).toLocaleDateString() : "Not available" }}</strong>
            <p>
              {{
                subscription.cancelAtPeriodEnd
                  ? "This subscription is set to end after the current billing period."
                  : "Stripe will keep renewing this plan until it is changed or canceled."
              }}
            </p>
          </article>
        </div>
      </article>

      <article class="billing-panel">
        <div class="billing-panel-header">
          <div>
            <p class="billing-card-label">Plans</p>
            <h2>Move from teaser access to a real publishing system.</h2>
          </div>
        </div>

        <div class="billing-plan-list">
          <article
            v-for="plan in planCards"
            :key="plan.planCode"
            class="billing-plan-card"
            :class="{ current: plan.current }"
          >
            <div class="billing-plan-head">
              <div>
                <p class="billing-card-label">{{ plan.label }}</p>
                <strong>{{ plan.priceDisplay }}</strong>
              </div>
              <span v-if="plan.current" class="billing-current-badge">Current</span>
            </div>

            <p class="billing-plan-description">{{ plan.description }}</p>

            <ul class="billing-highlight-list">
              <li v-for="highlight in plan.highlights" :key="highlight">{{ highlight }}</li>
            </ul>

            <button
              type="button"
              class="billing-plan-button"
              :class="{ secondary: plan.current || (paidWorkspace && !plan.current) }"
              :disabled="planActionDisabled(plan) || activePlanAction === plan.planCode"
              @click="void handlePlanAction(plan)"
            >
              {{
                activePlanAction === plan.planCode
                  ? "Redirecting..."
                  : getPlanActionLabel(plan)
              }}
            </button>
          </article>
        </div>
      </article>
    </section>
  </main>
</template>

<style scoped>
.billing-shell {
  display: grid;
  gap: 24px;
}

.billing-hero,
.billing-panel {
  border: 1px solid var(--fc-border);
  border-radius: 28px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.94) 0%, rgba(255, 248, 240, 0.92) 100%);
  box-shadow: var(--fc-card-shadow);
}

.billing-hero {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(280px, 1fr);
  gap: 24px;
  padding: clamp(24px, 4vw, 36px);
}

.billing-kicker,
.billing-card-label {
  margin: 0;
  font-size: 0.78rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--fc-text-muted);
}

.billing-hero h1,
.billing-panel h2 {
  margin: 10px 0 0;
  font-size: clamp(2rem, 4vw, 3rem);
  line-height: 0.95;
  color: var(--fc-text);
}

.billing-panel h2 {
  font-size: clamp(1.25rem, 2vw, 1.7rem);
  line-height: 1.05;
}

.billing-description,
.billing-panel-copy,
.billing-plan-description,
.billing-usage-card p,
.billing-meta-card p,
.billing-current-plan-card p {
  margin: 0;
  color: color-mix(in srgb, var(--fc-text) 78%, white 22%);
  line-height: 1.6;
}

.billing-hero-actions {
  display: grid;
  gap: 16px;
  align-content: start;
}

.billing-current-plan-card,
.billing-usage-card,
.billing-meta-card,
.billing-plan-card {
  border: 1px solid color-mix(in srgb, var(--fc-border) 80%, white 20%);
  border-radius: 22px;
  background: rgba(255, 255, 255, 0.78);
}

.billing-current-plan-card {
  padding: 20px;
}

.billing-current-plan-card strong,
.billing-usage-card strong,
.billing-meta-card strong,
.billing-plan-head strong {
  display: block;
  margin-top: 10px;
  font-size: 1.8rem;
  line-height: 1;
  color: var(--fc-text);
}

.billing-primary-button,
.billing-plan-button {
  border: 0;
  border-radius: 18px;
  padding: 14px 18px;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
  transition: transform 160ms ease, box-shadow 160ms ease, opacity 160ms ease;
}

.billing-primary-button,
.billing-plan-button:not(.secondary) {
  background: linear-gradient(135deg, #d85e2a 0%, #f08d2f 100%);
  color: #fffaf4;
  box-shadow: 0 16px 32px rgba(216, 94, 42, 0.18);
}

.billing-plan-button.secondary {
  background: rgba(255, 255, 255, 0.72);
  color: var(--fc-text);
  border: 1px solid color-mix(in srgb, var(--fc-border) 76%, white 24%);
  box-shadow: none;
}

.billing-primary-button:hover,
.billing-plan-button:hover {
  transform: translateY(-1px);
}

.billing-primary-button:disabled,
.billing-plan-button:disabled {
  cursor: not-allowed;
  opacity: 0.6;
  transform: none;
}

.billing-feedback {
  margin: 0;
  padding: 14px 18px;
  border-radius: 18px;
  border: 1px solid var(--fc-border);
}

.billing-feedback.success {
  background: rgba(238, 247, 237, 0.92);
  color: #24613f;
}

.billing-feedback.error {
  background: rgba(255, 238, 232, 0.95);
  color: #9f351f;
}

.billing-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(0, 0.95fr);
  gap: 24px;
}

.billing-panel {
  display: grid;
  gap: 20px;
  padding: clamp(22px, 3vw, 30px);
}

.billing-panel-header {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 16px;
}

.billing-status-chip,
.billing-current-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 8px 12px;
  border-radius: 999px;
  background: rgba(246, 221, 205, 0.8);
  color: #8f401c;
  font-size: 0.82rem;
  font-weight: 700;
}

.billing-usage-grid,
.billing-subscription-meta {
  display: grid;
  gap: 14px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.billing-usage-card,
.billing-meta-card {
  padding: 18px;
}

.billing-usage-card.loading {
  min-height: 120px;
  position: relative;
  overflow: hidden;
}

.billing-usage-card.loading span {
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, rgba(244, 232, 224, 0.7) 0%, rgba(255, 255, 255, 0.95) 50%, rgba(244, 232, 224, 0.7) 100%);
  background-size: 200% 100%;
  animation: billing-shimmer 1.4s linear infinite;
}

.billing-plan-list {
  display: grid;
  gap: 14px;
}

.billing-plan-card {
  display: grid;
  gap: 16px;
  padding: 20px;
}

.billing-plan-card.current {
  border-color: rgba(216, 94, 42, 0.24);
  box-shadow: inset 0 0 0 1px rgba(216, 94, 42, 0.12);
}

.billing-plan-head {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 12px;
}

.billing-highlight-list {
  margin: 0;
  padding-left: 18px;
  display: grid;
  gap: 8px;
  color: color-mix(in srgb, var(--fc-text) 88%, white 12%);
}

.billing-empty-state {
  margin: 0;
  padding: 18px;
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.72);
  color: var(--fc-text-muted);
}

@keyframes billing-shimmer {
  from {
    background-position: 200% 0;
  }

  to {
    background-position: -200% 0;
  }
}

@media (max-width: 980px) {
  .billing-hero,
  .billing-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .billing-shell {
    gap: 18px;
  }

  .billing-hero,
  .billing-panel {
    border-radius: 22px;
  }

  .billing-usage-grid,
  .billing-subscription-meta {
    grid-template-columns: 1fr;
  }
}
</style>
