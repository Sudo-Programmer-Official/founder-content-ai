# Phase 1 Product Understanding

## Product Definition

FounderContent AI should be positioned as a **Founder Personal Branding OS**.

The long-term category is larger than a text generator:

- idea generation
- hook generation
- post generation
- distribution
- analytics
- iteration

For the MVP, the product should feel much narrower:

**Idea -> Hook -> Post**

That is the shortest path to value for startup founders posting on LinkedIn.

## Primary Users

Best early users:

- startup founders
- SaaS founders
- indie hackers
- founders building in public

Later expansion can include consultants, coaches, and local businesses, but the current docs consistently favor founders first.

## Core User Problem

The stable problem statement across the docs is:

Founders know they should post, but they do not know:

- what to post
- how to open strongly
- how to turn experience into publishable content

FounderContent AI should turn founder experiences, lessons, and milestones into structured LinkedIn-ready content.

## MVP Workflow

Recommended MVP flow:

1. Founder generates content ideas.
2. Founder generates hooks from a chosen idea.
3. Founder generates full LinkedIn posts.
4. Founder copies and publishes manually.

Human review stays in the loop. The docs repeatedly warn against fully automated posting in the first version.

## MVP Features

### 1. LinkedIn Post Generator

Route:

`/linkedin-post-generator`

Inputs:

- topic
- tone
- length

Outputs:

- 3 variations
- story version
- lesson version
- build-in-public version

### 2. LinkedIn Hook Generator

Route:

`/linkedin-hook-generator`

Input:

- topic

Output:

- 5 hook options

### 3. Founder Content Idea Generator

Route:

`/founder-content-ideas`

Inputs:

- industry
- stage

Output:

- a list of founder-relevant content ideas
- each idea should be able to feed the post generator

## Near-Term Add-On

Some docs push for a **LinkedIn Post Analyzer** very early because it could increase repeat usage and sharing.

Current Phase 1 interpretation:

- keep analyzer as the strongest post-MVP or Phase 1.5 candidate
- do not let it displace the core Idea -> Hook -> Post flow

## Positioning

The strongest messaging from the drafts:

- Turn your founder journey into content.
- The personal branding OS for startup founders.

The product should not be framed as a generic AI writer.

## SEO Entry Points

The clearest high-intent SEO pages are:

- `/linkedin-post-ideas-for-founders`
- `/build-in-public-post-ideas`
- `/founder-storytelling-examples`

Each page should include:

- examples
- templates
- CTA into the generator

## Architecture Direction

The long-term technical direction is stable across the docs:

- frontend: Vue + Tailwind
- backend: Node + Express
- AI: OpenAI API
- shared packages:
  - `packages/ai-core`
  - `packages/prompts`
  - `packages/shared-types`

Existing apps in the wider workspace should be treated as references only. Shared modules should be built progressively without refactoring older products.

## Scope Guardrails

Avoid in the first MVP:

- scheduling
- analytics dashboards
- team features
- multi-channel publishing
- complex automation

Some older draft sections describe a broader marketing OS with workspaces, schedulers, and analytics. Those ideas remain part of the long-term vision, but the current feature-priority docs clearly narrow the first product to a founder-facing LinkedIn MVP.

## Phase 1 Resolution

Phase 1 should be treated as complete when later documentation reflects this split clearly:

- **Vision:** Founder Personal Branding OS
- **MVP:** Idea -> Hook -> Post for founders on LinkedIn
