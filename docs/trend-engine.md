# Trend Engine

## Goal

Turn normalized public content into trend signals that are useful for content strategy.

## Inputs

Trend aggregation uses:

- `source_items`
- `source_item_analysis`

The analysis step provides:

- `topic`
- `hookType`
- `tone`
- `format`
- `whyItMightWork`

## Time Windows

Two windows are computed:

- 7-day
- 30-day

Each window compares the current period against the immediately previous period of the same length.

## Output

The trend engine returns:

- `topic`
- `sourceItemCount`
- `momentum`
- `engagementWeightedTrendScore`
- `sampleHookTypes`

## Momentum Formula

Current implementation:

`momentum = (current_count - previous_count) / max(previous_count, 1)`

This makes it easy to detect:

- rising topics
- flat topics
- declining topics

## Engagement-Weighted Trend Score

Current implementation:

`engagementWeightedTrendScore = engagement_sum * (1 + max(momentum, 0)) + sourceItemCount * 0.35`

Notes:

- `engagement_sum` is the sum of source item engagement scores in the active window
- if engagement data is unavailable, the system falls back to a baseline score of `1`
- positive momentum increases the score
- negative momentum does not create negative total scores

## Why This Is Good Enough For Phase 12

This foundation gives the product:

- cross-source topic comparison
- early momentum detection
- a stable ranking function

without overbuilding a false precision layer.

## Future Improvements

- per-source weighting
- recency decay weighting inside the current window
- confidence-aware trend scoring
- business-specific topic clustering
- channel-specific trend views
- cached persisted trend snapshots in Postgres
