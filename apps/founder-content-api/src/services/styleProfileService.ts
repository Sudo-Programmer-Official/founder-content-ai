import type { QueryResultRow } from "pg";
import { isDatabaseConfigured, queryDb } from "./db/client.ts";

interface UserStyleProfileRow extends QueryResultRow {
  selected_tones: unknown;
  content_types: unknown;
  edit_count: string | number;
  accepted_output_count: string | number;
}

export interface StyleSignalInput {
  userId?: string;
  businessId?: string;
  tone?: string;
  contentType?: string;
  acceptedOutput?: boolean;
  edited?: boolean;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0);
}

function mergeRecentValues(existing: string[], nextValue: string | undefined, maxItems = 6): string[] {
  const normalizedNextValue = nextValue?.trim();

  if (!normalizedNextValue) {
    return existing.slice(0, maxItems);
  }

  return [normalizedNextValue, ...existing.filter((value) => value !== normalizedNextValue)].slice(
    0,
    maxItems,
  );
}

function toNumber(value: string | number): number {
  return typeof value === "number" ? value : Number.parseInt(value, 10) || 0;
}

export async function recordStyleSignal(input: StyleSignalInput): Promise<void> {
  if (!isDatabaseConfigured() || !input.userId || !input.businessId) {
    return;
  }

  const existingResult = await queryDb<UserStyleProfileRow>(
    `
      select
        selected_tones,
        content_types,
        edit_count,
        accepted_output_count
      from user_style_profiles
      where user_id = $1
        and business_id = $2
      limit 1
    `,
    [input.userId, input.businessId],
  );

  const existingProfile = existingResult.rows[0];
  const nextTones = mergeRecentValues(
    toStringArray(existingProfile?.selected_tones),
    input.tone,
  );
  const nextContentTypes = mergeRecentValues(
    toStringArray(existingProfile?.content_types),
    input.contentType,
  );
  const nextEditCount = toNumber(existingProfile?.edit_count ?? 0) + (input.edited ? 1 : 0);
  const nextAcceptedOutputCount =
    toNumber(existingProfile?.accepted_output_count ?? 0) + (input.acceptedOutput ? 1 : 0);

  await queryDb(
    `
      insert into user_style_profiles (
        user_id,
        business_id,
        selected_tones,
        content_types,
        edit_count,
        accepted_output_count,
        last_event_at,
        updated_at
      ) values (
        $1,
        $2,
        $3::jsonb,
        $4::jsonb,
        $5,
        $6,
        now(),
        now()
      )
      on conflict (user_id, business_id)
      do update set
        selected_tones = excluded.selected_tones,
        content_types = excluded.content_types,
        edit_count = excluded.edit_count,
        accepted_output_count = excluded.accepted_output_count,
        last_event_at = now(),
        updated_at = now()
    `,
    [
      input.userId,
      input.businessId,
      JSON.stringify(nextTones),
      JSON.stringify(nextContentTypes),
      nextEditCount,
      nextAcceptedOutputCount,
    ],
  );
}
