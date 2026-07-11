# Deployment Guide

## Deployment Model

FounderContent AI uses automatic deployment through GitHub integration.

Frontend:

- Platform: Vercel
- Domain: `https://foundercontent.ai`

Backend:

- Platform: Render
- Domain: `https://api.foundercontent.ai`

## Frontend Deployment

Platform:

- Vercel

Project root:

- `apps/founder-content-ai`

Build settings:

- Root Directory: `apps/founder-content-ai`
- Build Command: `npm run build`
- Output Directory: `dist`

Environment variables:

- `VITE_API_URL=https://api.foundercontent.ai/api`

## Backend Deployment

Platform:

- Render

Project root:

- `apps/founder-content-api`

Build settings:

- Root Directory: `apps/founder-content-api`
- Build Command: `npm install`
- Start Command: `node server.ts`

Required environment variables:

- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `PORT`
- `FRONTEND_ORIGIN`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_STARTER_PRICE_ID`
- `STRIPE_PRO_PRICE_ID`
- `META_APP_ID`
- `META_APP_SECRET`
- `META_REDIRECT_URI`

Optional billing environment variables:

- `STRIPE_EMAIL_STARTER_PRICE_ID`
- `STRIPE_EMAIL_GROWTH_PRICE_ID`
- `STRIPE_EMAIL_SCALE_PRICE_ID`

Recommended production values:

- `OPENAI_MODEL=gpt-4o-mini`
- `FRONTEND_ORIGIN=https://foundercontent.ai,https://www.foundercontent.ai,https://founder-content-ai.vercel.app`
- `META_REDIRECT_URI=https://api.foundercontent.ai/api/social-auth/meta/callback`
- `GOOGLE_CALENDAR_REDIRECT_URI=https://api.foundercontent.ai/api/google-calendar/callback`

Notes:

- Render usually injects `PORT` automatically.
- `FRONTEND_ORIGIN` may be provided as a comma-separated list.
- the backend also allows the main Vercel project domain and Vercel preview URLs for browser-based testing and preview deploys
- `STRIPE_WEBHOOK_SECRET` must come from the live Stripe webhook endpoint when billing is moved to production
- `STRIPE_STARTER_PRICE_ID` and `STRIPE_PRO_PRICE_ID` must be live Stripe price ids in production, not test ids
- if `/app/billing` should sell the email add-on, `STRIPE_EMAIL_STARTER_PRICE_ID`, `STRIPE_EMAIL_GROWTH_PRICE_ID`, and `STRIPE_EMAIL_SCALE_PRICE_ID` must also be live Stripe price ids
- `META_REDIRECT_URI` must exactly match a Valid OAuth Redirect URI in the Meta app dashboard.
- use the backend API host for the Meta callback. Do not point Meta OAuth back to the frontend app host.
- `GOOGLE_CALENDAR_REDIRECT_URI` must exactly match a Google OAuth authorized redirect URI in the Google Cloud console.
- use the backend API host for the Google Calendar callback. Do not point Google OAuth back to the frontend app host.

## Health Check

Backend health endpoint:

- `GET /api/health`

Expected response:

```json
{
  "status": "ok"
}
```

This endpoint can be used for infrastructure monitoring and platform health checks.

## CI/CD Behavior

Frontend:

- Git push -> GitHub integration -> Vercel auto deploy

Backend:

- Git push -> GitHub integration -> Render auto deploy

No manual deployment is required for normal code changes.

## Deployment Checklist

1. Set production environment variables in Vercel and Render.
2. Confirm frontend root directory is `apps/founder-content-ai`.
3. Confirm backend root directory is `apps/founder-content-api`.
4. Confirm the API custom domain points to Render.
5. Verify `GET /api/health` returns `{"status":"ok"}` after deploy.

## Stripe Billing Production Release Checklist

Before switching Stripe billing to production:

1. Verify the full billing flow in Stripe test mode: checkout, webhook sync, billing portal, and plan update in the app.
2. Create the live Stripe products and recurring monthly prices for `Starter` and `Pro`.
3. Replace Render backend env vars with live Stripe values:
   - `STRIPE_SECRET_KEY`
   - `STRIPE_WEBHOOK_SECRET`
   - `STRIPE_STARTER_PRICE_ID`
   - `STRIPE_PRO_PRICE_ID`
4. Confirm `FRONTEND_ORIGIN` includes `https://foundercontent.ai`.
5. Create the live Stripe webhook endpoint:
   - `https://api.foundercontent.ai/api/webhooks/stripe`
6. Subscribe that live webhook to:
   - `checkout.session.completed`
   - `invoice.paid`
   - `invoice.payment_succeeded`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `customer.subscription.paused`
   - `customer.subscription.resumed`
7. Confirm the Stripe customer portal is enabled in live mode.
8. Deploy the backend with the live Stripe env vars in place.
9. Run one live purchase end to end and verify:
   - the user returns to `/app/billing`
   - the workspace plan updates correctly in the app
   - `businesses.plan_code` changes to the expected internal code
   - a `subscriptions` row exists with the live Stripe customer id, subscription id, price id, and period dates
   - the Stripe billing portal opens from the app for the paying workspace
10. Repeat the verification for cancellation or plan change from the Stripe billing portal.

Use `docs/payment-billing.md` as the canonical payment and billing reference during release.

## Related Runbooks

- `./handbook/db-migration-runbook.md`
  - local, dev, prod, and older-database migration workflow for Postgres schema changes
- `./handbook/social-publishing-runbook.md`
  - working DNS, media host, Instagram smoke test, and publish history recovery flow
- `./payment-billing.md`
  - Stripe plan mapping, current billing architecture, webhook behavior, local verification, and test-to-live billing cutover
