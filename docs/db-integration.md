# DB Integration

## Goal

Phase 13 moves auth and business persistence out of in-memory maps and into Postgres.

## Runtime Components

### DB client

`apps/founder-content-api/src/services/db/client.ts`

This module owns:

- Postgres pool creation
- SSL mode handling
- query helpers
- transaction helper
- connection-level logging

### Auth and business repository service

`apps/founder-content-api/src/services/authBusinessService.ts`

This module now:

- bootstraps users by `auth_subject`
- upserts auth identities
- queries memberships from `business_members`
- inserts businesses and owner memberships transactionally

## Migrations

Current auth/business migration chain:

1. `001_auth_business_foundation.sql`
2. `003_auth_runtime_firebase_alignment.sql`

The alignment migration renames the old `cognito_sub` bridge column to `auth_subject` and updates the provider check constraint for Firebase-era providers.

## Query Behavior

### `GET /api/me`

- verifies Firebase token
- ensures the internal user exists
- loads memberships
- loads linked auth providers

### `GET /api/me/businesses`

- verifies Firebase token
- ensures the internal user exists
- returns joined business memberships

### `POST /api/businesses`

- verifies Firebase token
- ensures the internal user exists
- creates the business row
- creates the owner membership
- returns the created business plus membership

## Transaction Rules

Business creation runs in a transaction so the API does not leave orphaned business rows if membership creation fails.

## Slug Handling

Business slug creation is collision-aware.

The runtime:

- slugifies the requested name or explicit slug
- retries with numeric suffixes when the slug is already taken
- stops after bounded attempts and returns a conflict-style error

## Operational Notes

- set `DATABASE_SSL_MODE=disable` only for local Postgres without SSL
- leave SSL enabled for managed Postgres by default
- the API still needs actual dependency installation before these modules can run

## Remaining Work

Phase 13 only replaces auth and business persistence.

Still pending for future phases:

- competitive-intelligence persistence
- usage event persistence
- invite/member management routes
- billing/subscription repositories
