# FounderContent AI Task Priority

## Planning Rule

Tasks are ordered to support the roadmap while protecting MVP scope.

The first shipping workflow remains:

**Idea -> Hook -> Post**

## P0: Product Foundation

### Task 1: Finalize canonical documentation

Deliverable:

- approved versions of `product-spec.md`, `architecture.md`, `seo-strategy.md`, `feature-spec.md`, `roadmap.md`, and `task-priority.md`

Purpose:

- ensure later implementation uses one source of truth

### Task 2: Scaffold the monorepo structure

Deliverable:

- `apps/founder-content-ai`
- `apps/founder-content-api`
- `packages/ai-core`
- `packages/prompts`
- `packages/shared-types`

Purpose:

- prepare the repository for implementation without building full systems yet

### Task 3: Define shared types for MVP generation flows

Deliverable:

- request and response types for ideas, hooks, and LinkedIn posts

Purpose:

- lock frontend and backend contracts before UI work begins

### Task 4: Create the MVP prompt library

Deliverable:

- `idea-generator.prompt`
- `hook-generator.prompt`
- `linkedin-post.prompt`

Purpose:

- centralize prompt definitions before wiring the app

## P1: Core Application Setup

### Task 5: Initialize the FounderContent AI frontend structure

Deliverable:

- `pages/`, `components/`, `services/`, `styles/`, and `utils/` inside `apps/founder-content-ai`

Purpose:

- create the frontend application boundary for MVP work

### Task 6: Initialize the FounderContent API structure

Deliverable:

- `src/routes/`, `src/controllers/`, `src/services/`, `src/middleware/`, and `src/utils/` inside `apps/founder-content-api`

Purpose:

- create the backend application boundary for MVP work

### Task 7: Set up the Express API skeleton

Deliverable:

- route handlers for `POST /api/generate-ideas`
- route handlers for `POST /api/generate-hook`
- route handlers for `POST /api/generate-post`

Purpose:

- define the backend contract early

### Task 8: Implement the shared AI execution layer

Deliverable:

- OpenAI provider wrapper
- text or structured generation runners
- basic error handling

Purpose:

- avoid hardcoding AI calls directly in backend route code

### Task 9: Build the homepage

Deliverable:

- founder-focused homepage with clear CTA into the three MVP features

Purpose:

- give users an understandable entry point into the workflow

## P2: MVP Feature Delivery

### Task 10: Build `/founder-content-ideas`

Deliverable:

- UI for industry and stage inputs
- rendered idea results
- CTA into post generation

Purpose:

- establish the first step in the core workflow

### Task 11: Build `/linkedin-hook-generator`

Deliverable:

- UI for topic input
- rendered hook cards
- CTA into full post generation

Purpose:

- establish the hook step in the workflow

### Task 12: Build `/linkedin-post-generator`

Deliverable:

- UI for topic, tone, and length
- three labeled LinkedIn post variations
- copy-ready rendering

Purpose:

- deliver the highest-value output in the product

### Task 13: Connect all three pages into one workflow

Deliverable:

- navigation and parameter passing from ideas to hooks to posts

Purpose:

- make the MVP feel like one system instead of three isolated tools

### Task 14: Add loading, error, and empty states

Deliverable:

- reliable UX for failed requests, slow generations, and missing inputs

Purpose:

- make the product usable in real conditions

## P3: SEO Engine

### Task 15: Build a reusable SEO landing page template

Deliverable:

- consistent layout for examples, templates, CTA blocks, and internal links

Purpose:

- support the first SEO pages without duplicating layout work

### Task 16: Create `/linkedin-post-ideas-for-founders`

Deliverable:

- founder-specific page with examples, templates, and generator CTA

Purpose:

- launch the highest-intent SEO page first

### Task 17: Create `/build-in-public-post-ideas`

Deliverable:

- build-in-public page with milestone and update examples

Purpose:

- capture indie hacker and founder search demand

### Task 18: Create `/founder-storytelling-examples`

Deliverable:

- story-driven page with founder narrative examples and CTA into post generation

Purpose:

- capture storytelling search intent

### Task 19: Add metadata and internal linking across SEO pages and tools

Deliverable:

- page titles
- descriptions
- generator links
- cross-links between SEO pages

Purpose:

- improve discovery and conversion

## P4: Content Library

### Task 20: Define the content library data model

Deliverable:

- structure for examples, templates, and categorized founder post patterns

Purpose:

- prepare reusable content assets for Phase 3

### Task 21: Build the first template library experience

Deliverable:

- browsable founder templates linked back into the generators

Purpose:

- make successful patterns reusable

## P5: Analytics

### Task 22: Define analytics events and content feedback signals

Deliverable:

- event schema for generator starts, completions, and CTA flows

Purpose:

- create the foundation for future product learning

### Task 23: Design the LinkedIn post analyzer specification

Deliverable:

- input/output contract for a future post analysis feature

Purpose:

- prepare the first analytics-oriented product extension without pulling it into MVP scope

## Shipping Priority Summary

If implementation starts immediately after this documentation phase, the first build order should be:

1. scaffold repository structure
2. create shared types and prompt files
3. initialize separate frontend and backend apps
4. wire the backend API skeleton
5. build the three MVP generators
6. connect the workflow
7. launch the three SEO pages

Everything else should wait until that path is working end to end.
