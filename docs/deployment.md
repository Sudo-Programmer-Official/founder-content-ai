# Deployment Guide

## Deployment Model

FounderContent AI uses automatic deployment through GitHub integration.

Frontend:

- Platform: Vercel
- Domain: `https://foundercontent.ai`

Backend:

- Platform: Render
- Domain: `https://api.foundercontent.ai`
- Fallback domain: `https://founder-content-api.onrender.com`

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

Fallback behavior:

- if the primary API domain is unavailable, the frontend falls back to `https://founder-content-api.onrender.com/api`

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

Recommended production values:

- `OPENAI_MODEL=gpt-4o-mini`
- `FRONTEND_ORIGIN=https://foundercontent.ai,https://www.foundercontent.ai,https://founder-content-ai.vercel.app`

Notes:

- Render usually injects `PORT` automatically.
- `FRONTEND_ORIGIN` may be provided as a comma-separated list.
- the backend also allows the main Vercel project domain and Vercel preview URLs for browser-based testing and preview deploys

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
