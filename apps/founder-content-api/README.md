# FounderContent API

FounderContent API is the backend service for FounderContent AI.

## Purpose

This app owns:

- Express server setup
- generation routes
- Firebase-authenticated and Postgres-backed auth/business routes
- controllers
- AI orchestration through shared packages
- app-level service boundaries for future repository expansion

It should not contain frontend UI code.

## MVP Endpoints

- `POST /api/generate-ideas`
- `POST /api/generate-hook`
- `POST /api/generate-post`

## Auth and Business Scaffold Endpoints

- `GET /api/me`
- `GET /api/me/businesses`
- `POST /api/businesses`

These now use Firebase JWT verification in normal runtime and support `AUTH_MODE=stub` only for local development.

## Competitive Intelligence Endpoints

- `POST /api/competitor-sources`
- `GET /api/competitor-feed`
- `GET /api/trends`

These routes are designed around public or manually imported sources only and keep fetch behavior conservative.

## Admin and Analytics Endpoints

- `GET /api/admin/overview`
- `GET /api/admin/users`
- `GET /api/admin/workspaces`
- `GET /api/admin/usage`
- `GET /api/onboarding/status`
- `POST /api/onboarding/start`
- `POST /api/onboarding/preferences`
- `POST /api/onboarding/workspace`
- `POST /api/onboarding/complete`
- `GET /api/brand-profile`
- `POST /api/brand-profile/update`
- `GET /api/workspace/analytics/overview`
- `POST /api/workspace/analytics/events`

Admin routes require a super admin principal. Workspace analytics routes require auth and business membership.

## Structure

```text
apps/founder-content-api/
  db/
    migrations/
  src/
    routes/
    controllers/
    services/
    middleware/
    utils/
  server.ts
```

## Runtime Notes

- send Firebase ID tokens as `Authorization: Bearer <token>`
- set `DATABASE_URL` for Postgres-backed auth and business persistence
- set `AUTH_MODE=stub` only for local development and send `x-dev-user-id` plus `x-dev-user-email`

## Source Docs

Use the canonical docs in `../../docs/` as the source of truth:

- `../../docs/architecture.md`
- `../../docs/feature-spec.md`
- `../../docs/task-priority.md`
