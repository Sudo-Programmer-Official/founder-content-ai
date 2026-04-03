# Multi-Platform Content Distribution Plan

## Goal

Extend the current LinkedIn-first scheduler into a multi-platform distribution system without building a second orchestration stack.

The target product flow is:

`idea -> content item -> stored platform variants -> grouped distribution -> independent platform delivery`

The system should optimize for:

- one source content object
- stored per-platform variants
- independent platform retries
- grouped planner and notification UX
- no LLM calls during publish or retry

## Current Repo State

Today the repo already has the core content foundation:

- `content_batches`
- `content_items`
- `content_variants`
- `schedule_items`

Current runtime boundary:

- `scheduled_posts` is still the live social execution bridge
- social publishing is LinkedIn-only
- `content_variants` already represents channel-specific content
- `schedule_items` already represents per-variant planning records

Important conclusion:

Do not introduce a parallel `scheduled_content` scheduler model. Build on the orchestration layer that already exists.

## Core Design Decisions

### 1. Canonical Source Of Truth

Use `content_items` as the content master.

Each item is the durable source for:

- core message
- idea / angle
- base text
- links to generated assets

### 2. Store Platform Variants

Use `content_variants` as the stored platform output layer.

Rules:

- variant generation happens at creation time
- publish and retry reuse stored variants
- no platform variant is regenerated during retry
- manual edits set `is_customized = true`

### 3. Group Delivery, But Execute Independently

Use a parent grouping layer for UX and notifications, but keep actual publish execution per platform.

This repo now adds:

- `content_distribution_groups`

And connects it to:

- `schedule_items.distribution_group_id`

This gives the system a parent record for one content item being scheduled across multiple platforms, while keeping each platform schedule item and publish attempt isolated.

## Data Model

### Canonical Content

- `content_items`
  - one master content record

- `content_variants`
  - one stored output per platform
  - current channels: `linkedin`, `instagram`, `facebook`, `email`
  - later extend to `x`

### Distribution Layer

- `content_distribution_groups`
  - parent grouping record for one content item in one execution lane
  - stores group status, title, edit cutoff, and eventual overall publish state

- `schedule_items`
  - child schedule records
  - one row per platform variant delivery
  - each row owns its own status and external reference

### Legacy Execution Bridge

- `scheduled_posts`
  - keep this for live LinkedIn execution until the generic platform scheduler is ready

## Why `content_distribution_groups` Exists

`schedule_items` is already the correct child-level record for platform jobs.

What was missing was the parent-level grouping needed for:

- grouped planner display
- grouped notification emails
- edit window rules
- future "retry Instagram only" UX
- future "reschedule all" UX

The new table is the repo-aligned replacement for the rough draft concept of `scheduled_content`.

## Execution Model

### Publish Strategy

Do not use one giant multi-platform publish job.

Use:

- one distribution group
- many platform schedule items
- one publish execution path per platform

That guarantees:

- LinkedIn can succeed while Instagram fails
- retries stay platform-specific
- rate limits and expired tokens stay isolated

## Implemented Publish Ledger

The repo now has a real publish ledger for both manual and scheduled delivery.

Tables:

- `publish_attempts`
  - one parent row per publish action
- `publish_attempt_platforms`
  - one child row per selected platform

Each platform row stores:

- status
- external platform ids
- permalink or external URL when available
- error code and message
- media summary
- retry lineage back to the failed platform row it replaces

Parent attempt status is derived from child rows:

- `processing`
- `success`
- `partial`
- `failed`

This is the current system-of-record for publish history.

## Retry Model

The implemented retry rule is:

- retry only failed platforms
- create a new publish attempt on every retry
- link the new attempt back to the prior failed platform rows
- never repost a platform that already succeeded for the same action

This is important for both UX and data safety:

- LinkedIn can remain posted while Instagram is retried
- Facebook can recover later without creating duplicate LinkedIn posts
- the history page can show the full attempt chain instead of collapsing failures

## UI Model

The current frontend behavior now matches the execution model:

- result page shows per-platform status chips and external links
- partial failures switch the CTA to `Retry failed only`
- history page reads from the publish ledger, not ad hoc scheduled-post state
- publish detail shows success links, failure reasons, and retry actions

That means manual publish and scheduled publish now share one mental model:

- one attempt
- many platform results
- selective recovery when a subset fails

### Worker Strategy

Keep one shared worker process, but move toward one generic platform dispatcher:

```ts
publishPlatformPost(platform, payload)
```

Adapters:

- `linkedinPublisher`
- `instagramPublisher`
- `facebookPublisher`
- `xPublisher`

Phase 1 keeps LinkedIn on the existing bridge.

Phase 2 routes `schedule_items` through a shared platform dispatcher.

## Connection Model

Connections must stay workspace-scoped.

Target model:

- LinkedIn workspace connection
- Meta workspace connection
  - Facebook Page
  - linked Instagram Business or Creator account
- X workspace connection

Important product rule:

Instagram publishing should be implemented through Meta Graph API, not as a standalone auth model.

One Meta login should unlock:

- Facebook Page publishing
- Instagram Business publishing

## Editing Window

Grouped scheduling needs an explicit edit cutoff.

Rule:

- `editable_until = scheduled_at - 5 minutes`

This is now stored on `content_distribution_groups`.

Behavior:

- before cutoff: edit content, variants, platforms, or schedule
- after cutoff: lock edits
- cancel can remain a separate policy decision

## Notification Model

Notifications should be grouped per distribution group, not sent per platform.

Example summary:

- LinkedIn: posted
- Instagram: posted
- Facebook: failed

This should be generated from child schedule item / publish status, then emitted as one email.

## API Direction

### Existing Endpoints

- `POST /api/content/batches/generate`
- `GET /api/content/batches/:batchId`
- `POST /api/content/batches/:batchId/confirm`

### Current Batch Boundary

Current confirm behavior still creates:

- legacy LinkedIn `scheduled_posts`
- mirrored `schedule_items`

Now it also creates:

- `content_distribution_groups`

### Next API Additions

- `POST /api/content/items/:contentItemId/variants/generate`
  - generate or regenerate stored platform variants

- `POST /api/distribution-groups/:groupId/schedule`
  - create or update platform schedule items

- `POST /api/distribution-groups/:groupId/retry`
  - retry selected failed platforms

- `PATCH /api/distribution-groups/:groupId`
  - reschedule all or edit cutoff-safe metadata

- `PATCH /api/schedule-items/:scheduleItemId`
  - edit one platform-specific delivery

### Implemented Publish APIs

The repo now exposes:

- `POST /api/publish-attempts`
  - manual multi-platform publish
- `GET /api/publish-attempts`
  - publish history list
- `GET /api/publish-attempts/:publishAttemptId`
  - publish attempt detail
- `POST /api/publish-attempts/:publishAttemptId/retry-failed`
  - retry failed platforms only

## UI Direction

### Compose

Use one editor and many previews.

Flow:

- user writes one source post
- user selects platforms
- UI shows preview tabs for each platform

Do not build four independent editors by default.

### Scheduler

Default mode:

- same time for all selected platforms

Advanced mode:

- per-platform schedule overrides

### Planner

Planner should group by distribution group, then show platform chips underneath.

Example:

- 9:00 AM LinkedIn
- 12:00 PM Instagram
- 12:00 PM Facebook

Grouped drawer actions:

- retry one platform
- edit one variant
- reschedule all
- remove one platform

## Rollout Plan

### Phase 1

Land the grouping and schema foundation without breaking LinkedIn.

Deliverables:

- `content_distribution_groups`
- `schedule_items.distribution_group_id`
- backfill existing schedule items into groups
- expose groups through content batch responses

### Phase 2

Support stored multi-platform variants in the content layer.

Deliverables:

- platform variant generation endpoints
- variant regeneration rules
- preserve customized variants
- extend channel contracts to include `x`

### Phase 3

Introduce generic platform dispatch.

Deliverables:

- shared publish dispatcher
- LinkedIn adapter migrated to dispatcher
- Instagram adapter
- Meta connection model

### Phase 4

Add grouped planner and retry UX.

Deliverables:

- grouped planner cards
- grouped notifications
- retry one platform
- edit cutoff enforcement

### Phase 5

Extend channels intentionally.

Order:

1. LinkedIn + Instagram
2. X
3. Facebook Pages

## Non-Goals For Now

Do not build yet:

- full analytics dashboards per platform
- Reddit automation
- per-platform comment automation
- heavy approval workflow
- LLM-based regeneration during publish retries

## Implementation Notes

Repo references:

- orchestration foundation: `apps/founder-content-api/db/migrations/031_content_orchestration_foundation.sql`
- new grouping foundation: `apps/founder-content-api/db/migrations/059_content_distribution_groups.sql`
- service bridge: `apps/founder-content-api/src/services/contentOrchestrationService.ts`
- current social execution bridge: `apps/founder-content-api/src/services/scheduledPostService.ts`

Current rule of thumb:

- use `content_items` for source truth
- use `content_variants` for stored platform output
- use `content_distribution_groups` for grouped UX and lifecycle
- use `schedule_items` for per-platform planning and execution status
- keep `scheduled_posts` only as the temporary LinkedIn execution bridge
