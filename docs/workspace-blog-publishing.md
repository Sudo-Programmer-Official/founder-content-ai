# Workspace Blog Publishing Contract

This document defines how Founder Content AI exports blog-ready markdown so any website in a different workspace/repo can consume it.

## What gets exported

Exporter command writes files to:

- `exports/workspaces/{workspaceSlug}/blogs/*.md`
- `exports/workspaces/{workspaceSlug}/blogs/index.json`

Each markdown file includes frontmatter fields like:

- `title`
- `slug`
- `date`
- `summary`
- `tags`
- `keywords`
- `author`
- `image` (if available)
- `ai_summary` (if available)
- `source_kind`
- `pipeline_stage`
- `updated_at`

## Run exporter (inside `apps/founder-content-api`)

1. Single workspace by slug:

```bash
npm run export:workspace-blogs -- --workspace=sudo-programmer
```

2. Single workspace by UUID:

```bash
npm run export:workspace-blogs -- --workspace=<business-id>
```

3. Export all active workspaces:

```bash
npm run export:workspace-blogs:all
```

4. Override output directory (optional):

```bash
npm run export:workspace-blogs -- --workspace=sudo-programmer --out=/abs/path/exports/workspaces
```

## Required env on exporter side

- `DATABASE_URL` must be configured (same as API runtime).
- Optional: `BLOG_EXPORT_WORKSPACE` for default workspace when running `export:workspace-blogs`.
- Optional: `BLOG_EXPORT_OUT_DIR` to override output root.

## Website-side consumer changes (for future users)

In the website repo that renders blogs:

1. Add/update `blog-publisher.config.json`.
2. Set the workspace key that should be consumed.
3. Point to this founder-content repo path.
4. Keep `workspaceBlogsPathTemplate` as `exports/workspaces/{workspaceKey}/blogs`.

Example config:

```json
{
  "workspaceKey": "sudo-programmer",
  "founderContentRepoPath": "../founder-content-ai",
  "workspaceBlogsPathTemplate": "exports/workspaces/{workspaceKey}/blogs",
  "fallbackBlogsPath": "exports/blogs"
}
```

Then sync from website side:

```bash
npm run sync:founder-content
```

## Multi-tenant behavior

- Every workspace writes to its own isolated folder by `workspaceSlug`.
- Websites can choose any workspace by setting `workspaceKey`.
- Multiple websites can read different workspace folders from the same founder-content deployment.

## Automated export worker

Use this when exports should refresh automatically.

Commands (inside `apps/founder-content-api`):

```bash
npm run worker:blog-exports
```

Run one cycle and exit:

```bash
npm run worker:blog-exports:once
```

Environment variables:

- `BLOG_EXPORT_WORKSPACE`: export only one workspace (slug or business id). If omitted, exports all active workspaces.
- `BLOG_EXPORT_OUT_DIR`: custom output root.
- `BLOG_EXPORT_WORKER_INTERVAL_MS`: polling interval for long-running mode (default 900000 = 15 minutes).
- `BLOG_EXPORT_WORKER_RUN_ONCE`: set `true` to run once and exit.

## One-click publish to website

For local operator flow, use the publish orchestrator from `apps/founder-content-api`.

Sudo Programmer (export + sync):

```bash
npm run publish:sudo-programmer-blog
```

Sudo Programmer (export + sync + website build):

```bash
npm run publish:sudo-programmer-blog:build
```

Generic command:

```bash
npm run publish:workspace-blog -- --workspace=<workspace-slug>
```

Optional overrides:

- `--websiteRoot=/abs/path/to/website-repo`
- `--build`

This command sequence is:
1. Export from Founder Content AI (`exports/workspaces/{workspace}/blogs`)
2. Sync into website blog folder (`apps/website/src/content/blogs`)
3. Optional website build

## UI one-click publish (admin)

Super admins can trigger publishing directly from Founder Content UI:

1. Open `/admin/workspaces`.
2. Select the target workspace card.
3. Click:
- `Publish Blog` for export + sync
- `Publish + Build` for export + sync + website build

Backend endpoint used:

- `POST /api/admin/workspaces/:workspaceId/publish-blog`

Request body:

```json
{
  "runBuild": true
}
```

## Deploy/runtime requirements

For API-server triggered publish to work, the API runtime must have filesystem/process access to the website repo.

Set this env var in API runtime if website path is not the default sibling path:

- `BLOG_WEBSITE_ROOT=/abs/path/to/sudo-programmer-official-website`

## Workspace user flow (new)

Blog publishing is now available in workspace UI (not admin-only), but gated by feature flag.

1. Super admin enables `blog_publishing` for a workspace in `/admin/features`.
2. Workspace member opens `/app/blog`.
3. Use:
- `Publish blog` (publish-state + export + sync)
- `Publish + build` (publish-state + export + sync + website build)
- `Unpublish` by slug

Workspace endpoints:

- `GET /api/workspace/blogs?businessId=<workspace-id>`
- `POST /api/workspace/blogs/publish`
- `POST /api/workspace/blogs/:slug/unpublish`
