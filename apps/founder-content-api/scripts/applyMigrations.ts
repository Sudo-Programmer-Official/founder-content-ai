import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

type MigrationRecord = {
  version: string;
  checksum: string;
  applied_at: string;
};

function loadEnvFromFile(): void {
  const filePath = new URL("../.env", import.meta.url);
  const raw = readFileSync(filePath, "utf8");

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");

    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1);

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function resolveDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL?.trim();

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to run migrations.");
  }

  return databaseUrl;
}

function resolveSslConfig(): false | { rejectUnauthorized: false } {
  return process.env.DATABASE_SSL_MODE === "disable" ? false : { rejectUnauthorized: false };
}

function resolveTimeoutMs(envName: string, fallbackMs: number): number {
  const rawValue = process.env[envName]?.trim();

  if (!rawValue) {
    return fallbackMs;
  }

  const parsedValue = Number.parseInt(rawValue, 10);

  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return fallbackMs;
  }

  return parsedValue;
}

function parseArgs(argv: string[]): { statusOnly: boolean; bootstrapLedger: boolean } {
  return {
    statusOnly: argv.includes("--status"),
    bootstrapLedger: argv.includes("--bootstrap-ledger"),
  };
}

function checksum(contents: string): string {
  return createHash("sha256").update(contents, "utf8").digest("hex");
}

function migrationDir(): string {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(scriptDir, "../db/migrations");
}

async function ensureSchemaMigrationsTable(client: Client): Promise<void> {
  await client.query(`
    create table if not exists schema_migrations (
      version text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    )
  `);
}

async function countMigrationRecords(client: Client): Promise<number> {
  const result = await client.query<{ count: string }>(`
    select count(*)::text as count
    from schema_migrations
  `);

  return Number.parseInt(result.rows[0]?.count ?? "0", 10);
}

async function loadMigrationRecords(client: Client): Promise<Map<string, MigrationRecord>> {
  const result = await client.query<MigrationRecord>(`
    select version, checksum, applied_at
    from schema_migrations
    order by version asc
  `);

  return new Map(result.rows.map((row) => [row.version, row]));
}

async function readMigrationFiles(): Promise<
  Array<{ version: string; contents: string; checksum: string }>
> {
  const dir = migrationDir();
  const entries = await readdir(dir, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => {
      const filePath = path.join(dir, entry.name);
      const contents = readFileSync(filePath, "utf8");

      return {
        version: entry.name,
        contents,
        checksum: checksum(contents),
      };
    })
    .sort((left, right) => left.version.localeCompare(right.version));
}

async function applyMigration(
  client: Client,
  migration: { version: string; contents: string; checksum: string },
): Promise<void> {
  await client.query("BEGIN");

  try {
    await client.query(migration.contents);
    await client.query(
      `
        insert into schema_migrations (version, checksum)
        values ($1, $2)
      `,
      [migration.version, migration.checksum],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function bootstrapMigrationLedger(
  client: Client,
  migrations: Array<{ version: string; contents: string; checksum: string }>,
): Promise<void> {
  await client.query("BEGIN");

  try {
    const existingCount = await countMigrationRecords(client);

    if (existingCount > 0) {
      throw new Error(
        `schema_migrations already contains ${existingCount} record(s). Use db:migrate instead of bootstrapping.`,
      );
    }

    for (const migration of migrations) {
      await client.query(
        `
          insert into schema_migrations (version, checksum)
          values ($1, $2)
        `,
        [migration.version, migration.checksum],
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function main(): Promise<void> {
  loadEnvFromFile();

  const args = parseArgs(process.argv.slice(2));
  const client = new Client({
    connectionString: resolveDatabaseUrl(),
    ssl: resolveSslConfig(),
    connectionTimeoutMillis: resolveTimeoutMs("DATABASE_CONNECTION_TIMEOUT_MS", 10_000),
    query_timeout: resolveTimeoutMs("DATABASE_QUERY_TIMEOUT_MS", 15_000),
  });

  try {
    await client.connect();
    await ensureSchemaMigrationsTable(client);

    const appliedRecords = await loadMigrationRecords(client);
    const migrations = await readMigrationFiles();

    const pendingMigrations = migrations.filter((migration) => !appliedRecords.has(migration.version));
    const mismatchedMigrations = migrations.filter((migration) => {
      const applied = appliedRecords.get(migration.version);
      return applied ? applied.checksum !== migration.checksum : false;
    });

    if (mismatchedMigrations.length > 0) {
      const details = mismatchedMigrations
        .map((migration) => {
          const applied = appliedRecords.get(migration.version);
          return `${migration.version} (applied=${applied?.checksum ?? "n/a"}, current=${migration.checksum})`;
        })
        .join(", ");

      throw new Error(`Migration checksum mismatch detected: ${details}`);
    }

    console.log(
      `Found ${migrations.length} migration files. ${appliedRecords.size} recorded, ${pendingMigrations.length} pending.`,
    );

    if (args.bootstrapLedger) {
      await bootstrapMigrationLedger(client, migrations);
      console.log(`Bootstrapped schema_migrations with ${migrations.length} migration(s).`);
      return;
    }

    if (args.statusOnly) {
      for (const migration of migrations) {
        const applied = appliedRecords.get(migration.version);
        console.log(`${applied ? "applied" : "pending"} ${migration.version}`);
      }

      return;
    }

    for (const migration of pendingMigrations) {
      console.log(`Applying ${migration.version}...`);
      await applyMigration(client, migration);
      console.log(`Applied ${migration.version}.`);
    }

    if (pendingMigrations.length === 0) {
      console.log("No pending migrations.");
    } else {
      console.log(`Applied ${pendingMigrations.length} migration(s).`);
    }
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error("Migration run failed.");
  console.error(error);
  process.exitCode = 1;
});
