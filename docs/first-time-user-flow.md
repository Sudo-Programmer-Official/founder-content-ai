# First-Time User Flow

## Entry

Primary landing CTA:

- `Create your first post in 30 seconds`

The CTA should send the user into `/onboarding`, not a generic dashboard.

## First Session Journey

### Welcome

The user sees:

- a short promise
- a visible progress indicator
- a compact intent form

This reduces the psychological cost of getting started.

### Personalization

The product captures:

- why the user is here
- where they want to grow
- what outcome they want

This data feeds:

- onboarding state
- workspace defaults
- future dashboard recommendations

### Workspace creation

The user creates a business workspace with minimal friction.

This is the point where the product becomes "their system" instead of a generic tool.

### First value

The user generates content immediately after workspace creation.

The current onboarding screen supports:

- text input
- optional screenshot upload
- first generated idea
- first hooks
- first post
- remix action
- copy actions

### Optional activation

The final step is soft, not forced.

The user can:

- pick a priority channel
- choose a first schedule preference
- skip either step

### Dashboard handoff

After onboarding is marked complete, the user lands on `/dashboard`.

The dashboard should show:

- next action
- starter angle
- recent workspace activity
- links back into generation and analytics

## Resume Behavior

`GET /api/onboarding/status` is the source of truth for restoring the flow.

If onboarding is:

- not started: the frontend auto-starts it on onboarding entry
- in progress: the user resumes at the saved step
- completed: the user is redirected to `/dashboard`

## Current Scope Notes

The channel connection and scheduling steps are preference capture only in this phase.

They are designed so the future product can attach:

- real channel integrations
- publishing workflows
- recurring schedule automation

without changing the onboarding shape again.
