import express, { type Express } from "express";
import { generateHookRoute } from "./src/routes/generateHook";
import { generateIdeasRoute } from "./src/routes/generateIdeas";
import { generatePostRoute } from "./src/routes/generatePost";

export const serverConfig = {
  appName: "founder-content-api",
  status: "wired",
  basePath: "/api",
  port: Number(process.env.PORT ?? 3001),
} as const;

export function createServerApp(): Express {
  const app = express();
  const allowedOrigin = process.env.FRONTEND_ORIGIN ?? "*";

  app.use((request, response, next) => {
    response.header("Access-Control-Allow-Origin", allowedOrigin);
    response.header("Access-Control-Allow-Headers", "Content-Type");
    response.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");

    if (request.method === "OPTIONS") {
      response.sendStatus(204);
      return;
    }

    next();
  });

  app.use(express.json());

  app.get("/health", (_request, response) => {
    response.json({
      ok: true,
      service: serverConfig.appName,
      status: "ok",
    });
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
