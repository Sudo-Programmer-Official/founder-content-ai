# Founder Content AI Route UX Audit

## Scope
Audit basis:
- `apps/founder-content-ai/router.ts`
- `docs/handbook/mobile-saas-ux-handbook.md`
- `docs/handbook/mobile-saas-ux-checklist.md`

Classification tags:
- `happy_path`
- `secondary`
- `advanced`
- `operational`

## Layering Rule
Route visibility target:
- `/app/*` should bias to `happy_path` and selected `secondary`
- `/dashboard/*` should hold `operational` and legacy dense views
- `/admin/*` remains `operational`
- public/legal/auth remain separate onboarding/marketing surfaces

## Route Classification

### Happy Path
- `/app/create` (`app-create`)
- `/app/result` (`app-result`)
- `/app/ideas` (`app-ideas`)
- `/app/planner` (`app-planner`)
- `/app/history` (`app-history`) now supports scalable table + pagination
- `/app/dashboard` (`app-dashboard`) capture/start surface

### Secondary
- `/app/assets` (`app-assets`)
- `/app/brand-studio` (`app-brand-studio`)
- `/app/blog` (`app-blog`)
- `/app/growth` (`app-growth`)
- `/app/outreach` (`app-outreach`)
- `/app/email` (`app-email`)
- `/app/email/new` (`app-email-new`)
- `/app/email/:campaignId` (`app-email-edit`)

### Advanced
- `/settings/preferences` (`settings-preferences`)
- `/email-campaigns` (`email-campaigns`)
- `/linkedin-hook-generator` (`linkedin-hook-generator`)

### Operational
- `/dashboard` (`dashboard`) legacy alias
- `/dashboard/analytics` (`dashboard-analytics`)
- `/admin` (`admin`)
- `/admin/features` (`admin-features`)
- `/admin/media-registry` (`admin-media-registry`)
- `/admin/outreach` (`admin-outreach`)
- `/admin/users` (`admin-users`)
- `/admin/workspaces` (`admin-workspaces`)
- `/admin/usage` (`admin-usage`)

### Public / Auth / Standalone
- `/` (`home`)
- `/login` (`login`)
- `/signup` (`signup`)
- `/privacy` (`privacy`)
- `/terms` (`terms`)
- `/data-deletion` (`data-deletion`)
- `/onboarding` (`onboarding`)
- `/onboarding/workspace` (`onboarding-workspace`)
- `/founder-content-ideas` (`founder-content-ideas`)
- `/linkedin-post-ideas-for-founders` (`linkedin-post-ideas-for-founders`)

## Recommended Mobile Dock (Founder Content AI)
Target 5-item dock:
1. Ideas
2. Create
3. Capture
4. Analytics
5. Profile

Suggested route mapping:
- Ideas -> `/app/ideas`
- Create -> `/app/create`
- Capture -> `/app/dashboard` (capture inbox-first treatment)
- Analytics -> `/app/history` (with secondary link to `/dashboard/analytics`)
- Profile -> `/settings/preferences`

## Immediate Refactor Priorities
1. `app-create`:
- enforce single primary CTA hierarchy
- push advanced controls into expandable drawers

2. `app-result`:
- preserve one publish CTA per platform intent
- keep media tools behind progressive sections (already started)

3. `app-dashboard`:
- keep capture as dominant action
- reduce side actions in first viewport

4. `app-assets`:
- keep upload/attach as happy path
- move registry-style controls into advanced drawer

5. `app-history`:
- keep table as default for long-term scale
- keep row click -> detail panel behavior (implemented)

## Migration Guardrails
- Do not remove backend/ops capabilities during UX simplification.
- Move complexity behind view modes, drawers, and “Advanced”.
- Preserve URL-stable operational routes for internal/support use.

## Review Cadence
For each route in an active sprint:
1. Apply checklist from `mobile-saas-ux-checklist.md`
2. Mark violations against one-CTA + progressive disclosure
3. Ship view hierarchy before visual polish
