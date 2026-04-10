<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import type {
  BillingEmailPlanOption,
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
const router = useRouter();
const { bootstrap, activeBusinessId, refreshProductAccess } = useProductAccessContext();

const overview = ref<BillingOverviewResponse | null>(null);
const isLoading = ref(false);
const errorMessage = ref("");
const feedbackMessage = ref("");
const activePlanAction = ref("");
const activeEmailPlanAction = ref("");
const isOpeningPortal = ref(false);
const showPromotionCodeField = ref(false);
const promotionCode = ref("");

const BILLING_SYNC_RETRY_DELAYS_MS = [0, 800, 1200, 1800, 2600, 3600] as const;

type BillingCheckoutTarget = "workspace_plan" | "email_addon";

type LoadOverviewOptions = {
  refreshAccess?: boolean;
  awaitCheckoutSync?: boolean;
  checkoutTarget?: BillingCheckoutTarget;
};

let latestOverviewRequestId = 0;

const resolvedBusinessId = computed(
  () => bootstrap.value?.activeBusinessId?.trim() || activeBusinessId.value?.trim() || "",
);

const currentPlanLabel = computed(() => overview.value?.currentPlanLabel ?? "Free");
const currentPlanCode = computed(() => overview.value?.currentPlanCode ?? "free");
const subscription = computed(() => overview.value?.subscription);
const planCards = computed(() => overview.value?.plans ?? []);
const emailAddon = computed(() => overview.value?.emailAddon);
const emailPlanCards = computed(() => overview.value?.emailPlans ?? []);
const featuredPlan = computed(
  () =>
    planCards.value.find((plan) => plan.planCode === "growth" && !plan.current) ||
    planCards.value.find(
      (plan) => !plan.current && plan.planCode !== "free" && plan.planCode !== "custom",
    ) ||
    null,
);
const usageCards = computed(() => {
  const limits = overview.value?.usage;
  const unlimitedGenerations = bootstrap.value?.access?.unlimitedGenerations ?? false;

  if (!limits) {
    return [];
  }

  return [
    {
      label: "Generations today",
      value: `${limits.generationDailyUsed} / ${formatLimit(limits.generationDailyLimit)}`,
      detail: unlimitedGenerations
        ? "Unlimited admin override active. Usage is still tracked."
        : `${limits.generationDailyRemaining} remaining before the daily cap resets.`,
    },
    {
      label: "Generations this month",
      value: `${limits.generationMonthlyUsed} / ${formatLimit(limits.generationMonthlyLimit)}`,
      detail: unlimitedGenerations
        ? "Unlimited admin override active. Monthly usage is still tracked."
        :
        limits.generationMonthlyRemaining === null
          ? "Custom monthly generation allocation."
          : `${limits.generationMonthlyRemaining} remaining this billing month.`,
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
      label: "Outreach credits",
      value: `${limits.outreachUsed} / ${formatLimit(limits.outreachLimit)}`,
      detail: `${limits.outreachRemaining} touches remaining today.`,
    },
  ];
});
const canOpenPortal = computed(() => Boolean(subscription.value?.portalAvailable || emailAddon.value?.portalAvailable));
const paidWorkspace = computed(() => currentPlanCode.value !== "free");
const shouldManageBilling = computed(
  () => canOpenPortal.value && (paidWorkspace.value || emailAddon.value?.source === "addon"),
);
const overviewStatusLabel = computed(() => {
  if (subscription.value?.status) {
    return formatSubscriptionStatus(subscription.value.status);
  }

  if (emailAddon.value?.subscriptionStatus) {
    return formatSubscriptionStatus(emailAddon.value.subscriptionStatus);
  }

  if (currentPlanCode.value === "free") {
    return "Free workspace";
  }

  return "Billing not configured";
});
const renewalLabel = computed(() => {
  if (subscription.value?.currentPeriodEnd) {
    return subscription.value.cancelAtPeriodEnd ? "Ends on" : "Renews on";
  }

  if (emailAddon.value?.billingPeriodEnd) {
    return "Email period ends";
  }

  return "Renewal";
});
const renewalDateLabel = computed(() => {
  if (subscription.value?.currentPeriodEnd) {
    return new Date(subscription.value.currentPeriodEnd).toLocaleDateString();
  }

  if (emailAddon.value?.billingPeriodEnd) {
    return new Date(emailAddon.value.billingPeriodEnd).toLocaleDateString();
  }

  return "No Stripe renewal";
});
const overviewActionTitle = computed(() => {
  if (!resolvedBusinessId.value) {
    return "Select a workspace to load billing.";
  }

  if (shouldManageBilling.value) {
    return "Manage this workspace in Stripe.";
  }

  if (featuredPlan.value) {
    return `Upgrade to ${featuredPlan.value.label} when the current limits feel tight.`;
  }

  return "Review the plan options below.";
});
const overviewActionCopy = computed(() => {
  if (!resolvedBusinessId.value) {
    return "Billing actions appear once a workspace is selected.";
  }

  if (shouldManageBilling.value) {
    return "Open billing management to switch plans, update payment details, or cancel at period end without leaving the workspace context.";
  }

  if (featuredPlan.value) {
    return `${featuredPlan.value.description} Checkout starts in Stripe and returns here once billing is updated.`;
  }

  return "Plan changes are handled below once billing options are available.";
});
const overviewActionLabel = computed(() => {
  if (!resolvedBusinessId.value) {
    return "Select workspace";
  }

  if (shouldManageBilling.value) {
    return isOpeningPortal.value ? "Opening billing..." : "Manage subscription";
  }

  if (!featuredPlan.value) {
    return "Review plans";
  }

  return activePlanAction.value === featuredPlan.value.planCode
    ? "Redirecting..."
    : getPlanActionLabel(featuredPlan.value);
});
const overviewActionDisabled = computed(() => {
  if (!resolvedBusinessId.value) {
    return true;
  }

  if (shouldManageBilling.value) {
    return isOpeningPortal.value || !canOpenPortal.value;
  }

  if (!featuredPlan.value) {
    return true;
  }

  return planActionDisabled(featuredPlan.value) || activePlanAction.value === featuredPlan.value.planCode;
});
const normalizedPromotionCode = computed(() => {
  const normalized = promotionCode.value.trim();
  return normalized ? normalized : undefined;
});
const hasTransientBillingRouteState = computed(
  () => Boolean(readQueryString(route.query.checkout) || readQueryString(route.query.portal)),
);

function readQueryString(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return typeof value[0] === "string" ? value[0] : undefined;
  }

  return typeof value === "string" ? value : undefined;
}

function normalizeCheckoutTarget(value: string | undefined): BillingCheckoutTarget | undefined {
  if (value === "workspace_plan" || value === "email_addon") {
    return value;
  }

  return undefined;
}

function waitForDelay(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, delayMs);
  });
}

function isWorkspaceCheckoutSynced(nextOverview: BillingOverviewResponse): boolean {
  return nextOverview.currentPlanCode !== "free";
}

function isEmailAddonCheckoutSynced(nextOverview: BillingOverviewResponse): boolean {
  return nextOverview.emailAddon?.source === "addon";
}

function isCheckoutSyncComplete(
  nextOverview: BillingOverviewResponse,
  checkoutTarget: BillingCheckoutTarget | undefined,
): boolean {
  if (checkoutTarget === "email_addon") {
    return isEmailAddonCheckoutSynced(nextOverview);
  }

  return isWorkspaceCheckoutSynced(nextOverview);
}

async function loadOverviewWithCheckoutSync(
  businessId: string,
  checkoutTarget: BillingCheckoutTarget | undefined,
): Promise<{ overview: BillingOverviewResponse; synced: boolean }> {
  let latestOverview: BillingOverviewResponse | null = null;

  for (const delayMs of BILLING_SYNC_RETRY_DELAYS_MS) {
    if (delayMs > 0) {
      await waitForDelay(delayMs);
    }

    latestOverview = await requestBillingOverview(businessId);

    if (isCheckoutSyncComplete(latestOverview, checkoutTarget)) {
      return {
        overview: latestOverview,
        synced: true,
      };
    }
  }

  if (!latestOverview) {
    latestOverview = await requestBillingOverview(businessId);
  }

  return {
    overview: latestOverview,
    synced: false,
  };
}

function formatLimit(value: number | null | undefined): string {
  if (value === null || value === undefined || value >= 100000) {
    return "Unlimited";
  }

  return String(value);
}

function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "Custom";
  }

  return new Intl.NumberFormat("en-US").format(value);
}

function formatBillingCap(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "Custom";
  }

  if (value <= 0) {
    return "Not configured";
  }

  return formatNumber(value);
}

function formatUsageState(value: string | undefined): string {
  switch (value) {
    case "warning":
      return "Approaching limit";
    case "over_limit":
      return "Over soft limit";
    case "inactive":
      return "Not configured";
    default:
      return "Healthy";
  }
}

function formatEmailAddonSource(value: string | undefined): string {
  switch (value) {
    case "bundled":
      return "Included with current plan";
    case "addon":
      return "Separate email add-on";
    case "custom":
      return "Custom billing";
    default:
      return "Manual configuration";
  }
}

function resolveUsageProgress(current: number, limit: number | null | undefined): number {
  if (!limit || limit <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(100, (current / limit) * 100));
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

function isFeaturedCorePlan(plan: BillingPlanOption): boolean {
  return plan.planCode === "growth";
}

function isFeaturedEmailPlan(plan: BillingEmailPlanOption): boolean {
  return plan.tierCode === "growth_email";
}

function applyRouteFeedback(): {
  checkoutState?: string;
  portalState?: string;
  checkoutTarget?: string;
} {
  const checkoutState = readQueryString(route.query.checkout);
  const portalState = readQueryString(route.query.portal);
  const checkoutTarget = readQueryString(route.query.checkoutTarget);

  if (checkoutState === "success") {
    feedbackMessage.value =
      checkoutTarget === "email_addon"
        ? "Stripe checkout completed. Waiting for the email add-on to sync."
        : "Stripe checkout completed. Waiting for workspace billing to sync.";
    return { checkoutState, portalState, checkoutTarget };
  }

  if (checkoutState === "canceled") {
    feedbackMessage.value =
      checkoutTarget === "email_addon"
        ? "Email add-on checkout was canceled before any billing change was made."
        : "Checkout was canceled before any billing change was made.";
    return { checkoutState, portalState, checkoutTarget };
  }

  if (portalState === "return") {
    feedbackMessage.value = "Returned from billing management. Workspace access has been refreshed.";
    return { checkoutState, portalState, checkoutTarget };
  }

  return { checkoutState, portalState, checkoutTarget };
}

async function loadOverview(options?: LoadOverviewOptions): Promise<void> {
  const businessId = resolvedBusinessId.value;

  if (!businessId) {
    overview.value = null;
    return;
  }

  const requestId = ++latestOverviewRequestId;
  isLoading.value = true;
  errorMessage.value = "";

  try {
    const overviewResult = options?.awaitCheckoutSync
      ? await loadOverviewWithCheckoutSync(businessId, options.checkoutTarget)
      : {
          overview: await requestBillingOverview(businessId),
          synced: true,
        };

    if (requestId !== latestOverviewRequestId) {
      return;
    }

    overview.value = overviewResult.overview;

    if (options?.refreshAccess) {
      await refreshProductAccess(businessId);
    }

    if (requestId !== latestOverviewRequestId) {
      return;
    }

    const checkoutState = readQueryString(route.query.checkout);
    const portalState = readQueryString(route.query.portal);

    if (options?.awaitCheckoutSync && checkoutState === "success") {
      if (options.checkoutTarget === "email_addon") {
        feedbackMessage.value = overviewResult.synced && overviewResult.overview.emailAddon
          ? `${overviewResult.overview.emailAddon.label} is now active for this workspace.`
          : "Stripe checkout succeeded, but the email add-on is still syncing. Refresh again in a few seconds if it has not appeared yet.";
      } else {
        feedbackMessage.value = overviewResult.synced
          ? `You're now on ${overviewResult.overview.currentPlanLabel}. Workspace access has been refreshed.`
          : "Stripe checkout succeeded, but workspace billing is still syncing. Refresh again in a few seconds if the plan has not updated yet.";
      }
    } else if (options?.refreshAccess && portalState === "return") {
      feedbackMessage.value = "Returned from billing management. Workspace access has been refreshed.";
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Unable to load billing.";
  } finally {
    if (requestId === latestOverviewRequestId) {
      isLoading.value = false;
    }
  }
}

async function clearBillingRouteState(): Promise<void> {
  const nextQuery = {
    ...route.query,
  };

  delete nextQuery.checkout;
  delete nextQuery.portal;
  delete nextQuery.checkoutTarget;

  await router.replace({
    path: route.path,
    query: nextQuery,
    hash: route.hash,
  });
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

function getEmailPlanActionLabel(plan: BillingEmailPlanOption): string {
  if (plan.current) {
    return emailAddon.value?.source === "addon" ? "Current add-on" : "Included now";
  }

  if (emailAddon.value?.source === "addon" && canOpenPortal.value) {
    return "Manage in billing";
  }

  return plan.ctaLabel;
}

function emailPlanActionDisabled(plan: BillingEmailPlanOption): boolean {
  if (plan.current) {
    return true;
  }

  if (emailAddon.value?.source === "custom") {
    return true;
  }

  if (emailAddon.value?.source === "addon") {
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
      promotionCode: normalizedPromotionCode.value,
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

async function handleEmailPlanAction(plan: BillingEmailPlanOption): Promise<void> {
  if (plan.current) {
    return;
  }

  if (emailAddon.value?.source === "addon") {
    await openBillingPortal();
    return;
  }

  if (!plan.priceId) {
    errorMessage.value = "This email add-on is not configured in Stripe yet.";
    return;
  }

  const businessId = resolvedBusinessId.value;

  if (!businessId) {
    errorMessage.value = "Select a workspace before starting checkout.";
    return;
  }

  activeEmailPlanAction.value = plan.tierCode;
  errorMessage.value = "";

  try {
    const response = await requestCreateBillingCheckoutSession({
      businessId,
      priceId: plan.priceId,
      promotionCode: normalizedPromotionCode.value,
      returnPath: appRoutes.appBilling,
    });
    window.location.href = response.url;
  } catch (error) {
    if (error instanceof ApiRequestError && error.code === "billing_portal_required") {
      await openBillingPortal();
      return;
    }

    errorMessage.value = error instanceof Error ? error.message : "Unable to start email add-on checkout.";
  } finally {
    activeEmailPlanAction.value = "";
  }
}

async function handleOverviewPrimaryAction(): Promise<void> {
  if (!resolvedBusinessId.value) {
    errorMessage.value = "Select a workspace before managing billing.";
    return;
  }

  if (shouldManageBilling.value) {
    await openBillingPortal();
    return;
  }

  if (featuredPlan.value) {
    await handlePlanAction(featuredPlan.value);
  }
}

watch(
  () => resolvedBusinessId.value,
  () => {
    if (hasTransientBillingRouteState.value) {
      return;
    }

    void loadOverview();
  },
  { immediate: true },
);

watch(
  () => [
    readQueryString(route.query.checkout),
    readQueryString(route.query.portal),
    readQueryString(route.query.checkoutTarget),
  ] as const,
  ([checkoutState, portalState, checkoutTarget]) => {
    const handledState =
      checkoutState === "success"
        ? {
            refreshAccess: true,
            awaitCheckoutSync: true,
            checkoutTarget: normalizeCheckoutTarget(checkoutTarget),
          }
        : portalState === "return"
          ? {
              refreshAccess: true,
            }
          : undefined;

    applyRouteFeedback();

    if (checkoutState || portalState) {
      void (async () => {
        await loadOverview(handledState);
        await clearBillingRouteState();
      })();
      return;
    }
  },
  { immediate: true },
);
</script>

<template>
  <main class="billing-shell">
    <section class="billing-hero">
      <p class="billing-kicker">/app/billing</p>
      <h1>Make billing easy to scan before you wire more Stripe behavior.</h1>
      <p class="billing-description">
        Put the current plan first, show usage next, keep workspace plans in one row, and isolate email add-ons so upgrade decisions feel obvious.
      </p>
    </section>

    <p v-if="feedbackMessage" class="billing-feedback success">{{ feedbackMessage }}</p>
    <p v-if="errorMessage" class="billing-feedback error">{{ errorMessage }}</p>

    <section class="billing-panel">
      <div class="billing-section-heading">
        <div>
          <p class="billing-card-label">Plan + billing status</p>
          <h2>Lead with the current plan, then make the next action obvious.</h2>
        </div>
        <span class="billing-status-chip">
          {{ overviewStatusLabel }}
        </span>
      </div>

      <div class="billing-overview-grid">
        <article class="billing-current-plan-card billing-overview-primary">
          <p class="billing-card-label">Current plan</p>
          <strong>{{ currentPlanLabel }}</strong>
          <p>
            {{
              overview?.workspaceName
                ? `${overview.workspaceName} is the workspace attached to this billing state.`
                : "Select a workspace to load billing details."
            }}
          </p>

          <div class="billing-overview-meta">
            <article class="billing-inline-metric">
              <p class="billing-card-label">Billing status</p>
              <strong>{{ overviewStatusLabel }}</strong>
            </article>
            <article class="billing-inline-metric">
              <p class="billing-card-label">{{ renewalLabel }}</p>
              <strong>{{ renewalDateLabel }}</strong>
            </article>
          </div>
        </article>

        <article class="billing-current-plan-card billing-overview-cta">
          <p class="billing-card-label">
            {{ shouldManageBilling ? "Billing management" : "Upgrade CTA" }}
          </p>
          <h3>{{ overviewActionTitle }}</h3>
          <p>{{ overviewActionCopy }}</p>

          <button
            type="button"
            class="billing-primary-button"
            :disabled="overviewActionDisabled"
            @click="void handleOverviewPrimaryAction()"
          >
            {{ overviewActionLabel }}
          </button>
        </article>
      </div>
    </section>

    <section class="billing-panel">
      <div class="billing-section-heading">
        <div>
          <p class="billing-card-label">Usage + limits</p>
          <h2>Show the pressure points before the user asks why they should upgrade.</h2>
        </div>
      </div>

      <p class="billing-panel-copy">
        These numbers come from the same access layer that enforces posting, queue, and outreach limits in the product.
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
    </section>

    <section class="billing-panel">
      <div class="billing-section-heading">
        <div>
          <p class="billing-card-label">Plans</p>
          <h2>Keep workspace plans in one horizontal pricing row.</h2>
        </div>

        <div v-if="!paidWorkspace || emailAddon?.source !== 'addon'" class="billing-section-toolbar">
          <button
            type="button"
            class="billing-plan-button secondary billing-code-toggle"
            @click="showPromotionCodeField = !showPromotionCodeField"
          >
            {{ showPromotionCodeField ? "Hide promo code" : "Have a promo code?" }}
          </button>
        </div>
      </div>

      <p class="billing-panel-copy">
        Core workspace plans control generations, queue depth, and how much publishing headroom this workspace has.
      </p>

      <label v-if="showPromotionCodeField" class="billing-promo-field">
        <span class="billing-card-label">Promotion code</span>
        <input
          v-model="promotionCode"
          type="text"
          autocomplete="off"
          placeholder="Enter Stripe promotion code"
        />
        <small>Applied at Stripe checkout. Leave blank to continue without a discount.</small>
      </label>

      <div class="billing-plan-list core-plans">
        <article
          v-for="plan in planCards"
          :key="plan.planCode"
          class="billing-plan-card"
          :class="{ current: plan.current, featured: isFeaturedCorePlan(plan) }"
        >
          <div class="billing-plan-head">
            <div>
              <p class="billing-card-label">{{ plan.label }}</p>
              <strong>{{ plan.priceDisplay }}</strong>
            </div>
            <span v-if="plan.current" class="billing-current-badge">Current</span>
            <span v-else-if="isFeaturedCorePlan(plan)" class="billing-current-badge featured">Recommended</span>
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
    </section>

    <section class="billing-panel">
      <div class="billing-section-heading">
        <div>
          <p class="billing-card-label">Email add-on</p>
          <h2>Separate email billing from the core plan so the upsell stays clear.</h2>
        </div>
        <span
          v-if="emailAddon"
          class="billing-status-chip"
          :class="`state-${emailAddon.usageState}`"
        >
          {{ formatUsageState(emailAddon.usageState) }}
        </span>
      </div>

      <p class="billing-panel-copy">
        Email billing follows active mailable contacts and actual recipients sent in the current billing period. Daily email limits remain a background abuse guard.
      </p>

      <div v-if="emailAddon" class="billing-email-top-grid">
        <article class="billing-email-summary-card" :class="`state-${emailAddon.usageState}`">
          <div>
            <p class="billing-card-label">Current email tier</p>
            <strong>{{ emailAddon.label }}</strong>
          </div>
          <div class="billing-email-summary-meta">
            <span class="billing-status-chip">{{ formatEmailAddonSource(emailAddon.source) }}</span>
            <span>
              {{ new Date(emailAddon.billingPeriodStart).toLocaleDateString() }} - {{ new Date(emailAddon.billingPeriodEnd).toLocaleDateString() }}
            </span>
          </div>
          <p>{{ emailAddon.description }}</p>
        </article>

        <article class="billing-email-metric-card">
          <div class="billing-email-metric-head">
            <div>
              <p class="billing-card-label">Active subscribers</p>
              <strong>{{ formatNumber(emailAddon.currentSubscriberCount) }} / {{ formatBillingCap(emailAddon.subscriberLimit) }}</strong>
            </div>
            <span>
              {{
                emailAddon.subscriberRemaining === null
                  ? "Custom"
                  : emailAddon.subscriberLimit && emailAddon.subscriberLimit > 0
                    ? `${formatNumber(emailAddon.subscriberRemaining)} left`
                    : "No allowance"
              }}
            </span>
          </div>
          <div class="billing-progress-track">
            <span
              class="billing-progress-fill"
              :style="{ width: `${resolveUsageProgress(emailAddon.currentSubscriberCount, emailAddon.subscriberLimit)}%` }"
            ></span>
          </div>
          <p>Only active, mailable contacts count toward subscriber billing.</p>
        </article>

        <article class="billing-email-metric-card">
          <div class="billing-email-metric-head">
            <div>
              <p class="billing-card-label">Emails this period</p>
              <strong>{{ formatNumber(emailAddon.currentPeriodEmailUsage) }} / {{ formatBillingCap(emailAddon.monthlyEmailLimit) }}</strong>
            </div>
            <span>
              {{
                emailAddon.monthlyEmailRemaining === null
                  ? "Custom"
                  : emailAddon.monthlyEmailLimit && emailAddon.monthlyEmailLimit > 0
                    ? `${formatNumber(emailAddon.monthlyEmailRemaining)} left`
                    : "No allowance"
              }}
            </span>
          </div>
          <div class="billing-progress-track">
            <span
              class="billing-progress-fill"
              :style="{ width: `${resolveUsageProgress(emailAddon.currentPeriodEmailUsage, emailAddon.monthlyEmailLimit)}%` }"
            ></span>
          </div>
          <p>Usage reflects actual sent recipients in the current billing period.</p>
        </article>
      </div>

      <p v-else class="billing-empty-state">
        Email billing details will appear once workspace billing is loaded.
      </p>

      <p v-if="emailAddon" class="billing-email-footnote">
        <template v-if="emailAddon.fullListCampaignCapacity !== null">
          About {{ emailAddon.fullListCampaignCapacity }} full-list campaign{{ emailAddon.fullListCampaignCapacity === 1 ? "" : "s" }} fit inside this monthly allowance.
        </template>
        <template v-else>
          This workspace uses a manual or custom email billing setup.
        </template>
      </p>

      <div class="billing-plan-list email-addon">
        <article
          v-for="plan in emailPlanCards"
          :key="plan.tierCode"
          class="billing-plan-card"
          :class="{ current: plan.current, featured: isFeaturedEmailPlan(plan) }"
        >
          <div class="billing-plan-head">
            <div>
              <p class="billing-card-label">{{ plan.label }}</p>
              <strong>{{ plan.priceDisplay }}</strong>
            </div>
            <span v-if="plan.current" class="billing-current-badge">
              {{ emailAddon?.source === "addon" ? "Add-on" : "Included" }}
            </span>
            <span v-else-if="isFeaturedEmailPlan(plan)" class="billing-current-badge featured">Popular</span>
          </div>

          <p class="billing-plan-description">{{ plan.description }}</p>

          <ul class="billing-highlight-list">
            <li v-for="highlight in plan.highlights" :key="highlight">{{ highlight }}</li>
          </ul>

          <button
            type="button"
            class="billing-plan-button"
            :class="{ secondary: plan.current || emailAddon?.source === 'addon' }"
            :disabled="emailPlanActionDisabled(plan) || activeEmailPlanAction === plan.tierCode"
            @click="void handleEmailPlanAction(plan)"
          >
            {{
              activeEmailPlanAction === plan.tierCode
                ? "Redirecting..."
                : getEmailPlanActionLabel(plan)
            }}
          </button>
        </article>
      </div>
    </section>
  </main>
</template>

<style scoped>
.billing-shell {
  width: min(1180px, 100%);
  margin: 0 auto;
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
  gap: 12px;
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
.billing-panel h2,
.billing-overview-cta h3 {
  margin: 10px 0 0;
  font-size: clamp(2rem, 4vw, 3rem);
  line-height: 0.95;
  color: var(--fc-text);
}

.billing-panel h2 {
  font-size: clamp(1.25rem, 2vw, 1.7rem);
  line-height: 1.05;
}

.billing-overview-cta h3 {
  font-size: clamp(1.3rem, 2vw, 1.6rem);
}

.billing-description,
.billing-panel-copy,
.billing-plan-description,
.billing-usage-card p,
.billing-email-summary-card p,
.billing-email-metric-card p,
.billing-current-plan-card p,
.billing-inline-metric p,
.billing-empty-state {
  margin: 0;
  color: color-mix(in srgb, var(--fc-text) 78%, white 22%);
  line-height: 1.6;
}

.billing-panel {
  display: grid;
  gap: 20px;
  padding: clamp(22px, 3vw, 30px);
}

.billing-current-plan-card,
.billing-usage-card,
.billing-inline-metric,
.billing-plan-card {
  border: 1px solid color-mix(in srgb, var(--fc-border) 80%, white 20%);
  border-radius: 22px;
  background: rgba(255, 255, 255, 0.78);
}

.billing-current-plan-card {
  display: grid;
  gap: 16px;
  padding: 22px;
}

.billing-current-plan-card strong,
.billing-usage-card strong,
.billing-plan-head strong,
.billing-inline-metric strong {
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

.billing-section-heading {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.billing-section-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.billing-overview-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(320px, 0.85fr);
  gap: 18px;
}

.billing-overview-cta {
  align-content: start;
  background: linear-gradient(135deg, rgba(240, 141, 47, 0.16) 0%, rgba(255, 255, 255, 0.9) 100%);
}

.billing-overview-meta {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.billing-inline-metric {
  padding: 16px;
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

.billing-current-badge.featured {
  background: rgba(242, 229, 177, 0.92);
  color: #7d5b0e;
}

.billing-usage-grid {
  display: grid;
  gap: 14px;
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.billing-email-summary-card,
.billing-email-metric-card {
  display: grid;
  gap: 12px;
  padding: 18px;
  border: 1px solid color-mix(in srgb, var(--fc-border) 80%, white 20%);
  border-radius: 22px;
  background: rgba(255, 255, 255, 0.8);
}

.billing-email-top-grid {
  display: grid;
  gap: 14px;
  grid-template-columns: minmax(0, 1.15fr) repeat(2, minmax(0, 0.9fr));
}

.billing-email-summary-meta,
.billing-email-metric-head {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.billing-email-summary-card strong,
.billing-email-metric-card strong {
  display: block;
  margin-top: 10px;
  font-size: 1.6rem;
  line-height: 1;
  color: var(--fc-text);
}

.billing-email-summary-meta span:last-child,
.billing-email-metric-head span,
.billing-email-footnote {
  color: color-mix(in srgb, var(--fc-text) 76%, white 24%);
  line-height: 1.5;
}

.billing-progress-track {
  position: relative;
  overflow: hidden;
  height: 10px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--fc-border) 80%, white 20%);
}

.billing-progress-fill {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(135deg, #d85e2a 0%, #f08d2f 100%);
}

.billing-email-summary-card.state-warning,
.billing-status-chip.state-warning {
  border-color: rgba(206, 143, 21, 0.28);
  background: rgba(255, 245, 214, 0.92);
  color: #8c5d0a;
}

.billing-email-summary-card.state-over_limit,
.billing-status-chip.state-over_limit {
  border-color: rgba(209, 75, 47, 0.28);
  background: rgba(255, 231, 224, 0.95);
  color: #9f351f;
}

.billing-email-summary-card.state-healthy,
.billing-status-chip.state-healthy {
  border-color: rgba(79, 154, 104, 0.22);
  background: rgba(232, 245, 235, 0.94);
  color: #24613f;
}

.billing-email-summary-card.state-inactive,
.billing-status-chip.state-inactive {
  border-color: color-mix(in srgb, var(--fc-border) 80%, white 20%);
  background: rgba(247, 242, 236, 0.92);
  color: #7a5a47;
}

.billing-usage-card {
  display: grid;
  gap: 14px;
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
  gap: 16px;
}

.billing-plan-list.core-plans {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.billing-plan-list.email-addon {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.billing-code-toggle {
  justify-self: start;
}

.billing-promo-field {
  display: grid;
  gap: 8px;
}

.billing-promo-field input {
  min-height: 48px;
  padding: 0 14px;
  border: 1px solid rgba(126, 93, 72, 0.2);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.82);
  color: var(--fc-text);
  font: inherit;
}

.billing-promo-field small {
  color: var(--fc-text-muted);
  line-height: 1.5;
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

.billing-plan-card.featured {
  border-color: rgba(240, 141, 47, 0.38);
  box-shadow: 0 18px 32px rgba(216, 94, 42, 0.08);
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

@media (max-width: 1100px) {
  .billing-overview-grid,
  .billing-email-top-grid {
    grid-template-columns: 1fr;
  }

  .billing-usage-grid,
  .billing-plan-list.core-plans,
  .billing-plan-list.email-addon {
    grid-template-columns: repeat(2, minmax(0, 1fr));
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

  .billing-overview-meta,
  .billing-usage-grid,
  .billing-plan-list.core-plans,
  .billing-plan-list.email-addon {
    grid-template-columns: 1fr;
  }
}
</style>
