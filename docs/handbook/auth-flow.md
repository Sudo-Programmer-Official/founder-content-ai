# Auth Flow

## Target Production Flow

1. user signs in with email/password or Google through Firebase Auth
2. frontend receives a Firebase ID token
3. frontend calls backend with bearer token
4. backend validates the token with the Firebase Admin SDK
5. backend finds or creates the internal user by `auth_subject`
6. backend returns app-level session data from `/api/me`

## Current Scaffold Flow

1. set `AUTH_MODE=stub`
2. send:
   - `x-dev-user-id`
   - `x-dev-user-email`
3. backend creates or updates the real Postgres-backed user row
4. backend returns `/api/me` and business scaffolding responses

## Why This Exists

The stub path is only a temporary boundary so the route and service contracts can stabilize without blocking local development.
