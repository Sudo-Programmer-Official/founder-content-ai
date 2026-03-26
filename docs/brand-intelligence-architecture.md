# Brand Intelligence Architecture

## Goal

The brand intelligence layer turns raw workspace signals into an operational brand profile that can guide:

- content generation
- visual prompt alignment
- future publishing decisions

This phase does not introduce a full image-generation pipeline.

It introduces the intelligence and prompt contracts that a visual engine can use later.

## Core Model

The system uses one workspace-level `brand_profiles` table as the shared source of truth.

That profile now combines:

- onboarding defaults
- competitor intelligence signals
- generated content history
- trend signals

## Stored Profile Fields

The persisted brand profile includes:

- `tone`
- `writing_style`
- `visual_style`
- `topics`
- `patterns`

It also keeps the onboarding-oriented context:

- `industry`
- `preferred_tone`
- `target_channels`
- `goals`

## Signal Sources

The extraction service analyzes three signal groups:

1. competitor analyses
2. trend signals
3. generated content assets

Because competitive intelligence persistence is still lightweight in this repo, the extractor reads both:

- database-backed analytics tables where available
- in-memory competitive-intelligence runtime snapshots

## Extraction Strategy

The extraction flow is heuristic-first with optional AI refinement.

Heuristics infer:

- dominant tone
- writing style
- topic priorities
- recurring content patterns
- visual direction

If an OpenAI key is configured, the service refines those signals into a tighter brand profile.

If AI is unavailable or weak signals exist, the heuristic result is still usable.

## Generation Integration

The content engine now accepts optional `brandContext`.

That context is injected into prompt variables for:

- ideas
- hooks
- posts
- capture
- remix

This means content generation is no longer only channel-aware.

It is now channel-aware plus brand-aware.

## Visual Alignment

There is no live image-generation endpoint in this phase.

Instead, the system exposes a reusable visual prompt builder that converts:

- `tone`
- `writing_style`
- `visual_style`
- `topics`
- `patterns`

into a brand-aligned visual prompt template.

That keeps the visual layer honest and future-ready without pretending a full visual engine exists already.

## API

Routes:

- `GET /api/brand-profile`
- `POST /api/brand-profile/update`

Both routes:

- require authentication
- require active business membership

## Non-Goals

This phase intentionally does not include:

- heavy ML training
- private data scraping
- full image generation
- performance-based brand evolution

It is the brand intelligence foundation, not the final adaptive marketing brain.
