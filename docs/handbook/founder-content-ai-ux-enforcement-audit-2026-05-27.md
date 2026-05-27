# Founder Content AI UX Enforcement Audit (2026-05-27)

## Objective
Enforce the Universal Mobile SaaS UX Handbook across operator-facing routes without removing capability.

## Rules Applied
- One obvious next action per screen.
- One dominant CTA per screen.
- Secondary actions visible but de-emphasized.
- Advanced controls moved behind progressive disclosure.
- Mobile-first spacing, tap targets, and hierarchy.
- Presentation-layer simplification only.

## Page Audit + Actions

### 1) New Post / Create Post (`/app/result` and create flow)
Primary action:
- Publish or Schedule the current post.

Findings:
- The post result surface had multiple parallel actions competing with publish intent.
- Routing options and alternate channels were visually close to primary publishing controls.

Safe fixes status:
- Already improved in prior pass: outreach/email side routes moved under an `Advanced routes` disclosure in publish flow.

Residual risk:
- Draft/media tools remain dense in some viewport sizes and should be grouped into explicit step blocks in a follow-up.

### 2) Planner (`/app/planner`)
Primary action:
- Operate queue: review, adjust, and schedule planned posts.

Findings:
- Planner had started absorbing automation setup and orchestration complexity.

Safe fixes status:
- Already improved in prior pass: heavy autopilot workflow moved out, with handoff to `/app/automation-studio`.

Residual risk:
- Keep planner free from new orchestration controls; route-level ownership must stay strict.

### 3) Brand Studio (`/app/brand-studio`)
Primary action:
- Choose asset type and generate.

Findings:
- Brand Studio now supports advanced creative composition mode and can become dense.

Safe fixes status:
- Already improved in prior pass: Creative Composition added as advanced generation mode while preserving standard flow and brand memory consistency.

Residual risk:
- Additional UI collapsing for secondary knobs may still be useful after user testing.

### 4) Email Campaigns (`/app/email`)
Primary action:
- Create/send campaigns or import/manage contacts depending on tab.

Findings:
- Contacts directory toolbar exposed many filters at once, increasing cognitive load.
- Missing-name contacts showed placeholder dashes, which felt low trust.

Safe fixes implemented now:
- Kept `Search` + `Status` always visible.
- Moved `List/State/Plan/Tag` filters behind `Advanced filters` toggle.
- Added friendly name fallback: `Added by you` when first/last name is missing.

Notes:
- Import workflow already had progress, pagination, and leave-protection warning in place.

### 5) Contacts Import (`/app/email` contacts tab)
Primary action:
- Queue import safely after preview.

Findings:
- Core requirements are already present:
  - stepwise upload/preview/import flow
  - live import job progress
  - beforeunload + route leave protection
  - paginated contact directory

Safe fixes implemented now:
- Friendly missing-name fallback applied in preview and directory rows.

### 6) Assets (`/app/assets`)
Primary action:
- Upload/manage reusable assets.

Findings:
- Media intelligence, resolution diagnostics, and preset overrides were always visible, competing with core asset workflow.

Safe fixes implemented now:
- Added `Advanced controls` summary card.
- Moved media intelligence panels behind explicit `Show advanced controls` toggle:
  - media rules
  - resolution preview
  - preset overrides
- Preserved all underlying behavior and API calls.

### 7) Billing (`/app/billing`)
Primary action:
- Manage subscription/upgrade.

Findings:
- Mostly aligned with single-primary-action model in hero section.
- Still has high information density in plan comparison sections.

Safe fixes status:
- No functional changes in this pass to avoid accidental billing regression.

### 8) Settings (`/settings/preferences`)
Primary action:
- Save preference changes by section.

Findings:
- Large page with many controls remains operationally dense.

Safe fixes status:
- Deferred for dedicated section-by-section collapse refactor to avoid regressions.

## Highest-Impact Safe Fixes Implemented This Pass
- `app-email.vue`
  - progressive disclosure for contact filters
  - friendly fallback names for missing first/last name
- `app-assets.vue`
  - advanced media controls hidden by default
  - upload/library actions remain primary

## What Is Still Pending
- Section collapse pass for `settings-preferences.vue`.
- Billing plan detail compression with expandable advanced detail rows.
- New Post flow step framing (explicit 1) Create 2) Review 3) Publish shell) for clearer mobile progression.

## Files Updated In This Pass
- `apps/founder-content-ai/pages/app-email.vue`
- `apps/founder-content-ai/pages/app-assets.vue`
- `docs/handbook/founder-content-ai-ux-enforcement-audit-2026-05-27.md`

## Final Enforcement Pass (Completed)
- Added mobile bottom dock in workspace shell to keep 5 primary destinations persistent on small screens.
- Added explicit 3-step cue on New Post result (`Create -> Review -> Publish/Schedule`).
- Reduced Email campaign table action overload by keeping primary row action visible and moving less-used actions into a compact `More` disclosure.
- Reduced Brand Studio above-the-fold density by hiding template examples and advanced brand settings behind explicit toggles.
