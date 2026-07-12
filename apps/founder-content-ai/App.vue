<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch, type Component } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useProductAccessContext } from "./access/product-access-context";
import { useAuthContext } from "./auth/auth-context";
import WorkspaceSwitcher from "./components/WorkspaceSwitcher.vue";
import { actionIcons, aiFeatureIcons, iconSizes, iconStrokeWidth, navigationIcons } from "./src/icons";
import { appRoutes } from "./utils/routes";

const route = useRoute();
const router = useRouter();
const { bootstrap, activeBusinessId, isFeatureEnabled, isReady: productAccessReady } = useProductAccessContext();
const auth = useAuthContext();
const mobileMenuOpen = ref(false);
const accountMenuOpen = ref(false);
const SIDEBAR_COLLAPSED_STORAGE_KEY = "founder-content:sidebar-collapsed";
const sidebarCollapsed = ref(false);
const lastKnownPlatformAdminUserId = ref("");

if (typeof window !== "undefined") {
  sidebarCollapsed.value = window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "true";
}

const isPublicShell = computed(() => route.meta.shell === "public");
const isStandaloneShell = computed(() => route.meta.shell === "standalone");
const requiresWorkspace = computed(() => route.meta.requiresWorkspace === true);
const isWorkspaceGateRoute = computed(() => route.name === "onboarding-workspace");
const hasWorkspaceMemberships = computed(
  () => (auth.appSession.value?.businesses.length ?? 0) > 0,
);
const usesWorkspaceShell = computed(
  () => !isPublicShell.value && !isStandaloneShell.value,
);
const currentWorkspaceId = computed(
  () => bootstrap.value?.activeBusinessId?.trim() || activeBusinessId.value?.trim() || "",
);
const currentSessionUserId = computed(
  () => auth.currentUser.value?.id?.trim() || auth.authSession.value?.localId?.trim() || "",
);
const canAccessAdmin = computed(() => {
  const currentAuthUserId = currentSessionUserId.value;

  if (!currentAuthUserId || !auth.isAuthenticated.value) {
    return false;
  }

  return (
    Boolean(bootstrap.value?.isPlatformAdmin) ||
    lastKnownPlatformAdminUserId.value === currentAuthUserId
  );
});
const shouldHoldWorkspaceRoute = computed(
  () =>
    requiresWorkspace.value &&
    (!auth.isReady.value ||
      !productAccessReady.value ||
      (auth.isAuthenticated.value &&
        !currentWorkspaceId.value &&
        !hasWorkspaceMemberships.value)),
);

interface AppNavLink {
  to: string;
  label: string;
  shortLabel: string;
  icon: Component;
  visible?: boolean;
}

const visibleAppLinks = computed<AppNavLink[]>(() => {
  const hasWorkspaceContext = Boolean(currentWorkspaceId.value);
  const canUsePlanner = hasWorkspaceContext && isFeatureEnabled("scheduler");
  const canUseDashboard = hasWorkspaceContext && isFeatureEnabled("control_dashboard");
  const canUseBrandStudio = hasWorkspaceContext && isFeatureEnabled("brand_intelligence");
  const canUseOutreach = hasWorkspaceContext && isFeatureEnabled("outreach");
  const canUseEmail = hasWorkspaceContext && isFeatureEnabled("email_campaigns");
  const canUseBlogPublishing = hasWorkspaceContext && isFeatureEnabled("blog_publishing");

  return [
    { to: appRoutes.dashboard, label: "Dashboard", shortLabel: "D", icon: navigationIcons.dashboard, visible: canUseDashboard },
    { to: appRoutes.appIdeas, label: "Ideas", shortLabel: "I", icon: navigationIcons.ideas, visible: canUseDashboard },
    { to: appRoutes.appAssets, label: "Assets", shortLabel: "AS", icon: navigationIcons.assets, visible: canUseDashboard },
    { to: appRoutes.appBrandStudio, label: "Brand", shortLabel: "B", icon: navigationIcons.brand, visible: canUseBrandStudio },
    { to: appRoutes.appPlanner, label: "Planner", shortLabel: "P", icon: navigationIcons.planner, visible: canUsePlanner },
    { to: appRoutes.appAutomationStudio, label: "Automation", shortLabel: "AU", icon: navigationIcons.automation, visible: canUsePlanner },
    { to: appRoutes.appHistory, label: "History", shortLabel: "H", icon: navigationIcons.history, visible: canUsePlanner },
    { to: appRoutes.appGrowth, label: "Growth", shortLabel: "G", icon: navigationIcons.growth, visible: canUseEmail },
    { to: appRoutes.appOutreach, label: "Outreach", shortLabel: "O", icon: navigationIcons.outreach, visible: canUseOutreach },
    { to: appRoutes.appRevenueAgent, label: "Revenue", shortLabel: "R", icon: navigationIcons.revenue, visible: hasWorkspaceContext },
    { to: appRoutes.appEmail, label: "Email", shortLabel: "E", icon: navigationIcons.email, visible: canUseEmail },
    { to: appRoutes.appBlog, label: "Blog", shortLabel: "BL", icon: navigationIcons.blog, visible: canUseBlogPublishing },
    { to: appRoutes.dashboardAnalytics, label: "Analytics", shortLabel: "A", icon: navigationIcons.analytics, visible: canUseDashboard },
    { to: appRoutes.settingsPreferences, label: "Settings", shortLabel: "S", icon: navigationIcons.settings, visible: true },
    { to: appRoutes.admin, label: "Admin", shortLabel: "AD", icon: navigationIcons.admin, visible: canAccessAdmin.value },
  ].filter((link): link is AppNavLink => link.visible === true);
});

const mobileDockLinks = computed(() => {
  const findLink = (to: string) => visibleAppLinks.value.find((link) => link.to === to) ?? null;

  return [
    findLink(appRoutes.appIdeas),
    { to: appRoutes.appGenerate, label: "Create", shortLabel: "C", icon: aiFeatureIcons.generate },
    findLink(appRoutes.appPlanner),
    findLink(appRoutes.appEmail),
    findLink(appRoutes.settingsPreferences),
  ].filter(Boolean) as Array<Pick<AppNavLink, "to" | "label" | "shortLabel" | "icon">>;
});

const pageTitleMap: Record<string, string> = {
  admin: "Admin",
  "admin-features": "Feature controls",
  "admin-media-registry": "Media registry",
  "admin-outreach": "Outreach control",
  "admin-usage": "Usage control",
  "admin-users": "Admin users",
  "admin-workspaces": "Admin workspaces",
  "app-dashboard": "Dashboard",
  "app-assets": "Assets",
  "app-automation-studio": "Automation Studio",
  "app-blog": "Blog publishing",
  "app-billing": "Billing",
  "app-brand-studio": "Brand Studio",
  "app-email": "Email",
  "app-create": "Create new post",
  "app-growth": "Growth",
  "app-history": "History",
  "app-ideas": "Idea Inbox",
  "app-planner": "Planner",
  "app-outreach": "Outreach",
  "app-revenue-agent": "Revenue Agent",
  "app-result": "Generated content",
  "dashboard-analytics": "Analytics",
  onboarding: "Onboarding",
  "onboarding-workspace": "Create workspace",
  "settings-preferences": "Settings",
};

const currentPageTitle = computed(() => {
  const routeName = typeof route.name === "string" ? route.name : "";
  return pageTitleMap[routeName] ?? "FounderContent AI";
});

const userLabel = computed(
  () =>
    auth.currentUser.value?.fullName ||
    auth.currentUser.value?.email ||
    auth.authSession.value?.displayName ||
    auth.authSession.value?.email ||
    "",
);
const userInitial = computed(() => userLabel.value.trim().charAt(0).toUpperCase() || "F");

watch(
  () => route.fullPath,
  () => {
    mobileMenuOpen.value = false;
    accountMenuOpen.value = false;
  },
);

function resolveWorkspaceRedirectTarget(candidate: unknown): string {
  if (
    typeof candidate === "string" &&
    candidate.startsWith("/") &&
    candidate !== appRoutes.onboardingWorkspace &&
    !candidate.startsWith(`${appRoutes.onboardingWorkspace}?`)
  ) {
    return candidate;
  }

  return appRoutes.dashboard;
}

watch(sidebarCollapsed, (value) => {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(value));
  accountMenuOpen.value = false;
});

watch(
  () => currentSessionUserId.value,
  (nextUserId, previousUserId) => {
    if (nextUserId !== previousUserId) {
      lastKnownPlatformAdminUserId.value = "";
    }
  },
);

watch(
  () => [
    route.fullPath,
    auth.isReady.value,
    auth.isAuthenticated.value,
    productAccessReady.value,
    currentWorkspaceId.value,
    hasWorkspaceMemberships.value,
    isWorkspaceGateRoute.value,
    requiresWorkspace.value,
  ] as const,
  async ([
    currentPath,
    authReady,
    isAuthenticated,
    accessReady,
    workspaceId,
    hasMemberships,
    onWorkspaceGate,
    routeNeedsWorkspace,
  ]) => {
    if (!authReady || !isAuthenticated || !accessReady) {
      return;
    }

    if (onWorkspaceGate) {
      if (workspaceId) {
        await router.replace(resolveWorkspaceRedirectTarget(route.query.redirect));
      }

      return;
    }

    if (!routeNeedsWorkspace || workspaceId || hasMemberships) {
      return;
    }

    await router.replace({
      path: appRoutes.onboardingWorkspace,
      query: {
        redirect: currentPath,
      },
    });
  },
  { immediate: true },
);

watch(
  () => bootstrap.value?.isPlatformAdmin ?? false,
  (isPlatformAdmin) => {
    const currentAuthUserId = currentSessionUserId.value;

    if (isPlatformAdmin && currentAuthUserId) {
      lastKnownPlatformAdminUserId.value = currentAuthUserId;
    }
  },
);

function handleDocumentClick(event: MouseEvent): void {
  const target = event.target;

  if (!(target instanceof Element)) {
    return;
  }

  if (target.closest(".sidebar-account-shell")) {
    return;
  }

  accountMenuOpen.value = false;
}

function handleEscape(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    accountMenuOpen.value = false;
  }
}

onMounted(() => {
  document.addEventListener("click", handleDocumentClick);
  document.addEventListener("keydown", handleEscape);
});

onBeforeUnmount(() => {
  document.removeEventListener("click", handleDocumentClick);
  document.removeEventListener("keydown", handleEscape);
});

async function handleLogout(): Promise<void> {
  await auth.logout();
  await router.replace(appRoutes.login);
}

function toggleSidebar(): void {
  sidebarCollapsed.value = !sidebarCollapsed.value;
}

function toggleAccountMenu(): void {
  accountMenuOpen.value = !accountMenuOpen.value;
}

async function goToAdmin(): Promise<void> {
  accountMenuOpen.value = false;
  await router.push(appRoutes.admin);
}
</script>

<template>
  <div
    class="app-shell"
    :class="{
      'workspace-shell': usesWorkspaceShell,
      'sidebar-collapsed': usesWorkspaceShell && sidebarCollapsed,
    }"
  >
    <template v-if="isPublicShell">
      <header class="site-header" :class="{ 'public-shell': isPublicShell }">
        <router-link class="brand" to="/">
          <img
            class="brand-logo"
            src="/foundercontent-wordmark.svg"
            alt="FounderContent"
          />
        </router-link>

        <button
          type="button"
          class="mobile-menu-button public-menu-button"
          aria-label="Open site navigation"
          @click="mobileMenuOpen = true"
        >
          <component :is="actionIcons.menu" :size="iconSizes.default" :stroke-width="iconStrokeWidth" />
        </button>

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
              <router-link class="header-link public-header-link" :to="appRoutes.appGenerate">
                <component :is="actionIcons.open" :size="iconSizes.dense" :stroke-width="iconStrokeWidth" />
                <span>Open App</span>
              </router-link>
              <button class="header-secondary-button public-account-button" type="button" @click="handleLogout">
                <span>Logout</span>
                <span class="public-account-button-chevron" aria-hidden="true">
                  <component :is="actionIcons.logOut" :size="iconSizes.dense" :stroke-width="iconStrokeWidth" />
                </span>
              </button>
            </template>
            <template v-else>
              <router-link class="header-link public-header-link" :to="appRoutes.login">Login</router-link>
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

      <transition name="sidebar-fade">
        <div
          v-if="mobileMenuOpen"
          class="mobile-sidebar-overlay public-mobile-overlay"
          @click.self="mobileMenuOpen = false"
        >
          <aside class="mobile-sidebar public-mobile-sidebar">
            <div class="mobile-sidebar-header">
              <router-link class="sidebar-brand" to="/" @click="mobileMenuOpen = false">
                <img
                  class="brand-logo"
                  src="/foundercontent-wordmark.svg"
                  alt="FounderContent"
                />
              </router-link>

              <button
                type="button"
                class="mobile-menu-button close-button"
                aria-label="Close site navigation"
                @click="mobileMenuOpen = false"
              >
                <component :is="actionIcons.close" :size="iconSizes.default" :stroke-width="iconStrokeWidth" />
              </button>
            </div>

            <nav class="public-mobile-nav" aria-label="Site navigation">
              <a href="/#how-it-works" @click="mobileMenuOpen = false">How it works</a>
              <a href="/#pricing" @click="mobileMenuOpen = false">Pricing</a>
            </nav>

            <div class="public-mobile-actions">
              <template v-if="auth.isAuthenticated.value">
                <router-link class="header-cta public-mobile-cta" :to="appRoutes.appGenerate" @click="mobileMenuOpen = false">
                  Open App
                </router-link>
                <button
                  class="header-secondary-button public-mobile-secondary"
                  type="button"
                  @click="mobileMenuOpen = false; void handleLogout()"
                >
                  Logout
                </button>
              </template>
              <template v-else>
                <router-link class="header-cta public-mobile-cta" :to="appRoutes.signup" @click="mobileMenuOpen = false">
                  Get Started
                </router-link>
                <router-link class="header-secondary-button public-mobile-secondary" :to="appRoutes.login" @click="mobileMenuOpen = false">
                  Login
                </router-link>
              </template>
            </div>
          </aside>
        </div>
      </transition>

      <router-view />
    </template>

    <template v-else-if="isStandaloneShell">
      <router-view />
    </template>

    <template v-else-if="shouldHoldWorkspaceRoute">
      <main class="route-gate-shell">
        <section class="route-gate-card">
          <p class="route-gate-kicker">/workspace</p>
          <h1>Preparing your workspace access</h1>
          <p>
            We’re checking whether this account already has a workspace or needs first-time setup.
          </p>
        </section>
      </main>
    </template>

    <template v-else>
      <aside class="workspace-sidebar">
        <div class="sidebar-brand-row">
          <router-link class="sidebar-brand" to="/">
            <img
              class="brand-logo"
              :src="sidebarCollapsed ? '/foundercontent-mark.svg' : '/foundercontent-wordmark.svg'"
              alt="FounderContent"
            />
          </router-link>

          <button
            type="button"
            class="sidebar-panel-toggle"
            :aria-label="sidebarCollapsed ? 'Open navigation panel' : 'Close navigation panel'"
            :title="sidebarCollapsed ? 'Open panel' : 'Close panel'"
            @click="toggleSidebar"
          >
            <component
              :is="sidebarCollapsed ? actionIcons.expandSidebar : actionIcons.collapseSidebar"
              :size="iconSizes.dense"
              :stroke-width="iconStrokeWidth"
              aria-hidden="true"
            />
          </button>
        </div>

        <router-link
          class="sidebar-primary-cta"
          :class="{ compact: sidebarCollapsed }"
          :to="appRoutes.appGenerate"
          :title="sidebarCollapsed ? 'New Post' : undefined"
        >
          <span class="sidebar-primary-cta-icon">
            <component :is="aiFeatureIcons.generate" :size="iconSizes.dense" :stroke-width="iconStrokeWidth" />
          </span>
          <span class="sidebar-primary-cta-copy">New Post</span>
        </router-link>

        <nav class="sidebar-nav" aria-label="Workspace navigation">
          <router-link
            v-for="link in visibleAppLinks"
            :key="link.to"
            :to="link.to"
            class="sidebar-link"
            :title="sidebarCollapsed ? link.label : undefined"
          >
            <span class="sidebar-link-icon">
              <component :is="link.icon" :size="iconSizes.dense" :stroke-width="iconStrokeWidth" />
            </span>
            <span class="sidebar-link-copy">{{ link.label }}</span>
          </router-link>
        </nav>

        <div class="sidebar-footer">
          <router-link class="sidebar-footer-link" :to="appRoutes.appBilling">
            Usage & billing
          </router-link>
          <template v-if="userLabel && !sidebarCollapsed">
            <div class="sidebar-user-card">
              <span class="sidebar-user-avatar">{{ userInitial }}</span>
              <div>
                <strong>{{ userLabel }}</strong>
                <small>Account</small>
              </div>
            </div>
            <div class="sidebar-footer-actions">
              <button
                v-if="canAccessAdmin"
                type="button"
                class="sidebar-footer-action"
                @click="void goToAdmin()"
              >
                Admin
              </button>
              <button
                class="sidebar-logout-button"
                type="button"
                @click="void handleLogout()"
              >
                Logout
              </button>
            </div>
          </template>
          <div
            v-else-if="userLabel"
            class="sidebar-account-shell"
            :class="{ compact: sidebarCollapsed, open: accountMenuOpen }"
          >
            <button
              type="button"
              class="sidebar-account-trigger"
              :title="sidebarCollapsed ? userLabel : undefined"
              aria-haspopup="menu"
              :aria-expanded="accountMenuOpen"
              @click.stop="toggleAccountMenu"
            >
              <span class="sidebar-user-avatar">{{ userInitial }}</span>
              <div class="sidebar-account-copy">
                <strong>{{ userLabel }}</strong>
                <small>Account</small>
              </div>
              <span class="sidebar-account-chevron" aria-hidden="true">
                <component :is="actionIcons.chevronDown" :size="iconSizes.dense" :stroke-width="iconStrokeWidth" />
              </span>
            </button>

            <transition name="sidebar-fade">
              <div v-if="accountMenuOpen" class="sidebar-account-menu" role="menu">
                <button
                  v-if="canAccessAdmin"
                  type="button"
                  class="sidebar-account-menu-item"
                  role="menuitem"
                  @click="void goToAdmin()"
                >
                  Admin
                </button>
                <button
                  type="button"
                  class="sidebar-account-menu-item"
                  role="menuitem"
                  @click="accountMenuOpen = false; void handleLogout()"
                >
                  Logout
                </button>
              </div>
            </transition>
          </div>
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
                <img
                  class="brand-logo"
                  src="/foundercontent-wordmark.svg"
                  alt="FounderContent"
                />
              </router-link>

              <button
                type="button"
                class="mobile-menu-button close-button"
                aria-label="Close navigation"
                @click="mobileMenuOpen = false"
              >
                <component :is="actionIcons.close" :size="iconSizes.default" :stroke-width="iconStrokeWidth" />
              </button>
            </div>

            <router-link
              class="sidebar-primary-cta"
              :to="appRoutes.appGenerate"
              @click="mobileMenuOpen = false"
            >
              <span class="sidebar-primary-cta-icon">
                <component :is="aiFeatureIcons.generate" :size="iconSizes.dense" :stroke-width="iconStrokeWidth" />
              </span>
              <span class="sidebar-primary-cta-copy">New Post</span>
            </router-link>

            <nav class="sidebar-nav" aria-label="Mobile workspace navigation">
              <router-link
                v-for="link in visibleAppLinks"
                :key="link.to"
                :to="link.to"
                class="sidebar-link"
                @click="mobileMenuOpen = false"
              >
                <span class="sidebar-link-icon">
                  <component :is="link.icon" :size="iconSizes.dense" :stroke-width="iconStrokeWidth" />
                </span>
                <span class="sidebar-link-copy">{{ link.label }}</span>
              </router-link>
            </nav>

            <div class="sidebar-footer">
              <router-link
                class="sidebar-footer-link"
                :to="appRoutes.appBilling"
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
            </div>
          </div>

          <div class="workspace-header-actions">
            <WorkspaceSwitcher class="workspace-header-switcher" />
          </div>
        </header>

        <div class="app-content">
          <router-view />
        </div>

        <nav class="mobile-bottom-dock" aria-label="Primary app navigation">
          <router-link
            v-for="link in mobileDockLinks"
            :key="`dock-${link.to}`"
            :to="link.to"
            class="mobile-bottom-dock-link"
          >
            <span class="mobile-bottom-dock-icon">
              <component :is="link.icon" :size="iconSizes.dense" :stroke-width="iconStrokeWidth" />
            </span>
            <small>{{ link.label }}</small>
          </router-link>
        </nav>
      </div>
    </template>
  </div>
</template>

<style scoped>
.app-shell {
  min-height: 100vh;
  color: var(--fc-text);
}

.route-gate-shell {
  flex: 1 1 auto;
  width: 100%;
  min-width: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 32px 20px;
}

.route-gate-card {
  width: min(100%, 520px);
  padding: clamp(28px, 4vw, 40px);
  border: 1px solid var(--fc-border);
  border-radius: 28px;
  background: linear-gradient(180deg, var(--fc-surface) 0%, var(--fc-surface-subtle) 100%);
  box-shadow: var(--fc-card-shadow);
}

.route-gate-kicker {
  margin: 0 0 12px;
  color: var(--fc-text-muted);
  font-size: 0.8rem;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.route-gate-card h1 {
  margin: 0 0 12px;
  font-size: clamp(2rem, 4vw, 2.6rem);
  line-height: 1.04;
}

.route-gate-card p {
  margin: 0;
  color: var(--fc-text-muted);
  line-height: 1.7;
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
  gap: 28px;
  padding: 18px clamp(22px, 3.5vw, 52px);
  border-bottom-color: rgba(112, 84, 62, 0.08);
  background:
    linear-gradient(180deg, rgba(255, 248, 242, 0.9) 0%, rgba(255, 248, 242, 0.82) 100%);
  box-shadow: 0 8px 22px rgba(73, 46, 23, 0.03);
}

.brand,
.sidebar-brand {
  display: inline-flex;
  align-items: center;
  color: var(--fc-text);
  text-decoration: none;
}

.sidebar-brand-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.brand-logo {
  display: block;
  width: clamp(172px, 18vw, 214px);
  height: auto;
}

.sidebar-brand .brand-logo {
  width: min(100%, 182px);
}

.sidebar-panel-toggle {
  flex: 0 0 auto;
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid var(--fc-border);
  border-radius: 12px;
  background: color-mix(in srgb, var(--fc-panel-bg) 84%, white 16%);
  color: var(--fc-text);
  font: inherit;
  font-size: 0.92rem;
  font-weight: 800;
  cursor: pointer;
  box-shadow: 0 10px 18px rgba(64, 44, 28, 0.06);
  transition:
    transform 140ms ease,
    border-color 140ms ease,
    background 140ms ease,
    box-shadow 140ms ease;
}

.sidebar-panel-toggle:hover {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--fc-accent) 28%, var(--fc-border));
  background: color-mix(in srgb, var(--fc-panel-bg) 72%, white 28%);
  box-shadow: 0 14px 22px rgba(64, 44, 28, 0.1);
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
  gap: clamp(20px, 2.8vw, 48px);
}

.site-nav a {
  color: var(--fc-text-muted);
  font-weight: 600;
  text-decoration: none;
}

.site-header.public-shell .site-nav a {
  color: #2a201b;
  font-size: 1.02rem;
  font-weight: 500;
}

.site-nav a.router-link-active {
  color: var(--fc-text);
}

.header-controls,
.workspace-header-actions,
.workspace-header-session {
  display: flex;
  align-items: center;
  gap: 12px;
}

.workspace-header-actions {
  margin-left: auto;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: center;
}

.workspace-header-switcher {
  flex: 0 0 auto;
  width: min(100%, 360px);
  min-width: 240px;
}

.header-controls.public-controls {
  margin-left: 8px;
  gap: 16px;
}

.header-link {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--fc-text);
  font-weight: 700;
  text-decoration: none;
}

.public-header-link {
  color: #2a201b;
  font-weight: 500;
}

.header-secondary-button,
.sidebar-footer-action,
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

.public-account-button {
  gap: 0;
  padding: 0;
  overflow: hidden;
  border-color: rgba(112, 84, 62, 0.1);
  background: rgba(255, 251, 247, 0.92);
  box-shadow: 0 14px 32px rgba(76, 49, 26, 0.06);
}

.public-account-button > span:first-child {
  padding: 0 22px 0 24px;
}

.public-account-button-chevron {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 52px;
  min-height: 44px;
  border-left: 1px solid rgba(112, 84, 62, 0.1);
}

.public-account-button-chevron :deep(svg) {
  display: block;
}

.sidebar-footer-action {
  width: 100%;
  text-decoration: none;
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
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

.sidebar-primary-cta {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 48px;
  padding: 0 16px;
  border-radius: 18px;
  background: linear-gradient(135deg, var(--fc-accent) 0%, var(--fc-accent-dark) 100%);
  box-shadow: var(--fc-accent-shadow);
  color: var(--fc-accent-contrast);
  font-weight: 700;
  text-decoration: none;
  transition: transform 140ms ease, box-shadow 140ms ease, opacity 140ms ease;
}

.sidebar-primary-cta:hover {
  transform: translateY(-1px);
  box-shadow: 0 18px 28px rgba(204, 102, 45, 0.24);
}

.sidebar-primary-cta-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.18);
}

.sidebar-primary-cta.compact {
  width: 100%;
  padding: 0;
}

.sidebar-primary-cta.compact .sidebar-primary-cta-copy {
  display: none;
}

.workspace-sidebar {
  position: fixed;
  inset: 0 auto 0 0;
  z-index: 25;
  display: flex;
  flex-direction: column;
  gap: 18px;
  width: 288px;
  padding: 22px 18px;
  border-right: 1px solid var(--fc-border);
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--fc-surface) 90%, white 10%) 0%, color-mix(in srgb, var(--fc-surface-subtle) 94%, white 6%) 100%);
  box-shadow: 24px 0 48px rgba(64, 44, 28, 0.06);
  overflow-y: auto;
  overscroll-behavior: contain;
  transition: width 180ms ease, padding 180ms ease, box-shadow 180ms ease;
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

.sidebar-link-icon :deep(svg),
.sidebar-primary-cta-icon :deep(svg),
.sidebar-account-chevron :deep(svg) {
  display: block;
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

.sidebar-footer-actions {
  display: grid;
  gap: 10px;
}

.sidebar-account-shell {
  position: relative;
}

.sidebar-account-trigger {
  width: 100%;
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  padding: 12px 14px;
  border: 1px solid var(--fc-border);
  border-radius: 18px;
  background: color-mix(in srgb, var(--fc-panel-bg) 84%, var(--fc-surface-muted));
  color: var(--fc-text);
  text-align: left;
  font: inherit;
  cursor: pointer;
}

.sidebar-account-trigger:hover {
  border-color: color-mix(in srgb, var(--fc-accent) 24%, var(--fc-border));
}

.sidebar-account-copy {
  min-width: 0;
}

.sidebar-account-copy strong {
  display: block;
  font-size: 0.95rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sidebar-account-copy small {
  color: var(--fc-text-muted);
}

.sidebar-account-chevron {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 28px;
  height: 28px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.55);
  color: var(--fc-text-muted);
  font-weight: 800;
  transition: transform 160ms ease;
}

.sidebar-account-shell.open .sidebar-account-chevron {
  transform: rotate(180deg);
}

.sidebar-account-menu {
  position: absolute;
  right: 0;
  bottom: calc(100% + 10px);
  min-width: 180px;
  padding: 8px;
  border: 1px solid var(--fc-border);
  border-radius: 16px;
  background: color-mix(in srgb, var(--fc-surface) 94%, white 6%);
  box-shadow: 0 24px 40px rgba(64, 44, 28, 0.14);
}

.sidebar-account-menu-item {
  width: 100%;
  display: inline-flex;
  align-items: center;
  justify-content: flex-start;
  min-height: 42px;
  padding: 0 12px;
  border: 0;
  border-radius: 12px;
  background: transparent;
  color: var(--fc-text);
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}

.sidebar-account-menu-item:hover {
  background: color-mix(in srgb, var(--fc-panel-bg) 86%, var(--fc-surface-muted));
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
  transition: margin-left 180ms ease;
}

.workspace-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 18px clamp(18px, 2.8vw, 28px);
  border-bottom: 1px solid var(--fc-border);
  background: color-mix(in srgb, var(--fc-header-bg) 88%, white 12%);
}

.workspace-header-copy {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
}

.workspace-header-copy > div {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.workspace-header-copy strong {
  font-size: 0.98rem;
  line-height: 1.35;
}

.workspace-header-kicker {
  margin: 0;
  color: var(--fc-text-muted);
  font-size: 0.76rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.workspace-header-session {
  padding: 4px;
  border: 1px solid var(--fc-border);
  border-radius: 999px;
  background: color-mix(in srgb, var(--fc-surface) 88%, white 12%);
}

.workspace-header-session .header-user-pill {
  background: transparent;
}

.workspace-header-session .header-secondary-button {
  min-height: 36px;
  padding: 0 14px;
}

.app-content {
  flex: 1 1 auto;
  min-width: 0;
  padding: 28px clamp(20px, 3vw, 40px) 40px;
}

.app-content :deep(main) {
  width: 100%;
}

.mobile-bottom-dock {
  display: none;
}

.mobile-menu-button {
  display: none;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border: 1px solid var(--fc-border);
  border-radius: 14px;
  background: var(--fc-surface);
  color: var(--fc-text);
  cursor: pointer;
}

.mobile-menu-button :deep(svg) {
  display: block;
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
  overflow-y: auto;
}

.public-mobile-sidebar {
  justify-content: space-between;
}

.public-mobile-nav,
.public-mobile-actions {
  display: grid;
  gap: 12px;
}

.public-mobile-nav a {
  display: inline-flex;
  align-items: center;
  min-height: 48px;
  padding: 0 14px;
  border: 1px solid var(--fc-border);
  border-radius: 16px;
  background: color-mix(in srgb, var(--fc-panel-bg) 82%, white 18%);
  color: var(--fc-text);
  font-weight: 700;
  text-decoration: none;
}

.public-mobile-nav a:hover {
  border-color: color-mix(in srgb, var(--fc-accent) 22%, var(--fc-border));
}

.public-mobile-cta,
.public-mobile-secondary {
  width: 100%;
}

.mobile-sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.sidebar-collapsed .workspace-sidebar {
  width: 96px;
  padding: 22px 12px;
  align-items: center;
}

.sidebar-collapsed .sidebar-brand-row {
  width: 100%;
  gap: 8px;
}

.sidebar-collapsed .sidebar-brand .brand-logo {
  width: 32px;
}

.sidebar-collapsed .sidebar-nav {
  width: 100%;
}

.sidebar-collapsed .sidebar-primary-cta {
  width: 100%;
}

.sidebar-collapsed .sidebar-link {
  grid-template-columns: 1fr;
  justify-items: center;
  padding: 10px;
}

.sidebar-collapsed .sidebar-link:hover,
.sidebar-collapsed .sidebar-link.router-link-active {
  transform: translateY(-1px);
}

.sidebar-collapsed .sidebar-link-copy {
  display: none;
}

.sidebar-collapsed .sidebar-footer {
  width: 100%;
}

.sidebar-collapsed .sidebar-footer-link {
  display: none;
}

.sidebar-collapsed .sidebar-account-trigger {
  grid-template-columns: 1fr;
  justify-items: center;
  padding: 10px;
}

.sidebar-collapsed .sidebar-account-copy,
.sidebar-collapsed .sidebar-account-chevron {
  display: none;
}

.sidebar-collapsed .sidebar-account-menu {
  left: calc(100% + 12px);
  right: auto;
  bottom: 0;
}

.sidebar-collapsed .workspace-main-pane {
  margin-left: 96px;
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

  .brand-logo {
    width: clamp(160px, 24vw, 188px);
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

@media (max-width: 720px) {
  .site-header.public-shell {
    flex-wrap: nowrap;
  }

  .site-header.public-shell .site-nav,
  .site-header.public-shell .header-controls {
    display: none;
  }

  .public-menu-button {
    display: inline-flex;
    margin-left: auto;
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

  .workspace-header-actions {
    gap: 10px;
    width: 100%;
    justify-content: stretch;
  }

  .workspace-header-switcher {
    width: 100%;
    min-width: 0;
  }

  .mobile-menu-button {
    display: inline-flex;
  }

  .app-content {
    padding: 22px 16px 92px;
  }

  .mobile-bottom-dock {
    position: sticky;
    bottom: 0;
    z-index: 25;
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 8px;
    padding: 10px 10px calc(10px + env(safe-area-inset-bottom, 0px));
    border-top: 1px solid var(--fc-border);
    background: color-mix(in srgb, var(--fc-header-bg) 88%, white 12%);
    backdrop-filter: blur(12px);
  }

  .mobile-bottom-dock-link {
    display: grid;
    justify-items: center;
    gap: 2px;
    text-decoration: none;
    color: var(--fc-text-muted);
    border: 1px solid color-mix(in srgb, var(--fc-border) 72%, white 28%);
    border-radius: 12px;
    padding: 7px 4px;
    background: color-mix(in srgb, var(--fc-panel-bg) 78%, white 22%);
  }

  .mobile-bottom-dock-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .mobile-bottom-dock-icon :deep(svg) {
    display: block;
  }

  .mobile-bottom-dock-link small {
    font-size: 0.64rem;
    font-weight: 700;
    text-transform: uppercase;
  }

  .mobile-bottom-dock-link.router-link-active {
    color: var(--fc-text);
    border-color: color-mix(in srgb, var(--fc-accent) 32%, var(--fc-border));
  }
}

@media (max-width: 560px) {
  .brand-logo {
    width: 158px;
  }

  .site-header.public-shell {
    padding: 16px 18px;
  }

  .site-nav {
    gap: 12px;
    justify-content: flex-start;
  }

  .workspace-header {
    align-items: start;
    flex-direction: column;
    gap: 14px;
  }

  .workspace-header-actions {
    width: 100%;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    justify-content: stretch;
  }

  .workspace-header-switcher {
    max-width: none;
    min-width: 0;
  }

  .header-cta {
    width: 100%;
  }

  .header-secondary-button,
  .header-user-pill {
    display: none;
  }
}
</style>
