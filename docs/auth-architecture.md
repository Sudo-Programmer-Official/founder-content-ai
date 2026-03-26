# Auth Architecture

## Goal

FounderContent AI should use Firebase Auth for identity and Postgres for application state.

That means:

- Firebase Auth owns login, token issuance, linked providers, and verification state
- Postgres owns users, businesses, memberships, usage, billing state, and admin data
- the backend API is the boundary between the identity layer and the product layer

## Recommended Auth Stack

- Firebase Auth for email/password, Google, and future email-link flows
- Firebase ID tokens for frontend-to-backend authentication
- Postgres for internal user and business records
- SES for system email first, branded business sending later

## Current Phase Scope

Phase 12 stopped before real auth wiring. Phase 13 replaces that placeholder with Firebase verification.

This repo now scaffolds:

- app-level auth and business contracts
- `/api/me`
- `/api/me/businesses`
- `POST /api/businesses`
- a dev-only `AUTH_MODE=stub` path for local scaffolding

This repo does not yet implement:

- frontend Firebase auth screens or callback handling
- invitation flows
- role enforcement beyond future-ready data shapes

## Runtime Model

### Production target

1. Frontend sends a Firebase ID token to the backend.
2. Backend validates the token with the Firebase Admin SDK.
3. Backend resolves the JWT subject to an internal `users` record.
4. Backend loads business memberships.
5. Backend authorizes the request against the active business and role.

### Local scaffold mode

When `AUTH_MODE=stub`:

- backend reads `x-dev-user-id`
- backend reads `x-dev-user-email`
- backend optionally reads `x-dev-user-name` and `x-dev-user-avatar`
- backend still goes through the real Postgres-backed user bootstrap path

This mode exists only to let the app grow cleanly before Firebase is fully wired in local/dev flows.

## Core Rules

- do not treat a user as the tenant boundary
- do not store business logic in Firebase Auth
- do not hardcode one business per user
- every business-owned entity must carry `business_id`
- future content tables should also carry `created_by_user_id`

## Planned Phases

### Phase A

- Firebase email/password
- Google federation
- users
- businesses
- business_members
- `/api/me`
- business switcher

### Phase B

- invite members
- role-based authorization
- usage events
- platform admin overview

### Phase C

- SES system emails
- business email settings
- branded sending domain setup

### Phase D

- Stripe billing
- plans
- limits
- subscription enforcement
