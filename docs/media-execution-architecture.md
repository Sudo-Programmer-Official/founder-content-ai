# Media Execution Architecture

## Goal

FounderContent AI is not a media platform.

It is a content execution system where media is optional support for publishing quality, not the core product surface.

The primary rule is:

- planner and scheduling must work for text-only posts
- media is an optional attachment layer
- media storage and media publishing are separate concerns

## Core Storage Rule

Store these separately:

- post content and lifecycle in the application database
- post media metadata in the application database
- raw binary media in S3
- LinkedIn upload URNs only at publish time

Do not store media binaries in Postgres.

Do not treat LinkedIn media URNs as durable source-of-truth records.

## Stack Decision

The media stack for this repository is:

- auth: Firebase
- app data: Postgres
- media object storage: AWS S3
- publish-time destination upload: LinkedIn media APIs

S3 is the preferred storage layer because:

- the backend already owns scheduling and publishing
- direct-to-S3 uploads fit the backend-worker architecture
- cost is predictable for a text-first LinkedIn publishing tool

Firebase Storage is intentionally not the primary media layer for this product.

## Bucket Structure

Use one bucket for post media.

Recommended object layout:

```text
founder-content-media/
  workspaces/
    {workspaceId}/
      posts/
        {postId}/
          original/
            {timestamp}_{randomId}.{ext}
          processed/
            {timestamp}_{randomId}_compressed.{ext}
            {timestamp}_{randomId}_thumb.{ext}
```

Why this structure:

- workspace isolation is explicit
- post cleanup is simple
- original and processed assets are clearly separated
- naming collisions are avoided

## File Naming

Do not trust user-provided file names.

Use generated file names only:

```text
{timestamp}_{randomId}.{ext}
```

Example:

```text
1711737283_a8f3k2.jpg
```

## Upload Flow

Media upload must use presigned S3 URLs.

### Step 1

Frontend requests an upload URL from the backend:

`POST /api/media/upload-url`

Request:

```json
{
  "businessId": "workspace_uuid",
  "postId": "post_uuid",
  "fileType": "image/jpeg"
}
```

Response:

```json
{
  "uploadUrl": "https://...",
  "storageKey": "workspaces/{workspaceId}/posts/{postId}/original/1711737283_a8f3k2.jpg",
  "storageUrl": "s3://founder-content-media/workspaces/{workspaceId}/posts/{postId}/original/1711737283_a8f3k2.jpg",
  "expiresAt": "2026-03-29T18:30:00.000Z"
}
```

### Step 2

Frontend uploads directly to S3 using the presigned URL.

### Step 3

Frontend confirms the uploaded asset with the backend:

`POST /api/post-assets`

This creates the metadata row after upload completes.

### Step 4

Backend marks the asset as:

- `uploaded`
- then optionally `processing`
- then `ready`

Publishing only uses assets in `ready`.

## Database Model

Phase 2 media support should introduce a dedicated asset table.

Recommended schema:

```text
post_assets
- id
- post_id
- business_id
- type                -- image | video
- source              -- upload | generated
- storage_key
- storage_url
- mime_type
- size_bytes
- order_index
- status              -- uploaded | processing | ready | failed
- created_at
- updated_at
```

Optional later:

- thumbnail_url
- width
- height
- duration_seconds
- original_file_name
- linked_destination_asset_id

## Supported Media Types

Keep v1 narrow.

### v1

- text only
- text + link
- text + image attachments

### v1.5

- one video attachment

### Later

- documents
- richer carousel asset handling
- AI-generated visual assets

Recommended allowed MIME types:

- `image/jpeg`
- `image/png`
- `image/webp`
- `video/mp4` later

## Media Limits

Keep limits strict.

Recommended defaults:

- maximum 10 images per post
- maximum 5 MB per image
- maximum 1 video per post later
- maximum 100 MB per video later

The planner should stay usable even when media is omitted.

## Planner Rule

The planner is not the media editor.

The planner should answer:

- what is going out
- where
- when
- whether it is safe to publish

Planner cards should only show compact indicators:

- platform badge
- post status
- scheduled time
- media indicator like `📎`
- link indicator like `🔗`
- paused state when relevant

Do not render large media thumbnails in the weekly or monthly grid.

## LinkedIn Publish Flow

LinkedIn does not accept raw S3 URLs as publishable media.

Publish-time flow for media posts:

1. validate scheduled post is publishable
2. validate every required asset is `ready`
3. initialize upload with LinkedIn media API
4. stream or upload the binary from S3 to LinkedIn upload URL
5. receive LinkedIn media URN
6. create the final LinkedIn post using that URN
7. mark the scheduled post as `posted`

For image posts, use LinkedIn's Images API and Posts API.

Reference:

- `POST /rest/images?action=initializeUpload`
- then upload binary to returned upload URL
- then create post with returned image URN

Important rule:

- do not store LinkedIn asset URNs as permanent source-of-truth media records
- generate them at publish time from S3-backed assets

This avoids stale destination asset references and keeps retries clean.

## Publish-Time Safety Checks

Before automatic publishing:

- post status must be `scheduled`
- current UTC must be greater than or equal to `scheduled_at`
- selected workspace channel identity must exist
- token must be valid
- required media assets must be `ready`
- post must not be `paused`
- post must not be `canceled`
- media type and count must be valid for the channel

Then transition:

- `scheduled -> processing -> posted`
- or `scheduled -> failed`

## Cleanup Rule

Avoid orphaned storage.

Recommended cleanup worker:

- run daily
- find draft or canceled posts with unused assets older than the retention window
- delete the S3 objects
- mark or remove the metadata rows

Recommended initial retention:

- 7 days for abandoned draft assets

## Scope Boundary

Do not block planner delivery on AI media generation.

The planner and scheduler must work completely for text-only posts before any image generation or heavier asset processing is added.

Media should improve execution quality, not gate execution reliability.

## Implementation Phases

### Phase 1

- add S3 upload configuration
- add presigned upload endpoint
- add `post_assets` table
- add text-first planner support with media indicators only

### Phase 2

- image upload and preview
- attach uploaded images to posts
- LinkedIn publish flow for image posts
- readiness checks before publish

### Phase 3

- video support
- processed asset variants
- generated visuals
- richer LinkedIn media workflows

## Product Rule

Media is a support system for content execution.

It is not the product center.

The planner, scheduler, and publishing loop must remain reliable even when a user never uploads a single asset.
