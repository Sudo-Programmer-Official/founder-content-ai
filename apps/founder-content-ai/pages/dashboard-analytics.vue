<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { useProductAccessContext } from "../access/product-access-context";
import type { BusinessMembership, WorkspaceOverview } from "../../../packages/shared-types";
import {
  requestMyBusinesses,
  requestWorkspaceAnalyticsOverview,
} from "../services/admin-analytics-service";

const memberships = ref<BusinessMembership[]>([]);
const businessId = ref("");
const overview = ref<WorkspaceOverview | null>(null);
const isLoading = ref(true);
const errorMessage = ref("");
const { bootstrap: productAccess, setActiveBusinessId } = useProductAccessContext();

async function loadMemberships() {
  const response = await requestMyBusinesses();
  memberships.value = response.businesses;
  businessId.value = productAccess.value?.activeBusinessId || response.businesses[0]?.businessId || "";
}

async function loadOverview() {
  if (!businessId.value) {
    overview.value = null;
    errorMessage.value = "No workspace is available for analytics yet.";
    isLoading.value = false;
    return;
  }

  isLoading.value = true;
  errorMessage.value = "";

  try {
    const response = await requestWorkspaceAnalyticsOverview(businessId.value);
    overview.value = response.overview;
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "Unable to load workspace analytics.";
  } finally {
    isLoading.value = false;
  }
}

onMounted(async () => {
  isLoading.value = true;

  try {
    await loadMemberships();

    if (businessId.value) {
      const accessState = await setActiveBusinessId(businessId.value);

      if (accessState?.activeBusinessId && accessState.activeBusinessId !== businessId.value) {
        businessId.value = accessState.activeBusinessId;
      }
    }

    await loadOverview();
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "Unable to load workspace analytics.";
    isLoading.value = false;
  }
});

watch(businessId, async (nextBusinessId, previousBusinessId) => {
  if (!nextBusinessId || nextBusinessId === previousBusinessId) {
    return;
  }

  const accessState = await setActiveBusinessId(nextBusinessId);

  if (accessState?.activeBusinessId && accessState.activeBusinessId !== nextBusinessId) {
    businessId.value = accessState.activeBusinessId;
    return;
  }

  await loadOverview();
});
</script>

<template>
  <main class="dashboard-shell">
    <section class="dashboard-hero">
      <p class="dashboard-eyebrow">/dashboard/analytics</p>
      <h1>Workspace Analytics</h1>
      <p class="dashboard-description">
        Monitor generation volume, copy/remix behavior, and the basic generate-to-publish funnel.
      </p>
    </section>

    <section class="dashboard-panel">
      <div class="panel-header">
        <h2>Workspace</h2>
      </div>

      <label class="dashboard-field">
        <span>Select workspace</span>
        <select v-model="businessId">
          <option value="" disabled>Select a workspace</option>
          <option v-for="membership in memberships" :key="membership.id" :value="membership.businessId">
            {{ membership.business.name }}
          </option>
        </select>
      </label>
    </section>

    <p v-if="isLoading" class="dashboard-feedback">Loading workspace analytics...</p>
    <p v-else-if="errorMessage" class="dashboard-feedback error">{{ errorMessage }}</p>

    <template v-else-if="overview">
      <section class="dashboard-card-grid">
        <article class="dashboard-card">
          <p class="dashboard-card-label">Generations</p>
          <strong>{{ overview.totals.totalGenerations }}</strong>
        </article>
        <article class="dashboard-card">
          <p class="dashboard-card-label">Copies</p>
          <strong>{{ overview.totals.totalCopies }}</strong>
        </article>
        <article class="dashboard-card">
          <p class="dashboard-card-label">Remixes</p>
          <strong>{{ overview.totals.totalRemixes }}</strong>
        </article>
        <article class="dashboard-card">
          <p class="dashboard-card-label">Publishes</p>
          <strong>{{ overview.totals.totalPublishes }}</strong>
        </article>
        <article class="dashboard-card">
          <p class="dashboard-card-label">Assets</p>
          <strong>{{ overview.totals.totalAssets }}</strong>
        </article>
      </section>

      <section class="dashboard-grid-two">
        <article class="dashboard-panel">
          <h2>Funnel</h2>
          <table class="data-table compact">
            <thead>
              <tr>
                <th>Stage</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Generated</td>
                <td>{{ overview.funnel.generated }}</td>
              </tr>
              <tr>
                <td>Copied</td>
                <td>{{ overview.funnel.copied }}</td>
              </tr>
              <tr>
                <td>Published</td>
                <td>{{ overview.funnel.published }}</td>
              </tr>
            </tbody>
          </table>
        </article>

        <article class="dashboard-panel">
          <h2>Daily Metrics</h2>
          <table class="data-table compact">
            <thead>
              <tr>
                <th>Date</th>
                <th>Generations</th>
                <th>Copies</th>
                <th>Remixes</th>
                <th>Publishes</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="metric in overview.dailyMetrics" :key="metric.id">
                <td>{{ metric.date }}</td>
                <td>{{ metric.totalGenerations }}</td>
                <td>{{ metric.totalCopies }}</td>
                <td>{{ metric.totalRemixes }}</td>
                <td>{{ metric.totalPublishes }}</td>
              </tr>
            </tbody>
          </table>
        </article>
      </section>

      <section class="dashboard-grid-two">
        <article class="dashboard-panel">
          <h2>Activity Timeline</h2>
          <table class="data-table compact">
            <thead>
              <tr>
                <th>Event</th>
                <th>At</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="event in overview.activityTimeline" :key="event.id">
                <td>{{ event.eventType }}</td>
                <td>{{ event.createdAt }}</td>
              </tr>
            </tbody>
          </table>
        </article>

        <article class="dashboard-panel">
          <h2>Recent Assets</h2>
          <table class="data-table compact">
            <thead>
              <tr>
                <th>Type</th>
                <th>Status</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="asset in overview.topAssets" :key="asset.id">
                <td>{{ asset.contentType }}</td>
                <td>{{ asset.status }}</td>
                <td>{{ asset.createdAt }}</td>
              </tr>
            </tbody>
          </table>
        </article>
      </section>
    </template>
  </main>
</template>
