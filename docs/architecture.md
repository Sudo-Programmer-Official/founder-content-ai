# FounderContent AI Architecture

## Architecture Goal

FounderContent AI uses a monorepo structure with separate runnable apps for the frontend and backend, plus shared packages for reusable logic.

The guiding rule is:

- `apps/` contains runnable applications and services
- `packages/` contains reusable libraries
- `docs/` contains product and architecture documentation

This keeps UI, API, and shared AI logic separated while still allowing one repository and one CI/CD flow.

## Technology Stack

### Frontend

- Vue
- Vite
- Tailwind CSS-compatible styling approach
- deployed on Vercel

### Backend

- Node.js
- Express
- deployed on Render

### AI

- OpenAI API

### Shared Packages

- `packages/ai-core`
- `packages/prompts`
- `packages/shared-types`

## Repository Structure

```text
apps/
  founder-content-ai/
    pages/
    components/
    services/
    styles/
    utils/
  founder-content-api/
    src/
      routes/
      controllers/
      services/
      middleware/
      utils/
    server.ts

packages/
  ai-core/
  prompts/
  shared-types/

docs/
infra/
```

## Production Deployment Architecture

Production request flow:

User  
-> Vercel frontend (`https://foundercontent.ai`)  
-> Render backend (`https://api.foundercontent.ai`)  
-> OpenAI API

Fallback backend:

- `https://founder-content-api.onrender.com`

## Production Diagram

```text
User Browser
    |
    v
Vercel Frontend
foundercontent.ai
    |
    v
Render API
api.foundercontent.ai
    |
    v
OpenAI API
```

## App Responsibilities

### `apps/founder-content-ai`

This app is the frontend only.

Responsibilities:

- render the homepage, generator pages, and SEO pages
- capture user inputs
- display generated outputs
- call backend API endpoints
- handle loading, validation, and copy interactions

This app should not contain:

- prompt definitions
- OpenAI provider calls
- AI orchestration logic
- backend route logic

### `apps/founder-content-api`

This app is the backend only.

Responsibilities:

- expose generation endpoints
- validate requests
- load prompt templates
- call shared AI execution utilities
- shape responses into predictable payloads
- hold middleware and backend utilities

This app should not contain frontend rendering or UI concerns.

## Runtime Request Flow

High-level request flow:

1. A user interacts with a Vue page in `apps/founder-content-ai`.
2. The frontend calls the backend API using `VITE_API_URL`.
3. If the primary API domain is unavailable, the frontend falls back to the Render URL.
4. The API validates the request using shared contracts from `packages/shared-types`.
5. The API loads the correct prompt from `packages/prompts`.
6. The API calls `packages/ai-core` to execute the OpenAI request.
7. The API returns a structured response.
8. The frontend renders the response in a copy-ready format.

## Backend Structure

```text
apps/founder-content-api/
  src/
    routes/
      generateIdeas.ts
      generateHook.ts
      generatePost.ts
    controllers/
      ideaController.ts
      hookController.ts
      postController.ts
    services/
      aiService.ts
      promptLoader.ts
    middleware/
      auth.ts
      rateLimit.ts
    utils/
      logger.ts
  server.ts
```

## MVP API Endpoints

Recommended initial endpoints:

- `POST /api/generate-ideas`
- `POST /api/generate-hook`
- `POST /api/generate-post`
- `GET /api/health`

These endpoints map directly to the MVP workflow:

- ideas
- hooks
- posts
- health monitoring

## Shared Packages

### `packages/ai-core`

Purpose:

- reusable abstraction over AI generation

Recommended structure:

```text
packages/ai-core/
  src/
    generateCompletion.ts
    providers/
      openai.ts
    runners/
      text-generation.ts
      structured-generation.ts
    tracking/
      token-usage.ts
      generation-logs.ts
    limits/
      usage-limits.ts
```

Responsibilities:

- initialize provider clients
- execute completions
- standardize retries and error handling over time
- capture usage metadata when needed later

### `packages/prompts`

Purpose:

- centralized prompt registry

Recommended structure:

```text
packages/prompts/
  founder-content/
    linkedin-post.prompt
    hook-generator.prompt
    idea-generator.prompt
```

Each prompt file defines:

- system instruction
- input variables
- output format
- generation constraints

### `packages/shared-types`

Purpose:

- shared contracts between frontend, backend, and shared libraries

Suggested files:

```text
packages/shared-types/
  src/
    ai-generation.ts
    founder-content.ts
    api-responses.ts
```

Useful shared types include:

- idea generation request/response
- hook generation request/response
- LinkedIn post generation request/response
- common API success/error envelopes

## CORS and Environment Alignment

The backend must allow these frontend origins:

- `http://localhost:5173`
- `https://foundercontent.ai`
- `https://www.foundercontent.ai`

Additional origins can be added through environment configuration if needed.

## CI/CD Model

Deployment is automatic through GitHub integration.

Frontend:

- Git push -> Vercel auto deploy

Backend:

- Git push -> Render auto deploy

No manual deployment step is required for standard changes.

## Non-Goals for Current Infrastructure Phase

Do not add in this phase:

- background workers
- scheduled jobs
- analytics pipelines
- multi-region deployment
- infrastructure orchestration complexity

The current goal is production alignment for the existing MVP architecture.
