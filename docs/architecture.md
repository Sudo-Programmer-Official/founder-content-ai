# FounderContent AI Architecture

## Architecture Goal

FounderContent AI should use a monorepo structure with separate runnable apps for the frontend and backend, plus shared packages for reusable logic.

The guiding rule is:

- `apps/` contains runnable applications and services
- `packages/` contains reusable libraries
- `docs/` contains product and architecture documentation

This keeps the product clean as it grows and avoids mixing UI concerns with API and AI orchestration.

## Technology Stack

### Frontend

- Vue
- Tailwind CSS

### Backend

- Node.js
- Express

### AI

- OpenAI API

### Shared Packages

- `packages/ai-core`
- `packages/prompts`
- `packages/shared-types`

## Recommended Repository Structure

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

## App Responsibilities

### `apps/founder-content-ai`

This app is the frontend only.

Responsibilities:

- render the homepage, generator pages, and SEO pages
- capture user inputs
- display outputs
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

## System Overview

High-level request flow:

1. A user interacts with a Vue page in `apps/founder-content-ai`.
2. The frontend sends a request to `apps/founder-content-api`.
3. The API validates the request using shared contracts from `packages/shared-types`.
4. The API loads the correct prompt from `packages/prompts`.
5. The API calls `packages/ai-core` to execute the OpenAI request.
6. The API returns a structured response.
7. The frontend renders the response in a copy-ready format.

## Backend Structure

Recommended API app structure:

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

These endpoints map directly to the MVP workflow:

- ideas
- hooks
- posts

## Shared Packages

### `packages/ai-core`

Purpose:

- reusable abstraction over AI generation

Recommended structure:

```text
packages/ai-core/
  src/
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
- execute text or structured generations
- standardize retries and error handling
- capture usage metadata

Recommended core interfaces:

- `generateText(prompt, options)`
- `generateStructured(prompt, schema, options)`

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

Each prompt file should define:

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

## MVP Feature Flows

### Founder Content Ideas

1. Frontend collects `industry` and `stage`.
2. Frontend calls `POST /api/generate-ideas`.
3. Backend loads the idea prompt.
4. Backend calls `ai-core`.
5. Backend returns a list of founder-specific ideas.

### LinkedIn Hooks

1. Frontend collects `topic`.
2. Frontend calls `POST /api/generate-hook`.
3. Backend loads the hook prompt.
4. Backend calls `ai-core`.
5. Backend returns hook options.

### LinkedIn Posts

1. Frontend collects `topic`, `tone`, and `length`.
2. Frontend optionally passes a selected hook.
3. Frontend calls `POST /api/generate-post`.
4. Backend loads the LinkedIn post prompt.
5. Backend calls `ai-core`.
6. Backend returns three post variations:
   - story
   - lesson
   - build-in-public

## Response Design

The backend should return structured payloads instead of raw text blobs whenever possible.

Recommended output shapes:

- ideas: array of idea objects
- hooks: array of hook strings
- posts: array of post variation objects with `angle` and `content`

This makes UI rendering more stable and keeps later analytics work easier.

## State and Persistence Strategy

The MVP can start mostly stateless.

Required at launch:

- frontend form state
- backend request handling
- prompt loading
- optional lightweight generation logging

Not required at launch:

- saved drafts
- user accounts
- content calendar storage
- social integration tokens

## Non-Goals for MVP Architecture

Do not build these into the first implementation slice:

- scheduling workers
- social publishing integrations
- analytics pipelines
- team permissions
- multi-workspace data models
- multi-platform content orchestration

These capabilities belong to future roadmap phases, not the MVP foundation.
