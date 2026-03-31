# New Requirement Execution Plan

## Goal
Turn the current execution system into a compounding intelligence system without breaking the core workflow:

`Idea -> Post -> Publish/Email -> Growth -> Feedback -> Better next idea`

## Current Base
These pieces already exist and should be treated as foundations, not rebuilt:

- Idea Inbox and async understanding
- Content generation, POV layer, and repurpose loop
- Planner and safe posting orchestration
- Email campaigns and growth automation
- Post assets and lightweight media attachment
- Worker/jobs system
- Workspace retention and post performance signals

## Guiding Rules
- Keep execution stable while adding intelligence.
- Prefer shared services over page-specific logic.
- Reuse current content, post, email, and growth models before adding net-new entities.
- Ship text and asset infrastructure before ambitious media generation.
- Keep config flexible, but keep safety and core orchestration in code.

## Workstreams
The draft requirements collapse into four build tracks:

1. Knowledge Engine
2. Asset Hub + Media Intelligence
3. Feedback + Suggestion Engine
4. Config/Admin Control Layer

## Recommended Phase Order

### Phase 0: Stabilize The Current Loop
Ship first only if these are true:

- Idea Inbox -> draft -> planner -> publish works reliably
- Email source-driven flow is stable
- Growth lead capture and attribution work
- Worker health and scheduled-post visibility are in place

Acceptance:
- No content loss
- No duplicate scheduled jobs
- No broken cross-page routing

### Phase 1: Workspace Knowledge Engine
Purpose:
- Make generation brand-aware and workspace-aware

Build:
- `workspace_knowledge_sources` table
- `workspace_knowledge_profiles` table
- source types:
  - website
  - note
  - document
  - past content reference
- async extraction job:
  - tone
  - audience
  - positioning
  - core beliefs
  - topics
- Settings -> Knowledge page
- prompt injection for posts and emails using derived profile

Use current foundations:
- brand profile / competitor memory
- idea understanding pipeline
- shared worker

Acceptance:
- workspace can add sources
- system derives editable brand profile
- post and email generation use that profile by default

### Phase 2: Asset Hub Foundation
Purpose:
- create one source of truth for media, docs, and brand assets

Build:
- `workspace_assets` table
- `workspace_asset_usages` table
- asset types:
  - media
  - document
  - brand
- asset metadata:
  - tags
  - context
  - source
  - mime type
  - usage count
- Asset Hub page
- Asset Picker modal used by:
  - post editor
  - planner
  - email editor
- centralize uploads so new media lands in Asset Hub automatically

Reuse current foundations:
- post assets
- email media support
- storage/upload pipeline

Acceptance:
- one uploaded file is reusable everywhere
- users can select existing assets instead of re-uploading
- usage count is visible

### Phase 3: Media Intelligence Layer
Purpose:
- make media suggestions contextual, safe, and reusable

Build:
- preset registry for business types:
  - SaaS
  - Daycare
  - Fitness
- shared media recommendation service
- first supported media outputs:
  - quote_card
  - stat_card
  - photo_overlay
  - framework_card
  - screenshot_highlight
- asset auto-tagging by filename + lightweight content cues
- recommendation slots in:
  - result page
  - planner modal
  - email editor

Do not build yet:
- full video studio
- realistic AI people
- scraping external copyrighted images
- long-form editing

Acceptance:
- system recommends existing assets first
- if no asset exists, system can suggest a safe preset
- output stays domain-aware and brand-consistent

### Phase 4: Feedback + Suggestion Engine
Purpose:
- feed performance back into future creation

Build:
- normalize post performance + email performance into one insight layer
- `workspace_topic_insights` table
- `workspace_content_patterns` table
- rollups for:
  - topic weight
  - angle preference
  - format preference
  - best send window
- Insights panel:
  - what is working
  - what is weak
  - generate more like this
- Idea Inbox suggestions powered by:
  - high-performing topics
  - missing angles
  - reused successful themes

Reuse current foundations:
- post manual performance labels
- email events
- retention metrics
- idea inbox

Acceptance:
- user can see why an idea is being suggested
- suggestions are based on stored performance, not heuristics only

### Phase 5: Config-Driven Control Layer
Purpose:
- move domain/media behavior from code branches into controlled config

Build:
- business profile registry
- media preset registry
- prompt template registry
- decision rules registry
- internal admin screens to manage:
  - domains
  - presets
  - prompt templates
  - rule weights
  - feature toggles

Keep in code:
- safety filters
- copyright restrictions
- worker orchestration
- auth/governance rules

Acceptance:
- new domain profiles can be added without new logic branches
- preset tuning does not require shipping code for every copy tweak

## Suggested Delivery Schedule

### Sprint 1
- Phase 1 foundation
- Knowledge settings page
- prompt injection cleanup

### Sprint 2
- Phase 2 asset hub base
- picker modal in post/email
- centralized usage tracking

### Sprint 3
- Phase 3 first media presets
- SaaS/Daycare/Fitness registry
- safe recommendation service

### Sprint 4
- Phase 4 insight rollups
- Idea Inbox feedback suggestions
- simple "generate more like this"

### Sprint 5
- Phase 5 admin/config controls
- rule tuning
- preset editing

## What To Explicitly Avoid Right Now
- generic website scraping for assets
- broad copyrighted image ingestion
- drag-drop email builder complexity
- long video editing
- AI avatars or realistic fake humans
- custom domain-specific hardcoding in multiple places

## Implementation Order Inside The Repo

### First files to extend
- `apps/founder-content-api/src/services/controlDashboardService.ts`
- `apps/founder-content-api/src/services/contentOrchestrationService.ts`
- `apps/founder-content-api/src/workers/appWorker.ts`
- `apps/founder-content-ai/pages/dashboard.vue`
- `apps/founder-content-ai/pages/app-ideas.vue`
- `apps/founder-content-ai/pages/app-email.vue`
- `apps/founder-content-ai/pages/app-result.vue`

### New surfaces to add
- `Settings -> Knowledge`
- `Assets`
- `Insights`
- admin config views for presets/rules later

## Decision
The smart order is:

1. Knowledge first
2. Asset hub second
3. Media intelligence third
4. Feedback engine fourth
5. Config/admin last

This keeps the system compounding without destabilizing the current publish/email/growth loop.
