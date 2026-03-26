# Database Schema

## Goal

The product data model is business-centric.

The main relationship is:

`user -> memberships -> business`

## Canonical Tables

The initial foundation migration lives at:

- `apps/founder-content-api/db/migrations/001_auth_business_foundation.sql`
- `apps/founder-content-api/db/migrations/003_auth_runtime_firebase_alignment.sql`

It creates these tables:

- `users`
- `businesses`
- `business_members`
- `auth_identities`
- `business_channels`
- `business_email_settings`
- `plans`
- `subscriptions`
- `usage_events`
- `admin_audit_logs`

## Important Schema Rules

- `users.auth_subject` is the bridge between Firebase Auth and internal app state
- `business_members` is the source of truth for tenant access
- `business_email_settings` is one-to-one with a business
- `usage_events` should exist before billing enforcement
- admin actions should always create `admin_audit_logs` entries

## Tenant Safety Rule

Every business-owned table must include `business_id`.

Examples for future tables:

- `ideas`
- `content_items`
- `content_variants`
- `campaigns`
- `contacts`
- `email_sends`
- `channel_connections`

Future content tables should also include:

- `created_by_user_id`

## Persistence Status

Phase 13 replaces the auth and business scaffold with Postgres-backed runtime queries for:

- `GET /api/me`
- `GET /api/me/businesses`
- `POST /api/businesses`

The competitive-intelligence runtime is still in-memory and should move to repository-backed persistence in a later phase.
