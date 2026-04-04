Place optional bundled motion-lite tracks in this directory.

Expected file names:

- `clean_modern_1.mp3`
- `promo_fast_1.mp3`
- `warm_local_1.mp3`
- `luxury_soft_1.mp3`
- `calm_wellness_1.mp3`

Legacy fallback names still work:

- `calm.mp3`
- `upbeat.mp3`
- `ambient.mp3`

Behavior:

- If a matching file exists, motion-lite will loop and mux that track into the teaser.
- If the file is missing, the renderer falls back to the built-in generated audio bed for that track.

Keep tracks short, seamless, and license-safe for commercial use.
