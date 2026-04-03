# Decisions Log

## March 22, 2026

- Identity provider direction: Firebase Auth
- Product database direction: Postgres
- Email provider direction: SES
- Tenant boundary: business, not user
- Team access model: role-based memberships
- Usage tracking must exist before billing enforcement
- Auth implementation order: docs -> schema -> scaffolded routes -> Firebase + Postgres wiring

## April 2, 2026

- Multi-platform publish history direction: one parent `publish_attempts` row plus one child `publish_attempt_platforms` row per platform
- Manual publish and scheduled publish must write to the same publish ledger
- Retry direction: retries create a new attempt and rerun failed platforms only
- Instagram media direction: generate a dedicated public JPEG derivative under `public-instagram/*` instead of publishing original uploads directly
- Host separation direction: website hosts and publish-media hosts must stay separate
- Instagram runtime direction: use a dedicated Instagram media base URL when available and keep the delivery host boring, public, and file-only
