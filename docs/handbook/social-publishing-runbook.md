# Social Publishing Runbook

## Purpose

This runbook captures the working production setup for multi-platform publishing in FounderContent AI.

It is intentionally operational, not aspirational.

Use it when:

- setting up a new environment
- debugging Instagram media delivery
- verifying publish history and retry behavior
- checking whether website routing and media routing are separated correctly

## Working Host Layout

Keep website traffic and publish-media traffic on different hosts.

Recommended layout:

- `foundercontent.ai`
  - forwards to `https://www.foundercontent.ai`
- `www.foundercontent.ai`
  - main website or app entrypoint
- `api.foundercontent.ai`
  - backend API
- `media.foundercontent.ai`
  - dedicated public media host for publishable assets

Important rule:

- do not reuse `www.foundercontent.ai` as the Instagram media host

The media host should return direct files, not app HTML, redirects, or website content.

## Backend Environment

Required media and publishing envs:

- `AWS_REGION`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `S3_MEDIA_BUCKET`
- `S3_MEDIA_PREFIX`
- `S3_MEDIA_PUBLIC_BASE_URL`
- `S3_INSTAGRAM_PUBLIC_PREFIX`
- `S3_INSTAGRAM_PUBLIC_BASE_URL`
- `META_APP_ID`
- `META_APP_SECRET`
- `META_REDIRECT_URI`
- `META_GRAPH_VERSION`
- `META_SCOPE`
- `META_AUTH_SESSION_SECRET`

Recommended production values:

```env
S3_MEDIA_PREFIX=workspaces
S3_MEDIA_PUBLIC_BASE_URL=https://d1dkmcyl4t10d7.cloudfront.net
S3_INSTAGRAM_PUBLIC_PREFIX=public-instagram
S3_INSTAGRAM_PUBLIC_BASE_URL=https://media.foundercontent.ai
```

Notes:

- `S3_MEDIA_PUBLIC_BASE_URL` is the general public asset host
- `S3_INSTAGRAM_PUBLIC_BASE_URL` is the Instagram-specific public host
- the Instagram host should point to a static media CDN distribution, not the website
- `META_REDIRECT_URI` should resolve to the backend callback route on `api.foundercontent.ai`

## Meta OAuth Checklist

When Facebook Login shows a Meta-hosted "Feature Unavailable" screen before redirecting back to FounderContent AI, treat it as a Meta app configuration or review problem first.

Verify:

- the Meta app is in Live mode for the users you are testing with
- the Facebook Login product is enabled on the Meta app
- the Valid OAuth Redirect URI list includes the exact backend callback URL
- the callback URL uses the backend host: `https://api.foundercontent.ai/api/social-auth/meta/callback`
- required app details such as privacy policy, app icon, and contact details are filled in
- Data Use Checkup or any Meta-requested app details are completed in the dashboard
- the testing Facebook account has access to a Facebook Page, because the app expects `/me/accounts` to return pages after login

## Storage Layout

The current media split is:

```text
workspaces/{workspaceId}/posts/{postId}/original/{file}
public-instagram/{workspaceId}/{postId}/{assetId}.jpg
```

Meaning:

- original uploads stay in normal workspace storage
- Instagram publish creates a dedicated JPEG derivative under `public-instagram/*`

## Instagram Publish Flow

Current working flow:

1. user uploads or generates an image asset
2. backend loads the original asset bytes from S3
3. backend creates an Instagram-safe JPEG derivative
4. backend writes that derivative to `public-instagram/{workspaceId}/{postId}/{assetId}.jpg`
5. backend publishes Instagram using `S3_INSTAGRAM_PUBLIC_BASE_URL/public-instagram/...`
6. if needed, the backend can fall back to a compatible public object URL strategy

The derivative path is required because Instagram is stricter than LinkedIn and Facebook about media delivery and image decoding.

## DNS And CDN Rules

Website routing:

- `foundercontent.ai` should 301 redirect to `https://www.foundercontent.ai`
- `www.foundercontent.ai` should point to the real website/app host

Media routing:

- `media.foundercontent.ai` should point to the media CDN distribution
- direct asset URLs like `https://media.foundercontent.ai/public-instagram/test.jpg` must load cleanly in a browser

Do not treat root-domain forwarding as media delivery.

Do not point the website host at a media-only CloudFront distribution.

## Smoke Tests

### 1. Asset Reachability

The media host must return the asset directly:

```bash
curl -I "https://media.foundercontent.ai/public-instagram/test.jpg"
```

Expected:

- `200 OK`
- `Content-Type: image/jpeg`
- valid `Content-Length`
- no redirect
- no auth challenge

### 2. Instagram Control Test

Use the exact IG user and a known-good public JPEG:

```bash
curl -X POST "https://graph.facebook.com/v21.0/{ig-user-id}/media" \
  --data-urlencode "image_url=https://media.foundercontent.ai/public-instagram/test.jpg" \
  --data-urlencode "access_token={instagram-access-token}"
```

Expected:

- JSON response containing an `id`

This isolates:

- account validity
- token validity
- media-host compatibility

### 3. In-App Publish Test

Use the app to publish one post to:

- LinkedIn
- Facebook
- Instagram

Expected behavior:

- each platform gets its own result
- partial failures do not erase successful platforms
- retry only re-runs failed platforms

## Publish Ledger

The current system-of-record for publish history is:

- `publish_attempts`
- `publish_attempt_platforms`

Behavior:

- one parent attempt per publish action
- one child row per platform
- parent status derives from child statuses
- retries create a new attempt linked to the failed platform rows they replace

Related APIs:

- `POST /api/publish-attempts`
- `GET /api/publish-attempts`
- `GET /api/publish-attempts/:publishAttemptId`
- `POST /api/publish-attempts/:publishAttemptId/retry-failed`

## Result And History UX

Current UI expectations:

- result page shows per-platform status chips
- success states can show platform links
- partial failure changes the action to `Retry failed only`
- history page reads from the publish ledger

This is intentional. It prevents duplicate reposts and preserves a clean audit trail.

## Troubleshooting Order

When Instagram fails, debug in this order:

1. confirm the media host URL loads directly in a browser
2. run `curl -I` against the exact asset URL
3. run a direct Graph `/media` control test with the same URL
4. inspect backend logs for:
   - final media URL
   - MIME type
   - content length
   - Meta Graph error code and subcode
5. inspect publish history to confirm whether the failure is isolated to one platform

Avoid changing many variables at once.

Use the control test to separate:

- account/token problems
- media-host problems
- asset-encoding problems

## Known Lessons

- a URL that works in the browser is not automatically accepted by Meta crawlers
- signed URLs are not acceptable for Instagram publishing
- website hosts and media hosts should stay separate
- original uploaded images should not be trusted as Instagram-ready assets
- publish retries must stay platform-specific

## Security Notes

- rotate any token immediately if it was pasted into a terminal, chat, or screenshot
- keep the main bucket private by default
- expose only the narrow public media path needed for publish-safe assets
- tighten logging after a few successful production publishes, but keep enough metadata to diagnose media URL and Meta Graph failures
