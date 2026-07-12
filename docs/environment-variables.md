# Environment Variables

## Frontend

Frontend app:

- `apps/founder-content-ai`

### `VITE_API_URL`

Purpose:

- primary backend API base URL used by the frontend

Example production value:

- `https://api.foundercontent.ai/api`

Example local value:

- `http://localhost:3001/api`

Behavior:

- the frontend uses this as the primary API base URL
- if the primary production API is unavailable, the app falls back to the Render backend URL

### `VITE_FIREBASE_API_KEY`

Purpose:

- public Firebase Web API key used by the frontend auth flow for email/password sign-in and token refresh

How it is used:

- the frontend calls Firebase Auth directly
- Firebase is used for authentication only
- Postgres remains the system of record for app data

Setup note:

- create a Firebase project
- enable Email / Password sign-in
- copy the Web API Key from Firebase project settings into `apps/founder-content-ai/.env`

## Backend

Backend app:

- `apps/founder-content-api`

### `OPENAI_API_KEY`

Purpose:

- authenticates requests to OpenAI

Example:

- set in Render environment settings only

### `GOOGLE_PLACES_API_KEY`

Purpose:

- authenticates requests to the Google Places API for real Google Business lead discovery

Behavior:

- used by the revenue-agent Google Business provider
- if this is missing, the Google Business provider will fail fast
- the Google Cloud project must have the Places API enabled and billing configured

Optional alias:

- `GOOGLE_MAPS_API_KEY`

### `GOOGLE_CALENDAR_CLIENT_ID`

Purpose:

- starts the Google Calendar OAuth flow so the revenue agent can create real calendar events

Required companion envs:

- `GOOGLE_CALENDAR_CLIENT_SECRET`
- `GOOGLE_CALENDAR_REDIRECT_URI`

Notes:

- the OAuth app must allow the backend callback URL exactly as configured here
- the integration requests Google Calendar event scopes plus basic profile/email scopes so we can identify the connected account
- if you already use generic Google OAuth env names, the backend also accepts `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` as fallbacks
- the state and token storage encryption reuse the existing `SOCIAL_AUTH_STATE_SECRET` and `SOCIAL_ACCOUNT_ENCRYPTION_SECRET` keys

### `GOOGLE_CALENDAR_CLIENT_SECRET`

Purpose:

- exchanges the OAuth authorization code and refreshes Google Calendar access tokens

Required companion envs:

- `GOOGLE_CALENDAR_CLIENT_ID`
- `GOOGLE_CALENDAR_REDIRECT_URI`

### `GOOGLE_CALENDAR_REDIRECT_URI`

Purpose:

- backend OAuth callback URL registered in Google Cloud for the Google Calendar connection flow

Notes:

- must match the callback route exposed by the API exactly
- use the API host, not the frontend host

### `OPENAI_MODEL`

Purpose:

- selects the OpenAI model used for generation

Recommended default:

- `gpt-4o-mini`

### `PORT`

Purpose:

- controls the backend server port

Local example:

- `3001`

Production note:

- deployment platforms may inject this automatically

### `AUTH_MODE`

Purpose:

- selects temporary local auth behavior before Firebase verification is used

Supported values:

- `stub`

Runtime note:

- `stub` mode requires `x-dev-user-id` and `x-dev-user-email` headers on protected auth/business routes
- `stub` is ignored when `NODE_ENV=production`

### `DATABASE_URL`

Purpose:

- Postgres connection string for repository-backed auth and business storage

### `DATABASE_SSL_MODE`

Purpose:

- controls whether the backend creates the Postgres pool with SSL

Supported values:

- `disable`
- any other value enables SSL with `rejectUnauthorized: false`

Recommended target:

- AWS Postgres or compatible managed Postgres

### `FIREBASE_PROJECT_ID`

Purpose:

- Firebase project id used by the Admin SDK

### `FIREBASE_CLIENT_EMAIL`

Purpose:

- Firebase service account client email

### `FIREBASE_PRIVATE_KEY`

Purpose:

- Firebase service account private key

Format note:

- keep embedded newlines escaped as `\n` when stored in environment settings

### `FIREBASE_SERVICE_ACCOUNT_JSON`

Purpose:

- optional full Firebase service account JSON

Runtime note:

- if this is provided, it takes precedence over the individual Firebase credential variables

### `SUPER_ADMIN_EMAILS`

Purpose:

- comma-separated list of platform admin emails allowed to access admin APIs in Firebase-authenticated runtime

Development note:

- local stub mode can also elevate a request with `X-Dev-Super-Admin: true`

### `STRIPE_SECRET_KEY`

Purpose:

- authenticates backend requests to Stripe for checkout sessions, subscription lookup, and billing portal sessions

Setup rule:

- use a Stripe test secret key first
- switch to a live secret key only after billing has been verified end to end

### `STRIPE_WEBHOOK_SECRET`

Purpose:

- verifies the signature on incoming Stripe webhook events

Setup rule:

- for local development, use the signing secret from `stripe listen`
- for production, use the signing secret from the live Stripe webhook endpoint

### `STRIPE_STARTER_PRICE_ID`

Purpose:

- Stripe monthly recurring price id for the internal `pro` workspace tier shown in-product as `Starter`

### `STRIPE_PRO_PRICE_ID`

Purpose:

- Stripe monthly recurring price id for the internal `growth` workspace tier shown in-product as `Pro`

### `STRIPE_EMAIL_STARTER_PRICE_ID`

Purpose:

- optional Stripe price id for the Starter Email add-on

### `STRIPE_EMAIL_GROWTH_PRICE_ID`

Purpose:

- optional Stripe price id for the Growth Email add-on

### `STRIPE_EMAIL_SCALE_PRICE_ID`

Purpose:

- optional Stripe price id for the Scale Email add-on

Operational note:

- use `docs/payment-billing.md` for the canonical payment setup, current test price ids, webhook verification flow, Stripe portal behavior, and production cutover checklist

### `META_APP_ID`

Purpose:

- Meta app id used to start the Facebook Login OAuth flow for Facebook and Instagram publishing

### `META_APP_SECRET`

Purpose:

- Meta app secret used for OAuth code exchange and token inspection

### `META_REDIRECT_URI`

Purpose:

- exact backend callback URL registered in the Meta app for Facebook Login

Production rule:

- this must point to the backend host, not the frontend host
- recommended production value: `https://api.foundercontent.ai/api/social-auth/meta/callback`

### `META_GRAPH_VERSION`

Purpose:

- Graph API version used for Meta OAuth and page discovery

Recommended default:

- `v21.0`

### `META_SCOPE`

Purpose:

- space-separated Meta permissions requested during connect

Current default:

- `business_management pages_show_list pages_read_engagement pages_manage_posts pages_manage_metadata instagram_basic instagram_content_publish`

### `META_AUTH_SESSION_SECRET`

Purpose:

- encrypts the short-lived page-selection payload returned after Meta OAuth succeeds

Runtime note:

- if omitted, the backend falls back to `SOCIAL_AUTH_STATE_SECRET`

### `AI_ESTIMATED_COST_PER_1K_TOKENS_USD`

Purpose:

- optional placeholder rate used to estimate AI spend from logged token usage

Default behavior:

- when unset or `0`, the admin usage dashboard reports `0` estimated cost even if tokens exist

### `AWS_REGION`

Purpose:

- default AWS region for SES and future AWS-connected services

### `S3_MEDIA_BUCKET`

Purpose:

- S3 bucket used for uploaded post media

Usage:

- stores original and processed post assets before publish-time upload to LinkedIn

### `S3_MEDIA_PREFIX`

Purpose:

- optional top-level key prefix inside the media bucket

Recommended default:

- `workspaces`

### `S3_MEDIA_PUBLIC_BASE_URL`

Purpose:

- general public media base URL used when the backend needs a stable public URL for workspace assets

Example:

- `https://d1dkmcyl4t10d7.cloudfront.net`

Important note:

- this is the generic media host, not the Instagram-specific publish host
- website delivery and public media delivery should stay on separate hosts

### `S3_INSTAGRAM_PUBLIC_PREFIX`

Purpose:

- bucket prefix used for Instagram-ready public JPEG derivatives

Recommended default:

- `public-instagram`

Behavior:

- the backend writes Instagram publish-safe images into this prefix
- this lets the system expose only a narrow public path instead of opening the whole bucket

### `S3_INSTAGRAM_PUBLIC_BASE_URL`

Purpose:

- dedicated public base URL for Instagram publish media

Recommended production value:

- `https://media.foundercontent.ai`

Behavior:

- when set, Instagram publish uses this host for `public-instagram/...` assets
- when unset, the backend falls back to a compatible public object URL strategy

Operational rule:

- point this at a static media host only
- do not point this at the main site host
- the response must be a direct file response, not HTML or an app route

### `S3_PRESIGNED_UPLOAD_TTL_SECONDS`

Purpose:

- TTL for S3 presigned upload URLs

Recommended default:

- `900`

### `S3_MAX_IMAGE_BYTES`

Purpose:

- maximum allowed uploaded image size in bytes

Recommended default:

- `5242880`

### `S3_MAX_VIDEO_BYTES`

Purpose:

- maximum allowed uploaded video size in bytes

Recommended default:

- `104857600`

### `SES_CONFIGURATION_SET`

Purpose:

- optional SES configuration set for system email and event tracking later

### `SYSTEM_FROM_EMAIL`

Purpose:

- default verified sender for platform-level system emails

### `COMPETITOR_DEFAULT_FETCH_FREQUENCY_MINUTES`

Purpose:

- default low-frequency fetch interval for public competitor sources

### `COMPETITOR_MIN_FETCH_FREQUENCY_MINUTES`

Purpose:

- hard minimum interval for scheduled source fetches

### `COMPETITOR_FETCH_LOCK_TIMEOUT_MINUTES`

Purpose:

- worker lease timeout used to avoid duplicate source processing

### `COMPETITOR_FETCH_BATCH_SIZE`

Purpose:

- maximum number of due sources a worker cycle should claim at once

### `COMPETITOR_FETCH_USER_AGENT`

Purpose:

- explicit user agent sent for public content fetches

### `FRONTEND_ORIGIN`

Purpose:

- adds allowed frontend origins for backend CORS

Supported format:

- a single origin
- or a comma-separated list of origins

Example production value:

- `https://foundercontent.ai,https://www.foundercontent.ai,https://founder-content-ai.vercel.app`

## Current Default Allowed Origins

The backend also supports these built-in origins:

- `http://localhost:5173`
- `https://foundercontent.ai`
- `https://www.foundercontent.ai`
- `https://founder-content-ai.vercel.app`

Preview note:

- Vercel preview URLs that match the `founder-content-ai*.vercel.app` pattern are also accepted by the backend CORS logic

## Security Notes

- never commit real API keys
- keep `.env` files local only
- use `.env.example` files for documentation
- store production secrets in Vercel and Render environment settings
