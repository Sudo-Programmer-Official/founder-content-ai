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

## Billing Endpoints

- `GET /api/billing/overview`
- `POST /api/billing/create-checkout-session`
- `POST /api/billing/portal`
- `POST /api/webhooks/stripe`

Billing setup notes:

- configure Stripe in test mode first
- verify checkout, webhook sync, and the billing portal before switching to live mode
- follow `../../docs/payment-billing.md` for the exact plan mapping, current test price ids, env vars, webhook events, local CLI flow, Stripe portal behavior, and production cutover checklist

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

## Background Workers

FounderContent already uses a shared Postgres-backed jobs table and one shared worker runtime. Do not add a second Redis/BullMQ queue layer unless you are intentionally replacing the existing queue architecture end to end.

FounderContent should run one shared Background Worker service for async execution:

- `npm run worker`

The shared worker handles the current background workloads in priority order:

- scheduled post publishing
- email campaign sending
- email contact import jobs
- growth automation runs
- email deliverability rollups on a slower cadence

Keep the feature-specific worker entrypoints only for one-off debugging or manual backfills:

- `npm run worker:scheduled-posts`
- `npm run worker:email-campaigns`
- `npm run worker:email-deliverability`
- `npm run worker:growth-automation`

On Render, use one Background Worker service with:

- repo: this same repository
- root dir: `apps/founder-content-api`
- start command: `npm run worker`

Shared worker runtime envs:

- `DATABASE_URL`
- `DATABASE_SSL_MODE`
- `AWS_REGION`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_SESSION_TOKEN` if used
- `SYSTEM_FROM_EMAIL`
- `SYSTEM_FROM_NAME`
- `API_PUBLIC_BASE_URL`
- `APP_WORKER_POLL_INTERVAL_MS` default `5000`
- `APP_WORKER_DELIVERABILITY_INTERVAL_MS` default `900000`
- `APP_WORKER_RUN_ONCE` default `false`
- `SCHEDULED_POST_WORKER_BATCH_SIZE` default `3`
- `IDEA_PROCESS_BATCH_SIZE` default `5`
- `IDEA_PROCESS_JOB_PRIORITY` default `60`
- `POST_PUBLISH_JOB_PRIORITY` default `40`
- `SCHEDULED_POST_MAX_RETRIES` default `2`
- `POST_SAFETY_DAILY_LIMIT` default `2`
- `POST_SAFETY_MIN_GAP_MINUTES` default `240`
- `POST_DISPATCH_LINKEDIN_MIN_DELAY_SECONDS` default `0`
- `POST_DISPATCH_LINKEDIN_MAX_DELAY_SECONDS` default `8`
- `POST_DISPATCH_FACEBOOK_MIN_DELAY_SECONDS` default `6`
- `POST_DISPATCH_FACEBOOK_MAX_DELAY_SECONDS` default `18`
- `POST_DISPATCH_INSTAGRAM_MIN_DELAY_SECONDS` default `14`
- `POST_DISPATCH_INSTAGRAM_MAX_DELAY_SECONDS` default `30`
- `POST_PUBLISH_CONFLICT_RETRY_MAX_SECONDS` default `20`
- `EMAIL_CAMPAIGN_WORKER_BATCH_SIZE` default `100`
- `EMAIL_CONTACT_IMPORT_WORKER_BATCH_SIZE` default `2`
- `GROWTH_AUTOMATION_WORKER_BATCH_SIZE` default `25`

The web API should enqueue work and return quickly. The shared worker owns background execution and retries.

## Media Upload Storage

Post media, generated visuals, and workspace assets require S3-backed storage on the API service.

Required envs:

- `AWS_REGION`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `S3_MEDIA_BUCKET`

Optional envs:

- `AWS_SESSION_TOKEN`
- `S3_MEDIA_PREFIX`
- `S3_PRESIGNED_UPLOAD_TTL_SECONDS`
- `S3_MAX_IMAGE_BYTES`
- `S3_MAX_VIDEO_BYTES`

If these are missing, upload and generated-media attach flows will stay disabled and posts will remain text-only until storage is configured.

## Source Docs

Use the canonical docs in `../../docs/` as the source of truth:

- `../../docs/architecture.md`
- `../../docs/feature-spec.md`
- `../../docs/task-priority.md`
- `../../docs/handbook/social-publishing-runbook.md`
