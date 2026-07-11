# Founder Content Mobile UX Daily Checklist

Use this for every `/app/*` screen in Founder Content AI.
Goal: keep OpenMat-level simplicity every day, not just at launch.

## How to Use Daily
1. Before design/build: run `Pre-Work Gate` (2 minutes).
2. During implementation: run `Build Gate` (5 minutes).
3. Before merge: run `PR Gate` (5 minutes).
4. If any gate fails: do not ship until failures are resolved.

## Pre-Work Gate (Before Design or Coding)
- [ ] Screen has one clear primary user intent.
- [ ] One dominant CTA is defined with a verb-led label.
- [ ] Bottom dock destination for this screen is clear.
- [ ] Advanced/ops actions are identified and marked secondary.

## Build Gate (During Implementation)
### 1) One-CTA Rule
- [ ] One primary CTA is visually dominant.
- [ ] No row has more than 2 visible non-primary actions.
- [ ] Extra actions are moved to overflow (`...`) or bottom sheet.

### 2) OpenMat-Style Shell
- [ ] Top bar has clear identity/title.
- [ ] `Advanced` entry exists where needed.
- [ ] Fixed bottom dock remains visible and stable.
- [ ] Center create action (`+`) is not blocked/clipped.

### 3) Navigation and Loop Speed
- [ ] User can return to core loop in one tap.
- [ ] Happy-path flow has low click depth.
- [ ] No sidebar/table-first desktop pattern appears in `/app/*`.

### 4) Progressive Disclosure
- [ ] Required inputs are shown first.
- [ ] Advanced fields are hidden behind explicit reveal.
- [ ] Low-frequency controls are not in the first viewport.

### 5) Mobile Usability
- [ ] Touch targets are at least `44px` high.
- [ ] Safe-area padding works for top and bottom fixed elements.
- [ ] No overlap/clipping at `390px` width.
- [ ] Spacing and text remain readable without zoom.

### 6) States and Reliability
- [ ] Loading state exists (no major layout shift).
- [ ] Empty state explains the next action.
- [ ] Error state shows retry path near the failing action.
- [ ] UX simplification did not remove backend/ops capability.

## PR Gate (Before Merge)
- [ ] "Next obvious action" is understandable in under 10 seconds.
- [ ] First-time user can complete the happy path without help.
- [ ] Power user can reach advanced controls quickly.
- [ ] Route boundary is preserved:
- [ ] `/app/*` = simple operator experience.
- [ ] `/dashboard/*` or `/admin/*` = heavy operations.
- [ ] Reviewer confirmed no cognitive-load regression.

## Daily Standup Status Format
Use this short format in standups/async updates:

```md
Route: /app/____
Primary action: ____
Gate status: Pre-Work PASS/FAIL, Build PASS/FAIL, PR PASS/FAIL
Failed checks: ____
Fix ETA: ____
```

## Screen Review Template (Copy/Paste)
```md
Route:
Primary user:
Primary action (one):
Secondary actions (max 2 visible):
Overflow actions:
Advanced entry point:
Dock tab:
Happy-path steps:
Loading/empty/error coverage:
390px mobile check result:
Risks before ship:
```
