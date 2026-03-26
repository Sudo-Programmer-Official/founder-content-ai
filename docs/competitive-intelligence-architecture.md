# Competitive Intelligence Architecture

## Goal

Build a scraping-safe competitor intelligence layer that only uses:

- public content
- user-provided sources
- conservative fetch intervals
- scheduled fetch jobs with explicit leases

This system is not designed for private-platform scraping or aggressive crawling.

## Approved Source Types

- RSS
- public URL
- website page
- manual import

Each source is created by a user for a specific business tenant.

## Core Data Flow

1. user creates a competitor source
2. source is validated as public and safe to fetch
3. source content is normalized into a shared `source_items` shape
4. AI analysis classifies:
   - topic
   - hook type
   - tone
   - format
   - why it might work
5. trend aggregation computes 7-day and 30-day signals

## Tables

The foundation migration lives at:

- `apps/founder-content-api/db/migrations/002_competitive_intelligence_foundation.sql`

Tables:

- `competitor_sources`
- `source_items`
- `source_item_analysis`
- `trend_signals`
- `competitor_watchlists`
- `watchlist_sources`

## Safety Rules

- only `http` and `https` URLs
- no embedded credentials in URLs
- no localhost or obvious private network targets
- no private auth-gated content
- no high-frequency crawling
- no auto-discovery crawl loops

## Scheduling Model

`competitor_sources` carries:

- `next_fetch_at`
- `last_fetched_at`
- `last_fetch_status`
- `fetch_lock_id`
- `fetch_locked_at`

These fields support cron-safe worker leases.

## Worker Design

The worker entry point is:

- `apps/founder-content-api/src/services/competitiveIntelligence/worker.ts`

Design rules:

- claim only due sources
- set a short lease before fetch
- process sources one at a time
- release the lease after success or failure
- schedule the next fetch conservatively

This allows future cron or queue execution without duplicate fetch storms.

## Current Implementation Status

Implemented now:

- shared source/feed/trend contracts
- source adapters
- safe URL validation
- in-memory source/item/analysis store
- AI analysis with heuristic fallback
- trend aggregation
- API endpoints

Not implemented yet:

- Postgres persistence
- background job runner
- retries with durable queues
- robots-aware advanced crawling policy
- UI for watchlists and feed review

## API Surface

- `POST /api/competitor-sources`
- `GET /api/competitor-feed`
- `GET /api/trends`

All three are business-scoped and should be called with authenticated app users.
