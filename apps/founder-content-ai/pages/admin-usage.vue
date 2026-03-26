<script setup lang="ts">
import { onMounted, ref } from "vue";
import type { AdminUsageResponse } from "../../../packages/shared-types";
import { requestAdminUsage } from "../services/admin-analytics-service";

const usage = ref<AdminUsageResponse | null>(null);
const isLoading = ref(true);
const errorMessage = ref("");

async function loadUsage() {
  isLoading.value = true;
  errorMessage.value = "";

  try {
    usage.value = await requestAdminUsage();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Unable to load admin usage.";
  } finally {
    isLoading.value = false;
  }
}

onMounted(() => {
  void loadUsage();
});
</script>

<template>
  <main class="dashboard-shell">
    <section class="dashboard-hero">
      <p class="dashboard-eyebrow">/admin/usage</p>
      <h1>Admin Usage</h1>
      <p class="dashboard-description">
        AI cost visibility, recent events, and alert monitoring for the platform.
      </p>
    </section>

    <p v-if="isLoading" class="dashboard-feedback">Loading usage...</p>
    <p v-else-if="errorMessage" class="dashboard-feedback error">{{ errorMessage }}</p>

    <template v-else-if="usage">
      <section class="dashboard-card-grid">
        <article class="dashboard-card">
          <p class="dashboard-card-label">Requests</p>
          <strong>{{ usage.aiCostSummary.totalRequests }}</strong>
        </article>
        <article class="dashboard-card">
          <p class="dashboard-card-label">Successful</p>
          <strong>{{ usage.aiCostSummary.successfulRequests }}</strong>
        </article>
        <article class="dashboard-card">
          <p class="dashboard-card-label">Failed</p>
          <strong>{{ usage.aiCostSummary.failedRequests }}</strong>
        </article>
        <article class="dashboard-card">
          <p class="dashboard-card-label">Tokens</p>
          <strong>{{ usage.aiCostSummary.totalTokens }}</strong>
        </article>
        <article class="dashboard-card">
          <p class="dashboard-card-label">Estimated Cost</p>
          <strong>${{ usage.aiCostSummary.estimatedCostUsd.toFixed(4) }}</strong>
        </article>
        <article class="dashboard-card">
          <p class="dashboard-card-label">Active Alerts</p>
          <strong>{{ usage.alerts.length }}</strong>
        </article>
      </section>

      <section class="dashboard-grid-two">
        <article class="dashboard-panel">
          <h2>Event Breakdown</h2>
          <table class="data-table compact">
            <thead>
              <tr>
                <th>Event</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="entry in usage.usageSummary.eventBreakdown" :key="entry.eventType">
                <td>{{ entry.eventType }}</td>
                <td>{{ entry.total }}</td>
              </tr>
            </tbody>
          </table>
        </article>

        <article class="dashboard-panel">
          <h2>Alerts</h2>
          <ul class="dashboard-list">
            <li v-for="alert in usage.alerts" :key="alert.id">
              <strong>{{ alert.severity.toUpperCase() }}</strong>
              <span>{{ alert.message }}</span>
            </li>
            <li v-if="usage.alerts.length === 0">No active alerts.</li>
          </ul>
        </article>
      </section>

      <section class="dashboard-panel">
        <h2>Recent Events</h2>
        <table class="data-table compact">
          <thead>
            <tr>
              <th>Event</th>
              <th>Business</th>
              <th>At</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="event in usage.usageSummary.recentEvents" :key="event.id">
              <td>{{ event.eventType }}</td>
              <td>{{ event.businessId || "platform" }}</td>
              <td>{{ event.createdAt }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="dashboard-panel">
        <h2>Recent Generation Logs</h2>
        <table class="data-table compact">
          <thead>
            <tr>
              <th>Model</th>
              <th>Input</th>
              <th>Tokens</th>
              <th>Latency</th>
              <th>Success</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="log in usage.usageSummary.recentGenerationLogs" :key="log.id">
              <td>{{ log.model }}</td>
              <td>{{ log.inputType }}</td>
              <td>{{ log.tokensUsed }}</td>
              <td>{{ log.latencyMs }} ms</td>
              <td>{{ log.success ? "yes" : "no" }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>
  </main>
</template>
