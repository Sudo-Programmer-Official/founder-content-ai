<script setup lang="ts">
import { ApiRequestError } from "../services/api-client";
import { onMounted, ref } from "vue";
import type {
  AdminUserDeleteBlockedDetails,
  AdminUserListItem,
} from "../../../packages/shared-types";
import {
  requestAdminUserDelete,
  requestAdminUsers,
} from "../services/admin-analytics-service";

const users = ref<AdminUserListItem[]>([]);
const totalUsers = ref(0);
const isLoading = ref(true);
const errorMessage = ref("");
const feedbackMessage = ref("");
const deletingUserId = ref("");

async function loadUsers() {
  isLoading.value = true;
  errorMessage.value = "";

  try {
    const response = await requestAdminUsers();
    users.value = response.users;
    totalUsers.value = response.totalUsers;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Unable to load admin users.";
  } finally {
    isLoading.value = false;
  }
}

function buildDeleteBlockedMessage(details?: AdminUserDeleteBlockedDetails): string {
  const ownedWorkspaces = details?.ownedWorkspaces ?? [];

  if (ownedWorkspaces.length === 0) {
    return "Transfer owned workspaces before deleting this user.";
  }

  const ownedWorkspaceSummary = ownedWorkspaces
    .map((workspace) => `${workspace.name} (${workspace.slug})`)
    .join(", ");

  return `Transfer owned workspaces before deleting this user: ${ownedWorkspaceSummary}.`;
}

async function deleteUser(user: AdminUserListItem) {
  const confirmed =
    typeof window === "undefined" ||
    window.confirm(
      `Delete ${user.email}?\n\nThis permanently removes the user record and any dependent records that already cascade in the database.`,
    );

  if (!confirmed) {
    return;
  }

  deletingUserId.value = user.id;
  errorMessage.value = "";
  feedbackMessage.value = "";

  try {
    await requestAdminUserDelete(user.id);
    feedbackMessage.value = `${user.email} deleted.`;
    await loadUsers();
  } catch (error) {
    if (error instanceof ApiRequestError && error.code === "admin_user_delete_blocked") {
      errorMessage.value = buildDeleteBlockedMessage(
        error.details as AdminUserDeleteBlockedDetails | undefined,
      );
    } else {
      errorMessage.value = error instanceof Error ? error.message : "Unable to delete admin user.";
    }
  } finally {
    deletingUserId.value = "";
  }
}

onMounted(() => {
  void loadUsers();
});
</script>

<template>
  <main class="dashboard-shell">
    <section class="dashboard-hero">
      <p class="dashboard-eyebrow">/admin/users</p>
      <h1>Admin Users</h1>
      <p class="dashboard-description">Track user growth and workspace participation.</p>
    </section>

    <p v-if="isLoading" class="dashboard-feedback">Loading users...</p>
    <p v-else-if="errorMessage" class="dashboard-feedback error">{{ errorMessage }}</p>
    <p v-if="feedbackMessage" class="dashboard-feedback admin-users-feedback">{{ feedbackMessage }}</p>

    <section v-else class="dashboard-panel">
      <div class="panel-header">
        <h2>Users</h2>
        <span class="panel-meta">{{ totalUsers }} loaded</span>
      </div>

      <table class="data-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Status</th>
            <th>Businesses</th>
            <th>Last Active</th>
            <th>Created</th>
            <th class="admin-users-actions">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="user in users" :key="user.id">
            <td>{{ user.fullName }}</td>
            <td>{{ user.email }}</td>
            <td>{{ user.status }}</td>
            <td>{{ user.businessCount }}</td>
            <td>{{ user.lastActiveAt ? user.lastActiveAt.slice(0, 16).replace('T', ' ') : "no activity" }}</td>
            <td>{{ user.createdAt.slice(0, 10) }}</td>
            <td class="admin-users-actions-cell">
              <button
                type="button"
                class="dashboard-button secondary danger compact"
                :disabled="Boolean(deletingUserId)"
                @click="deleteUser(user)"
              >
                {{ deletingUserId === user.id ? "Deleting..." : "Delete" }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </main>
</template>

<style scoped>
.admin-users-feedback {
  color: var(--fc-success-text);
}

.admin-users-actions,
.admin-users-actions-cell {
  text-align: right;
  white-space: nowrap;
}

.dashboard-button.compact {
  padding: 0.55rem 0.85rem;
}

.dashboard-button.danger {
  border-color: color-mix(in srgb, var(--fc-danger-text, #a63d32) 26%, var(--fc-border));
  color: var(--fc-danger-text, #a63d32);
}

.dashboard-button.danger:hover:not(:disabled) {
  background: color-mix(in srgb, var(--fc-danger-text, #a63d32) 10%, var(--fc-panel-bg));
}
</style>
