import type { RouteLocationNormalizedLoaded } from "vue-router";

type MixpanelProperties = Record<string, string | number | boolean | null | undefined>;

interface MixpanelClient {
  init: (token: string, config?: Record<string, unknown>) => void;
  track: (eventName: string, properties?: MixpanelProperties) => void;
}

declare global {
  interface Window {
    mixpanel?: MixpanelClient;
  }
}

const MIXPANEL_SCRIPT_ID = "mixpanel-browser-sdk";
const MIXPANEL_SCRIPT_SRC = "https://cdn.mxpnl.com/libs/mixpanel-2-latest.min.js";
const DEFAULT_MARKETING_HOSTS = ["salonflow.studio", "www.salonflow.studio"];

let isInitialized = false;
let isLoading = false;

function getMixpanelToken(): string {
  return import.meta.env.VITE_MIXPANEL_TOKEN?.trim() ?? "";
}

function getMarketingHosts(): string[] {
  const configuredHosts = import.meta.env.VITE_MIXPANEL_MARKETING_HOSTS?.trim();

  if (!configuredHosts) {
    return DEFAULT_MARKETING_HOSTS;
  }

  return configuredHosts
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter((host) => host !== "");
}

function isMarketingHost(hostname: string): boolean {
  return getMarketingHosts().includes(hostname.toLowerCase());
}

function isPublicMarketingRoute(route: RouteLocationNormalizedLoaded): boolean {
  return route.meta.shell === "public" && route.name === "home";
}

function loadMixpanelScript(): Promise<void> {
  if (typeof document === "undefined") {
    return Promise.resolve();
  }

  const existingScript = document.getElementById(MIXPANEL_SCRIPT_ID);

  if (existingScript) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.id = MIXPANEL_SCRIPT_ID;
    script.async = true;
    script.src = MIXPANEL_SCRIPT_SRC;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Unable to load Mixpanel browser SDK."));
    document.head.appendChild(script);
  });
}

async function initializeMixpanel(): Promise<boolean> {
  const token = getMixpanelToken();

  if (!token || typeof window === "undefined") {
    return false;
  }

  if (isInitialized && window.mixpanel) {
    return true;
  }

  if (isLoading) {
    return false;
  }

  isLoading = true;

  try {
    await loadMixpanelScript();

    if (!window.mixpanel) {
      return false;
    }

    window.mixpanel.init(token, {
      debug: import.meta.env.DEV,
      persistence: "localStorage",
      track_pageview: false,
    });
    isInitialized = true;
    return true;
  } catch {
    return false;
  } finally {
    isLoading = false;
  }
}

function buildLandingPageProperties(route: RouteLocationNormalizedLoaded): MixpanelProperties {
  const searchParams = new URLSearchParams(window.location.search);

  return {
    page: "landing",
    path: route.path,
    fullPath: route.fullPath,
    hostname: window.location.hostname,
    url: window.location.href,
    referrer: document.referrer || undefined,
    title: document.title,
    utm_source: searchParams.get("utm_source"),
    utm_medium: searchParams.get("utm_medium"),
    utm_campaign: searchParams.get("utm_campaign"),
    utm_content: searchParams.get("utm_content"),
    utm_term: searchParams.get("utm_term"),
  };
}

export async function trackLandingPageVisit(route: RouteLocationNormalizedLoaded): Promise<void> {
  if (
    typeof window === "undefined" ||
    !isMarketingHost(window.location.hostname) ||
    !isPublicMarketingRoute(route)
  ) {
    return;
  }

  const ready = await initializeMixpanel();

  if (!ready || !window.mixpanel) {
    return;
  }

  window.mixpanel.track("Landing Page Viewed", buildLandingPageProperties(route));
}
