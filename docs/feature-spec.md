# FounderContent AI MVP Feature Spec

## MVP Definition

FounderContent AI MVP is the founder content workflow:

**Idea -> Hook -> Post**

The MVP includes exactly three product features:

- `/founder-content-ideas`
- `/linkedin-hook-generator`
- `/linkedin-post-generator`

Everything else is deferred.

## Shared Product Rules

All three features should follow these rules:

- inputs should be minimal and easy to complete
- outputs should be structured and copy-ready
- results should feel founder-specific
- each feature should lead naturally into the next step in the workflow

## Feature 1: Founder Content Idea Generator

### Goal

Help founders answer the question: "What should I post next?"

### Route

`/founder-content-ideas`

### Inputs

- `industry`
- `stage`

### Input Guidance

Examples:

- industry: SaaS
- stage: early startup

### Output Format

Return a list of founder-specific content ideas.

Recommended MVP output:

- 5 idea cards
- each card includes a short headline
- each card includes a one-line angle or explanation
- each card includes a CTA to continue into post generation

### AI Prompt Strategy

System instruction:

- act as a founder content strategist
- generate ideas that feel relevant to a startup founder's real journey
- prioritize practical, story-driven, and insight-driven topics

Variables:

- industry
- stage

Expected output:

- a structured list of idea options
- each idea should be specific enough to turn into a hook or post immediately

### UX Outcome

The user should leave this page with clear content directions, not vague topics.

### Non-Goals

- long-form content calendars
- multi-channel plans
- weekly analytics recommendations

## Feature 2: LinkedIn Hook Generator

### Goal

Help founders create stronger openings so more people read their posts.

### Route

`/linkedin-hook-generator`

### Inputs

- `topic`

### Input Guidance

Example:

- topic: startup failure

### Output Format

Return a list of hook options.

Recommended MVP output:

- 5 hooks
- each hook shown as a separate selectable card
- each hook designed for founder storytelling or insight-led posts

### AI Prompt Strategy

System instruction:

- act as a LinkedIn hook specialist for startup founders
- write concise, high-curiosity openings
- favor clarity, tension, lessons, and founder experience

Variables:

- topic

Expected output:

- 5 distinct hooks
- each hook should be strong enough to start a full post

### UX Outcome

The user should be able to copy a hook directly or use it as input to the LinkedIn post generator.

### Non-Goals

- thread generation
- headline testing across multiple platforms
- performance scoring

## Feature 3: LinkedIn Post Generator

### Goal

Generate complete LinkedIn posts from founder topics.

### Route

`/linkedin-post-generator`

### Inputs

- `topic`
- `tone`
- `length`

### Input Guidance

Examples:

- topic: startup failure
- tone: storytelling
- length: medium

If a user arrives from the hook generator, a selected hook may be prefilled, but it should not be a required field for MVP.

### Output Format

Return three LinkedIn-ready post variations.

Required MVP variations:

- story version
- lesson version
- build-in-public version

Recommended rendering:

- one result card per variation
- clean copy-ready formatting
- clear labels for each angle

### AI Prompt Strategy

System instruction:

- act as a founder content writer for LinkedIn
- turn the topic into short, structured posts optimized for readability
- preserve founder authenticity over generic marketing language

Variables:

- topic
- tone
- length
- optional selected hook

Expected output:

- three post variations
- each version should be readable, founder-specific, and suitable for direct publishing after review

### UX Outcome

The user should receive multiple usable options without having to regenerate repeatedly for a basic result.

### Non-Goals

- auto-publishing
- analytics scoring
- team review workflow

## Cross-Feature Workflow

The intended navigation flow is:

1. User starts at `/founder-content-ideas`.
2. User chooses an idea and opens `/linkedin-hook-generator`.
3. User chooses a hook and opens `/linkedin-post-generator`.
4. User copies a finished post and publishes manually.

The product should also allow direct entry into any individual route for users coming from SEO or repeat usage.

## Recommended API Contracts

### Ideas

Request fields:

- industry
- stage

Response fields:

- ideas[]

### Hooks

Request fields:

- topic

Response fields:

- hooks[]

### LinkedIn Posts

Request fields:

- topic
- tone
- length
- optional selectedHook

Response fields:

- variations[]

## Acceptance Criteria

The MVP feature set is ready when:

- each route has a clear page contract
- each feature has a stable input/output shape
- all AI outputs are structured enough to render predictably
- the three routes connect into one understandable workflow
- no non-MVP capabilities leak into the implementation plan
