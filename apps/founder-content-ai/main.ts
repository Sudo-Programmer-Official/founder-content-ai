import { createApp } from "vue";
import RootApp from "./RootApp.vue";
import router from "./router";
import { trackLandingPageVisit } from "./services/mixpanel-service";
import "./styles/app.css";

router.afterEach((route) => {
  void trackLandingPageVisit(route);
});

createApp(RootApp).use(router).mount("#app");
