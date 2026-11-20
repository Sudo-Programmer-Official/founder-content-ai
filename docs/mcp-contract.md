# Founder Content MCP Contract

## Purpose

Expose Founder Content as a workspace-scoped MCP server that lets an approved AI client inspect content operations and, later, request campaign actions.

The MCP layer must remain a thin adapter over the existing API. It must not duplicate generation, scheduling, publishing, or billing logic.

## Current authentication audit

The product currently uses:

- Firebase Auth in the frontend for sign-in and ID-token issuance
- Firebase Admin in the API to verify `Authorization: Bearer <Firebase ID token>`
- Postgres `users` and `business_members` records for workspace authorization
- server-side encrypted storage for LinkedIn and Meta connection tokens
- `AUTH_MODE=stub` only for local development; production ignores stub mode

This is a good application-auth foundation. The MCP transport now adds a separate OAuth resource-server boundary: it validates signed bearer access tokens, publishes protected-resource metadata, enforces `mcp:read`, and maps a configured token claim to an already-linked Founder Content user. The API remains a resource server; it does not mint OAuth tokens.

The transport is disabled unless all issuer, endpoint, JWKS, resource, and identity-mapping values are configured. Firebase ID tokens remain for the first-party web app and are not treated as public MCP OAuth.

## Rollout boundary

Start with read-only tools:

- `founder_content_list_workspaces`
- `founder_content_get_channels`
- `founder_content_get_content_plan`

Add write tools only after workspace-scoped OAuth and client allowlisting are in place:

- `founder_content.generate_campaign`
- `founder_content.update_variant`
- `founder_content.approve_campaign`
- `founder_content.schedule_campaign`
- `founder_content.pause_automation`

Publishing and ad-spend actions must always be approval-gated. A connected AI client must never receive raw LinkedIn, Meta, or other platform tokens.

## Authorization requirements

- Authenticate the public MCP connection with OAuth 2.1 bearer tokens from a dedicated authorization server. Keep Firebase Auth for the first-party web app.
- Publish protected-resource metadata for the canonical MCP URL and validate the token audience/resource indicator.
- Require PKCE for interactive client authorization and use short-lived access tokens.
- Keep the MCP service as a resource server; it must not mint tokens itself.
- Bind every request to one user and one workspace.
- Validate the requested workspace against the authenticated user's active membership.
- Use least-privilege scopes for read-only versus write tools.
- Return an explicit authorization error when a tool requires a higher scope.
- Record tool calls, workspace ID, actor, result status, and external side effects in the audit log.

## Idempotency and safety

- Generation and scheduling tools require an idempotency key.
- Approval and publishing tools must reject already-completed actions.
- Ad tools must create drafts first; publishing and budget changes require a separate approval action.
- Tool responses should return structured JSON inside MCP content blocks so clients can reliably chain actions.

## Initial tool shapes

```text
founder_content_list_workspaces() -> { workspaces[] }

founder_content_get_channels({ businessId })
  -> { accounts[] }

founder_content_get_content_plan({ businessId, batchId })
  -> { batch, selectedPlatforms[], plan[] }
```

The first public MCP release should support a single workspace per request and read-only operations only. Generation, approval, publishing, and ads should be enabled incrementally behind feature flags.

## Live rollout configuration

The MCP transport should be disabled by default and enabled only after the authorization issuer is configured:

```text
MCP_MODE=disabled | readonly
MCP_RESOURCE_URL=https://api.foundercontent.ai/mcp
MCP_ISSUER_URL=https://dev-7qgrx7dzi24vtcvm.us.auth0.com/
MCP_AUTHORIZATION_ENDPOINT=https://dev-7qgrx7dzi24vtcvm.us.auth0.com/authorize
MCP_TOKEN_ENDPOINT=https://dev-7qgrx7dzi24vtcvm.us.auth0.com/oauth/token
MCP_JWKS_URI=https://dev-7qgrx7dzi24vtcvm.us.auth0.com/.well-known/jwks.json
MCP_USER_SUBJECT_CLAIM=sub
MCP_AUDIENCE=https://api.foundercontent.ai/mcp
MCP_READ_SCOPE=mcp:read
```

The verifier uses Auth0's standard `sub` claim. Link each approved Auth0 user once to the existing Founder Content user after the user signs in and you know the Auth0 subject:

```bash
npm run mcp:link-auth0 -- --email=founder@example.com --subject='auth0|abc123'
```

Keep `MCP_MODE=disabled` until the identity link exists, migration `097_mcp_oauth_identity.sql` has been applied, and the API has been redeployed. Then change only `MCP_MODE` to `readonly`.

When a client starts without a token, it receives a standard `WWW-Authenticate` challenge pointing to the protected-resource metadata document. The client can then discover the authorization server and complete its OAuth/PKCE flow. The first live mode exposes only `mcp:read` tools. Write scopes should be separate and absent from read-only tokens:

```text
mcp:read
mcp:campaign:create
mcp:campaign:approve
mcp:publish
mcp:ads:manage
```

Workspace membership remains the final authorization check even when the OAuth token has the correct scope.

The `MCP_USER_SUBJECT_CLAIM` value is used to find either an existing `users.auth_subject` row or an `auth_identities` row with provider `oauth`. The server rejects unlinked identities; it never auto-provisions a user from an MCP token.
