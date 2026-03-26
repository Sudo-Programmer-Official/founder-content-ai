# Admin Dashboard Spec

## Goal

Phase 14 adds a lightweight but production-ready admin and workspace analytics foundation.

The objective is not a polished BI suite.

It is:

- stable contracts
- usable admin APIs
- a scalable data model
- enough frontend scaffolding to validate the dashboard shape

## Admin Dashboard Scope

Routes:

- `/admin`
- `/admin/users`
- `/admin/workspaces`
- `/admin/usage`

### Platform overview metrics

The admin overview should surface:

- total users
- total workspaces
- total content generations
- total API failures
- unresolved alert count

### User growth

The dashboard should expose daily user growth series so the platform can track:

- new users by day
- trend direction over the last 7 to 14 days

### Workspace growth

The dashboard should expose daily workspace growth series so the platform can track:

- new workspaces by day
- workspace creation pace

### Usage trends

The platform should show a lightweight daily trend for:

- generations
- copies
- remixes
- publishes
- failures

### AI usage and cost visibility

The admin usage area should expose:

- total AI requests
- success and failure counts
- total tokens used
- model breakdown
- estimated cost summary

This cost number is intentionally estimated from stored token counts and a configurable rate.

### Alerting system

The admin layer should support lightweight alerting for:

- API failures
- abuse signals
- anomalies

Each alert needs:

- type
- severity
- message
- metadata
- resolved state

## Workspace Analytics Scope

Route:

- `/dashboard/analytics`

### Workspace overview

The workspace analytics view should expose:

- content generated
- output copied
- remix usage
- publish markers
- recent content assets

### Engagement actions

The tracked engagement actions in this phase are:

- `output_copied`
- `remix_used`
- `publish_marked`

### Activity timeline

The dashboard should expose a recent activity stream from `usage_events` so teams can see:

- what happened
- when it happened
- which business it belongs to

### Basic funnel

The first funnel is intentionally simple:

- generate
- copy
- publish

This gives the product a measurable activation loop without adding full attribution logic yet.

## API Scope

Admin:

- `GET /api/admin/overview`
- `GET /api/admin/users`
- `GET /api/admin/workspaces`
- `GET /api/admin/usage`

Workspace:

- `GET /api/workspace/analytics/overview`

Support endpoint added for client-side tracking:

- `POST /api/workspace/analytics/events`

## Access Rules

- all admin and workspace analytics endpoints require authentication
- admin routes require `isSuperAdmin`
- workspace routes require business membership when `businessId` is provided

## Non-Goals

Phase 14 does not include:

- billing analytics
- complex charting
- real-time streaming analytics
- complete aggregation pipelines
- finalized auth UI
