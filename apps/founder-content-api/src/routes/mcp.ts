import express, { type RequestHandler } from "express";
import {
  AuthInfo,
  bearerAuthChallengeResponse,
  createMcpHandler,
  getOAuthProtectedResourceMetadataUrl,
  McpServer,
  oauthMetadataResponse,
  OAuthError,
  OAuthErrorCode,
  type OAuthTokenVerifier,
  type AuthMetadataOptions,
  verifyBearerToken,
} from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { z } from "zod/v4";
import type { AuthenticatedPrincipal } from "../middleware/auth.ts";
import { requireLinkedUser, listUserBusinesses } from "../services/authBusinessService.ts";
import { getSocialContentPlan } from "../services/socialContentPlanService.ts";
import { listSocialAccounts } from "../services/socialAuthService.ts";
import type { SocialContentPlanPlatform } from "../../../../packages/shared-types/index.ts";
import { logWarn } from "../utils/logger.ts";

const MCP_PATH = "/mcp";
const DEFAULT_READ_SCOPE = "mcp:read";
const MCP_SUBJECT_CLAIM = "sub";

interface McpRuntimeConfig {
  resourceUrl: URL;
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint?: string;
  jwksUri: URL;
  audience: string;
  subjectClaim: string;
  readScope: string;
  jwks: ReturnType<typeof createRemoteJWKSet>;
}

function normalizeUrl(value: string): string {
  return value.trim().replace(/\/$/, "");
}

function readUrl(value: string | undefined): URL | null {
  if (!value?.trim()) {
    return null;
  }

  try {
    return new URL(value.trim());
  } catch {
    return null;
  }
}

function readMcpConfig(): McpRuntimeConfig | null {
  if (process.env.MCP_MODE?.trim().toLowerCase() !== "readonly") {
    return null;
  }

  const resourceUrl = readUrl(process.env.MCP_RESOURCE_URL);
  const issuerUrl = readUrl(process.env.MCP_ISSUER_URL);
  const authorizationEndpoint = readUrl(process.env.MCP_AUTHORIZATION_ENDPOINT);
  const tokenEndpoint = readUrl(process.env.MCP_TOKEN_ENDPOINT);
  const jwksUri = readUrl(process.env.MCP_JWKS_URI);
  const registrationEndpoint = readUrl(process.env.MCP_REGISTRATION_ENDPOINT);
  const subjectClaim = process.env.MCP_USER_SUBJECT_CLAIM?.trim() || MCP_SUBJECT_CLAIM;
  const readScope = process.env.MCP_READ_SCOPE?.trim() || DEFAULT_READ_SCOPE;

  if (!resourceUrl || !issuerUrl || !authorizationEndpoint || !tokenEndpoint || !jwksUri) {
    logWarn("MCP readonly mode is configured but its OAuth endpoints are incomplete; MCP remains disabled.");
    return null;
  }

  const resource = normalizeUrl(resourceUrl.toString());
  const audience = normalizeUrl(process.env.MCP_AUDIENCE?.trim() || resource);

  if (audience !== resource) {
    logWarn("MCP_AUDIENCE must match MCP_RESOURCE_URL so RFC 8707 resource validation remains enforced.", {
      audience,
      resource,
    });
    return null;
  }

  const issuer = normalizeUrl(issuerUrl.toString());

  if (issuerUrl.protocol !== "https:" && !["localhost", "127.0.0.1", "::1"].includes(issuerUrl.hostname)) {
    logWarn("MCP_ISSUER_URL must use HTTPS outside local development; MCP remains disabled.");
    return null;
  }

  return {
    resourceUrl,
    issuer,
    authorizationEndpoint: authorizationEndpoint.toString(),
    tokenEndpoint: tokenEndpoint.toString(),
    registrationEndpoint: registrationEndpoint?.toString(),
    jwksUri,
    audience,
    subjectClaim,
    readScope,
    jwks: createRemoteJWKSet(jwksUri),
  };
}

function readStringClaim(payload: JWTPayload, claim: string): string | undefined {
  const value = payload[claim];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function resolveScopes(payload: JWTPayload): string[] {
  const scopeClaim = payload.scope ?? payload.scp;

  if (typeof scopeClaim === "string") {
    return scopeClaim.split(/\s+/).map((scope) => scope.trim()).filter(Boolean);
  }

  if (Array.isArray(scopeClaim)) {
    return scopeClaim.filter((scope): scope is string => typeof scope === "string" && Boolean(scope.trim()));
  }

  return [];
}

class JwtMcpTokenVerifier implements OAuthTokenVerifier {
  constructor(private readonly config: McpRuntimeConfig) {}

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    try {
      const { payload } = await jwtVerify(token, this.config.jwks, {
        issuer: this.config.issuer,
        audience: this.config.audience,
      });

      const subject = readStringClaim(payload, this.config.subjectClaim);
      const email = readStringClaim(payload, "email");

      if (!subject || !email) {
        throw new OAuthError(
          OAuthErrorCode.InvalidToken,
          `The access token must include ${this.config.subjectClaim} and email claims.`,
        );
      }

      const scopes = resolveScopes(payload);

      if (!scopes.includes(this.config.readScope)) {
        throw new OAuthError(
          OAuthErrorCode.InsufficientScope,
          `The access token must include the ${this.config.readScope} scope.`,
        );
      }

      if (typeof payload.exp !== "number") {
        throw new OAuthError(OAuthErrorCode.InvalidToken, "The access token must include an expiration.");
      }

      return {
        token,
        clientId: readStringClaim(payload, "client_id") ?? readStringClaim(payload, "azp") ?? "unknown",
        scopes,
        expiresAt: payload.exp,
        resource: this.config.resourceUrl,
        extra: {
          mcpUserSubject: subject,
          mcpEmail: email,
          mcpFullName: readStringClaim(payload, "name") ?? email.split("@")[0] ?? "Founder Content User",
          mcpAvatarUrl: readStringClaim(payload, "picture"),
        },
      };
    } catch (error) {
      if (error instanceof OAuthError) {
        throw error;
      }

      throw new OAuthError(OAuthErrorCode.InvalidToken, "The access token is invalid or expired.");
    }
  }
}

function principalFromAuthInfo(authInfo: AuthInfo | undefined): AuthenticatedPrincipal {
  const extra = authInfo?.extra;
  const subject = typeof extra?.mcpUserSubject === "string" ? extra.mcpUserSubject : undefined;
  const email = typeof extra?.mcpEmail === "string" ? extra.mcpEmail : undefined;

  if (!authInfo || !subject || !email) {
    throw new OAuthError(OAuthErrorCode.InvalidToken, "MCP authentication context is incomplete.");
  }

  return {
    subject,
    email,
    fullName:
      typeof extra?.mcpFullName === "string" && extra.mcpFullName.trim()
        ? extra.mcpFullName
        : email.split("@")[0] || "Founder Content User",
    avatarUrl: typeof extra?.mcpAvatarUrl === "string" ? extra.mcpAvatarUrl : undefined,
    emailVerified: true,
    provider: "oauth",
    isSuperAdmin: false,
  };
}

function jsonToolResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

function sanitizeSocialAccount(account: Awaited<ReturnType<typeof listSocialAccounts>>["accounts"][number]) {
  return {
    id: account.id,
    businessId: account.businessId,
    platform: account.platform,
    accountEmail: account.accountEmail,
    tokenExpiresAt: account.tokenExpiresAt,
    refreshTokenExpiresAt: account.refreshTokenExpiresAt,
    scopes: account.scopes,
    status: account.status,
    selectedIdentity: account.selectedIdentity
      ? {
        id: account.selectedIdentity.id,
        platform: account.selectedIdentity.platform,
        type: account.selectedIdentity.type,
        displayName: account.selectedIdentity.displayName,
      }
      : undefined,
    availableIdentities: account.availableIdentities.map((identity) => ({
      id: identity.id,
      platform: identity.platform,
      type: identity.type,
      displayName: identity.displayName,
    })),
  };
}

function buildMcpRouter(config: McpRuntimeConfig): express.Router {
  const serverHandler = createMcpHandler(
    (_context) => {
      const server = new McpServer({
        name: "founder-content",
        version: "0.1.0",
      });

      server.registerTool(
        "founder_content_list_workspaces",
        {
          title: "List Founder Content workspaces",
          description: "Read the workspaces the authenticated Founder Content user can access. This never creates or changes data.",
          inputSchema: z.object({}),
        },
        async (_input, context) => {
          const principal = principalFromAuthInfo(context.http?.authInfo);
          await requireLinkedUser(principal);
          return jsonToolResult(await listUserBusinesses(principal));
        },
      );

      server.registerTool(
        "founder_content_get_channels",
        {
          title: "Get connected publishing channels",
          description: "Read the connected LinkedIn, Facebook, and Instagram channel status for one workspace. Access tokens are never returned.",
          inputSchema: z.object({
            businessId: z.string().min(1),
          }),
        },
        async ({ businessId }, context) => {
          const principal = principalFromAuthInfo(context.http?.authInfo);
          await requireLinkedUser(principal);
          const response = await listSocialAccounts(principal, businessId);
          return jsonToolResult({
            accounts: response.accounts.map(sanitizeSocialAccount),
          });
        },
      );

      server.registerTool(
        "founder_content_get_content_plan",
        {
          title: "Get a content plan",
          description: "Read a generated content plan and its channel-ready entries for one workspace and batch. This is read-only.",
          inputSchema: z.object({
            businessId: z.string().min(1),
            batchId: z.string().min(1),
            goal: z.string().optional(),
            platforms: z.array(z.enum(["linkedin", "instagram", "facebook"])).optional(),
            startDate: z.string().optional(),
            defaultScheduledTime: z.string().optional(),
          }),
        },
        async ({ businessId, batchId, goal, platforms, startDate, defaultScheduledTime }, context) => {
          const principal = principalFromAuthInfo(context.http?.authInfo);
          await requireLinkedUser(principal);
          const response = await getSocialContentPlan(principal, {
            businessId,
            batchId,
            goal,
            platforms: platforms as SocialContentPlanPlatform[] | undefined,
            startDate,
            defaultScheduledTime,
          });

          return jsonToolResult({
            batch: response.batch,
            selectedPlatforms: response.selectedPlatforms,
            plan: response.plan,
          });
        },
      );

      return server;
    },
    {
      legacy: "stateless",
      responseMode: "json",
    },
  );

  const nodeHandler = toNodeHandler(serverHandler);
  const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(config.resourceUrl);
  const router = express.Router();
  const metadataOptions: AuthMetadataOptions = {
    oauthMetadata: {
      issuer: config.issuer,
      authorization_endpoint: config.authorizationEndpoint,
      token_endpoint: config.tokenEndpoint,
      ...(config.registrationEndpoint ? { registration_endpoint: config.registrationEndpoint } : {}),
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      token_endpoint_auth_methods_supported: ["none", "client_secret_basic", "client_secret_post"],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: [config.readScope],
    },
    resourceServerUrl: config.resourceUrl,
    resourceName: "Founder Content MCP",
    scopesSupported: [config.readScope],
  };

  router.use(async (request, response, next) => {
    const requestUrl = new URL(
      request.originalUrl,
      `${request.protocol}://${request.get("host")}`,
    );
    const metadataResponse = oauthMetadataResponse(
      new Request(requestUrl, {
        method: request.method,
        headers: request.headers as Record<string, string>,
      }),
      metadataOptions,
    );

    if (!metadataResponse) {
      next();
      return;
    }

    response.status(metadataResponse.status);
    metadataResponse.headers.forEach((value, key) => response.setHeader(key, value));
    response.send(await metadataResponse.text());
  });

  const verifier = new JwtMcpTokenVerifier(config);
  const authenticate: RequestHandler = async (request, response, next) => {
    try {
      const authInfo = await verifyBearerToken(request.headers.authorization, {
        verifier,
        requiredScopes: [config.readScope],
        expectedResource: config.resourceUrl,
        resourceMetadataUrl,
      });
      (request as unknown as { auth?: AuthInfo }).auth = authInfo;
      next();
    } catch (error) {
      const challenge = bearerAuthChallengeResponse(error, {
        requiredScopes: [config.readScope],
        resourceMetadataUrl,
      });
      response.status(challenge.status);
      challenge.headers.forEach((value, key) => response.setHeader(key, value));
      response.send(await challenge.text());
    }
  };

  router.all(MCP_PATH, authenticate, (request, response, next) => {
    void nodeHandler(
      request as unknown as Parameters<typeof nodeHandler>[0],
      response,
      request.body,
    ).catch(next);
  });

  return router;
}

const mcpConfig = readMcpConfig();

if (process.env.MCP_MODE?.trim().toLowerCase() === "readonly" && !mcpConfig) {
  logWarn("MCP is not exposed because its readonly OAuth configuration is incomplete.");
}

export const mcpRoute = mcpConfig ? buildMcpRouter(mcpConfig) : express.Router();
