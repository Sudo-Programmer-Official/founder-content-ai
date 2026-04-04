# Daycare Spots Business Content Mode

## Goal

Make Daycare Spots feel native in the product without forking the platform into a daycare-only app.

The system should:

- onboard Daycare Spots as one workspace/brand
- generate business-marketing content instead of founder thought-leadership
- produce Instagram/Facebook/email-ready assets instead of defaulting to LinkedIn slides
- stay reusable for future domains like dentists, salons, gyms, and local service brands

## What The Current Product Does

Today the generation flow is still biased toward:

- founder-style input
- LinkedIn-first text generation
- slide/carousel-first visual generation

That shows up in the current code:

- `packages/content-engine/src/types.ts` limits `ContentChannel` to `linkedin`
- `packages/shared-types/src/founder-content.ts` exposes `LinkedInPostGenerationRequest`
- `apps/founder-content-api/src/services/aiService.ts` always loads LinkedIn prompt context
- `apps/founder-content-ai/pages/app-generate.vue` frames creation as "Bring one idea"
- `apps/founder-content-ai/pages/app-result.vue` pushes users toward "Generate carousel"

At the same time, the repo already has the right foundation for a broader model:

- workspace/business tenancy is already brand-scoped
- orchestration already supports `linkedin | instagram | facebook | email`
- brand profiles already store Instagram and Facebook URLs
- media intelligence already knows `daycare` as a business type
- email already has a real campaign engine

## Product Direction

Do not build a second app for Daycare Spots.

Do not keep the current founder workflow and hope prompt tweaks will fix it.

Add a workspace-level operating mode on top of the current brand model:

- `founder_mode`
- `business_growth_mode`

For Daycare Spots, default to `business_growth_mode`.

This is a product behavior layer, not a tenant-model change.

The current tenant rule should stay:

- `1 workspace = 1 brand`

So Daycare Spots gets one workspace, one brand memory layer, one publishing/account context, one email reputation context, and its own analytics.

## How Jenny Should Experience It

### 1. Onboarding

When Jenny creates or configures the Daycare Spots workspace, onboarding should capture:

- brand name: Daycare Spots
- website
- primary channels: Instagram, Facebook, Email
- business type: `daycare`
- operating mode: `business_growth_mode`
- core goal: `fill_open_slots` or `drive_listings`
- primary audience: daycare owners
- secondary market scope: state / city / metro

This should extend the existing onboarding and brand-profile system, not bypass it.

### 2. Content Entry

Replace the founder-style input framing for business-growth workspaces.

Instead of:

- "Bring one idea"

Use:

- "What do you want to achieve?"

Suggested options:

- Get more daycare leads
- Promote a listing offer
- Fill open spots faster
- Drive traffic to the directory
- Run a local campaign
- Generate weekly content pack

Free text can still exist, but the entry point should anchor on goal first.

### 3. Output Shape

Do not make carousel generation the default output for Daycare Spots.

The default output should be a campaign-ready post package:

- social image or text visual
- Instagram caption
- Facebook caption
- CTA
- optional email version

Example content archetypes:

- `offer`
- `problem`
- `trust`
- `local`
- `reminder`
- `educational`

## Recommended Canonical Contract

Add a new domain-agnostic marketing content contract instead of extending `LinkedInPostGenerationRequest` forever.

```ts
type BusinessOperatingMode = "founder_mode" | "business_growth_mode";

type MarketingGoal =
  | "build_audience"
  | "get_leads"
  | "promote_offer"
  | "drive_traffic"
  | "fill_open_slots";

type MarketingContentType =
  | "offer"
  | "problem"
  | "trust"
  | "local"
  | "reminder"
  | "educational";

type MarketingChannel = "linkedin" | "instagram" | "facebook" | "email";

interface MarketingContentGenerationRequest {
  businessId?: string;
  operatingMode: BusinessOperatingMode;
  businessType?: "general" | "saas" | "daycare" | "fitness";
  goal: MarketingGoal;
  contentType: MarketingContentType;
  primaryChannel: MarketingChannel;
  targetChannels: MarketingChannel[];
  audience?: string;
  marketScope?: {
    state?: string;
    city?: string;
    region?: string;
  };
  offer?: string;
  sourceIdea?: string;
  tone?: string;
}

interface MarketingChannelVariant {
  channel: MarketingChannel;
  headline: string;
  subheadline?: string;
  body?: string;
  caption: string;
  ctaLabel?: string;
  ctaUrl?: string;
  visualBrief?: string;
}

interface MarketingContentGenerationResponse {
  contentType: MarketingContentType;
  goal: MarketingGoal;
  variants: MarketingChannelVariant[];
}
```

This lets the same system serve:

- founder LinkedIn thought pieces
- daycare lead-gen posts
- salon promotions
- local dentist reminder campaigns

## What To Reuse From The Existing System

### Keep

- workspace/business tenancy
- brand profile storage
- workspace knowledge
- content orchestration variants
- Instagram/Facebook/LinkedIn scheduling model
- email engine
- media intelligence business type layer

### Change

- generation entry contract
- prompt selection logic
- result-page recommendation logic
- onboarding defaults
- visual presets for business-growth workspaces

## Architecture Changes

### 1. Add workspace operating mode

Store an operating mode in workspace/brand settings.

Suggested values:

- `founder_mode`
- `business_growth_mode`

This should drive:

- onboarding defaults
- content-entry UI copy
- available generation actions
- prompt family selection
- result-page media recommendations

### 2. Separate channel-aware marketing generation from LinkedIn generation

Right now the content engine still assumes:

- channel = LinkedIn
- output = LinkedIn variations

Refactor the content engine into:

- prompt family selection by `operatingMode + businessType + primaryChannel + contentType`
- channel adaptation by destination platform

The existing orchestration layer already supports multiple channel variants. The generator should produce variants that fit that model directly.

### 3. Add business-growth prompt families

Keep founder prompts.

Add new prompt families for:

- business-growth offer posts
- local campaign posts
- trust/social-proof posts
- reminder posts
- educational posts

For Daycare Spots, prompts should optimize for:

- direct response
- local relevance
- benefit clarity
- simple CTA
- parent/daycare-owner context

Not:

- long founder stories
- build-in-public framing
- thought-leadership voice

### 4. Make visual generation mode-aware

The current visual layer supports:

- `quote`
- `insight`
- `contrarian`
- `carousel`

That is not enough for Daycare Spots.

Add business-oriented visual presets on top of the existing engine:

- `offer_card`
- `trust_badge_card`
- `local_promo_card`
- `reminder_card`
- `photo_text_overlay`

Important: carousel should still exist, but it should not be the recommended first action for a daycare business-growth workspace.

### 5. Use media intelligence as the recommendation layer

The media-intelligence layer already knows about `daycare` and already suppresses some media types for that business type.

Extend it so business-growth workspaces prefer:

- `quote_card`
- `stat_card`
- `framework_card`
- new business-specific promo templates

For Daycare Spots, default recommendation should be:

- single post visual first
- short caption second
- optional email derivative third

Not:

- narrative deck first

### 6. Reuse the email lane as a downstream adaptation

Once a business-growth content item exists, the system should adapt it across:

- Instagram
- Facebook
- Email

Example:

- content item: Texas daycare listing push
- Instagram variant: short caption + square visual
- Facebook variant: medium caption + local CTA
- email variant: promo block with button

That matches the existing orchestration direction instead of creating a parallel ad-hoc system.

## UI Changes

### `apps/founder-content-ai/pages/app-generate.vue`

For `business_growth_mode`:

- change heading from idea-centric to goal-centric
- add quick-pick goals
- add content-type selector
- add market scope selector
- add channel pack selector

Suggested CTA labels:

- `Generate post`
- `Generate local campaign`
- `Generate weekly pack`

Not:

- `Generate founder post`

### `apps/founder-content-ai/pages/app-result.vue`

For `business_growth_mode`:

- change the media recommendation headline
- stop presenting carousel as the safest default unless content explicitly needs a sequence
- make single-image post generation the primary next action
- show per-channel variants together
- show CTA and landing URL clearly

Suggested recommendation cards:

- `Generate post visual`
- `Generate local campaign visual`
- `Generate email version`
- `Use existing daycare imagery`

### Planner

Expose one campaign across many channels:

- Monday 09:00 Instagram
- Monday 12:00 Facebook
- Monday 16:00 Email

This is already aligned with the orchestration model.

## Data Model Suggestions

Keep the base data model generic.

Suggested additions:

- workspace operating mode
- optional workspace business type override
- campaign goal on content batch / content item metadata
- content archetype on content item / variant metadata
- market scope metadata on content item / variant

Do not add daycare-only columns for every new requirement.

Prefer:

- enum or validated string for operating mode
- generic metadata JSON for campaign context

## Daycare Spots-Specific Defaults

When `businessType = daycare` and `operatingMode = business_growth_mode`:

- default channels: Instagram, Facebook, Email
- default goal suggestions: `get_leads`, `promote_offer`, `fill_open_slots`
- default content types: `offer`, `trust`, `local`, `reminder`
- default visual preference: single-image post or promo card
- default caption style: short, friendly, direct
- avoid founder/storytelling language
- avoid realistic child AI imagery where possible
- prefer uploaded brand assets, listing screenshots, badges, logos, and abstract/kid-safe illustration styles

## Where The Codebase Is Currently Blocked

### Text generation is still LinkedIn-only

- `packages/content-engine/src/types.ts`
- `packages/content-engine/src/generate-content.ts`
- `packages/content-engine/src/content-definitions.ts`
- `packages/shared-types/src/founder-content.ts`
- `apps/founder-content-api/src/services/aiService.ts`
- `apps/founder-content-api/src/controllers/postController.ts`

### UI pushes slide generation

- `apps/founder-content-ai/pages/app-generate.vue`
- `apps/founder-content-ai/pages/app-result.vue`

### Brand intelligence is founder-seeded

- `apps/founder-content-api/src/services/brandIntelligence/brandProfileService.ts`
- `apps/founder-content-api/src/services/onboardingService.ts`

## Recommended Rollout

### Phase 1: Business mode foundation

1. Add workspace operating mode and business type defaults.
2. Update onboarding to support `business_marketing + daycare`.
3. Update generate page copy and controls for business-growth workspaces.

### Phase 2: Marketing content contract

1. Introduce `MarketingContentGenerationRequest`.
2. Add business-growth prompt families.
3. Generate channel-ready variants for Instagram/Facebook/Email.

### Phase 3: Result-page and media changes

1. Replace carousel-first recommendation with business-growth recommendations.
2. Add business-oriented visual presets.
3. Show CTA, market scope, and channel variants in one review surface.

### Phase 4: Campaign automation

1. Add weekly-pack generation by content archetype mix.
2. Persist campaign metadata into content batches/items/variants.
3. Reuse content into email automatically.

## The Right Product Framing

For Daycare Spots, the product is not:

- AI founder content generator

It becomes:

- AI marketing operator for a local-business directory brand

That shift should happen in:

- prompts
- UI labels
- generation contracts
- recommendation logic

Not just marketing copy.

## Immediate First Build

If implementation starts now, the highest-leverage cut is:

1. add `business_growth_mode`
2. add a business-growth generate flow in `app-generate.vue`
3. introduce a new marketing generation request/response type
4. generate Instagram/Facebook/email variants instead of LinkedIn-only variations
5. make `Generate post visual` the primary result-page action for daycare workspaces

That is the smallest real product shift that would make Daycare Spots usable without breaking the founder workflow.
