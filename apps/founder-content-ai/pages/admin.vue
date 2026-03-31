<script setup lang="ts">
import { onMounted, ref } from "vue";
import type {
  AdminOpsOverview,
  AdminProblemJob,
  PlatformOverview,
  SystemErrorLogEntry,
} from "../../../packages/shared-types";
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

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function formatDateTime(value?: string): string {
  if (!value) {
    return "Not recorded yet";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function formatMinutes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 min";
  }

  return `${value.toFixed(1)} min`;
}

function formatWorkerStatus(status: AdminOpsOverview["workerHealth"]["status"]): string {
  switch (status) {
    case "healthy":
      return "Healthy";
    case "stale":
      return "Stale";
    default:
      return "Offline";
  }
}

function workerStatusClass(status: AdminOpsOverview["workerHealth"]["status"]): string {
  return `status-chip ${status}`;
}

function formatProblemKind(job: AdminProblemJob): string {
  switch (job.problemKind) {
    case "stale_processing":
      return "Stale processing";
    case "stuck_queued":
      return "Stuck queued";
    default:
      return "Failed";
  }
}

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
        <article class="dashboard-card">
          <p class="dashboard-card-label">Risky Email Domains</p>
          <strong>{{ opsOverview.riskyEmailDomains.length }}</strong>
        </article>
        <article class="dashboard-card">
          <p class="dashboard-card-label">Shared Worker</p>
          <strong>{{ formatWorkerStatus(opsOverview.workerHealth.status) }}</strong>
        </article>
        <article class="dashboard-card">
          <p class="dashboard-card-label">Queued Jobs</p>
          <strong>{{ opsOverview.jobQueue.queued }}</strong>
        </article>
        <article class="dashboard-card">
          <p class="dashboard-card-label">Failed Jobs</p>
          <strong>{{ opsOverview.jobQueue.failed }}</strong>
        </article>
        <article class="dashboard-card">
          <p class="dashboard-card-label">Stuck Queued</p>
          <strong>{{ opsOverview.jobQueue.stuckQueued }}</strong>
        </article>
        <article class="dashboard-card">
          <p class="dashboard-card-label">Missed Due Posts</p>
          <strong>{{ opsOverview.postingReliability.missedDueCount }}</strong>
        </article>
        <article class="dashboard-card">
          <p class="dashboard-card-label">Avg Publish Delay</p>
          <strong>{{ formatMinutes(opsOverview.postingReliability.averagePublishDelayMinutes) }}</strong>
        </article>
      </section>

      <section v-if="opsOverview" class="dashboard-grid-two">
        <article class="dashboard-panel">
          <div class="panel-header">
            <div>
              <p class="panel-meta">Worker Runtime</p>
              <h2>Shared Worker Health</h2>
            </div>
            <span :class="workerStatusClass(opsOverview.workerHealth.status)">
              {{ formatWorkerStatus(opsOverview.workerHealth.status) }}
            </span>
          </div>
          <ul class="dashboard-list">
            <li>
              <strong>Service</strong>
              <span>{{ opsOverview.workerHealth.serviceName || opsOverview.workerHealth.workerKey }}</span>
            </li>
            <li>
              <strong>Last heartbeat</strong>
              <span>{{ formatDateTime(opsOverview.workerHealth.lastHeartbeatAt) }}</span>
            </li>
            <li>
              <strong>Last successful pass</strong>
              <span>{{ formatDateTime(opsOverview.workerHealth.lastSuccessfulPassAt) }}</span>
            </li>
            <li>
              <strong>Last work detected</strong>
              <span>{{ formatDateTime(opsOverview.workerHealth.lastWorkDetectedAt) }}</span>
            </li>
            <li>
              <strong>Poll interval</strong>
              <span>{{ Math.round(opsOverview.workerHealth.pollIntervalMs / 1000) }}s</span>
            </li>
            <li v-if="opsOverview.workerHealth.lastErrorMessage">
              <strong>Last crash</strong>
              <span>
                {{ opsOverview.workerHealth.lastErrorMessage }}
                <template v-if="opsOverview.workerHealth.lastErrorAt">
                  · {{ formatDateTime(opsOverview.workerHealth.lastErrorAt) }}
                </template>
              </span>
            </li>
          </ul>
        </article>

        <article class="dashboard-panel">
          <div class="panel-header">
            <div>
              <p class="panel-meta">Posting Reliability</p>
              <h2>Scheduled Post Health</h2>
            </div>
          </div>
          <ul class="dashboard-list">
            <li>
              <strong>Scheduled (7d)</strong>
              <span>{{ opsOverview.postingReliability.scheduledLast7d }}</span>
            </li>
            <li>
              <strong>Published (7d)</strong>
              <span>{{ opsOverview.postingReliability.publishedLast7d }}</span>
            </li>
            <li>
              <strong>Failed (7d)</strong>
              <span>{{ opsOverview.postingReliability.failedLast7d }}</span>
            </li>
            <li>
              <strong>Processing now</strong>
              <span>{{ opsOverview.postingReliability.processingNow }}</span>
            </li>
            <li>
              <strong>Missed due</strong>
              <span>{{ opsOverview.postingReliability.missedDueCount }}</span>
            </li>
            <li>
              <strong>Avg publish delay</strong>
              <span>{{ formatMinutes(opsOverview.postingReliability.averagePublishDelayMinutes) }}</span>
            </li>
          </ul>
        </article>
      </section>

      <section v-if="opsOverview" class="dashboard-panel">
        <h2>Job Backlog By Type</h2>
        <table class="data-table compact">
          <thead>
            <tr>
              <th>Type</th>
              <th>Queued</th>
              <th>Processing</th>
              <th>Failed</th>
              <th>Paused</th>
              <th>Stuck queued</th>
              <th>Stale processing</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in opsOverview.jobQueue.byType" :key="row.type">
              <td>{{ row.type }}</td>
              <td>{{ row.queued }}</td>
              <td>{{ row.processing }}</td>
              <td>{{ row.failed }}</td>
              <td>{{ row.paused }}</td>
              <td>{{ row.stuckQueued }}</td>
              <td>{{ row.staleProcessing }}</td>
            </tr>
            <tr v-if="opsOverview.jobQueue.byType.length === 0">
              <td colspan="7">No queued or failed jobs right now.</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section v-if="opsOverview" class="dashboard-panel">
        <h2>Problem Jobs</h2>
        <table class="data-table compact">
          <thead>
            <tr>
              <th>Kind</th>
              <th>Type</th>
              <th>Status</th>
              <th>Attempts</th>
              <th>Workspace</th>
              <th>Run after</th>
              <th>Message</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="job in opsOverview.jobQueue.problemJobs" :key="job.id">
              <td>{{ formatProblemKind(job) }}</td>
              <td>{{ job.type }}</td>
              <td>{{ job.status }}</td>
              <td>{{ job.attempts }} / {{ job.maxAttempts }}</td>
              <td>{{ job.businessId || "Platform" }}</td>
              <td>{{ formatDateTime(job.runAfter) }}</td>
              <td>{{ job.errorMessage || "No error message recorded." }}</td>
            </tr>
            <tr v-if="opsOverview.jobQueue.problemJobs.length === 0">
              <td colspan="7">No stuck or failed jobs right now.</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section v-if="opsOverview" class="dashboard-panel">
        <h2>Email Deliverability Watchlist</h2>
        <table class="data-table compact">
          <thead>
            <tr>
              <th>Workspace</th>
              <th>Domain</th>
              <th>Score</th>
              <th>Bounce 7d</th>
              <th>Complaint 7d</th>
              <th>Top blocker</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="domain in opsOverview.riskyEmailDomains" :key="`${domain.businessId}-${domain.domainName}`">
              <td>{{ domain.businessName }}</td>
              <td>{{ domain.domainName }}</td>
              <td>{{ domain.score }} / {{ domain.scoreBand }}</td>
              <td>{{ formatPercent(domain.bounceRate7d) }}</td>
              <td>{{ formatPercent(domain.complaintRate7d) }}</td>
              <td>{{ domain.blockers[0]?.message || "No active blocker." }}</td>
            </tr>
            <tr v-if="opsOverview.riskyEmailDomains.length === 0">
              <td colspan="6">No risky email domains right now.</td>
            </tr>
          </tbody>
        </table>
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
          <router-link class="dashboard-button secondary" :to="appRoutes.adminMediaRegistry">
            Media registry
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

.status-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 88px;
  padding: 6px 12px;
  border-radius: 999px;
  font-size: 0.82rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.status-chip.healthy {
  background: rgba(33, 128, 92, 0.14);
  color: #1b6b4d;
}

.status-chip.stale {
  background: rgba(196, 120, 31, 0.14);
  color: #8a5715;
}

.status-chip.offline {
  background: rgba(164, 48, 77, 0.14);
  color: #8b2940;
}
</style>
