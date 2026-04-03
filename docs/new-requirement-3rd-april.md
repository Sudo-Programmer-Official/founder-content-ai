# Email Product Expansion Plan

## Goal

Turn the existing email feature set into a real small-business campaign workflow that can replace tools like Constant Contact for one customer profile first, while keeping the architecture reusable for other domains later.

This is not a rebuild. The system already has:

- contacts, lists, campaigns, recipient tracking
- CSV import
- unsubscribe flow and suppression checks
- SES-based sending and deliverability setup
- HTML rendering and campaign preview UI

The plan below extends that foundation without introducing drag-drop builders, a generic block DSL, or a second product surface.

## Product Principle

Build for one concrete workflow first:

- import audience
- segment audience
- generate or compose campaign
- preview
- send or schedule

But keep the internal model generic enough for:

- daycare owners today
- dentists, coaches, salons, real-estate teams, agencies later

The system should be:

- domain-agnostic in data model
- opinionated in UI
- template-driven, not free-form page-builder driven

## What Already Exists

Current implementation already covers the hard parts:

- backend rendering in `apps/founder-content-api/src/services/email/emailService.ts`
- campaign preview/editor in `apps/founder-content-ai/pages/app-email.vue`
- sending UI in `apps/founder-content-ai/pages/email-campaigns.vue`
- shared contracts in `packages/shared-types/src/email.ts`
- unsubscribe logic and recipient suppression in `apps/founder-content-api/src/services/email/emailService.ts`

So the main gaps are:

1. audience attributes and segmentation
2. structured campaign templates
3. guided onboarding around the existing email flow

## Architecture Direction

### 1. Contacts: use flexible attributes, not daycare-specific columns

Do not add only a `state` column and stop there.

Use a hybrid model:

- keep core columns as-is: `email`, `first_name`, `last_name`, `status`, `tags_json`
- add `attributes_json jsonb not null default '{}'::jsonb`

Initial supported keys:

- `state`
- `city`
- `business_type`
- `audience_type`
- `language`
- `plan`

Why this is the right boundary:

- `state` is needed now
- future domains will need different fields
- JSONB lets you move fast without schema churn every time a new use case appears

Optional later:

- if one attribute becomes heavily queried, add a generated/derived indexed column

### 2. Segments: first-class saved filters

Do not rely on list names alone for segmentation.

Add a saved segment model:

- `email_segments`
  - `id`
  - `business_id`
  - `name`
  - `filter_json`
  - `created_by_user_id`
  - timestamps

`filter_json` should support a narrow grammar only:

- `listIds`
- `statusIn`
- `tagIn`
- `attributeEquals`
- `attributeIn`

Example:

```json
{
  "listIds": ["launch-list-id"],
  "statusIn": ["active"],
  "attributeIn": {
    "state": ["Texas", "Arizona"]
  }
}
```

This is enough for MVP and still scales to other domains.

### 3. Templates: structured presets, not a generic page builder

Do not build a JSON block engine first.

Add a small structured template layer on top of the current renderer:

- `promo`
- `educational`
- `announcement`

Extend campaign content with structured fields:

- `templateType`
- `eyebrow`
- `headline`
- `subheadline`
- `ctaLabel`
- `ctaUrl`
- `heroImage`
- `supportingImage`
- `includeSignature`

Renderer stays opinionated:

- logo/header area
- hero section
- body copy
- CTA button
- optional supporting image
- footer/unsubscribe

Store the structured content in `EmailCampaignContent`, then render HTML/text from it.

### 4. Keep send infrastructure unchanged

Do not switch providers right now.

Keep:

- SES
- deliverability checks
- unsubscribe handling
- suppression logic

This is already built and changing it would slow down delivery for no customer-facing win.

## Phase Plan

## Phase 1: Contact Attributes + Import

### Objective

Make the current email system usable for a real segmented business audience.

### Backend

1. Add `attributes_json` to `email_contacts`.
2. Extend CSV import mapping to support:
   - `state`
   - `city`
   - `business_type`
   - `audience_type`
   - `plan`
3. Extend import preview so these fields are visible before import.
4. Preserve current unsubscribe import behavior:
   - active contacts import
   - unsubscribed contacts import
   - status remains authoritative

### Frontend

1. Update contacts import UI to map extra fields.
2. Show imported attributes in contact table/detail.
3. Add filter controls for:
   - status
   - tag
   - state
   - plan

### Files Likely Touched

- `packages/shared-types/src/email.ts`
- `apps/founder-content-api/src/services/email/emailService.ts`
- `apps/founder-content-ai/pages/app-email.vue`
- `apps/founder-content-ai/pages/email-campaigns.vue`

### Acceptance Criteria

- CSV with `email,name,state` imports correctly
- unsubscribed contacts never re-enter active sends
- contacts can be filtered by `state`

## Phase 2: Saved Segments + Recipient Resolution

### Objective

Move from “send to list” to “send to the right audience in the list.”

### Backend

1. Add `email_segments` table.
2. Add segment CRUD endpoints.
3. Add recipient resolver that combines:
   - list membership
   - status
   - tags
   - attributes
4. Update campaign send flow so recipient selection can come from:
   - list only
   - segment
   - list + segment filter

### Frontend

1. Add segment create/edit UI.
2. Add saved segment selector in campaign flow.
3. Show estimated recipient count before send.

### Files Likely Touched

- `packages/shared-types/src/email.ts`
- `apps/founder-content-api/src/services/email/emailService.ts`
- email controllers/routes
- `apps/founder-content-ai/pages/app-email.vue`
- `apps/founder-content-ai/pages/email-campaigns.vue`

### Acceptance Criteria

- “Texas active contacts” can be saved as a segment
- campaign preview shows recipient count before send
- recipient query excludes unsubscribed, bounced, complained contacts

## Phase 3: Structured Template Renderer

### Objective

Match the customer’s current email quality without building a page builder.

### Backend

1. Extend `EmailCampaignContent` with structured template fields.
2. Update `buildEmailCampaignBodies(...)` to render:
   - `promo`
   - `educational`
   - `announcement`
3. Preserve current plain text fallback generation.

### Frontend

1. Add template type selector.
2. Add fields for:
   - eyebrow
   - headline
   - subheadline
   - CTA label
   - CTA URL
   - hero/supporting image
3. Update preview to mirror backend layout closely.

### Files Likely Touched

- `packages/shared-types/src/email.ts`
- `apps/founder-content-api/src/services/email/emailService.ts`
- `apps/founder-content-ai/pages/app-email.vue`

### Acceptance Criteria

- can recreate the current Constant Contact style email
- campaign preview matches send output closely
- sending still appends unsubscribe footer correctly

## Phase 4: Guided Business Workflow

### Objective

Make the existing email surface feel simple for business users without creating a separate product mode.

### UX Rules

Do not create a special “business mode.”

Instead, trigger guidance when:

- no contacts exist
- no segments exist
- no sender domain is configured

### Guided Flow

1. Import contacts
2. Map fields
3. Import unsubscribed contacts
4. Create first segment
5. Generate or compose first campaign
6. Send test campaign

### Frontend

Add lightweight onboarding prompts inside current email pages:

- empty-state CTA
- next-step checklist
- inline warnings

### Acceptance Criteria

- new workspace can go from zero to first send without support
- normal content-only users are not pushed into email setup

## Phase 5: Intelligence Layer

### Objective

Add differentiation after the workflow is stable.

### Additions

1. Dynamic copy by segment
   - `Texas Daycares: Fill Your Open Spots This Week`
2. Existing personalization tokens
   - `{{name}}`
   - `{{first_name}}`
3. Segment-aware image suggestions
4. CTA variants
5. Later: A/B testing

### Do Not Build Yet

- drag-drop editor
- full template marketplace
- visual automation rules engine
- advanced attribution analytics

## Recommended Delivery Sequence

This is the fastest sequence that still preserves scalable boundaries.

### Sprint 1

- `attributes_json` on contacts
- CSV import mapping for `state`
- contact filters by state/status

### Sprint 2

- saved segments
- recipient preview counts
- send by segment

### Sprint 3

- `promo / educational / announcement` templates
- recreate current customer email design

### Sprint 4

- onboarding checklist
- first-campaign workflow

### Sprint 5

- dynamic segment-aware copy
- image improvements
- CTA improvements

## Non-Negotiables

These must remain true through every phase:

1. Unsubscribe always works.
2. Suppressed contacts are never resent.
3. Deliverability configuration stays visible and actionable.
4. Renderer stays deterministic and testable.
5. Domain-specific logic does not leak into the core schema.

## Future Scalability Rules

To keep this reusable across domains:

### Use generic naming

Prefer:

- `attributes_json`
- `segments`
- `templateType`

Avoid:

- `daycare_state`
- `daycare_template`
- `business_mode`

### Keep vertical logic in presets, not schema

Daycare-specific behavior should live in:

- import templates
- segment presets
- campaign template presets
- AI prompt presets

Not in:

- core contact table design
- send pipeline
- unsubscribe system

### Keep the renderer narrow

Add new preset layouts only when a real use case needs them.

That keeps:

- preview stable
- HTML safe
- rendering testable
- support burden low

## Definition of Success

Phase 1 success:

- real customer imports contacts and unsubscribes
- filters by state
- sends one clean segmented campaign

Phase 2 success:

- customer saves reusable regional audiences
- send workflow becomes repeatable

Phase 3 success:

- customer no longer needs Canva for routine email campaigns

Business success:

- customer can replace Constant Contact
- customer keeps using Founder Content AI as the operating surface for content and email

## Short Recommendation

Build this in the following order:

1. contact attributes
2. saved segments
3. structured templates
4. guided onboarding
5. intelligence layer

That is the narrowest path to revenue and the cleanest path to future domain expansion.
