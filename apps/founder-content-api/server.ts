import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { businessesRoute } from "./src/routes/businesses.ts";
import { brandProfileRoute } from "./src/routes/brandProfile.ts";
import { captureRoute } from "./src/routes/capture.ts";
import { competitiveIntelligenceRoute } from "./src/routes/competitiveIntelligence.ts";
import { controlDashboardRoute } from "./src/routes/controlDashboard.ts";
import { contentOrchestrationRoute } from "./src/routes/contentOrchestration.ts";
import { adminRoute } from "./src/routes/admin.ts";
import { billingRoute } from "./src/routes/billing.ts";
import { emailRoute } from "./src/routes/email.ts";
import { generateHookRoute } from "./src/routes/generateHook.ts";
import { generateIdeasRoute } from "./src/routes/generateIdeas.ts";
import { generatePostRoute } from "./src/routes/generatePost.ts";
import { generateVisualRoute } from "./src/routes/generateVisual.ts";
import { growthRoute } from "./src/routes/growth.ts";
import { growthIntelligenceRoute } from "./src/routes/growthIntelligence.ts";
import { ingestionRoute } from "./src/routes/ingestion.ts";
import { meRoute } from "./src/routes/me.ts";
import { mediaIntelligenceRoute } from "./src/routes/mediaIntelligence.ts";
import { onboardingRoute } from "./src/routes/onboarding.ts";
import { outreachAdminRoute, outreachRoute } from "./src/routes/outreach.ts";
import { postAssetsRoute } from "./src/routes/postAssets.ts";
import { remixRoute } from "./src/routes/remix.ts";
import { repurposeRoute } from "./src/routes/repurpose.ts";
import { scheduledPostsRoute } from "./src/routes/scheduledPosts.ts";
import { socialAuthRoute } from "./src/routes/socialAuth.ts";
import { transcribeRoute } from "./src/routes/transcribe.ts";
import { userPreferencesRoute } from "./src/routes/userPreferences.ts";
import { workspaceAnalyticsRoute } from "./src/routes/workspaceAnalytics.ts";
import { workspaceAssetsRoute } from "./src/routes/workspaceAssets.ts";
import { workspaceInsightsRoute } from "./src/routes/workspaceInsights.ts";
import { workspaceKnowledgeRoute } from "./src/routes/workspaceKnowledge.ts";
import { sendApiError, toErrorContext } from "./src/utils/http.ts";
import { logError, logInfo } from "./src/utils/logger.ts";

export const serverConfig = {
  appName: "founder-content-api",
  status: "wired",
  basePath: "/api",
  port: Number(process.env.PORT ?? 3001),
} as const;

function buildAllowedOrigins(): Set<string> {
  const configuredOrigins = (process.env.FRONTEND_ORIGIN ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return new Set([
    "http://localhost:5173",
    "https://foundercontent.ai",
    "https://www.foundercontent.ai",
    "https://founder-content-ai.vercel.app",
    ...configuredOrigins,
  ]);
}

function isAllowedOrigin(origin: string, allowedOrigins: Set<string>): boolean {
  if (allowedOrigins.has(origin)) {
    return true;
  }

  return /^https:\/\/founder-content-ai(?:-[a-z0-9-]+)?\.vercel\.app$/i.test(origin);
}

export function createServerApp(): Express {
  const app = express();
  const allowedOrigins = buildAllowedOrigins();

  app.use((request, response, next) => {
    const startedAt = Date.now();

    response.on("finish", () => {
      logInfo("Handled request.", {
        method: request.method,
        path: request.originalUrl,
        statusCode: response.statusCode,
        durationMs: Date.now() - startedAt,
      });
    });

    next();
  });

  app.use((request, response, next) => {
    const requestOrigin = request.headers.origin;

    if (requestOrigin && isAllowedOrigin(requestOrigin, allowedOrigins)) {
      response.header("Access-Control-Allow-Origin", requestOrigin);
      response.header("Vary", "Origin");
    }

    response.header(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-Dev-User-Id, X-Dev-User-Email, X-Dev-User-Name, X-Dev-User-Avatar, X-Dev-Super-Admin",
    );
    response.header("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");

    if (request.method === "OPTIONS") {
      if (requestOrigin && !isAllowedOrigin(requestOrigin, allowedOrigins)) {
        response.sendStatus(403);
        return;
      }

      response.sendStatus(204);
      return;
    }

    next();
  });

  app.use(billingRoute);
  app.use(express.json({ limit: "25mb" }));

  app.get("/health", (_request, response) => {
    response.json({ status: "ok" });
  });

  app.get("/api/health", (_request, response) => {
    response.json({ status: "ok" });
  });

  app.use(generateIdeasRoute);
  app.use(generateHookRoute);
  app.use(generatePostRoute);
  app.use(transcribeRoute);
  app.use(generateVisualRoute);
  app.use(growthRoute);
  app.use(growthIntelligenceRoute);
  app.use(ingestionRoute);
  app.use(captureRoute);
  app.use(remixRoute);
  app.use(repurposeRoute);
  app.use(controlDashboardRoute);
  app.use(contentOrchestrationRoute);
  app.use(postAssetsRoute);
  app.use(meRoute);
  app.use(mediaIntelligenceRoute);
  app.use(userPreferencesRoute);
  app.use(businessesRoute);
  app.use(socialAuthRoute);
  app.use(scheduledPostsRoute);
  app.use(brandProfileRoute);
  app.use(workspaceAssetsRoute);
  app.use(workspaceInsightsRoute);
  app.use(workspaceKnowledgeRoute);
  app.use(onboardingRoute);
  app.use(adminRoute);
  app.use(emailRoute);
  app.use(outreachAdminRoute);
  app.use(outreachRoute);
  app.use(workspaceAnalyticsRoute);
  app.use(competitiveIntelligenceRoute);

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    logError("Unhandled Express error.", toErrorContext(error));
    sendApiError(response, 500, "internal_server_error", "Unexpected server error.");
  });

  return app;
}

export function startServer(port = serverConfig.port) {
  const app = createServerApp();

  return app.listen(port, () => {
    console.info(`[${serverConfig.appName}] listening on port ${port}`);
  });
}

if (process.argv[1]?.includes("server.ts")) {
  startServer();
}
