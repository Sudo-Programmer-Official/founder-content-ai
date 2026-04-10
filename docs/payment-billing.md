# Payment and Billing

This is the canonical payment and billing document for FounderContent AI.

Use Stripe test mode first. Switch to live mode only after checkout, webhook sync, and billing portal flows are verified end to end.

## Scope

This document covers:

- plan and price mapping
- current Stripe test-mode ids
- backend routes
- frontend flow
- Stripe billing portal behavior
- required env vars
- webhook events
- database sync behavior
- local verification
- production cutover

## Current Plan Model

User-facing plans:

- Free -> `$0/month`
- Starter -> `$9/month`
- Pro -> `$19/month`

Internal workspace plan codes:

- `free` -> Free
- `pro` -> Starter
- `growth` -> Pro
- `custom` -> manual support plan

Important: internal plan codes do not match the marketing labels exactly. In this codebase:

- `pro` means the user-facing Starter plan
- `growth` means the user-facing Pro plan

## Current Stripe Test Configuration

Current Stripe monthly test price ids:

- Starter: `price_1TKlOBQZyvgtsQ6Eu9Tr9Qw0`
- Pro: `price_1TKlPmQZyvgtsQ6EGWsRlkVt`

Use them as:

```env
STRIPE_STARTER_PRICE_ID=price_1TKlOBQZyvgtsQ6Eu9Tr9Qw0
STRIPE_PRO_PRICE_ID=price_1TKlPmQZyvgtsQ6EGWsRlkVt
```

These are test-mode values and should not be reused for production.

## Current Product Behavior

Billing flow summary:

1. User selects a paid plan from `/app/billing`.
2. Frontend calls `POST /api/billing/create-checkout-session`.
3. Backend creates a Stripe Checkout session in subscription mode.
4. Stripe redirects the user back to `/app/billing`.
5. Stripe webhook updates the database.
6. Frontend reloads billing state and reflects the synced plan.

Manage billing flow:

1. After a Stripe customer record exists, the workspace can open the Stripe billing portal.
2. Frontend calls `POST /api/billing/portal`.
3. Backend creates a Stripe customer portal session.
4. User manages card details, plan changes, or cancellation inside Stripe.
5. Stripe webhooks sync the resulting subscription state back into the database.

Access control:

- only workspace `owner` or `admin` can start checkout
- only workspace `owner` or `admin` can open billing management

## Routes

Backend routes:

- `GET /api/billing/overview`
- `POST /api/billing/create-checkout-session`
- `POST /api/billing/portal`
- `POST /api/webhooks/stripe`

Frontend billing route:

- `/app/billing`

## Stripe Billing Portal

Yes, users can manage billing in Stripe after the workspace has a Stripe customer record.

That includes:

- payment method updates
- plan management
- subscription cancellation
- any other settings enabled in the Stripe customer portal configuration

Important conditions:

- the workspace must already have a Stripe customer id
- the acting user must be an `owner` or `admin`

## Required Backend Env Vars

Set these in `apps/founder-content-api/.env` for local development, then in the deployment platform for production:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_STARTER_PRICE_ID`
- `STRIPE_PRO_PRICE_ID`
- `FRONTEND_ORIGIN`

Optional email add-on billing env vars:

- `STRIPE_EMAIL_STARTER_PRICE_ID`
- `STRIPE_EMAIL_GROWTH_PRICE_ID`
- `STRIPE_EMAIL_SCALE_PRICE_ID`

Example local backend env:

```env
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_STARTER_PRICE_ID=price_1TKlOBQZyvgtsQ6Eu9Tr9Qw0
STRIPE_PRO_PRICE_ID=price_1TKlPmQZyvgtsQ6EGWsRlkVt
FRONTEND_ORIGIN=http://localhost:5173
```

## Stripe Dashboard Setup

In Stripe test mode:

1. Create product `Starter` with a recurring monthly price of `$9`.
2. Create product `Pro` with a recurring monthly price of `$19`.
3. Copy the resulting price ids into:
   - `STRIPE_STARTER_PRICE_ID`
   - `STRIPE_PRO_PRICE_ID`
4. Create a webhook endpoint that points to:
   - local: `http://localhost:3001/api/webhooks/stripe`
   - production: `https://<your-api-domain>/api/webhooks/stripe`
5. Enable the Stripe customer portal in the Stripe dashboard.

Recommended webhook events:

- `checkout.session.completed`
- `invoice.paid`
- `invoice.payment_succeeded`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `customer.subscription.paused`
- `customer.subscription.resumed`

## Webhook and Database Sync

The system of record is:

`Stripe webhook -> backend sync -> database -> product access layer`

The frontend must never be trusted as the source of billing truth.

Current sync behavior:

- `checkout.session.completed` fetches the Stripe subscription and syncs it
- `invoice.paid` and `invoice.payment_succeeded` refresh active subscription state
- `customer.subscription.created`, `updated`, `deleted`, `paused`, and `resumed` sync subscription lifecycle changes

Database tables involved:

- `businesses`
- `subscriptions`
- `plans`
- `email_billing_configs` for email add-ons

Current workspace plan persistence:

- `businesses.plan_code` stores the effective workspace tier
- `subscriptions` stores Stripe customer id, subscription id, price id, status, and billing period dates

## Local Test Flow

Start the backend:

```bash
cd apps/founder-content-api
npm run dev
```

Start the frontend:

```bash
cd apps/founder-content-ai
npm run dev
```

Forward Stripe events locally with Stripe CLI:

```bash
stripe listen --forward-to localhost:3001/api/webhooks/stripe
```

Copy the webhook signing secret printed by Stripe CLI into `STRIPE_WEBHOOK_SECRET`.

Test card for a successful payment:

- `4242 4242 4242 4242`

Use:

- any future expiry date
- any CVC
- any ZIP code

## Verification Checklist

Before switching to live mode, verify all of this in test mode:

1. Open `/app/billing`.
2. Start Starter checkout.
3. Complete checkout with the Stripe test card.
4. Confirm Stripe redirects back to `/app/billing`.
5. Confirm the billing page updates from `Free` to `Starter`.
6. Confirm `businesses.plan_code` changes from `free` to `pro`.
7. Confirm a `subscriptions` row exists with:
   - `provider_customer_id`
   - `provider_subscription_id`
   - `provider_price_id`
   - `status`
   - `current_period_start`
   - `current_period_end`
8. Confirm the Stripe billing portal opens from the app.
9. Confirm a portal-side change updates the workspace state after webhook delivery.
10. Repeat the same flow for Pro.

Helpful SQL checks:

```sql
select id, plan_code, updated_at
from businesses
where id = '<business-id>';
```

```sql
select
  provider_subscription_id,
  provider_customer_id,
  provider_price_id,
  status,
  current_period_start,
  current_period_end,
  cancel_at_period_end
from subscriptions
where business_id = '<business-id>'
order by created_at desc;
```

## Production Cutover

Only after test mode is verified:

1. Create the same products and prices in Stripe live mode.
2. Replace `STRIPE_SECRET_KEY` with the live secret key.
3. Replace `STRIPE_STARTER_PRICE_ID` and `STRIPE_PRO_PRICE_ID` with live price ids.
4. Point the Stripe live webhook endpoint to the production API URL.
5. Replace `STRIPE_WEBHOOK_SECRET` with the live webhook signing secret.
6. Confirm the Stripe customer portal is enabled in live mode.
7. Run one live checkout with a real payment method.
8. Confirm the app, database, and Stripe portal all reflect the live subscription correctly.

## Safety Rules

- Never expose `STRIPE_SECRET_KEY` to the frontend.
- Never expose `STRIPE_WEBHOOK_SECRET` to the frontend.
- Never trust frontend plan state as final billing truth.
- Always let Stripe webhooks update the backend state.
- Keep test and live keys, webhook secrets, and price ids completely separate.

## Source Files

Current implementation lives in:

- `apps/founder-content-api/src/services/billing/billingService.ts`
- `apps/founder-content-api/src/services/billing/stripe.ts`
- `apps/founder-content-api/src/controllers/billingController.ts`
- `apps/founder-content-api/src/routes/billing.ts`
- `apps/founder-content-ai/pages/app-billing.vue`
- `apps/founder-content-ai/services/billing-service.ts`
