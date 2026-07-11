# Database Migrations

This API uses raw Postgres SQL migrations stored in `db/migrations`.

Migration workflow:

1. Set `DATABASE_URL` and, when needed, `DATABASE_SSL_MODE`.
2. Run `npm run db:migrate` from `apps/founder-content-api`.
3. The runner applies pending `.sql` files in filename order and records them in `schema_migrations`.
4. Re-running is safe. Already applied files are skipped, and checksum mismatches fail fast.

Useful commands:

- `npm run db:migrate`
- `npm run db:migrate:status`
- `npm run db:bootstrap-ledger`

Notes:

- The migrations are intentionally plain SQL so they can be reviewed and applied directly with `psql` if needed.
- The runner only tracks files in this directory. If a migration file changes after it has already been applied, fix the drift before continuing.
- On a database that predates this runner, use `npm run db:bootstrap-ledger` once before relying on status output.
- The initial foundation is split across `001_auth_business_foundation.sql` and `002_competitive_intelligence_foundation.sql`.
