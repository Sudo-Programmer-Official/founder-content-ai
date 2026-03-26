import { createRouter, createWebHistory } from "vue-router";
import { ensureProtectedRouteAccess } from "./services/auth-service";
import { appRoutes } from "./utils/routes";
import HomePage from "./pages/home.vue";
import AdminPage from "./pages/admin.vue";
import AdminFeaturesPage from "./pages/admin-features.vue";
import AdminOutreachPage from "./pages/admin-outreach.vue";
import AdminUsagePage from "./pages/admin-usage.vue";
import AdminUsersPage from "./pages/admin-users.vue";
import AdminWorkspacesPage from "./pages/admin-workspaces.vue";
import AppEmailPage from "./pages/app-email.vue";
import AppGeneratePage from "./pages/app-generate.vue";
import AppOutreachPage from "./pages/app-outreach.vue";
import AppResultPage from "./pages/app-result.vue";
import DashboardPage from "./pages/dashboard.vue";
import DashboardAnalyticsPage from "./pages/dashboard-analytics.vue";
import EmailCampaignsPage from "./pages/email-campaigns.vue";
import FounderContentIdeasPage from "./pages/founder-content-ideas.vue";
import LinkedInHookGeneratorPage from "./pages/linkedin-hook-generator.vue";
import LinkedInPostGeneratorPage from "./pages/linkedin-post-generator.vue";
import LinkedInPostIdeasForFoundersPage from "./pages/linkedin-post-ideas-for-founders.vue";
import LoginPage from "./pages/login.vue";
import OnboardingPage from "./pages/onboarding.vue";
import SettingsPreferencesPage from "./pages/settings-preferences.vue";
import SignupPage from "./pages/signup.vue";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/",
      name: "home",
      component: HomePage,
      meta: {
        shell: "public",
      },
    },
    {
      path: "/login",
      name: "login",
      component: LoginPage,
      meta: {
        shell: "public",
      },
    },
    {
      path: "/signup",
      name: "signup",
      component: SignupPage,
      meta: {
        shell: "public",
      },
    },
    {
      path: "/app",
      redirect: "/app/generate",
    },
    {
      path: "/app/generate",
      name: "app-generate",
      component: AppGeneratePage,
      meta: {
        requiresAuth: true,
      },
    },
    {
      path: "/app/result",
      name: "app-result",
      component: AppResultPage,
      meta: {
        requiresAuth: true,
      },
    },
    {
      path: "/app/dashboard",
      name: "app-dashboard",
      component: DashboardPage,
      meta: {
        requiresAuth: true,
      },
    },
    {
      path: "/app/outreach",
      name: "app-outreach",
      component: AppOutreachPage,
      meta: {
        requiresAuth: true,
      },
    },
    {
      path: "/app/email",
      name: "app-email",
      component: AppEmailPage,
      meta: {
        requiresAuth: true,
      },
    },
    {
      path: "/founder-content-ideas",
      name: "founder-content-ideas",
      component: FounderContentIdeasPage,
    },
    {
      path: "/admin",
      name: "admin",
      component: AdminPage,
      meta: {
        requiresAuth: true,
      },
    },
    {
      path: "/admin/features",
      name: "admin-features",
      component: AdminFeaturesPage,
      meta: {
        requiresAuth: true,
      },
    },
    {
      path: "/admin/outreach",
      name: "admin-outreach",
      component: AdminOutreachPage,
      meta: {
        requiresAuth: true,
      },
    },
    {
      path: "/admin/users",
      name: "admin-users",
      component: AdminUsersPage,
      meta: {
        requiresAuth: true,
      },
    },
    {
      path: "/admin/workspaces",
      name: "admin-workspaces",
      component: AdminWorkspacesPage,
      meta: {
        requiresAuth: true,
      },
    },
    {
      path: "/admin/usage",
      name: "admin-usage",
      component: AdminUsagePage,
      meta: {
        requiresAuth: true,
      },
    },
    {
      path: "/dashboard/analytics",
      name: "dashboard-analytics",
      component: DashboardAnalyticsPage,
      meta: {
        requiresAuth: true,
      },
    },
    {
      path: "/dashboard",
      name: "dashboard",
      component: DashboardPage,
      meta: {
        requiresAuth: true,
      },
    },
    {
      path: "/email-campaigns",
      name: "email-campaigns",
      component: EmailCampaignsPage,
      meta: {
        requiresAuth: true,
      },
    },
    {
      path: "/onboarding",
      name: "onboarding",
      component: OnboardingPage,
      meta: {
        requiresAuth: true,
      },
    },
    {
      path: "/settings/preferences",
      name: "settings-preferences",
      component: SettingsPreferencesPage,
      meta: {
        requiresAuth: true,
      },
    },
    {
      path: "/linkedin-hook-generator",
      name: "linkedin-hook-generator",
      component: LinkedInHookGeneratorPage,
      meta: {
        requiresAuth: true,
      },
    },
    {
      path: "/linkedin-post-generator",
      name: "linkedin-post-generator",
      component: LinkedInPostGeneratorPage,
      meta: {
        requiresAuth: true,
      },
    },
    {
      path: "/linkedin-post-ideas-for-founders",
      name: "linkedin-post-ideas-for-founders",
      component: LinkedInPostIdeasForFoundersPage,
    },
  ],
  scrollBehavior(to) {
    if (to.hash) {
      return {
        el: to.hash,
        top: 24,
        behavior: "smooth",
      };
    }

    return { top: 0 };
  },
});

const AUTH_ENTRY_ROUTE_NAMES = new Set(["login", "signup"]);

router.beforeEach(async (to) => {
  const requiresAuth = to.matched.some((record) => record.meta.requiresAuth === true);
  const isAuthEntryRoute = typeof to.name === "string" && AUTH_ENTRY_ROUTE_NAMES.has(to.name);

  if (!requiresAuth && !isAuthEntryRoute) {
    return true;
  }

  const hasProtectedAccess = await ensureProtectedRouteAccess();

  if (requiresAuth && !hasProtectedAccess) {
    return {
      path: appRoutes.login,
      query: {
        redirect: to.fullPath,
      },
    };
  }

  if (isAuthEntryRoute && hasProtectedAccess) {
    return appRoutes.appGenerate;
  }

  return true;
});

export default router;
