# Analytics Architecture

## Goal

The analytics foundation should support two layers:

1. platform analytics for admins
2. workspace analytics for individual businesses

The implementation in Phase 14 stays intentionally light, but the contracts and schema are designed to scale.

## Data Model

Core tables:

- `usage_events`
- `content_generation_logs`
- `content_assets`
- `workspace_metrics_daily`
- `platform_metrics_daily`
- `admin_alerts`

## Event Model

`usage_events` is the write-optimized activity stream.

This table is used for:

- product usage tracking
- funnel analysis
- admin investigation
- lightweight workspace activity timelines

Current event types include:

- `idea_generated`
- `hook_generated`
- `post_generated`
- `capture_used`
- `remix_used`
- `output_copied`
- `publish_marked`
- `api_failed`

## Generation Logs

`content_generation_logs` is a separate operational table for AI request visibility.

This separation matters because:

- events describe user behavior
- generation logs describe model execution behavior

The generation log stores:

- input type
- estimated tokens used
- model
- latency
- success state

## Content Assets

`content_assets` stores generated content snapshots that are useful for:

- workspace activity history
- lightweight asset browsing
- future publishing workflows

In this phase, content is stored as JSON so posts, hooks, and future email assets can share one table.

## Aggregated Metrics

`workspace_metrics_daily` and `platform_metrics_daily` are the read-optimized layer.

Phase 14 includes only a scaffolded aggregation service.

This keeps the architecture ready for:

- daily cron aggregation
- caching-heavy dashboard reads
- historical trend reporting

## Services

### `analyticsService.ts`

Owns dashboard-oriented reads:

- `getPlatformOverview()`
- `getWorkspaceOverview()`
- `getUsageSummary()`

### `metricsAggregationService.ts`

Owns rollup-oriented writes:

- `aggregateDailyMetrics()`
- `updateWorkspaceMetrics()`
- `updatePlatformMetrics()`

### `costService.ts`

Owns AI cost visibility:

- `getAICostSummary()`

The cost calculation is intentionally estimated and configurable.

### `alertService.ts`

Owns alert creation and evaluation:

- `evaluateAlerts()`
- `createAlert()`

## API Layer

Admin:

- `GET /api/admin/overview`
- `GET /api/admin/users`
- `GET /api/admin/workspaces`
- `GET /api/admin/usage`

Workspace:

- `GET /api/workspace/analytics/overview`
- `POST /api/workspace/analytics/events`

## Write Path

Phase 14 writes happen in two places:

1. backend generation controllers log generation events and execution metadata
2. frontend copy actions send lightweight tracking events back to the backend

This keeps the analytics write path simple:

- no message queue
- no separate collector service
- no complex enrichment pipeline

## Read Path

Current reads are a mix of:

- direct table queries for live data
- aggregated daily tables where available
- placeholder-friendly service boundaries for future optimization

## Safety and Scope

This phase intentionally avoids:

- billing enforcement
- heavy BI tooling
- private tracking scripts
- complex customer segmentation

The system is meant to be testable now and extensible in the next phase.
