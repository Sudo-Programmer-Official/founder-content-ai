<script setup lang="ts">
import type {
  AdminWorkspaceListItem,
  BillingEmailAddonTierCode,
  BusinessPlanCode,
  UpdateAdminWorkspaceAccessRequest,
} from "../../../packages/shared-types";
import { onMounted, reactive, ref } from "vue";
import {
  requestAdminWorkspaceAccessUpdate,
  requestAdminWorkspaces,
} from "../services/admin-analytics-service";

const workspaces = ref<AdminWorkspaceListItem[]>([]);
const totalWorkspaces = ref(0);
const isLoading = ref(true);
const errorMessage = ref("");
const feedbackMessage = ref("");
const isMutating = ref(false);
const selectedPlanByWorkspace = reactive<Record<string, BusinessPlanCode>>({});
const selectedEmailTierByWorkspace = reactive<Record<string, BillingEmailAddonTierCode>>({});

async function loadWorkspaces() {
  isLoading.value = true;
  errorMessage.value = "";

  try {
    const response = await requestAdminWorkspaces();
    workspaces.value = response.workspaces;
    totalWorkspaces.value = response.totalWorkspaces;

    for (const workspace of response.workspaces) {
      selectedPlanByWorkspace[workspace.id] = workspace.access.planCode;
      selectedEmailTierByWorkspace[workspace.id] = workspace.emailAddon?.tierCode ?? "none";
    }
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "Unable to load admin workspaces.";
  } finally {
    isLoading.value = false;
  }
}

async function applyWorkspaceAction(
  workspace: AdminWorkspaceListItem,
  payload: UpdateAdminWorkspaceAccessRequest,
  successMessage: string,
) {
  isMutating.value = true;
  errorMessage.value = "";
  feedbackMessage.value = "";

  try {
    await requestAdminWorkspaceAccessUpdate(workspace.id, payload);
    feedbackMessage.value = successMessage;
    await loadWorkspaces();
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "Unable to update workspace access.";
  } finally {
    isMutating.value = false;
  }
}

onMounted(() => {
  void loadWorkspaces();
});
</script>

<template>
  <main class="dashboard-shell">
    <section class="dashboard-hero">
      <p class="dashboard-eyebrow">/admin/workspaces</p>
      <h1>Workspace Control</h1>
      <p class="dashboard-description">
        Adjust plan access, extend recovery windows, and reset daily limits without touching the underlying product flows.
      </p>
    </section>

    <p v-if="isLoading" class="dashboard-feedback">Loading workspaces...</p>
    <p v-else-if="errorMessage" class="dashboard-feedback error">{{ errorMessage }}</p>
    <p v-if="feedbackMessage" class="dashboard-feedback workspace-feedback">{{ feedbackMessage }}</p>

    <section v-if="!isLoading" class="workspace-card-list">
      <article v-for="workspace in workspaces" :key="workspace.id" class="dashboard-panel workspace-card">
        <div class="panel-header">
          <div>
            <p class="panel-meta">Workspace</p>
            <h2>{{ workspace.name }}</h2>
            <p class="workspace-copy">
              {{ workspace.slug }} · Owner {{ workspace.ownerEmail || "n/a" }} · {{ workspace.memberCount }} members
            </p>
          </div>
          <div class="workspace-status-row">
            <span class="topbar-pill" :data-state="workspace.access.isActive ? 'active' : 'inactive'">
              {{ workspace.access.isActive ? "Active" : "Disabled" }}
            </span>
            <span class="topbar-pill muted">Plan {{ workspace.access.planCode }}</span>
          </div>
        </div>

        <div class="workspace-grid">
          <div class="workspace-meta-block">
            <strong>Status</strong>
            <span>{{ workspace.status }}</span>
          </div>
          <div class="workspace-meta-block">
            <strong>Created</strong>
            <span>{{ workspace.createdAt.slice(0, 10) }}</span>
          </div>
          <div class="workspace-meta-block">
            <strong>Last active</strong>
            <span>{{ workspace.lastActiveAt ? workspace.lastActiveAt.slice(0, 16).replace('T', ' ') : "No activity yet" }}</span>
          </div>
          <div class="workspace-meta-block">
            <strong>Trial</strong>
            <span>{{ workspace.access.trialEndsAt ? workspace.access.trialEndsAt.slice(0, 10) : "Not set" }}</span>
          </div>
          <div class="workspace-meta-block">
            <strong>Grace</strong>
            <span>{{ workspace.access.graceUntil ? workspace.access.graceUntil.slice(0, 10) : "Not set" }}</span>
          </div>
          <div class="workspace-meta-block">
            <strong>Recent override</strong>
            <span>{{ workspace.access.recentAdminActionSummary || "None yet" }}</span>
          </div>
        </div>

        <div class="workspace-limits-grid">
          <article class="workspace-limit-chip">
            <span>Posts</span>
            <strong>{{ workspace.access.dailyLimits.postsUsed }} / {{ workspace.access.dailyLimits.postsLimit }}</strong>
          </article>
          <article class="workspace-limit-chip">
            <span>Emails</span>
            <strong>{{ workspace.access.dailyLimits.emailsUsed }} / {{ workspace.access.dailyLimits.emailsLimit }}</strong>
          </article>
          <article class="workspace-limit-chip">
            <span>Outreach</span>
            <strong>{{ workspace.access.dailyLimits.outreachUsed }} / {{ workspace.access.dailyLimits.outreachLimit }}</strong>
          </article>
        </div>

        <div v-if="workspace.emailAddon" class="workspace-email-billing-grid">
          <article class="workspace-limit-chip">
            <span>Email tier</span>
            <strong>{{ workspace.emailAddon.label }}</strong>
            <small>{{ workspace.emailAddon.source }}</small>
          </article>
          <article class="workspace-limit-chip">
            <span>Subscribers</span>
            <strong>{{ workspace.emailAddon.currentSubscriberCount }} / {{ workspace.emailAddon.subscriberLimit ?? "Custom" }}</strong>
            <small>{{ workspace.emailAddon.usageState }}</small>
          </article>
          <article class="workspace-limit-chip">
            <span>Emails this period</span>
            <strong>{{ workspace.emailAddon.currentPeriodEmailUsage }} / {{ workspace.emailAddon.monthlyEmailLimit ?? "Custom" }}</strong>
            <small>{{ workspace.emailAddon.billingPeriodStart.slice(0, 10) }} - {{ workspace.emailAddon.billingPeriodEnd.slice(0, 10) }}</small>
          </article>
        </div>

        <div class="workspace-plan-row">
          <label class="dashboard-field">
            <span>Plan</span>
            <select v-model="selectedPlanByWorkspace[workspace.id]">
              <option value="free">Free</option>
              <option value="pro">Pro</option>
              <option value="growth">Growth</option>
              <option value="custom">Custom</option>
            </select>
          </label>

          <button
            type="button"
            class="dashboard-button secondary"
            :disabled="isMutating"
            @click="
              applyWorkspaceAction(
                workspace,
                {
                  action: 'set_plan',
                  planCode: selectedPlanByWorkspace[workspace.id],
                  note: 'Plan changed from admin control.',
                },
                `${workspace.name} plan updated.`,
              )
            "
          >
            Set plan
          </button>
        </div>

        <div class="workspace-plan-row">
          <label class="dashboard-field">
            <span>Email tier</span>
            <select v-model="selectedEmailTierByWorkspace[workspace.id]">
              <option value="none">None</option>
              <option value="starter_email">Starter Email</option>
              <option value="growth_email">Growth Email</option>
              <option value="scale_email">Scale Email</option>
              <option value="custom">Custom</option>
            </select>
          </label>

          <button
            type="button"
            class="dashboard-button secondary"
            :disabled="isMutating"
            @click="
              applyWorkspaceAction(
                workspace,
                {
                  action: 'set_email_billing',
                  emailBillingTierCode: selectedEmailTierByWorkspace[workspace.id],
                  note: 'Email billing tier changed from admin control.',
                },
                `${workspace.name} email tier updated.`,
              )
            "
          >
            Set email tier
          </button>
        </div>

        <div class="workspace-action-row">
          <button
            type="button"
            class="dashboard-button secondary"
            :disabled="isMutating"
            @click="
              applyWorkspaceAction(
                workspace,
                {
                  action: 'grant_pro_access',
                  note: 'Granted Pro access from admin control.',
                },
                `${workspace.name} upgraded to Pro.`,
              )
            "
          >
            Grant Pro
          </button>
          <button
            type="button"
            class="dashboard-button secondary"
            :disabled="isMutating"
            @click="
              applyWorkspaceAction(
                workspace,
                {
                  action: 'extend_trial',
                  trialDays: 7,
                  note: 'Extended trial from admin control.',
                },
                `${workspace.name} trial extended by 7 days.`,
              )
            "
          >
            Extend Trial
          </button>
          <button
            type="button"
            class="dashboard-button secondary"
            :disabled="isMutating"
            @click="
              applyWorkspaceAction(
                workspace,
                {
                  action: 'extend_grace',
                  graceDays: 3,
                  note: 'Extended grace period from admin control.',
                },
                `${workspace.name} grace period extended.`,
              )
            "
          >
            Extend Grace
          </button>
          <button
            type="button"
            class="dashboard-button secondary"
            :disabled="isMutating"
            @click="
              applyWorkspaceAction(
                workspace,
                {
                  action: 'reset_limits',
                  note: 'Reset daily limits from admin control.',
                },
                `${workspace.name} daily limits reset.`,
              )
            "
          >
            Reset Limits
          </button>
          <button
            type="button"
            class="dashboard-button secondary"
            :disabled="isMutating"
            @click="
              applyWorkspaceAction(
                workspace,
                {
                  action: workspace.access.isActive ? 'disable_business' : 'enable_business',
                  note: workspace.access.isActive
                    ? 'Disabled from admin control.'
                    : 'Re-enabled from admin control.',
                },
                workspace.access.isActive
                  ? `${workspace.name} disabled.`
                  : `${workspace.name} re-enabled.`,
              )
            "
          >
            {{ workspace.access.isActive ? "Disable" : "Enable" }}
          </button>
        </div>

        <p v-if="workspace.access.adminOverrideNote" class="workspace-note">
          {{ workspace.access.adminOverrideNote }}
        </p>
      </article>

      <article v-if="workspaces.length === 0" class="dashboard-panel">
        <p class="panel-meta">Workspace Control</p>
        <h2>No workspaces yet</h2>
        <p class="dashboard-description">
          Workspaces will appear here once real users create them.
        </p>
      </article>
    </section>
  </main>
</template>

<style scoped>
.workspace-feedback {
  color: var(--fc-success-text);
}

.workspace-card-list,
.workspace-card {
  display: grid;
  gap: 18px;
}

.workspace-status-row,
.workspace-limits-grid,
.workspace-email-billing-grid,
.workspace-action-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.workspace-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}

.workspace-meta-block,
.workspace-limit-chip {
  display: grid;
  gap: 6px;
  padding: 14px 16px;
  border: 1px solid var(--fc-border);
  border-radius: 16px;
  background: var(--fc-input-bg);
}

.workspace-copy,
.workspace-note {
  margin: 0;
  color: var(--fc-text-muted);
  line-height: 1.6;
}

.workspace-note {
  font-size: 0.95rem;
}

.workspace-meta-block strong,
.workspace-limit-chip span {
  font-size: 0.82rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--fc-text-muted);
}

.workspace-plan-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: end;
}

.workspace-plan-row .dashboard-field {
  min-width: 180px;
}

.workspace-limit-chip small {
  color: var(--fc-text-muted);
  line-height: 1.5;
}

.topbar-pill[data-state="active"] {
  border-color: color-mix(in srgb, var(--fc-success-text) 30%, var(--fc-border));
  background: color-mix(in srgb, var(--fc-success-bg) 42%, var(--fc-panel-bg));
}

.topbar-pill[data-state="inactive"] {
  border-color: color-mix(in srgb, var(--fc-warning-text) 30%, var(--fc-border));
  background: color-mix(in srgb, var(--fc-warning-bg) 40%, var(--fc-panel-bg));
}

@media (max-width: 980px) {
  .workspace-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .workspace-grid {
    grid-template-columns: 1fr;
  }
}
</style>
