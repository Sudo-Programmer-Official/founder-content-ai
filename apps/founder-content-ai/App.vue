<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useProductAccessContext } from "./access/product-access-context";
import { useAuthContext } from "./auth/auth-context";
import { appRoutes } from "./utils/routes";

const route = useRoute();
const router = useRouter();
const { bootstrap, isFeatureEnabled } = useProductAccessContext();
const auth = useAuthContext();
const isPublicShell = computed(() => route.meta.shell === "public");

const visibleAppLinks = computed(() => {
  const currentBusinessId = bootstrap.value?.activeBusinessId;
  const hasWorkspaceContext = Boolean(currentBusinessId);
  const canCreate =
    !hasWorkspaceContext ||
    isFeatureEnabled("content_generation") ||
    isFeatureEnabled("capture_remix") ||
    isFeatureEnabled("visual_generation");
  const canUseDashboard = hasWorkspaceContext && isFeatureEnabled("control_dashboard");
  const canUseOutreach = hasWorkspaceContext && isFeatureEnabled("outreach");
  const canUseEmail = hasWorkspaceContext && isFeatureEnabled("email_campaigns");

  return [
    { to: appRoutes.appGenerate, label: "Create", visible: canCreate },
    { to: appRoutes.dashboard, label: "Dashboard", visible: canUseDashboard },
    { to: appRoutes.appOutreach, label: "Outreach", visible: canUseOutreach },
    { to: appRoutes.appEmail, label: "Email", visible: canUseEmail },
    { to: appRoutes.dashboardAnalytics, label: "Analytics", visible: canUseDashboard },
    { to: appRoutes.settingsPreferences, label: "Settings", visible: true },
    { to: appRoutes.admin, label: "Admin", visible: bootstrap.value?.isPlatformAdmin ?? false },
  ].filter((link) => link.visible);
});

const limitSummary = computed(() => {
  const limits = bootstrap.value?.limits;

  if (!limits) {
    return [];
  }

  return [
    `Posts left ${limits.postsRemaining}`,
    `Emails left ${limits.emailsRemaining}`,
  ];
});

const isReadOnly = computed(() => bootstrap.value?.access?.readOnly ?? false);
const userLabel = computed(() => auth.currentUser.value?.fullName || auth.currentUser.value?.email || "");

async function handleLogout(): Promise<void> {
  await auth.logout();
  await router.replace(appRoutes.login);
}
</script>

<template>
  <div class="app-shell">
    <header class="site-header" :class="{ 'public-shell': isPublicShell }">
      <router-link class="brand" to="/">
        <span class="brand-mark">FC</span>
        <span class="brand-copy">
          <strong>FounderContent AI</strong>
          <small>Content from anything.</small>
        </span>
      </router-link>

      <nav class="site-nav" :class="{ 'public-nav': isPublicShell }">
        <template v-if="isPublicShell">
          <a href="/#how-it-works">How it works</a>
          <a href="/#pricing">Pricing</a>
        </template>
        <template v-else>
          <router-link
            v-for="link in visibleAppLinks"
            :key="link.to"
            :to="link.to"
          >
            {{ link.label }}
          </router-link>
        </template>
      </nav>

      <div class="header-controls" :class="{ 'public-controls': isPublicShell }">
        <template v-if="isPublicShell">
          <template v-if="auth.isAuthenticated.value">
            <router-link class="header-link" :to="appRoutes.appGenerate">Open App</router-link>
            <button class="header-secondary-button" type="button" @click="handleLogout">
              Logout
            </button>
          </template>
          <template v-else>
            <router-link class="header-link" :to="appRoutes.login">Login</router-link>
            <router-link class="header-cta" :to="appRoutes.signup">Get Started</router-link>
          </template>
        </template>
        <template v-else>
          <div v-if="limitSummary.length > 0" class="header-limit-row">
            <span v-for="item in limitSummary" :key="item" class="header-limit-pill">{{ item }}</span>
            <span v-if="isReadOnly" class="header-limit-pill warning">Read-only mode</span>
          </div>

          <span v-if="userLabel" class="header-user-pill">{{ userLabel }}</span>
          <button class="header-secondary-button" type="button" @click="handleLogout">
            Logout
          </button>
          <router-link class="header-cta" :to="appRoutes.appGenerate">New Post</router-link>
        </template>
      </div>
    </header>

    <router-view />
  </div>
</template>

<style scoped>
.app-shell {
  min-height: 100vh;
  color: var(--fc-text);
}

.site-header {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: var(--fc-header-padding-y) var(--fc-header-padding-x);
  border-bottom: 1px solid var(--fc-border);
  background: var(--fc-header-bg);
  backdrop-filter: blur(18px);
}

.site-header.public-shell {
  border-bottom-color: rgba(112, 84, 62, 0.1);
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  color: var(--fc-text);
  text-decoration: none;
}

.brand-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  border-radius: 14px;
  background: linear-gradient(135deg, var(--fc-accent) 0%, var(--fc-emerald) 100%);
  color: var(--fc-accent-contrast);
  font-weight: 800;
  letter-spacing: 0.04em;
}

.brand-copy {
  display: grid;
}

.brand-copy strong {
  font-size: 1rem;
}

.brand-copy small {
  color: var(--fc-text-muted);
  font-size: 0.78rem;
}

.site-nav {
  display: flex;
  flex-wrap: wrap;
  gap: 18px;
  align-items: center;
  margin-left: auto;
}

.site-nav.public-nav {
  margin-left: auto;
}

.header-controls {
  display: flex;
  align-items: center;
  gap: 12px;
}

.header-controls.public-controls {
  margin-left: 8px;
}

.header-limit-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}

.header-limit-pill {
  display: inline-flex;
  align-items: center;
  min-height: 34px;
  padding: 0 12px;
  border: 1px solid var(--fc-border);
  border-radius: 999px;
  background: var(--fc-surface-subtle);
  color: var(--fc-text-muted);
  font-size: 0.8rem;
  font-weight: 700;
}

.header-limit-pill.warning {
  border-color: var(--fc-warning-bg);
  background: var(--fc-warning-bg);
  color: var(--fc-warning-text);
}

.site-nav a {
  color: var(--fc-text-muted);
  font-weight: 600;
  text-decoration: none;
}

.header-link {
  color: var(--fc-text);
  font-weight: 700;
  text-decoration: none;
}

.header-secondary-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: 0 16px;
  border: 1px solid var(--fc-border);
  border-radius: 999px;
  background: var(--fc-surface);
  color: var(--fc-text);
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}

.header-user-pill {
  display: inline-flex;
  align-items: center;
  min-height: 36px;
  padding: 0 12px;
  border-radius: 999px;
  background: var(--fc-surface-subtle);
  color: var(--fc-text-muted);
  font-size: 0.84rem;
  font-weight: 700;
}

.site-nav a.router-link-active {
  color: var(--fc-text);
}

.header-cta {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: 0 18px;
  border-radius: 999px;
  background: linear-gradient(135deg, var(--fc-accent) 0%, var(--fc-accent-dark) 100%);
  box-shadow: var(--fc-accent-shadow);
  color: var(--fc-accent-contrast);
  font-weight: 700;
  text-decoration: none;
}

@media (max-width: 860px) {
  .site-header {
    flex-wrap: wrap;
  }

  .header-controls {
    width: 100%;
    justify-content: space-between;
  }

  .site-nav {
    order: 3;
    width: 100%;
    margin-left: 0;
    justify-content: space-between;
  }

  .header-controls.public-controls {
    margin-left: 0;
  }
}

@media (max-width: 560px) {
  .site-nav {
    gap: 12px;
    justify-content: flex-start;
  }
}
</style>
