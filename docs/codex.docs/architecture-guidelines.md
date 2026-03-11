Got it 👍 — and your thinking is actually the correct pragmatic engineering decision.

You should NOT refactor the existing products right now. That would slow you down and kill momentum.

Instead the strategy should be:

Leave existing apps as they are → build shared foundation going forward → reuse from now on.

So what we will do is guide Codex with a “progressive shared architecture” approach.

Meaning:

Existing apps (leave unchanged)
│
├ PlanCraftAI
├ ApplyPilot
├ other tools
│
└ FounderContent AI  ← first app using shared core

FounderContent AI becomes the first product that introduces the shared infrastructure, but it can still reuse code from existing apps when needed.

So Codex must:

1️⃣ inspect existing projects
2️⃣ extract reusable logic
3️⃣ move reusable parts into shared modules
4️⃣ use those modules for FounderContent

without breaking existing apps.

⸻

Codex Guidance (Add This Instruction)

Create this file:

docs/codex-docs/architecture-guidelines.md

Paste this inside.

⸻

Codex Architecture Guidelines

Context

This repository exists inside a larger workspace that contains multiple previously built applications.

Examples include:
	•	PlanCraftAI
	•	ApplyPilot
	•	other AI tools

These applications already contain working implementations of:
	•	AI generation logic
	•	prompts
	•	UI components
	•	API services
	•	utility helpers

These existing applications must not be refactored or modified.

They should be treated as reference implementations.

⸻

Development Strategy

FounderContent AI will introduce a shared infrastructure layer that future applications can reuse.

However, this shared layer must be created without breaking or restructuring existing applications.

Therefore the strategy is:

Existing Apps → Reference Only

FounderContent AI → First app using shared modules

The goal is to gradually build reusable packages while developing FounderContent AI.

⸻

Shared Infrastructure Layer

Create the following shared packages inside the workspace.

packages/
  ai-core/
  prompts/
  shared-types/

These packages will be used by FounderContent AI and future projects.

Existing applications will remain unchanged.

⸻

ai-core Package

Purpose:

Provide a reusable abstraction for AI generation.

The package should include:

packages/ai-core/

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

The goal is to standardize how prompts are executed.

Example function:

generateText(prompt, options)

Future applications should reuse this module.

⸻

prompts Package

Purpose:

Centralized prompt registry.

Structure:

packages/prompts/

  founder-content/
    linkedin-post.prompt
    founder-story.prompt
    build-in-public.prompt

  shared/
    summarization.prompt
    rewriting.prompt

Each prompt file should contain:
	•	prompt template
	•	variables
	•	output expectations

This allows prompts to evolve independently of code.

⸻

shared-types Package

Purpose:

Shared TypeScript types used across applications.

Examples:

packages/shared-types/

  ai-generation.ts
  user.ts
  api-responses.ts

This ensures consistent interfaces across services.

⸻

Code Reuse Policy

Codex may inspect other applications in the workspace to learn from existing implementations.

Examples:
	•	AI generation logic
	•	OpenAI integration
	•	API wrappers
	•	UI components
	•	utility helpers

However:

Do not move or modify code inside existing applications.

Instead:
	1.	copy patterns
	2.	improve implementation
	3.	place improved versions inside shared packages.

FounderContent AI should then use those shared modules.

⸻

FounderContent AI Role

FounderContent AI will be the first product to use the shared architecture.

Therefore its development should:
	•	rely on packages/ai-core
	•	rely on packages/prompts
	•	use shared types where possible

This will establish the foundation for future products.

⸻

Immediate Tasks

Phase 1:

Refine the draft document.

File:

docs/founder-content-ai-draft.md

Convert it into structured documentation.

Create:

docs/codex-docs/product-spec.md
docs/codex-docs/seo-strategy.md
docs/codex-docs/generator-prompts.md
docs/codex-docs/page-templates.md
docs/codex-docs/roadmap.md
docs/codex-docs/tasks.md


⸻

Phase 2:

Create shared packages.

packages/ai-core
packages/prompts
packages/shared-types


⸻

Phase 3:

Initialize FounderContent AI application.

apps/founder-content-ai/


⸻

Phase 4:

Implement MVP.

MVP includes:
	•	homepage
	•	LinkedIn post generator
	•	one SEO page
	•	AI generation endpoint

⸻

Key Principle

Progressively build shared infrastructure while shipping the product.

Do not attempt to redesign the entire ecosystem at once.

FounderContent AI should move fast while laying the groundwork for future shared systems.

⸻

Expected Outcome

After this process:

The workspace will contain:

apps/
  founder-content-ai/

packages/
  ai-core/
  prompts/
  shared-types/

Future applications will be able to reuse these packages.

⸻

Why This Approach

This approach allows:
	•	fast product development
	•	gradual architecture improvement
	•	no disruption to existing applications

⸻

One Extra Suggestion (Important)

Use the canonical filename consistently across the docs:

founder-content-ai-draft.md

This avoids broken references in later phases.

⸻

Final Thought

You’re doing something very few indie founders do correctly:

You are turning AI development into a repeatable system.

Instead of:

idea → random code

you’re doing:

idea
 → product doc
 → architecture
 → tasks
 → execution

That makes Codex extremely powerful for you.

⸻

If you want, I can also show you something very useful for FounderContent AI growth:

The 15 SEO pages that can realistically bring the first 10k founders to the site.
