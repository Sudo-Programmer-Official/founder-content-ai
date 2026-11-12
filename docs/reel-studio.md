# Reel Studio

Prompt → AI storyboard → approval → narration → animated 9:16 MP4 → human review → share, inside the workspace app at `/app/reels`.

## How it works

```text
Vue page (/app/reels)
  │ POST /api/reel-studio/projects            prompt + settings
  ▼
AI director (reelStoryboardService)           LLM picks + configures scenes from a fixed library
  │ normalizeStoryboard()                     untrusted JSON → validated ReelStoryboard
  ▼
reel_projects row (status: storyboard_ready)  user edits text / regenerates single scenes
  │ POST /approve → workflow gate
  │ POST /render  → jobs row (type reel_render)
  ▼
reelRenderWorker (dedicated process)
  1. TTS per scene (OpenAI, PCM)              narration length decides each scene's length
  2. timeline + captions                      frame-exact; audio padded per scene so nothing drifts
  3. apps/reel-renderer (Remotion, child proc) MP4 + poster
  4. S3 (or local .data/ in dev)              render → human review → signed URLs to the page
```

Key rule: **the LLM never writes animation code.** It returns scene JSON that maps onto deterministic
React components in `apps/reel-renderer/src/scenes` (`title`, `bullets`, `flow`, `stat`, `comparison`,
`code`, `outro`). Adding a visual = add a scene type to `packages/shared-types/src/reel-studio.ts`, a component,
a case in `normalizeScene()`, and a line in the director prompt's scene library.

## Pieces

| Piece | Location |
| --- | --- |
| Types / contracts | `packages/shared-types/src/reel-studio.ts` |
| TTS helper | `packages/ai-core/src/synthesizeSpeech.ts` |
| Director + validation | `apps/founder-content-api/src/services/reelStudio/reelStoryboardService.ts` |
| Projects CRUD, render queueing | `.../reelStudio/reelProjectService.ts` |
| Narration, timeline, render, upload | `.../reelStudio/reelRenderService.ts` |
| S3 / local media + signed URLs | `.../reelStudio/reelMediaStorage.ts` |
| Worker | `apps/founder-content-api/src/workers/reelRenderWorker.ts` |
| Remotion scene engine | `apps/reel-renderer` |
| Page | `apps/founder-content-ai/pages/app-reel-studio.vue` |
| Migration | `db/migrations/092_reel_studio_projects.sql` |

Access is gated by the `visual_generation` feature flag; generating a storyboard and regenerating a scene each
count as one generation against the workspace quota. Rendering does not.

The workflow is enforced by the API: storyboard edits return a project to `script_draft`, rendering requires
`approved`, and the share action is only presented after the rendered video is marked `reviewed`. Every generated,
edited, regenerated, approved, and reviewed storyboard is saved as a revision in `reel_project_revisions`.

## Local setup

```bash
# once
cd apps/reel-renderer && npm install          # Remotion downloads Chrome Headless Shell on first render
cd ../founder-content-api && npm run db:migrate

# smoke test without DB/S3: prompt → storyboard → voice → MP4 in ./reel-smoke
npm run smoke:reel -- "Explain Kafka with a food delivery example" --language=hinglish --style=minimal_motion

# full app: API + worker + frontend (worker must share a disk with the API when S3 is not configured)
npm run dev
npx tsx --env-file=.env src/workers/reelRenderWorker.ts   # or, with env exported: npm run worker:reel-renders
```

In the app, the normal loop is: generate storyboard → edit/regenerate → approve storyboard → render → watch and
mark reviewed → use `Share reel` (native file sharing where supported, otherwise MP4 download plus copied caption).

To enable the optional YouTube handoff, create a Google OAuth web client with the YouTube Data API enabled and set
`YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, and `YOUTUBE_REDIRECT_URI` (the callback is
`/api/reel-studio/youtube/callback`). The app requires a reviewed reel before the explicit YouTube publish action.

Remotion Studio for designing scenes against the sample storyboard: `cd apps/reel-renderer && npm run studio`.

## Environment

| Variable | Purpose |
| --- | --- |
| `REEL_STORYBOARD_MODEL` | Model for the director (falls back to `OPENAI_MODEL`). A stronger model than `gpt-4o-mini` noticeably improves scripts. |
| `OPENAI_TTS_MODEL` | Defaults to `gpt-4o-mini-tts` (supports accent/tone instructions), falls back to `tts-1`. |
| `REEL_RENDERER_DIR` | Path to `apps/reel-renderer` if not the sibling folder. |
| `REEL_RENDER_CONCURRENCY` | Remotion render concurrency (defaults to `1` for small Render workers; increase only on a larger worker). |
| `REEL_MEDIA_SIGNING_SECRET` | Signs local-dev media URLs (falls back to `SOCIAL_AUTH_STATE_SECRET`). |
| `S3_MEDIA_BUCKET`, `AWS_*` | When set, reels and posters are stored in S3 under `<prefix>/<businessId>/reels/<projectId>/`. |
| `REEL_RENDER_REQUIRES_S3` | Set to `true` on deployed API/worker services so a missing S3 configuration fails fast instead of using isolated local disk. |

## Deployment notes

- The existing Render worker needs `apps/reel-renderer` installed next to the API (`npm install` in both) and the
  system libraries Chrome Headless Shell needs. Its command is `npm run worker:all`, which runs shared queues and
  Reel Studio renders in the same service. A Docker worker (e.g. `node:22-bookworm` + Chrome deps) remains the
  safest production path if Render's native runtime cannot launch Chrome.
- Production must use S3: the local media fallback only works when API and worker share a filesystem.
- Set `REEL_RENDER_REQUIRES_S3=true` on both Render services. The Reel Worker and API then fail fast when S3 is
  missing, instead of completing a render that the API cannot later serve. The worker logs a safe storage diagnostic
  showing `mode`, bucket, region, and whether the key/secret are present; it never logs credential values.
- The IAM principal used by the API and Reel worker must be able to read rendered media. At minimum, grant
  `s3:PutObject` and `s3:GetObject` on `arn:aws:s3:::<bucket>/workspaces/*`; add `s3:DeleteObject` if the
  application should remove old media. `s3:ListBucket` on the bucket is optional and can be restricted to the
  `workspaces/` prefix. Keep the bucket private; the API uses presigned URLs for browser playback.
- Fonts load from Google Fonts at render time, so the worker needs outbound internet (it already calls OpenAI).
- S3 bucket CORS must allow `GET` from the frontend origin for the in-page download button; otherwise it opens the
  file in a new tab.
- Remotion is free for individuals and small companies; check the current Remotion license before charging customers.

## Known limits (v1)

- Captions are timed by character share within each scene's audio, not word-level timestamps.
- No background music track yet.
- Language, duration and audience are fixed once a storyboard exists (start a new reel to change them); style,
  voice, captions and handle can change before each render.
