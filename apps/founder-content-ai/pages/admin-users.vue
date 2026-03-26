<script setup lang="ts">
import { onMounted, ref } from "vue";
import type { AdminUserListItem } from "../../../packages/shared-types";
import { requestAdminUsers } from "../services/admin-analytics-service";

const users = ref<AdminUserListItem[]>([]);
const totalUsers = ref(0);
const isLoading = ref(true);
const errorMessage = ref("");

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
          </tr>
        </tbody>
      </table>
    </section>
  </main>
</template>
