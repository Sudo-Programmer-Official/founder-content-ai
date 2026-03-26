# Onboarding Spec

## Goal

Phase 15 turns onboarding into an activation funnel, not a form sequence.

The product should feel like:

- "I just got a marketing team in 60 seconds."

It should not feel like:

- "I filled in setup fields and landed on an empty dashboard."

## Core Principles

The onboarding flow must do three things quickly:

1. understand user intent
2. deliver first value
3. create a reason to come back

## Flow Shape

The implemented flow stays under five steps:

1. welcome + intent capture
2. workspace creation
3. first content generation
4. optional activation

After step 4, the user is redirected to `/dashboard`.

## Step Details

### 1. Welcome + intent

The first screen captures:

- primary use case
- target channels
- primary growth goal
- preferred tone

Defaults:

- LinkedIn selected
- professional tone selected

This step should feel fast and directional.

### 2. Workspace creation

The second screen creates the first business workspace.

Fields:

- business name
- industry
- website URL
- timezone

This creates product ownership early and gives the platform a tenant context.

Important rule:

- the workspace being created is one brand container
- it is not a multi-brand organization shell

For founders, this usually maps to one product or company.

For agencies, each client should get a separate workspace.

### 3. First content generation

This is the activation moment.

The user can provide:

- rough text
- topic
- optional screenshot upload

The output screen shows:

- extracted idea
- hook options
- post output
- remix action
- copy actions

The first content value is delivered before any channel connection or scheduling friction.

### 4. Optional activation

The final onboarding screen captures lightweight activation preferences:

- preferred connected channel
- first schedule preference

These are skippable in this phase.

The current implementation stores the intent and onboarding milestone, not a live social integration.

## Backend Contracts

Routes:

- `GET /api/onboarding/status`
- `POST /api/onboarding/start`
- `POST /api/onboarding/preferences`
- `POST /api/onboarding/workspace`
- `POST /api/onboarding/complete`

## Data Model

Tables introduced in this phase:

- `onboarding_profiles`
- `brand_profiles`

`onboarding_profiles` stores user-level onboarding progress and first-session milestones.

`brand_profiles` stores workspace-level content context such as:

- industry
- preferred tone
- target channels
- goals

This means brand context is isolated per workspace from the first onboarding session onward.

## Event Tracking

Onboarding-specific events:

- `onboarding_started`
- `workspace_created`
- `onboarding_completed`
- `first_content_generated`
- `first_content_copied`
- `first_channel_connected`
- `first_content_scheduled`

Generic analytics events still apply during onboarding, especially:

- `post_generated`
- `output_copied`

## Constraints

This phase intentionally avoids:

- frontend auth UI
- forced channel integrations
- live scheduler infrastructure
- heavy visual polish

The objective is structure, speed, and a clean activation path.
