import { createRouter, createWebHistory } from "vue-router";
import { ensureProtectedRouteAccess } from "./services/auth-service";
import { appRoutes } from "./utils/routes";
const HomePage = () => import("./pages/home.vue");
const AdminPage = () => import("./pages/admin.vue");
const AdminFeaturesPage = () => import("./pages/admin-features.vue");
const AdminMediaRegistryPage = () => import("./pages/admin-media-registry.vue");
const AdminOutreachPage = () => import("./pages/admin-outreach.vue");
const AdminUsagePage = () => import("./pages/admin-usage.vue");
const AdminUsersPage = () => import("./pages/admin-users.vue");
const AdminWorkspacesPage = () => import("./pages/admin-workspaces.vue");
const AppEmailPage = () => import("./pages/app-email.vue");
const AppAssetsPage = () => import("./pages/app-assets.vue");
const AppAutomationStudioPage = () => import("./pages/app-automation-studio.vue");
const AppBlogPage = () => import("./pages/app-blog.vue");
const AppBillingPage = () => import("./pages/app-billing.vue");
const AppBrandStudioPage = () => import("./pages/app-brand-studio.vue");
const AppGeneratePage = () => import("./pages/app-generate.vue");
const AppGrowthPage = () => import("./pages/app-growth.vue");
const AppHistoryPage = () => import("./pages/app-history.vue");
const AppIdeasPage = () => import("./pages/app-ideas.vue");
const AppOutreachPage = () => import("./pages/app-outreach.vue");
const AppRevenueAgentPage = () => import("./pages/app-revenue-agent.vue");
const AppReelStudioPage = () => import("./pages/app-reel-studio.vue");
const AppPlannerPage = () => import("./pages/app-planner.vue");
const AppResultPage = () => import("./pages/app-result.vue");
const DashboardPage = () => import("./pages/dashboard.vue");
const DashboardAnalyticsPage = () => import("./pages/dashboard-analytics.vue");
const EmailCampaignsPage = () => import("./pages/email-campaigns.vue");
const FounderContentIdeasPage = () => import("./pages/founder-content-ideas.vue");
const LinkedInHookGeneratorPage = () => import("./pages/linkedin-hook-generator.vue");
const LinkedInPostIdeasForFoundersPage = () => import("./pages/linkedin-post-ideas-for-founders.vue");
const LoginPage = () => import("./pages/login.vue");
const OnboardingPage = () => import("./pages/onboarding.vue");
const OnboardingWorkspacePage = () => import("./pages/onboarding-workspace.vue");
const PrivacyPage = () => import("./pages/privacy.vue");
const SettingsPreferencesPage = () => import("./pages/settings-preferences.vue");
const SignupPage = () => import("./pages/signup.vue");
const TermsPage = () => import("./pages/terms.vue");
const DataDeletionPage = () => import("./pages/data-deletion.vue");

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
      path: "/privacy",
      name: "privacy",
      component: PrivacyPage,
      meta: {
        shell: "public",
      },
    },
    {
      path: "/terms",
      name: "terms",
      component: TermsPage,
      meta: {
        shell: "public",
      },
    },
    {
      path: "/data-deletion",
      name: "data-deletion",
      component: DataDeletionPage,
      meta: {
        shell: "public",
      },
    },
    {
      path: "/app",
      redirect: appRoutes.appCreate,
    },
    {
      path: "/app/create",
      name: "app-create",
      component: AppGeneratePage,
      meta: {
        requiresAuth: true,
        requiresWorkspace: true,
      },
    },
    {
      path: "/app/generate",
      redirect: appRoutes.appCreate,
    },
    {
      path: "/app/growth",
      name: "app-growth",
      component: AppGrowthPage,
      meta: {
        requiresAuth: true,
        requiresWorkspace: true,
      },
    },
    {
      path: "/app/ideas",
      name: "app-ideas",
      component: AppIdeasPage,
      meta: {
        requiresAuth: true,
        requiresWorkspace: true,
      },
    },
    {
      path: "/app/history",
      name: "app-history",
      component: AppHistoryPage,
      meta: {
        requiresAuth: true,
        requiresWorkspace: true,
      },
    },
    {
      path: "/app/planner",
      name: "app-planner",
      component: AppPlannerPage,
      meta: {
        requiresAuth: true,
        requiresWorkspace: true,
      },
    },
    {
      path: "/app/result",
      name: "app-result",
      component: AppResultPage,
      meta: {
        requiresAuth: true,
        requiresWorkspace: true,
      },
    },
    {
      path: "/app/dashboard",
      name: "app-dashboard",
      component: DashboardPage,
      meta: {
        requiresAuth: true,
        requiresWorkspace: true,
      },
    },
    {
      path: "/app/outreach",
      name: "app-outreach",
      component: AppOutreachPage,
      meta: {
        requiresAuth: true,
        requiresWorkspace: true,
      },
    },
    {
      path: "/app/revenue-agent",
      name: "app-revenue-agent",
      component: AppRevenueAgentPage,
      meta: {
        requiresAuth: true,
        requiresWorkspace: true,
      },
    },
    {
      path: "/app/reels",
      name: "app-reel-studio",
      component: AppReelStudioPage,
      meta: {
        requiresAuth: true,
        requiresWorkspace: true,
      },
    },
    {
      path: "/app/assets",
      name: "app-assets",
      component: AppAssetsPage,
      meta: {
        requiresAuth: true,
        requiresWorkspace: true,
      },
    },
    {
      path: "/app/automation-studio",
      name: "app-automation-studio",
      component: AppAutomationStudioPage,
      meta: {
        requiresAuth: true,
        requiresWorkspace: true,
      },
    },
    {
      path: "/app/blog",
      name: "app-blog",
      component: AppBlogPage,
      meta: {
        requiresAuth: true,
        requiresWorkspace: true,
      },
    },
    {
      path: "/app/brand-studio",
      name: "app-brand-studio",
      component: AppBrandStudioPage,
      meta: {
        requiresAuth: true,
        requiresWorkspace: true,
      },
    },
    {
      path: "/app/billing",
      name: "app-billing",
      component: AppBillingPage,
      meta: {
        requiresAuth: true,
        requiresWorkspace: true,
      },
    },
    {
      path: "/app/email",
      name: "app-email",
      component: AppEmailPage,
      meta: {
        requiresAuth: true,
        requiresWorkspace: true,
      },
    },
    {
      path: "/app/email/new",
      name: "app-email-new",
      component: AppEmailPage,
      meta: {
        requiresAuth: true,
        requiresWorkspace: true,
      },
    },
    {
      path: "/app/email/:campaignId",
      name: "app-email-edit",
      component: AppEmailPage,
      meta: {
        requiresAuth: true,
        requiresWorkspace: true,
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
      path: "/admin/media-registry",
      name: "admin-media-registry",
      component: AdminMediaRegistryPage,
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
        requiresWorkspace: true,
      },
    },
    {
      path: "/dashboard",
      name: "dashboard",
      component: DashboardPage,
      meta: {
        requiresAuth: true,
        requiresWorkspace: true,
      },
    },
    {
      path: "/email-campaigns",
      name: "email-campaigns",
      component: EmailCampaignsPage,
      meta: {
        requiresAuth: true,
        requiresWorkspace: true,
      },
    },
    {
      path: "/onboarding",
      name: "onboarding",
      component: OnboardingPage,
      meta: {
        requiresAuth: true,
        shell: "standalone",
      },
    },
    {
      path: "/onboarding/workspace",
      name: "onboarding-workspace",
      component: OnboardingWorkspacePage,
      meta: {
        requiresAuth: true,
        shell: "standalone",
      },
    },
    {
      path: "/settings/preferences",
      name: "settings-preferences",
      component: SettingsPreferencesPage,
      meta: {
        requiresAuth: true,
        requiresWorkspace: true,
      },
    },
    {
      path: "/linkedin-hook-generator",
      name: "linkedin-hook-generator",
      component: LinkedInHookGeneratorPage,
      meta: {
        requiresAuth: true,
        requiresWorkspace: true,
      },
    },
    {
      path: "/linkedin-post-generator",
      redirect: (to) => ({
        path: appRoutes.appCreate,
        query: {
          ...to.query,
          mode: "repurpose",
        },
        hash: "#repurpose-panel",
      }),
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
    return appRoutes.appCreate;
  }

  return true;
});

export default router;
