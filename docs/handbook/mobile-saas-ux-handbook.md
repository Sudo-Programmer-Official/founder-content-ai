# Founder Content Mobile UX Handbook (OpenMat Pattern)

## Purpose
This is the UX standard for Founder Content AI mobile surfaces.

Reference pattern:
- OpenMat mobile app shell (simple top bar + feed cards + fixed bottom dock)

Core rule:
**Hide complexity. Do not remove capability.**

## Product Intent
Founder Content should feel:
- creator-first
- lightweight
- fast to publish/share
- operationally powerful underneath

Users should understand what to do in under 10 seconds.

## Golden Rule
Every screen must answer:
**What is the one next action?**

If unclear, reduce visible controls.

## OpenMat-Style App Shell
Required structure for `/app/*`:
- Top bar:
  - left: product identity/title
  - right: `Advanced` entry
- Content:
  - single vertical feed/stack
  - clear cards with one focal action
- Bottom:
  - persistent dock (4 tabs + center create action)
  - safe-area aware on iOS/Android

Do not use dashboard-style sidebars or dense table layouts in mobile-first routes.

## Bottom Dock Standard
Use one stable dock across app screens.

Target shape:
- Tab 1: Home/Content
- Tab 2: Pipeline/Review
- Center: Create (`+`)
- Tab 3: Revenue/Performance
- Tab 4: Profile

Rules:
- no tab reordering per screen
- max 5 top-level items including center CTA
- selected tab has clear active state

## Action Hierarchy
For each screen/card:
1. Primary action:
- one dominant CTA (filled/accented)

2. Secondary actions:
- max 1-2 visible neutral buttons (for example `Preview`, `Share`)

3. Tertiary actions:
- overflow menu (`...`) or bottom sheet

If a row has more than 2 visible buttons, move extras into overflow.

## Progressive Disclosure
Default experience:
- show only required inputs and next step
- reveal advanced options explicitly (`Advanced`, `More`, bottom sheet)

Never front-load low-frequency controls in the first view.

## Founder Content Screen Blueprint
### 1) Content Feed
Must include:
- content cards with title, status, date
- primary CTA: publish/share/continue
- secondary CTA: preview
- overflow for duplicate/archive/settings

### 2) Create Flow
Must include:
- one-column mobile form
- step-by-step sequence
- immediate draft save/visual feedback

Advanced fields:
- SEO/meta/automation rules hidden under `Advanced`

### 3) Revenue/Performance
Must include:
- compact key numbers first
- one primary action (for example `View Full Report` or `Withdraw`)

Avoid:
- dense analytics dashboards by default in `/app/*`

### 4) Profile
Must include:
- identity block
- creator bio and links
- entry to advanced workspace

## Route Architecture
Use:
- `/app/*` for simplified creator UX
- `/dashboard/*` and `/admin/*` for heavy operations

This is a presentation-layer separation, not a backend rewrite.

## Visual Direction
Use visual language similar to OpenMat simplicity:
- dark, calm surfaces
- high-contrast typography
- rounded cards and controls
- minimal noise

Avoid:
- overloaded borders/shadows
- too many competing accent colors
- multi-panel density above the fold

## Quality Bar (Definition of Done)
A mobile screen is done when:
1. one next action is obvious
2. dock is persistent and safe-area correct
3. no clipped/overlapping controls at 390px width
4. loading/empty/error states exist
5. advanced actions are not in the primary action row
6. legacy capability is still reachable via advanced surfaces

## Decision Filter
Before shipping any UI change, ask:
1. Does this reduce cognitive load?
2. Is the next action clearer?
3. Can this move to overflow/advanced without losing capability?
4. Does this preserve mobile speed and thumb ergonomics?

If any answer is no, revise.

## Implementation
Use with:
- [mobile-saas-ux-checklist.md](/Users/abhishekkumarjha/Documents/sudo-programmer-official/founder-content-ai/docs/handbook/mobile-saas-ux-checklist.md)
