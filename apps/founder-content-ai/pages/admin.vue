<script setup lang="ts">
import { onMounted, ref } from "vue";
import type { AdminOpsOverview, PlatformOverview, SystemErrorLogEntry } from "../../../packages/shared-types";
import {
  requestAdminErrors,
  requestAdminOpsOverview,
  requestAdminOverview,
} from "../services/admin-analytics-service";
import { appRoutes } from "../utils/routes";

const overview = ref<PlatformOverview | null>(null);
const opsOverview = ref<AdminOpsOverview | null>(null);
const recentErrors = ref<SystemErrorLogEntry[]>([]);
const isLoading = ref(true);
const errorMessage = ref("");

async function loadOverview() {
  isLoading.value = true;
  errorMessage.value = "";

  try {
    const [overviewResponse, opsResponse, errorsResponse] = await Promise.all([
      requestAdminOverview(),
      requestAdminOpsOverview(),
      requestAdminErrors(),
    ]);
    overview.value = overviewResponse.overview;
    opsOverview.value = opsResponse.overview;
    recentErrors.value = errorsResponse.errors.slice(0, 5);
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "Unable to load admin overview.";
  } finally {
    isLoading.value = false;
  }
}

onMounted(() => {
  void loadOverview();
});
</script>

<template>
  <main class="dashboard-shell">
    <section class="dashboard-hero">
      <p class="dashboard-eyebrow">/admin</p>
      <h1>Platform Overview</h1>
      <p class="dashboard-description">
        Lightweight admin analytics foundation for growth, usage, AI cost visibility, and alerts.
      </p>
    </section>

    <p v-if="isLoading" class="dashboard-feedback">Loading admin overview...</p>
    <p v-else-if="errorMessage" class="dashboard-feedback error">{{ errorMessage }}</p>

    <template v-else-if="overview">
      <section class="dashboard-card-grid">
        <article class="dashboard-card">
          <p class="dashboard-card-label">Users</p>
          <strong>{{ overview.totals.totalUsers }}</strong>
        </article>
        <article class="dashboard-card">
          <p class="dashboard-card-label">Workspaces</p>
          <strong>{{ overview.totals.totalWorkspaces }}</strong>
        </article>
        <article class="dashboard-card">
          <p class="dashboard-card-label">Generations</p>
          <strong>{{ overview.totals.totalGenerations }}</strong>
        </article>
        <article class="dashboard-card">
          <p class="dashboard-card-label">API Failures</p>
          <strong>{{ overview.totals.totalApiFailures }}</strong>
        </article>
        <article class="dashboard-card">
          <p class="dashboard-card-label">Unresolved Alerts</p>
          <strong>{{ overview.totals.unresolvedAlerts }}</strong>
        </article>
        <article class="dashboard-card">
          <p class="dashboard-card-label">Estimated AI Cost</p>
          <strong>${{ overview.aiUsage.estimatedCostUsd.toFixed(4) }}</strong>
        </article>
      </section>

      <section v-if="opsOverview" class="dashboard-card-grid">
        <article class="dashboard-card">
          <p class="dashboard-card-label">AI Calls Today</p>
          <strong>{{ opsOverview.aiCallsToday }}</strong>
        </article>
        <article class="dashboard-card">
          <p class="dashboard-card-label">Outreach Messages</p>
          <strong>{{ opsOverview.outreachMessagesToday }}</strong>
        </article>
        <article class="dashboard-card">
          <p class="dashboard-card-label">Emails Sent</p>
          <strong>{{ opsOverview.emailSendsToday }}</strong>
        </article>
        <article class="dashboard-card">
          <p class="dashboard-card-label">Failures Today</p>
          <strong>{{ opsOverview.failuresToday }}</strong>
        </article>
        <article class="dashboard-card">
          <p class="dashboard-card-label">Active Users Today</p>
          <strong>{{ opsOverview.activeUsersToday }}</strong>
        </article>
      </section>

      <section class="dashboard-grid-two">
        <article class="dashboard-panel">
          <h2>User Growth (14d)</h2>
          <table class="data-table compact">
            <thead>
              <tr>
                <th>Date</th>
                <th>Users</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="point in overview.userGrowth" :key="point.date">
                <td>{{ point.date }}</td>
                <td>{{ point.value }}</td>
              </tr>
            </tbody>
          </table>
        </article>

        <article class="dashboard-panel">
          <h2>Workspace Growth (14d)</h2>
          <table class="data-table compact">
            <thead>
              <tr>
                <th>Date</th>
                <th>Workspaces</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="point in overview.workspaceGrowth" :key="point.date">
                <td>{{ point.date }}</td>
                <td>{{ point.value }}</td>
              </tr>
            </tbody>
          </table>
        </article>
      </section>

      <section class="dashboard-grid-two">
        <article class="dashboard-panel">
          <h2>Usage Trend (14d)</h2>
          <table class="data-table compact">
            <thead>
              <tr>
                <th>Date</th>
                <th>Events</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="point in overview.usageTrend" :key="point.date">
                <td>{{ point.date }}</td>
                <td>{{ point.value }}</td>
              </tr>
            </tbody>
          </table>
        </article>

        <article class="dashboard-panel">
          <h2>Active Alerts</h2>
          <ul class="dashboard-list">
            <li v-for="alert in overview.alerts" :key="alert.id">
              <strong>{{ alert.severity.toUpperCase() }}</strong>
              <span>{{ alert.message }}</span>
            </li>
            <li v-if="overview.alerts.length === 0">No active alerts.</li>
          </ul>
        </article>
      </section>

      <section class="dashboard-panel">
        <h2>Recent Errors</h2>
        <table class="data-table compact">
          <thead>
            <tr>
              <th>Code</th>
              <th>Route</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="entry in recentErrors" :key="entry.id">
              <td>{{ entry.code }}</td>
              <td>{{ entry.route }}</td>
              <td>{{ entry.createdAt }}</td>
            </tr>
            <tr v-if="recentErrors.length === 0">
              <td colspan="3">No recent errors.</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="dashboard-panel">
        <div class="panel-header">
          <div>
            <p class="panel-meta">Operator Surface</p>
            <h2>Admin Control Screens</h2>
          </div>
        </div>

        <div class="admin-link-row">
          <router-link class="dashboard-button secondary" :to="appRoutes.adminFeatures">
            Features
          </router-link>
          <router-link class="dashboard-button secondary" :to="appRoutes.adminOutreach">
            Outreach
          </router-link>
          <router-link class="dashboard-button secondary" :to="appRoutes.adminUsers">
            Users
          </router-link>
          <router-link class="dashboard-button secondary" :to="appRoutes.adminWorkspaces">
            Workspaces
          </router-link>
          <router-link class="dashboard-button secondary" :to="appRoutes.adminUsage">
            Usage
          </router-link>
        </div>
      </section>
    </template>
  </main>
</template>

<style scoped>
.admin-link-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
</style>
