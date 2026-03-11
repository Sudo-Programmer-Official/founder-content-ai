# FounderContent AI – Codex Execution Plan

This repository contains the early planning documents for FounderContent AI.

The documentation inside `/docs` is not fully structured. It contains drafts,
ideas, feature descriptions, and architecture notes.

Your role is to convert these drafts into a structured product foundation
before development begins.

Do NOT start coding immediately.

Follow the phases below.

---

# Phase 1 – Understand the Product

Read the following documents carefully:

docs/founder-content-ai-draft.md
docs/codex.docs/feature-priority.md
docs/codex.docs/posting-idea.md
docs/codex.docs/SEO-plan.md
docs/codex.docs/architecture-guidelines.md

These documents collectively describe the product vision.

FounderContent AI is positioned as:

Founder Personal Branding OS

The platform helps startup founders:

- generate content ideas
- create LinkedIn posts
- generate hooks
- build personal brand content

The core workflow is:

Idea → Hook → Post

---

# Phase 2 – Clean and Organize Documentation

Create the following structured documentation.

docs/product-spec.md
docs/architecture.md
docs/seo-strategy.md
docs/feature-spec.md
docs/roadmap.md
docs/task-priority.md

These files should consolidate information from all draft documents.

---

## product-spec.md

Describe:

- product vision
- target users
- problem statement
- product workflow
- feature modules

---

## architecture.md

Define system architecture.

Expected stack:

Frontend
- Vue
- Tailwind

Backend
- Node
- Express

AI
- OpenAI API

Shared packages

packages/
  ai-core
  prompts
  shared-types

Explain how FounderContent AI will interact with these modules.

---

## seo-strategy.md

Define traffic strategy.

Focus on pages like:

/linkedin-post-ideas-for-founders
/build-in-public-post-ideas
/founder-storytelling-examples

These pages should contain:

- examples
- templates
- CTA to generator

---

## feature-spec.md

Define the MVP features.

Feature 1
LinkedIn Post Generator

Feature 2
Hook Generator

Feature 3
Founder Content Idea Generator

Each feature should include:

- page route
- input fields
- output format
- AI prompt strategy

---

## roadmap.md

Create phased roadmap.

Phase 1
MVP

Phase 2
SEO engine

Phase 3
Content library

Phase 4
Founder analytics

---

## task-priority.md

Convert roadmap into actionable tasks.

Example:

Task 1
Create project structure

Task 2
Build homepage

Task 3
Build LinkedIn generator

Task 4
Build hook generator

Task 5
Build idea generator

Task 6
Create SEO landing pages

---

# Phase 3 – Prepare Project Structure

Create the following directories if missing.

apps/founder-content-ai
packages/ai-core
packages/prompts
packages/shared-types

Only scaffold them.

Do not implement full systems yet.

---

# Phase 4 – Prepare AI Prompt Library

Create prompt files inside:

packages/prompts/founder-content/

Example prompts:

linkedin-post.prompt
hook-generator.prompt
idea-generator.prompt

Each prompt should define:

- system instruction
- variables
- expected output format

---

# Phase 5 – MVP Development Preparation

Before coding, prepare the following:

apps/founder-content-ai/pages

Pages required for MVP:

/linkedin-post-generator
/linkedin-hook-generator
/founder-content-ideas
/linkedin-post-ideas-for-founders

Define UI structure but do not fully implement backend logic yet.

---

# Codex Rules

1. Documentation first
2. Clean architecture before coding
3. Build smallest possible MVP
4. Avoid unnecessary complexity

The goal is to ship a working MVP quickly.

---

# Immediate Objective

Your first objective is:

Organize documentation and prepare project structure.

Only after documentation is structured should development begin.