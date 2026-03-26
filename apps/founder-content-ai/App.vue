<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useProductAccessContext } from "./access/product-access-context";
import { useAuthContext } from "./auth/auth-context";
import { appRoutes } from "./utils/routes";

const route = useRoute();
const router = useRouter();
const { bootstrap, isFeatureEnabled } = useProductAccessContext();
const auth = useAuthContext();
const mobileMenuOpen = ref(false);

const isPublicShell = computed(() => route.meta.shell === "public");
const usesWorkspaceShell = computed(
  () => !isPublicShell.value && route.name !== "onboarding",
);

const visibleAppLinks = computed(() => {
  const currentBusinessId = bootstrap.value?.activeBusinessId;
  const hasWorkspaceContext = Boolean(currentBusinessId);
  const canUseDashboard = hasWorkspaceContext && isFeatureEnabled("control_dashboard");
  const canUseOutreach = hasWorkspaceContext && isFeatureEnabled("outreach");
  const canUseEmail = hasWorkspaceContext && isFeatureEnabled("email_campaigns");

  return [
    { to: appRoutes.dashboard, label: "Dashboard", shortLabel: "D", visible: canUseDashboard },
    { to: appRoutes.appOutreach, label: "Outreach", shortLabel: "O", visible: canUseOutreach },
    { to: appRoutes.appEmail, label: "Email", shortLabel: "E", visible: canUseEmail },
    { to: appRoutes.dashboardAnalytics, label: "Analytics", shortLabel: "A", visible: canUseDashboard },
    { to: appRoutes.settingsPreferences, label: "Settings", shortLabel: "S", visible: true },
    { to: appRoutes.admin, label: "Admin", shortLabel: "AD", visible: bootstrap.value?.isPlatformAdmin ?? false },
  ].filter((link) => link.visible);
});

const pageTitleMap: Record<string, string> = {
  admin: "Admin",
  "admin-features": "Feature controls",
  "admin-outreach": "Outreach control",
  "admin-usage": "Usage control",
  "admin-users": "Admin users",
  "admin-workspaces": "Admin workspaces",
  "app-dashboard": "Dashboard",
  "app-email": "Email",
  "app-generate": "Create new post",
  "app-outreach": "Outreach",
  "app-result": "Generated content",
  "dashboard-analytics": "Analytics",
  onboarding: "Onboarding",
  "settings-preferences": "Settings",
};

const currentPageTitle = computed(() => {
  const routeName = typeof route.name === "string" ? route.name : "";
  return pageTitleMap[routeName] ?? "FounderContent AI";
});

const currentPageSubtitle = computed(() => {
  if (route.path.startsWith("/admin")) {
    return "Operate the workspace system without crowding the content surface.";
  }

  return "Keep navigation persistent, content focused, and actions obvious.";
});

const userLabel = computed(() => auth.currentUser.value?.fullName || auth.currentUser.value?.email || "");
const userInitial = computed(() => userLabel.value.trim().charAt(0).toUpperCase() || "F");

watch(
  () => route.fullPath,
  () => {
    mobileMenuOpen.value = false;
  },
);

async function handleLogout(): Promise<void> {
  await auth.logout();
  await router.replace(appRoutes.login);
}
</script>

<template>
  <div class="app-shell" :class="{ 'workspace-shell': usesWorkspaceShell }">
    <template v-if="!usesWorkspaceShell">
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
            <span v-if="userLabel" class="header-user-pill">{{ userLabel }}</span>
            <button class="header-secondary-button" type="button" @click="handleLogout">
              Logout
            </button>
            <router-link class="header-cta" :to="appRoutes.appGenerate">New Post</router-link>
          </template>
        </div>
      </header>

      <router-view />
    </template>

    <template v-else>
      <aside class="workspace-sidebar">
        <router-link class="sidebar-brand" to="/">
          <span class="brand-mark">FC</span>
          <span class="brand-copy">
            <strong>FounderContent AI</strong>
            <small>Workspace OS</small>
          </span>
        </router-link>

        <router-link class="sidebar-cta" :to="appRoutes.appGenerate">New Post</router-link>

        <nav class="sidebar-nav" aria-label="Workspace navigation">
          <router-link
            v-for="link in visibleAppLinks"
            :key="link.to"
            :to="link.to"
            class="sidebar-link"
          >
            <span class="sidebar-link-icon">{{ link.shortLabel }}</span>
            <span class="sidebar-link-copy">{{ link.label }}</span>
          </router-link>
        </nav>

        <div class="sidebar-footer">
          <router-link class="sidebar-footer-link" :to="appRoutes.settingsPreferences">
            Usage & billing
          </router-link>
          <div v-if="userLabel" class="sidebar-user-card">
            <span class="sidebar-user-avatar">{{ userInitial }}</span>
            <div>
              <strong>{{ userLabel }}</strong>
              <small>Account</small>
            </div>
          </div>
          <button class="sidebar-logout-button" type="button" @click="handleLogout">
            Logout
          </button>
        </div>
      </aside>

      <transition name="sidebar-fade">
        <div
          v-if="mobileMenuOpen"
          class="mobile-sidebar-overlay"
          @click.self="mobileMenuOpen = false"
        >
          <aside class="mobile-sidebar">
            <div class="mobile-sidebar-header">
              <router-link class="sidebar-brand" to="/">
                <span class="brand-mark">FC</span>
                <span class="brand-copy">
                  <strong>FounderContent AI</strong>
                  <small>Workspace OS</small>
                </span>
              </router-link>

              <button
                type="button"
                class="mobile-menu-button close-button"
                aria-label="Close navigation"
                @click="mobileMenuOpen = false"
              >
                <span></span>
                <span></span>
              </button>
            </div>

            <router-link class="sidebar-cta" :to="appRoutes.appGenerate">New Post</router-link>

            <nav class="sidebar-nav" aria-label="Mobile workspace navigation">
              <router-link
                v-for="link in visibleAppLinks"
                :key="link.to"
                :to="link.to"
                class="sidebar-link"
                @click="mobileMenuOpen = false"
              >
                <span class="sidebar-link-icon">{{ link.shortLabel }}</span>
                <span class="sidebar-link-copy">{{ link.label }}</span>
              </router-link>
            </nav>

            <div class="sidebar-footer">
              <router-link
                class="sidebar-footer-link"
                :to="appRoutes.settingsPreferences"
                @click="mobileMenuOpen = false"
              >
                Usage & billing
              </router-link>
              <div v-if="userLabel" class="sidebar-user-card">
                <span class="sidebar-user-avatar">{{ userInitial }}</span>
                <div>
                  <strong>{{ userLabel }}</strong>
                  <small>Account</small>
                </div>
              </div>
              <button
                class="sidebar-logout-button"
                type="button"
                @click="mobileMenuOpen = false; void handleLogout()"
              >
                Logout
              </button>
            </div>
          </aside>
        </div>
      </transition>

      <div class="workspace-main-pane">
        <header class="workspace-header">
          <div class="workspace-header-copy">
            <button
              type="button"
              class="mobile-menu-button"
              aria-label="Open navigation"
              @click="mobileMenuOpen = true"
            >
              <span></span>
              <span></span>
              <span></span>
            </button>
            <div>
              <p class="workspace-header-kicker">{{ currentPageTitle }}</p>
              <strong>{{ currentPageSubtitle }}</strong>
            </div>
          </div>

          <div class="workspace-header-actions">
            <span v-if="userLabel" class="header-user-pill desktop-only">{{ userLabel }}</span>
            <button class="header-secondary-button desktop-only" type="button" @click="handleLogout">
              Logout
            </button>
            <router-link class="header-cta" :to="appRoutes.appGenerate">New Post</router-link>
          </div>
        </header>

        <div class="app-content">
          <router-view />
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.app-shell {
  min-height: 100vh;
  color: var(--fc-text);
}

.workspace-shell {
  display: flex;
  min-height: 100vh;
}

.site-header,
.workspace-header {
  position: sticky;
  top: 0;
  z-index: 20;
  backdrop-filter: blur(18px);
}

.site-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: var(--fc-header-padding-y) var(--fc-header-padding-x);
  border-bottom: 1px solid var(--fc-border);
  background: var(--fc-header-bg);
}

.site-header.public-shell {
  border-bottom-color: rgba(112, 84, 62, 0.1);
}

.brand,
.sidebar-brand {
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

.site-nav a {
  color: var(--fc-text-muted);
  font-weight: 600;
  text-decoration: none;
}

.site-nav a.router-link-active {
  color: var(--fc-text);
}

.header-controls,
.workspace-header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.header-controls.public-controls {
  margin-left: 8px;
}

.header-link {
  color: var(--fc-text);
  font-weight: 700;
  text-decoration: none;
}

.header-secondary-button,
.sidebar-logout-button {
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

.header-cta,
.sidebar-cta {
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

.workspace-sidebar {
  position: fixed;
  inset: 0 auto 0 0;
  z-index: 25;
  display: flex;
  flex-direction: column;
  gap: 20px;
  width: 288px;
  padding: 22px 18px;
  border-right: 1px solid var(--fc-border);
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--fc-surface) 90%, white 10%) 0%, color-mix(in srgb, var(--fc-surface-subtle) 94%, white 6%) 100%);
  box-shadow: 24px 0 48px rgba(64, 44, 28, 0.06);
}

.sidebar-cta {
  width: 100%;
}

.sidebar-nav {
  display: grid;
  gap: 10px;
}

.sidebar-link {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr);
  gap: 12px;
  align-items: center;
  padding: 12px 14px;
  border: 1px solid transparent;
  border-radius: 18px;
  color: var(--fc-text-muted);
  text-decoration: none;
  transition:
    border-color 140ms ease,
    background 140ms ease,
    color 140ms ease,
    transform 140ms ease;
}

.sidebar-link:hover,
.sidebar-link.router-link-active {
  border-color: var(--fc-border);
  background: color-mix(in srgb, var(--fc-panel-bg) 78%, var(--fc-surface-muted));
  color: var(--fc-text);
  transform: translateX(2px);
}

.sidebar-link-icon,
.sidebar-user-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  border-radius: 14px;
  background: var(--fc-surface-muted);
  color: var(--fc-text);
  font-size: 0.82rem;
  font-weight: 800;
  letter-spacing: 0.04em;
}

.sidebar-link.router-link-active .sidebar-link-icon {
  background: color-mix(in srgb, var(--fc-accent) 20%, var(--fc-surface));
}

.sidebar-link-copy {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  font-weight: 700;
}

.sidebar-footer {
  display: grid;
  gap: 14px;
  margin-top: auto;
  padding-top: 16px;
  border-top: 1px solid var(--fc-border);
}

.sidebar-footer-link {
  color: var(--fc-text-muted);
  font-size: 0.92rem;
  font-weight: 700;
  text-decoration: none;
}

.sidebar-user-card {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr);
  gap: 12px;
  align-items: center;
  padding: 12px 14px;
  border: 1px solid var(--fc-border);
  border-radius: 18px;
  background: color-mix(in srgb, var(--fc-panel-bg) 84%, var(--fc-surface-muted));
}

.sidebar-user-card strong {
  display: block;
  font-size: 0.95rem;
}

.sidebar-user-card small {
  color: var(--fc-text-muted);
}

.workspace-main-pane {
  flex: 1 1 auto;
  min-width: 0;
  margin-left: 288px;
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

.workspace-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 24px;
  border-bottom: 1px solid var(--fc-border);
  background: color-mix(in srgb, var(--fc-header-bg) 88%, white 12%);
}

.workspace-header-copy {
  display: flex;
  align-items: center;
  gap: 14px;
}

.workspace-header-copy > div {
  display: grid;
  gap: 4px;
}

.workspace-header-copy strong {
  font-size: 0.98rem;
}

.workspace-header-kicker {
  margin: 0;
  color: var(--fc-text-muted);
  font-size: 0.76rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.app-content {
  flex: 1 1 auto;
  min-width: 0;
  padding: 28px clamp(20px, 3vw, 40px) 40px;
}

.app-content :deep(main) {
  width: 100%;
}

.mobile-menu-button {
  display: none;
  align-items: center;
  justify-content: center;
  gap: 4px;
  width: 44px;
  height: 44px;
  border: 1px solid var(--fc-border);
  border-radius: 14px;
  background: var(--fc-surface);
  cursor: pointer;
}

.mobile-menu-button span {
  display: block;
  width: 18px;
  height: 2px;
  border-radius: 999px;
  background: var(--fc-text);
}

.close-button {
  position: relative;
}

.close-button span {
  position: absolute;
}

.close-button span:first-child {
  transform: rotate(45deg);
}

.close-button span:last-child {
  transform: rotate(-45deg);
}

.mobile-sidebar-overlay {
  position: fixed;
  inset: 0;
  z-index: 40;
  background: rgba(20, 16, 13, 0.36);
  backdrop-filter: blur(8px);
}

.mobile-sidebar {
  position: absolute;
  inset: 0 auto 0 0;
  display: flex;
  flex-direction: column;
  gap: 18px;
  width: min(88vw, 320px);
  padding: 20px 18px;
  background: color-mix(in srgb, var(--fc-surface) 92%, white 8%);
  box-shadow: 28px 0 44px rgba(40, 27, 18, 0.16);
}

.mobile-sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.desktop-only {
  display: inline-flex;
}

.sidebar-fade-enter-active,
.sidebar-fade-leave-active {
  transition: opacity 160ms ease;
}

.sidebar-fade-enter-from,
.sidebar-fade-leave-to {
  opacity: 0;
}

@media (max-width: 1080px) {
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

@media (max-width: 960px) {
  .workspace-sidebar {
    display: none;
  }

  .workspace-main-pane {
    margin-left: 0;
  }

  .workspace-header {
    padding: 16px 18px;
  }

  .workspace-header-copy strong {
    max-width: 42ch;
  }

  .mobile-menu-button {
    display: inline-flex;
  }

  .desktop-only {
    display: none;
  }

  .app-content {
    padding: 22px 16px 32px;
  }
}

@media (max-width: 560px) {
  .site-nav {
    gap: 12px;
    justify-content: flex-start;
  }

  .workspace-header {
    align-items: start;
    flex-direction: column;
  }

  .workspace-header-actions {
    width: 100%;
    justify-content: space-between;
  }

  .header-cta {
    flex: 1 1 auto;
  }

  .header-secondary-button,
  .header-user-pill {
    display: none;
  }
}
</style>
