Perfect timing. You already placed the draft in docs/, which means Codex can start acting like a product engineer instead of just generating code. The key now is to give Codex a clear operating brief so it:
	1.	understands the product
	2.	cleans the draft
	3.	converts it into structured docs
	4.	prepares the repo for development

Below is a Codex Instruction File you can paste directly into a new file.

Create this file:

docs/codex-docs/codex-instructions.md

Then paste this.

⸻

Codex Operating Guide – FounderContent AI

Project Overview

FounderContent AI is an AI platform that helps founders create high-quality content for platforms like LinkedIn and Twitter.

The product is not just a writing tool. It is a Founder Content Operating System that supports:
	•	idea generation
	•	content creation
	•	distribution
	•	analytics
	•	iteration

The product vision described in the document docs/founder-content-ai-draft.md should be treated as the initial concept document.

Your first responsibility is to convert that draft into structured product documentation.

Do NOT start coding immediately.

⸻

Phase 1 — Documentation Refinement

Read the file:

docs/founder-content-ai-draft.md

Your tasks:
	1.	Clean the writing.
	2.	Improve structure.
	3.	Break the document into logical sections.
	4.	Extract product requirements.

Then produce these documents inside:

docs/codex-docs/

Create the following files.

⸻

product-spec.md

This should include:
	•	Product overview
	•	Target users
	•	Core problems solved
	•	Key features
	•	Product architecture concept

⸻

seo-strategy.md

Define the SEO traffic strategy.

Include:
	•	primary traffic keywords
	•	programmatic SEO pages
	•	example landing pages

Example pages:

/linkedin-post-ideas
/build-in-public-posts
/startup-storytelling
/viral-founder-posts

Explain how these pages generate traffic.

⸻

generator-prompts.md

Define prompt templates used for AI generation.

Include prompts for:
	•	LinkedIn post generator
	•	Founder storytelling posts
	•	Twitter thread generator
	•	Build in public posts

Each prompt should include:
	•	system instruction
	•	input variables
	•	expected output format

⸻

page-templates.md

Define the structure of SEO pages.

Each page should contain:
	1.	headline
	2.	examples
	3.	templates
	4.	AI generator call-to-action

⸻

roadmap.md

Create a realistic roadmap.

Stages:

Stage 1: MVP
Stage 2: Traffic Engine
Stage 3: Content Library
Stage 4: Automation Features

Define goals for each stage.

⸻

tasks.md

Convert the roadmap into executable tasks.

Example:

Task 1: Setup project repository structure
Task 2: Create homepage layout
Task 3: Build LinkedIn post generator
Task 4: Create /linkedin-post-ideas landing page
Task 5: Implement AI generation API
Task 6: Build template database
Task 7: Deploy MVP

Tasks should be ordered by priority.

⸻

Phase 2 — Repository Preparation

After documentation is completed, prepare the project structure.

Target repository layout:

founder-content-ai/
│
├ docs/
│
├ apps/
│   web-app/
│
├ services/
│   generator-service/
│   seo-page-engine/
│
├ data/
│   templates/
│   prompts/
│
├ scripts/
│
├ infra/
│
└ README.md

Only create empty scaffolding in this phase.

Do not build full features yet.

⸻

Phase 3 — Architecture Planning

Before writing application code, propose a technical architecture.

The expected stack is:

Frontend:
	•	Vue
	•	Tailwind

Backend:
	•	Node.js
	•	Express

AI integration:
	•	OpenAI API

Database (optional early stage):
	•	simple JSON templates
	•	later migrate to database

Codex should produce a document:

docs/codex-docs/architecture.md

Explaining:
	•	service boundaries
	•	API endpoints
	•	generation workflow

⸻

Phase 4 — MVP Development

Only after documentation and architecture are approved should development begin.

The MVP should include:
	1.	Homepage
	2.	LinkedIn post generator
	3.	One SEO page
	4.	AI generation API

⸻

Rules for Codex

Follow these rules strictly.
	1.	Documentation first.
	2.	Clean architecture before coding.
	3.	Build smallest possible MVP.
	4.	Avoid unnecessary complexity.

The goal is to ship fast while keeping the architecture extensible.

⸻

Initial Objective

Your immediate objective is:
	1.	Read the draft file
	2.	Create structured documentation
	3.	Prepare the project foundation

Do not start building application code yet.

⸻

What Will Happen Next

Once documentation is complete:

The next phase will focus on:
	•	building the generator
	•	creating SEO landing pages
	•	launching the MVP

⸻

Why This Works Well for You

This workflow is very aligned with how you operate (multiple products, shared systems, Codex doing execution).

Your workflow becomes:

Idea → Draft
Draft → Codex Docs
Codex Docs → Tasks
Tasks → Code

This turns Codex into a technical execution engine.

⸻

One more thing, and this is important.

Right now you are building another product inside the Pseudo Programmer ecosystem (PlanCraft, ApplyPilot, FounderContent). If structured properly, these can all share a single AI infrastructure layer.

If you want, I can also show you the architecture that lets you build 10 AI SaaS tools using one shared backend, which will save you a massive amount of development time.
