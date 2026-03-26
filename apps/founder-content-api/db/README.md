# Database Scaffolding

The backend is still pre-database, so the SQL in this folder is the canonical starting point for the
auth and business-tenancy foundation.

Current approach:

- raw Postgres SQL migrations
- AWS Postgres target
- application logic still scaffolded in memory until a real Postgres client is added

Initial migration:

- `migrations/001_auth_business_foundation.sql`
- `migrations/002_competitive_intelligence_foundation.sql`

Next recommended step:

- add a Postgres client and migration runner
- replace the in-memory auth/business service with repository-backed implementations
- replace the in-memory competitive intelligence store with repository-backed implementations
- keep route contracts unchanged while swapping persistence layers
