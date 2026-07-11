# Database Migration Runbook

## Purpose

This runbook is the operational path for applying and tracking Postgres schema migrations in FounderContent AI.

Use it when:

- setting up a new local database
- moving changes into dev or production
- backfilling an older database that predates the migration ledger
- checking whether a migration file already landed

## Migration Tooling

The API owns the migration runner:

- [apps/founder-content-api/scripts/applyMigrations.ts](../../apps/founder-content-api/scripts/applyMigrations.ts)

Package scripts:

- `npm run db:migrate`
- `npm run db:migrate:status`
- `npm run db:bootstrap-ledger`

Ledger table:

- `schema_migrations`

## Local Workflow

Use this when you are working against a local Postgres instance.

1. Open `apps/founder-content-api/.env` and set `DATABASE_URL`.
2. Set `DATABASE_SSL_MODE=disable` for local Postgres without TLS.
3. Change into `apps/founder-content-api`.
4. Run `npm run db:migrate`.
5. Run `npm run db:migrate:status` if you want to confirm the final state.

Example:

```bash
cd apps/founder-content-api
npm run db:migrate
npm run db:migrate:status
```

## Dev Workflow

Use this for shared development databases.

1. Confirm the target database is the intended dev instance.
2. Confirm `DATABASE_URL` and `DATABASE_SSL_MODE` point to that instance.
3. Run `npm run db:migrate`.
4. If the database already existed before the runner, run `npm run db:bootstrap-ledger` once first.
5. Re-run `npm run db:migrate:status` to confirm the applied list.

Important rules:

- never edit an already-applied migration file in place
- add a new numbered SQL file instead
- keep filename order stable so the runner can apply the chain deterministically

## Production Workflow

Use this for the live deployed database.

1. Verify the current deploy is healthy.
2. Back up or snapshot the database before the migration window.
3. Set the production `DATABASE_URL` in the shell or deployment environment.
4. If the production database predates the ledger, run `npm run db:bootstrap-ledger` once.
5. Run `npm run db:migrate`.
6. Run `npm run db:migrate:status`.
7. Spot-check the schema change or application path that depends on the migration.

Recommended checks after production migration:

- confirm `schema_migrations` contains the new file
- confirm the related table or column exists
- confirm the API route or worker that depends on the migration still starts cleanly

## Older Database Recovery

If a database already has the schema but does not yet have `schema_migrations`:

1. Do not reapply SQL blindly.
2. Run `npm run db:bootstrap-ledger` once.
3. Confirm `schema_migrations` now has one row per migration file.
4. From that point on, use `npm run db:migrate` normally.

This is the correct path for the current deployed database if you are bringing it under the new runner.

## Failure Handling

If migration application fails:

1. Read the error and identify the file that failed.
2. Fix the database or SQL issue.
3. Re-run `npm run db:migrate`.
4. If the failure happened after a partial deploy and the ledger was not written, the runner will retry the failed file.

If the runner reports a checksum mismatch:

- stop and inspect the file
- do not edit the applied migration in place unless you are deliberately rebuilding the database from scratch
- add a new migration instead

## Why This Helps

The runner and ledger give us:

- deterministic ordering
- idempotent reruns
- a visible audit trail in `schema_migrations`
- a safe path for older deployed databases
- a single command path for local, dev, and production environments
