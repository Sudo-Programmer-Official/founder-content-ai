# FounderContent API

FounderContent API is the backend service for FounderContent AI.

## Purpose

This app owns:

- Express server setup
- generation routes
- controllers
- prompt loading
- AI orchestration through shared packages

It should not contain frontend UI code.

## MVP Endpoints

- `POST /api/generate-ideas`
- `POST /api/generate-hook`
- `POST /api/generate-post`

## Structure

```text
apps/founder-content-api/
  src/
    routes/
    controllers/
    services/
    middleware/
    utils/
  server.ts
```

## Source Docs

Use the canonical docs in `../../docs/` as the source of truth:

- `../../docs/architecture.md`
- `../../docs/feature-spec.md`
- `../../docs/task-priority.md`
