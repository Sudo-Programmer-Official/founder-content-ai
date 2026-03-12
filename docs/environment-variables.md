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

## Backend

Backend app:

- `apps/founder-content-api`

### `OPENAI_API_KEY`

Purpose:

- authenticates requests to OpenAI

Example:

- set in Render environment settings only

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
