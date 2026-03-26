# Workspace Brand Model

## Decision

FounderContent AI treats a workspace as one brand identity.

The rule is:

- `1 workspace = 1 brand`
- `1 user = many workspaces`
- `workspace owns channels, brand memory, content, and billing context`

This is a product and data-model rule, not just a UI preference.

## Why This Exists

The product is being built as a brand operating system, not a generic social media manager.

That means each workspace needs one isolated:

- voice
- source memory
- publishing surface
- analytics context
- billing and usage context

If multiple brands share one workspace, content quality degrades and tenant boundaries become ambiguous.

## Core Model

```text
User (Firebase identity)
  -> Workspace memberships
      -> Workspace / Brand
          -> Brand memory
          -> Channels
          -> Generated content
          -> Analytics
          -> Email domain + reputation
          -> Usage / billing
```

Important codebase note:

- the database currently uses `businesses` and `business_id` as the tenant key
- in product terms, that tenant is the workspace
- in practical usage, that workspace represents one brand

## Rules To Preserve

### 1. One workspace must not contain multiple brands

Do not support:

- multiple brand voices inside one workspace
- multiple unrelated websites inside one workspace
- multiple client identities inside one workspace

This causes:

- mixed brand memory
- polluted source ingestion
- lower generation quality
- ambiguous channel ownership
- harder permissions and billing later

### 2. One user can own or collaborate on many workspaces

This supports:

- founders with multiple products
- operators managing multiple business lines
- agencies managing multiple clients

Example:

```text
User
  -> Workspace: PlanCraft AI
  -> Workspace: FounderContent AI
  -> Workspace: Client Brand C
```

### 3. Channels belong to the workspace, not the user

Connected accounts are distribution channels for a brand.

Examples:

- LinkedIn company page
- founder personal LinkedIn
- Instagram brand account
- Reddit account used for distribution later

These must stay scoped to the workspace so that switching workspaces feels like switching brands, not switching user identities.

### 4. Authentication email is not brand identity

User auth is handled by Firebase.

Do not use:

- Firebase email
- login email
- admin email

as the source of brand identity.

Brand identity belongs to the workspace and its attached channels, memory, and settings.

## V1 Channel Rule

For now:

- `1 workspace -> 1 LinkedIn account`

This is the correct v1 simplification.

It keeps setup, publishing, and support simpler while the product is still focused on direct founder content workflows.

## Future-Safe Direction

The model should allow this later:

```text
1 workspace
  -> LinkedIn company page
  -> LinkedIn founder personal account
  -> Instagram brand account
  -> Reddit account
```

That means implementation should stay compatible with:

- multiple accounts per platform per workspace
- channel status states like `connected`, `expired`, `error`
- explicit workspace-owned channel records

But that future flexibility should not change the current product rule that a workspace itself still represents only one brand.

## Agency Model

Agencies should be modeled as:

- one user
- many workspaces

Not:

- one workspace containing many client brands

Correct:

```text
Agency user
  -> Workspace: Client A
  -> Workspace: Client B
  -> Workspace: Client C
```

Incorrect:

```text
Workspace
  -> Brand A
  -> Brand B
  -> Brand C
```

## UX Guidance

The workspace switcher should feel like:

- `Switch brand`

Not:

- `Switch account`

Users should understand that entering a workspace means entering one brand's memory, channels, and operating context.

## Non-Goals

Do not add these patterns:

- multiple brands per workspace
- user-owned channels detached from workspaces
- auth-email-driven brand identity
- silent blending of unrelated brand sources in one memory layer

## Related Systems

This rule applies directly to:

- onboarding
- brand profiles
- saved source memory
- social channel connections
- email domains
- deliverability reputation
- analytics
- usage and billing

Any new feature should assume workspace isolation first.
