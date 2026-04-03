import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";
import { HttpError, toErrorContext } from "../../utils/http.ts";
import { logError, logInfo } from "../../utils/logger.ts";

let pool: Pool | null = null;
const tableColumnsCache = new Map<string, Promise<Set<string>>>();

function resolveDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL?.trim();

  if (!databaseUrl) {
    throw new HttpError(500, "database_not_configured", "DATABASE_URL is not configured.");
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

function createPool(): Pool {
  const connectionString = resolveDatabaseUrl();
  const ssl = resolveSslConfig();
  const connectionTimeoutMillis = resolveTimeoutMs("DATABASE_CONNECTION_TIMEOUT_MS", 10_000);
  const queryTimeoutMillis = resolveTimeoutMs("DATABASE_QUERY_TIMEOUT_MS", 15_000);
  const nextPool = new Pool({
    connectionString,
    ssl,
    connectionTimeoutMillis,
    query_timeout: queryTimeoutMillis,
    statement_timeout: queryTimeoutMillis,
  });

  nextPool.on("error", (error: Error) => {
    logError("Unexpected Postgres pool error.", toErrorContext(error));
  });

  logInfo("Initialized Postgres pool.", {
    sslEnabled: Boolean(ssl),
    connectionTimeoutMillis,
    queryTimeoutMillis,
  });

  return nextPool;
}

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export function getDbPool(): Pool {
  if (!pool) {
    pool = createPool();
  }

  return pool;
}

export async function queryDb<TRow extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<QueryResult<TRow>> {
  try {
    return await getDbPool().query<TRow>(text, values);
  } catch (error) {
    logError("Database query failed.", {
      statement: text.replace(/\s+/g, " ").trim().slice(0, 180),
      ...toErrorContext(error),
    });
    throw error;
  }
}

export async function getTableColumnSet(
  tableName: string,
  schemaName = "public",
): Promise<Set<string>> {
  const cacheKey = `${schemaName}.${tableName}`;
  const cached = tableColumnsCache.get(cacheKey);

  if (cached) {
    return new Set(await cached);
  }

  const pending = queryDb<{ column_name: string }>(
    `
      select column_name
      from information_schema.columns
      where table_schema = $1
        and table_name = $2
    `,
    [schemaName, tableName],
  )
    .then((result) => new Set(result.rows.map((row) => row.column_name)))
    .catch((error) => {
      tableColumnsCache.delete(cacheKey);
      throw error;
    });

  tableColumnsCache.set(cacheKey, pending);
  return new Set(await pending);
}

export async function withDbClient<TResult>(
  callback: (client: PoolClient) => Promise<TResult>,
): Promise<TResult> {
  const client = await getDbPool().connect();

  try {
    return await callback(client);
  } finally {
    client.release();
  }
}

export async function withDbTransaction<TResult>(
  callback: (client: PoolClient) => Promise<TResult>,
): Promise<TResult> {
  return withDbClient(async (client) => {
    await client.query("BEGIN");

    try {
      const result = await callback(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
}
