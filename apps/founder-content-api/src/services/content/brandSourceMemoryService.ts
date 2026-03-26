import type {
  ContentIngestionItem,
  SavedContentSource,
} from "../../../../../packages/shared-types/index.ts";
import type { QueryResultRow } from "pg";
import { queryDb } from "../db/client.ts";

interface BrandSourceItemRow extends QueryResultRow {
  id: string;
  business_id: string;
  source_type: SavedContentSource["sourceType"];
  source_url: string;
  label: string;
  title: string | null;
  extracted_text: string;
  metadata_json: unknown;
  last_fetched_at: Date | string;
  updated_at: Date | string;
}

const MAX_SOURCE_CONTEXT_ITEMS = 3;
const MAX_SOURCE_CONTEXT_LENGTH = 2400;
const MAX_SOURCE_ITEM_LENGTH = 900;

function normalizeOptional(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  const truncated = value.slice(0, maxLength);
  const lastSpaceIndex = truncated.lastIndexOf(" ");
  return (lastSpaceIndex > 120 ? truncated.slice(0, lastSpaceIndex) : truncated).trim();
}

function toIsoString(value: Date | string): string {
  return new Date(value).toISOString();
}

function mapSavedSource(row: BrandSourceItemRow): SavedContentSource {
  return {
    id: row.id,
    businessId: row.business_id,
    sourceType: row.source_type,
    sourceUrl: row.source_url,
    label: row.label,
    title: row.title ?? undefined,
    extractedText: row.extracted_text,
    lastFetchedAt: toIsoString(row.last_fetched_at),
    updatedAt: toIsoString(row.updated_at),
    metadata:
      row.metadata_json && typeof row.metadata_json === "object"
        ? (row.metadata_json as SavedContentSource["metadata"])
        : undefined,
  };
}

function resolveStoredSourceUrl(item: ContentIngestionItem): string | undefined {
  return normalizeOptional(item.metadata?.finalUrl)
    ?? normalizeOptional(item.metadata?.url);
}

export async function listSavedContentSources(businessId: string): Promise<SavedContentSource[]> {
  const result = await queryDb<BrandSourceItemRow>(
    `
      select
        id,
        business_id,
        source_type,
        source_url,
        label,
        title,
        extracted_text,
        metadata_json,
        last_fetched_at,
        updated_at
      from brand_source_items
      where business_id = $1
      order by updated_at desc
    `,
    [businessId],
  );

  return result.rows.map(mapSavedSource);
}

export async function upsertSavedContentSources(
  businessId: string,
  items: ContentIngestionItem[],
): Promise<SavedContentSource[]> {
  const persisted: SavedContentSource[] = [];

  for (const item of items) {
    const sourceUrl = resolveStoredSourceUrl(item);

    if (!sourceUrl) {
      continue;
    }

    const result = await queryDb<BrandSourceItemRow>(
      `
        insert into brand_source_items (
          business_id,
          source_type,
          source_url,
          label,
          title,
          extracted_text,
          metadata_json,
          last_fetched_at
        ) values (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7::jsonb,
          now()
        )
        on conflict (business_id, source_url)
        do update set
          source_type = excluded.source_type,
          label = excluded.label,
          title = excluded.title,
          extracted_text = excluded.extracted_text,
          metadata_json = excluded.metadata_json,
          last_fetched_at = now(),
          updated_at = now()
        returning
          id,
          business_id,
          source_type,
          source_url,
          label,
          title,
          extracted_text,
          metadata_json,
          last_fetched_at,
          updated_at
      `,
      [
        businessId,
        item.sourceType,
        sourceUrl,
        item.label,
        normalizeOptional(item.title),
        truncateText(item.rawText, 12_000),
        JSON.stringify(item.metadata ?? {}),
      ],
    );

    persisted.push(mapSavedSource(result.rows[0]));
  }

  return persisted;
}

export async function buildSavedSourceMemoryContext(businessId?: string): Promise<string | undefined> {
  const normalizedBusinessId = normalizeOptional(businessId);

  if (!normalizedBusinessId) {
    return undefined;
  }

  const sources = await listSavedContentSources(normalizedBusinessId);

  if (sources.length === 0) {
    return undefined;
  }

  const segments = sources
    .slice(0, MAX_SOURCE_CONTEXT_ITEMS)
    .map((source) => {
      const headline = source.title?.trim() || source.label;
      const excerpt = truncateText(source.extractedText, MAX_SOURCE_ITEM_LENGTH);
      return `${headline}\n${excerpt}`;
    });

  const combined = [
    "Saved brand sources:",
    ...segments,
  ].join("\n\n");

  return truncateText(combined, MAX_SOURCE_CONTEXT_LENGTH);
}
