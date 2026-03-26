# Auth Runtime

## Goal

Phase 13 replaces the old auth placeholder with real Firebase JWT verification.

The runtime model is:

1. frontend obtains a Firebase ID token
2. frontend sends `Authorization: Bearer <token>` to the API
3. backend verifies the token with the Firebase Admin SDK
4. backend extracts the Firebase `uid`, email, display name, avatar, and provider
5. backend bootstraps or updates the internal `users` row
6. backend authorizes access through `business_members`

## Supported Modes

### Default runtime

- Firebase Auth is the default mode
- invalid or expired tokens return `401`
- requests without a bearer token return `401`

### Development stub

- enabled only when `AUTH_MODE=stub` and `NODE_ENV` is not `production`
- requires:
  - `x-dev-user-id`
  - `x-dev-user-email`
- optional:
  - `x-dev-user-name`
  - `x-dev-user-avatar`

This mode exists only to keep local UI and route development unblocked.

## Provider Mapping

Firebase token providers are normalized into app-level providers:

- `password` -> `firebase_password`
- `google.com` -> `google`
- `emailLink` -> `otp_email`
- anything else -> `firebase`

## First-Request Bootstrap

On the first authenticated request, the backend:

- inserts the user into `users` if `auth_subject` is new
- updates `email`, `full_name`, and `avatar_url` if the user already exists
- records a provider row in `auth_identities` for non-stub auth

This means `/api/me`, `/api/me/businesses`, and `POST /api/businesses` all work without a separate onboarding sync job.

## Failure Behavior

- bad or expired Firebase token -> `401 invalid_token`
- missing email in the verified token -> `401 email_required`
- missing Firebase admin credentials -> `500 auth_not_configured`
- missing `DATABASE_URL` on protected runtime paths -> `500 database_not_configured`

## Required Backend Environment

- `DATABASE_URL`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`

Optional alternative:

- `FIREBASE_SERVICE_ACCOUNT_JSON`

## Route Coverage

The Phase 13 runtime is now active on:

- `GET /api/me`
- `GET /api/me/businesses`
- `POST /api/businesses`

Other protected business-scoped flows continue to use the same auth middleware and membership service boundary.
