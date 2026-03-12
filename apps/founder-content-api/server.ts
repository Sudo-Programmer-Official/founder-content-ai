import express, { type Express } from "express";
import { generateHookRoute } from "./src/routes/generateHook.ts";
import { generateIdeasRoute } from "./src/routes/generateIdeas.ts";
import { generatePostRoute } from "./src/routes/generatePost.ts";

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
    const requestOrigin = request.headers.origin;

    if (requestOrigin && isAllowedOrigin(requestOrigin, allowedOrigins)) {
      response.header("Access-Control-Allow-Origin", requestOrigin);
      response.header("Vary", "Origin");
    }

    response.header("Access-Control-Allow-Headers", "Content-Type");
    response.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");

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

  app.use(express.json());

  app.get("/health", (_request, response) => {
    response.json({ status: "ok" });
  });

  app.get("/api/health", (_request, response) => {
    response.json({ status: "ok" });
  });

  app.use(generateIdeasRoute);
  app.use(generateHookRoute);
  app.use(generatePostRoute);

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
