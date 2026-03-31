# New Requirement Phase Program

## Objective
Finish the intelligence and media platform work in a sequence that preserves the current product loop and avoids building disconnected subsystems.

Target end state:

`Knowledge -> Ideas -> Posts -> Email -> Growth -> Feedback -> Better recommendations`

## Non-Negotiables
- Do not break the current publish/email/growth loop.
- Do not introduce domain-specific hardcoding across multiple pages.
- Do not build a design-heavy builder before asset and knowledge foundations exist.
- Keep safety rules and legal guardrails in code, even if presets/rules become configurable later.

## Program Structure
This should be executed in six phases.

## Phase 0: Lock The Existing Core Loop
Purpose:
- Make sure the product can absorb new intelligence layers without regressions.

Scope:
- scheduled post reliability
- worker visibility
- cross-page source linking
- email source-driven flow stability
- growth lead attribution stability
- idea inbox to planner to publish continuity

Definition of done:
- post publish and schedule paths are stable
- email campaign creation works from draft/post sources
- growth lead creation with source attribution works
- planner, ideas, result, email, growth routes are coherent

Out of scope:
- no new intelligence/data models

## Phase 1: Workspace Knowledge Engine
Purpose:
- Make every workspace generation flow aware of brand, audience, and beliefs.

Deliverables:
- `workspace_knowledge_sources`
- `workspace_knowledge_profiles`
- `workspace_knowledge_topics`
- `knowledge_process` worker job
- Settings -> Knowledge page
- generation prompt injection for posts and email

Suggested migrations:
1. `045_workspace_knowledge_foundation.sql`
2. `046_workspace_knowledge_processing_jobs.sql`

Backend work:
- add source storage for:
  - website URL
  - note
  - document
  - linked past asset
- extract:
  - voice
  - audience
  - positioning
  - beliefs
  - topics
- store structured editable profile
- inject profile into:
  - idea conversion
  - post generation
  - email generation

Frontend work:
- add `Settings -> Knowledge`
- source list
- add source modal
- editable insights panel:
  - voice
  - audience
  - beliefs
  - topics

Worker work:
- enqueue async extraction after source create/update
- status: queued / processing / completed / failed

Definition of done:
- workspace can add knowledge sources
- derived profile persists
- prompts use that profile consistently
- user can edit extracted profile

Do not build:
- vector search
- semantic retrieval system
- advanced website crawling

## Phase 2: Asset Hub Foundation
Purpose:
- Create a central asset system that all surfaces can reuse.

Deliverables:
- `workspace_assets`
- `workspace_asset_usages`
- `workspace_brand_kit`
- Assets page
- Asset Picker modal
- centralized upload flow

Suggested migrations:
1. `047_workspace_asset_hub_foundation.sql`
2. `048_workspace_brand_kit_foundation.sql`

Backend work:
- unify asset storage metadata across:
  - post assets
  - email assets
  - uploaded docs
  - brand assets
- track:
  - type
  - source
  - tags
  - context
  - mime type
  - usage count
- expose picker/list endpoints

Frontend work:
- add `/app/assets`
- asset grid
- search + filters
- lightweight preview cards
- picker modal for:
  - post flow
  - planner modal
  - email editor

Integration:
- uploads from post/email save centrally
- selecting an existing asset increments usage

Definition of done:
- one uploaded file can be reused in multiple surfaces
- uploads no longer feel feature-specific
- brand kit assets are visible in one place

Do not build:
- auto-sync with Drive/Dropbox yet
- asset performance scoring yet

## Phase 3: Media Intelligence Layer
Purpose:
- Recommend safe, context-aware media without turning the product into an image tool.

Deliverables:
- media preset registry
- business profile media rules
- shared recommendation service
- first release media suggestions

Suggested migrations:
1. `049_business_media_profiles.sql`
2. `050_media_presets_and_prompt_templates.sql`
3. `051_media_generation_logs.sql`

Preset packs to ship first:
- SaaS
- Daycare
- Fitness

Media outputs for first release:
- quote_card
- stat_card
- photo_overlay
- framework_card
- screenshot_highlight

Backend work:
- shared media recommendation service
- content goal + business type + available assets -> recommendation
- prefer existing assets first
- fallback to safe generated visuals
- generation logging

Frontend work:
- `Add Media` recommendation tray in:
  - result page
  - planner modal
  - email editor
- show:
  - use existing asset
  - generate visual
  - skip

Definition of done:
- system recommends relevant media by context
- media options are constrained by business type
- no generic unsafe visual recommendations

Hardcoded guardrails:
- no external copyrighted image scraping
- no realistic AI daycare/family imagery
- no stock-photo-looking fake content

Do not build:
- full video editor
- avatars
- long-form video

## Phase 4: Feedback + Suggestion Engine
Purpose:
- Convert execution data into better ideas and better recommendations.

Deliverables:
- `workspace_topic_insights`
- `workspace_content_patterns`
- simple insight rollups
- Idea Inbox suggestion engine
- Insights panel

Suggested migrations:
1. `052_workspace_topic_insights.sql`
2. `053_workspace_content_pattern_rollups.sql`

Inputs:
- post performance labels and engagement
- email opens/clicks
- idea reuse frequency
- campaign conversion context

Backend work:
- roll up:
  - top topics
  - weak topics
  - angle preference
  - format preference
  - best send window
- expose explanation-rich suggestions

Frontend work:
- Insights page or Insights section
- `Generate more like this`
- Idea Inbox:
  - high-performing topics
  - missing angle suggestions
  - reuse suggestions

Definition of done:
- suggestions have visible reasons
- repeated high-performing themes become easier to reuse
- system can say what is working and what is not

Do not build:
- heavy analytics dashboard
- opaque recommendations without explanation

## Phase 5: Config-Driven Control Layer
Purpose:
- Move preset/domain behavior into controlled config without making the system chaotic.

Deliverables:
- business profile registry
- media preset registry UI
- prompt template registry UI
- decision rule registry UI
- workspace media override support

Suggested migrations:
1. `054_decision_rules_and_workspace_media_overrides.sql`

Admin surfaces:
- Domains
- Presets
- Prompt templates
- Decision rules
- Feature toggles

Workspace surfaces:
- media preferences
- real vs generated preference
- optional override of tone/style

Definition of done:
- new business/domain behavior can be tuned without code branching
- presets/prompts are editable centrally
- workspace overrides do not bypass safety rules

Keep in code:
- generation pipeline
- auth/governance
- safety categories
- legal restrictions

## Phase 6: Performance-Driven Optimization
Purpose:
- Make the system self-improving without retraining models.

Deliverables:
- preset performance tracking
- media recommendation re-ranking
- topic weighting adjustments
- future scoring hooks

Suggested migrations:
1. `055_media_preset_performance.sql`

Definition of done:
- successful presets/topics get boosted
- weak presets/topics get deprioritized
- recommendations adapt over time

Do not build:
- opaque autonomous optimization
- anything that mutates user-facing behavior without an audit trail

## Execution Priority
Follow this order exactly:

1. Phase 0
2. Phase 1
3. Phase 2
4. Phase 3
5. Phase 4
6. Phase 5
7. Phase 6

Reason:
- knowledge improves generation quality first
- assets prevent media chaos
- media intelligence becomes useful only after assets exist
- feedback becomes useful only after content/media usage is tracked
- config/admin should tune a working system, not define an unbuilt one

## Release Gates

### Release Gate A
Phases complete:
- 0
- 1

Meaning:
- brand-aware content engine

### Release Gate B
Phases complete:
- 0
- 1
- 2

Meaning:
- reusable content + asset system

### Release Gate C
Phases complete:
- 0
- 1
- 2
- 3

Meaning:
- intelligent media-assisted content system

### Release Gate D
Phases complete:
- 0
- 1
- 2
- 3
- 4

Meaning:
- full content feedback loop

## Immediate Recommendation
Start now with:

### Next build slice
- Phase 1A:
  - knowledge source storage
  - processing job
  - derived profile persistence
  - prompt injection

Why:
- highest leverage
- lowest UX risk
- improves posts and email immediately

## Final Rule
Do not try to “finish everything” in one implementation wave.

Finish each phase only when:
- schema is stable
- worker path is stable
- UI has one clear home
- the phase has measurable product value on its own
