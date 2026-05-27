# Mobile SaaS Screen Checklist

Use this checklist for every new screen and every major UI refactor.

## 1) Primary Outcome
- [ ] One primary user intent is explicit on this screen.
- [ ] One dominant CTA is visually obvious.
- [ ] Primary CTA label is action-first (verb-led).

## 2) Action Hierarchy
- [ ] Secondary actions are visibly quieter than primary CTA.
- [ ] Advanced actions are moved behind drawer/sheet/menu.
- [ ] Operational/admin actions are not above the fold by default.

## 3) Navigation
- [ ] Screen fits the 4-5 item bottom-dock model.
- [ ] User can return to core loop in one tap.
- [ ] No deep navigation for core happy-path task.

## 4) Cognitive Load
- [ ] Initial viewport avoids dense option overload.
- [ ] Copy is concise and task-specific.
- [ ] Number of simultaneous choices is intentionally constrained.

## 5) Progressive Disclosure
- [ ] Required fields shown first.
- [ ] Advanced fields hidden behind explicit reveal.
- [ ] Empty states guide next action clearly.

## 6) Mobile Interaction Quality
- [ ] Touch targets are comfortably tappable.
- [ ] Spacing rhythm is consistent and breathable.
- [ ] Content width and safe-area padding prevent crowding.

## 7) Data Presentation
- [ ] Dense tables are optional view modes, not forced defaults.
- [ ] Card/table views keep click-to-detail behavior clear.
- [ ] Pagination or virtualized scrolling exists for large datasets.

## 8) Visual System Consistency
- [ ] Primary button style is consistent with app standard.
- [ ] Status and chips use consistent tone mapping.
- [ ] Backgrounds, borders, and shadows avoid visual noise.

## 9) Reliability + Capability
- [ ] No backend/ops capability removed for UX simplification.
- [ ] Legacy/ops workflows remain reachable where needed.
- [ ] Errors and retries are visible near affected actions.

## 10) Acceptance Gates
- [ ] "Next obvious action" is understandable in under 10 seconds.
- [ ] First-time user can complete happy path without help.
- [ ] Power user can reach advanced controls without friction.

## Screen Review Template
Use this per route:

```
Route:
Primary user:
Primary action:
Secondary actions:
Advanced entry point:
Ops/admin entry point:
Happy-path completion steps:
Potential overload risks:
Changes required before ship:
```
