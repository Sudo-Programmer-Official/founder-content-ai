import type { QueryResultRow } from "pg";
import {
  DEFAULT_GENERATION_TONE,
  normalizeGenerationToneOverride,
  resolveGenerationToneMode,
} from "../../../../packages/shared-types/index.ts";
import { isDatabaseConfigured, queryDb } from "./db/client.ts";

interface BrandToneRow extends QueryResultRow {
  tone: string | null;
  preferred_tone: string | null;
}

async function loadWorkspaceGenerationTone(businessId: string): Promise<string | undefined> {
  if (!isDatabaseConfigured()) {
    return undefined;
  }

  const result = await queryDb<BrandToneRow>(
    `
      select
        tone,
        preferred_tone
      from brand_profiles
      where business_id = $1
      limit 1
    `,
    [businessId],
  );

  const row = result.rows[0];
  return resolveGenerationToneMode(row?.tone ?? row?.preferred_tone ?? undefined);
}

export async function resolveContentGenerationTone(input: {
  requestedTone?: string | null;
  businessId?: string | null;
}): Promise<string> {
  const requestedTone = normalizeGenerationToneOverride(input.requestedTone);

  if (requestedTone) {
    return requestedTone;
  }

  const businessId = input.businessId?.trim();

  if (businessId) {
    const workspaceTone = await loadWorkspaceGenerationTone(businessId);

    if (workspaceTone) {
      return workspaceTone;
    }
  }

  return DEFAULT_GENERATION_TONE;
}
