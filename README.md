# FounderContent AI

FounderContent AI is a founder-led content product for turning startup experiences, lessons, and business insights into LinkedIn-ready content.

The current MVP scope is:

**Idea -> Hook -> Post**

## MVP Features

- `/founder-content-ideas`
- `/linkedin-hook-generator`
- `/linkedin-post-generator`

Early SEO entry page:

- `/linkedin-post-ideas-for-founders`

## Repository Structure

```text
apps/
  founder-content-ai/    # Vue frontend
  founder-content-api/   # Express backend

packages/
  ai-core/               # Shared OpenAI wrapper and AI utilities
  prompts/               # Prompt templates
  shared-types/          # Shared request/response contracts

docs/                    # Canonical product and architecture docs
```

## Source of Truth

Use these docs when making product or architecture decisions:

- `docs/product-spec.md`
- `docs/architecture.md`
- `docs/seo-strategy.md`
- `docs/feature-spec.md`
- `docs/roadmap.md`
- `docs/task-priority.md`

## Current Status

- Phase 1 complete: product understanding
- Phase 2 complete: structured documentation
- Phase 3 complete: monorepo and package scaffolding
- Phase 4 complete: minimal synchronous AI generation pipeline

## Positioning

FounderContent AI is positioned founder-first, but the product can also be used by:

- operators
- marketers
- consultants
- agencies
- small business owners

## Local Development Notes

Backend app:

- `apps/founder-content-api`
- requires `OPENAI_API_KEY`
- optional: `OPENAI_MODEL`, `PORT`, `FRONTEND_ORIGIN`

Frontend app:

- `apps/founder-content-ai`
- calls the backend API for the three MVP generation flows

## Scope Guardrails

Not in MVP:

- scheduling
- analytics dashboards
- multi-channel publishing
- team workflows
- background workers

Those remain future roadmap items.
