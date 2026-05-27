# Campaign Automation Engine

## Decision
Separate manual planning from AI orchestration.

Planner remains operations-focused:
- calendar
- queue
- approvals
- quick edits
- schedule status

Automation Studio becomes orchestration-focused:
- campaign goal
- duration
- platforms
- creative direction
- references
- sequential generation pipeline
- day-by-day campaign batch output

## Why
Combining planning + orchestration in one surface creates cognitive overload and weakens the primary loop.

This split preserves:
- low cognitive load in Planner
- strategic depth in Automation Studio
- reusable architecture across products

## Route Model
- Planner: `/app/planner`
- Automation Studio: `/app/automation-studio`

## Pipeline Contract (per day)
1. generate strategy
2. generate hook
3. generate caption
4. generate CTA
5. generate image prompt
6. generate creative asset
7. run quality validation
8. save campaign batch

## Product Rule
Do not overload Planner with orchestration controls.
Route orchestration to Automation Studio and feed approved output back into Planner.
