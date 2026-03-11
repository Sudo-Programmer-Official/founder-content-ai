import { createRouter, createWebHistory } from "vue-router";
import HomePage from "./pages/home.vue";
import FounderContentIdeasPage from "./pages/founder-content-ideas.vue";
import LinkedInHookGeneratorPage from "./pages/linkedin-hook-generator.vue";
import LinkedInPostGeneratorPage from "./pages/linkedin-post-generator.vue";
import LinkedInPostIdeasForFoundersPage from "./pages/linkedin-post-ideas-for-founders.vue";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/",
      name: "home",
      component: HomePage,
    },
    {
      path: "/founder-content-ideas",
      name: "founder-content-ideas",
      component: FounderContentIdeasPage,
    },
    {
      path: "/linkedin-hook-generator",
      name: "linkedin-hook-generator",
      component: LinkedInHookGeneratorPage,
    },
    {
      path: "/linkedin-post-generator",
      name: "linkedin-post-generator",
      component: LinkedInPostGeneratorPage,
    },
    {
      path: "/linkedin-post-ideas-for-founders",
      name: "linkedin-post-ideas-for-founders",
      component: LinkedInPostIdeasForFoundersPage,
    },
  ],
  scrollBehavior() {
    return { top: 0 };
  },
});

export default router;
