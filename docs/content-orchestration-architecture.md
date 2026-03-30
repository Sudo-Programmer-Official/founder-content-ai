# Content Orchestration Architecture

## Goal

The product should treat content as a shared source system, then execute it through two separate lanes:

- social distribution
- email delivery

Email is not just another social channel. It shares content intent, but it does not share the same execution model.

## Required Separation

The runtime architecture should stay:

`Content Engine -> Social Engine`

`Content Engine -> Email Engine`

Why:

- social is audience-broadcast scheduling
- email is contact-based delivery with unsubscribe, suppression, and compliance rules

## Canonical Model

Use four layers:

1. `content_batches`
2. `content_items`
3. `content_variants`
4. `schedule_items`

### `content_batches`

This is the review and confirmation layer for automation.

Examples:

- generate 7 days of LinkedIn content
- generate a founder launch email sequence
- generate one week of social drafts before scheduling

Rules:

- generation writes into a batch first
- confirmation happens before scheduling
- scheduling should create `schedule_items` only after user confirmation

### `content_items`

The shared source of truth.

One idea or base draft can create many variants.

Examples:

- founder lesson
- product launch angle
- customer proof story

### `content_variants`

One content item can branch into many channel-specific outputs.

Examples:

- LinkedIn post
- Instagram caption
- Facebook post
- Email draft

Rules:

- each variant owns its own text and media
- email variants can own HTML
- variants can be regenerated from the base item
- manually edited variants must set `is_customized = true`

### `schedule_items`

This is the planner unit.

Rules:

- one day can contain many schedule items
- each schedule item points to exactly one variant
- schedule items sort by time ascending inside a day
- planner should show `+N more` after a compact threshold

Examples:

- Monday 09:00 LinkedIn
- Monday 12:00 Instagram
- Monday 18:00 Facebook

## Current Product Boundary

The live product is not fully on this model yet.

Today:

- social scheduling is still represented by `scheduled_posts`
- social execution is LinkedIn-only
- email uses a separate campaign engine
- planner already supports many scheduled items per day on the LinkedIn side

This means the next backend cut should **bridge into** this model, not pretend it is already fully shipped.

## Migration Direction

Do this in phases.

### Phase 1

Keep current execution stable, but standardize contracts:

- define shared `content item -> variant -> schedule item` types
- keep email execution separate
- keep LinkedIn scheduling working on the current `scheduled_posts` table

### Phase 2

Introduce persistent variant records:

- `content_batches`
- `content_items`
- `content_variants`

Map current pipeline assets into content items and variants.
Use batches for bulk generation preview and confirmation.

### Phase 3

Introduce scheduler records:

- `schedule_items`

Map current `scheduled_posts` rows into schedule items for social execution.

### Phase 4

Add planner features on top:

- per-day multi-variant view
- add missing channel
- duplicate to another channel
- preserve customized variants during group regenerate

## Product Rules

- email remains a separate execution lane
- planner supports multiple scheduled items per day
- grouped edits regenerate variants from the base content item
- individual edits only change one variant
- customized variants are never silently overwritten

## Current Shared Contract

The initial shared types for this architecture live in:

- [content-orchestration.ts](/Users/abhishekkumarjha/Documents/sudo-programmer-official/founder-content-ai/packages/shared-types/src/content-orchestration.ts)

These types are foundation only. They do not claim that Instagram, Facebook, or email scheduling are already live in the current runtime.

## Initial Persistence Foundation

The first additive schema migration for this model lives at:

- [031_content_orchestration_foundation.sql](/Users/abhishekkumarjha/Documents/sudo-programmer-official/founder-content-ai/apps/founder-content-api/db/migrations/031_content_orchestration_foundation.sql)

It adds:

- `content_batches`
- `content_items`
- `content_variants`
- `schedule_items`

This migration is intentionally additive. It does not replace the current `content_assets`, `scheduled_posts`, or email campaign runtime yet.

## Current Batch API Foundation

The first live orchestration endpoints are:

- `POST /api/content/batches/generate`
- `GET /api/content/batches/:batchId?businessId=...`
- `POST /api/content/batches/:batchId/confirm`

Current behavior:

- generation creates `content_batches`, `content_items`, and `content_variants`
- confirmation creates legacy `content_assets` and `scheduled_posts` for LinkedIn execution
- confirmation also writes mirrored `schedule_items`

Current boundary:

- LinkedIn social batches only
- email lane is still handled through the existing campaign engine
- no batch review UI is wired yet on the frontend
