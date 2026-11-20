import { readFileSync } from "node:fs";
import { Client } from "pg";

function loadEnvFromFile(): void {
  const filePath = new URL("../.env", import.meta.url);

  try {
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
  } catch {
    // Render and CI provide environment variables directly.
  }
}

function readArgument(name: string): string | undefined {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((argument) => argument.startsWith(prefix));
  return value?.slice(prefix.length).trim() || undefined;
}

function resolveSslConfig(): false | { rejectUnauthorized: false } {
  return process.env.DATABASE_SSL_MODE === "disable" ? false : { rejectUnauthorized: false };
}

async function main(): Promise<void> {
  loadEnvFromFile();

  const databaseUrl = process.env.DATABASE_URL?.trim();
  const email = readArgument("email")?.toLowerCase();
  const subject = readArgument("subject");

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  if (!email || !subject) {
    throw new Error("Usage: npm run mcp:link-auth0 -- --email=user@example.com --subject='auth0|subject'");
  }

  const client = new Client({ connectionString: databaseUrl, ssl: resolveSslConfig() });
  await client.connect();

  try {
    const userResult = await client.query<{ id: string; email: string; status: string }>(
      `
        select id, email, status
        from users
        where lower(email) = $1
        limit 1
      `,
      [email],
    );
    const user = userResult.rows[0];

    if (!user) {
      throw new Error(`No Founder Content user exists for ${email}.`);
    }

    if (user.status !== "active") {
      throw new Error(`Founder Content user ${email} is not active.`);
    }

    const existingResult = await client.query<{ user_id: string }>(
      `
        select user_id
        from auth_identities
        where provider = 'oauth'
          and provider_user_id = $1
        limit 1
      `,
      [subject],
    );
    const existing = existingResult.rows[0];

    if (existing && existing.user_id !== user.id) {
      throw new Error("That Auth0 subject is already linked to a different Founder Content user.");
    }

    await client.query(
      `
        insert into auth_identities (user_id, provider, provider_user_id, email)
        values ($1, 'oauth', $2, $3)
        on conflict (provider, provider_user_id)
        do update set user_id = excluded.user_id, email = excluded.email
      `,
      [user.id, subject, user.email],
    );

    console.log(`Linked Auth0 subject ${subject} to Founder Content user ${user.email}.`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
