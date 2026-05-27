# Universal Mobile SaaS UX Handbook

## Purpose
Use this as the default UX standard for all operator-facing products:
- OpenMat
- PlanCraftAI
- Founder Content AI
- SalonFlow
- future creator/marketplace/operations products

This handbook defines one rule set:
**hide complexity, do not remove capability.**

## Core Philosophy
Old SaaS approach:
- expose all functionality immediately
- prioritize system completeness over user momentum

Result:
- crowded dashboards
- confusing onboarding
- high abandonment

New SaaS approach:
- expose only the next obvious action
- prioritize operator momentum and loop completion

Result:
- clarity
- speed
- better activation and conversion

## Golden Rule
Every screen must answer:
**What is the one thing the user should do next?**

If that answer is unclear, the screen hierarchy has failed.

## 5-Layer UX Model
### Layer 1: Happy Path
Primary outcome action, immediately visible.
Examples: Create deal, Publish, Open QR, Redeem.

### Layer 2: Secondary Actions
Visible but de-emphasized.
Examples: Preview, Duplicate, Archive, Export.

### Layer 3: Advanced Actions
Hidden behind progressive disclosure.
Examples: bottom sheet, tools drawer, "Advanced", three-dots menu.

### Layer 4: Operational Systems
Admin/ops functions available but not default UI.
Examples: analytics, audit logs, moderation, support tools.

### Layer 5: Infrastructure
Never in operator UI.
Examples: API orchestration, pipelines, auth internals, payment wiring.

## Mobile-First SaaS Layout
Preferred structure:
- Top: identity, title, one clear action
- Middle: focused content for current step
- Bottom: persistent dock navigation

Avoid making desktop-enterprise patterns primary:
- left-heavy sidebars
- dense table-first home screens
- multi-panel overload

## Bottom Navigation Rule
Use stable dock navigation with low click depth and strong muscle memory.

Target: 4-5 primary destinations, not 10-15 mixed destinations.

## One-CTA Principle
Each screen has:
- one dominant CTA
- one emotional outcome

Everything else must be secondary or advanced.

## Progressive Disclosure Standard
Default forms should collect only essential inputs first.
Advanced controls should be delayed behind explicit reveal.

Do not front-load power-user fields into the first interaction.

## Operator Layer Architecture
Use:
- `/app/*` for polished operator UX
- `/dashboard/*` for legacy/ops/system workflows

This is a visibility architecture, not a backend rewrite.

## Presentation Layer Migration Strategy
When modernizing:
- keep backend systems intact
- keep analytics/admin logic intact
- change exposure order and interaction density

Do not break operational reliability for visual simplification.

## Visual Rules
Design should feel:
- breathable
- touch-friendly
- calm
- intentional

Avoid:
- crowded borders
- excessive cards and shadows
- high-noise color usage
- unnecessary controls above the fold

## Viral UX Principle
Value comprehension target:
**user understands value in under 10 seconds**.

Users should not need to understand architecture before action.

## Product Loop Optimization
Default optimization loop:
Create -> Share -> Consume -> Redeem -> Return

Build around the loop, not around subsystem visibility.

## Long-Term Operating Principle
**Hide complexity. Do not remove capability.**

Use this as a decision filter for every screen, flow, and refactor.

## Implementation
Apply this with the screen-level checklist:
- [mobile-saas-ux-checklist.md](/Users/abhishekkumarjha/Documents/sudo-programmer-official/founder-content-ai/docs/handbook/mobile-saas-ux-checklist.md)
