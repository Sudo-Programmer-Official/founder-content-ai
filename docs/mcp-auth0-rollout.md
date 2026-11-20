# Auth0 MCP rollout

This is the deployment checklist for the Founder Content MCP resource server.

## Auth0 API

The custom API must use:

- Identifier: `https://api.foundercontent.ai/mcp`
- Signing algorithm: `RS256`
- Permission: `mcp:read`
- Application access: `Founder Content MCP Client` with **User-delegated Access** granted
- Client access: disabled
- Anonymous access: disabled

The client is a public SPA, so interactive authorization uses Authorization Code + PKCE. Do not add a client secret to the browser application.

## Token subject mapping

The MCP API uses Auth0's standard `sub` claim and intentionally does not auto-provision users. Link the Auth0 subject to an existing Founder Content user through the `auth_identities` table:

```bash
npm run mcp:link-auth0 -- --email=founder@example.com --subject='auth0|abc123'
```

The command is idempotent and refuses to link a subject to a missing or inactive user. No custom Auth0 Action is required.

## Render API service

Keep the MCP service disabled while setting up the claim and user link. The public, non-secret Auth0 endpoints are already represented in `render.yaml`; set the following in the API service only when ready:

```text
MCP_MODE=readonly
MCP_USER_SUBJECT_CLAIM=sub
MCP_READ_SCOPE=mcp:read
```

Apply database migrations before enabling the endpoint:

```bash
npm run db:migrate
```

## Verification

After deployment:

```bash
curl -i https://api.foundercontent.ai/mcp
```

Without a token, the expected response is `401 Unauthorized` with a `WWW-Authenticate` header containing `scope="mcp:read"` and a `resource_metadata` URL. A `404` means the service is still disabled or the deployment did not contain the MCP route.

Then connect an OAuth-capable MCP client to:

```text
https://api.foundercontent.ai/mcp
```

The first production release exposes read-only workspace tools. Keep generation, scheduling, publishing, and ad-spend actions behind separate scopes and explicit approval flows.
