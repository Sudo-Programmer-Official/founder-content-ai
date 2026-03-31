import type { PoolClient, QueryResultRow } from "pg";
import type {
  AdminDecisionRuleRecord,
  AdminDecisionRuleScope,
  AdminMediaPresetRecord,
  AdminMediaRegistryOptions,
  AdminMediaRegistryResponse,
  AdminPromptTemplateRecord,
  BusinessMediaProfileType,
  MediaRecommendationContentType,
  MediaRecommendationGoal,
  MediaSuggestionType,
  UpsertAdminDecisionRuleRequest,
  UpsertAdminMediaPresetRequest,
  UpsertAdminPromptTemplateRequest,
} from "../../../../packages/shared-types/index.ts";
import { queryDb, withDbTransaction } from "./db/client.ts";
import { HttpError } from "../utils/http.ts";
import { logInfo } from "../utils/logger.ts";

const BUSINESS_TYPE_OPTIONS: BusinessMediaProfileType[] = ["general", "saas", "daycare", "fitness"];
const CONTENT_TYPE_OPTIONS: MediaRecommendationContentType[] = ["post", "email"];
const GOAL_OPTIONS: MediaRecommendationGoal[] = ["authority", "engagement", "conversion"];
const MEDIA_TYPE_OPTIONS: MediaSuggestionType[] = [
  "quote_card",
  "stat_card",
  "photo_overlay",
  "framework_card",
  "screenshot_highlight",
];
const RULE_SCOPE_OPTIONS: AdminDecisionRuleScope[] = ["global", "business_type", "workspace"];

interface MediaPresetRow extends QueryResultRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  supported_business_types: unknown;
  supported_content_types: unknown;
  supported_goals: unknown;
  media_types: unknown;
  fallback_order: unknown;
  ui_label: string | null;
  priority: number;
  is_active: boolean;
  created_at: Date | string;
  updated_at: Date | string;
}

interface PromptMapRow extends QueryResultRow {
  media_preset_id: string;
  media_type: string;
  prompt_template_id: string;
}

interface PromptTemplateRow extends QueryResultRow {
  id: string;
  slug: string;
  name: string;
  category: string;
  template_body: string;
  variables: unknown;
  notes: string | null;
  version: number;
  is_active: boolean;
  created_at: Date | string;
  updated_at: Date | string;
}

interface DecisionRuleRow extends QueryResultRow {
  id: string;
  rule_name: string;
  rule_scope: AdminDecisionRuleScope;
  business_type: BusinessMediaProfileType | null;
  business_id: string | null;
  business_name: string | null;
  conditions: unknown;
  outputs: unknown;
  priority: number;
  is_active: boolean;
  created_at: Date | string;
  updated_at: Date | string;
}

interface BusinessLookupRow extends QueryResultRow {
  id: string;
}

function toIsoString(value: Date | string): string {
  return new Date(value).toISOString();
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function normalizeSlug(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizePositiveInteger(value: number, fallback: number): number {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(1, Math.round(parsed));
}

function assertAllowedArray<T extends string>(
  values: string[],
  allowed: readonly T[],
  fieldName: string,
): T[] {
  const uniqueValues = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  const invalidValue = uniqueValues.find((value) => !allowed.includes(value as T));

  if (invalidValue) {
    throw new HttpError(400, "admin_registry_invalid_value", `${fieldName} contains an unsupported value: ${invalidValue}.`);
  }

  return uniqueValues as T[];
}

async function executeQuery<TRow extends QueryResultRow>(
  text: string,
  values: unknown[] = [],
  client?: PoolClient,
): Promise<{ rows: TRow[] }> {
  if (client) {
    return client.query<TRow>(text, values);
  }

  return queryDb<TRow>(text, values);
}

async function logAdminAction(
  actorUserId: string | undefined,
  targetType: string,
  targetId: string,
  action: string,
  metadata: Record<string, unknown>,
  client?: PoolClient,
): Promise<void> {
  await executeQuery(
    `
      insert into admin_actions (
        actor_user_id,
        target_type,
        target_id,
        action,
        metadata_json
      ) values (
        $1,
        $2,
        $3,
        $4,
        $5::jsonb
      )
    `,
    [actorUserId ?? null, targetType, targetId, action, JSON.stringify(metadata)],
    client,
  );
}

function buildOptions(promptTemplates: AdminPromptTemplateRecord[]): AdminMediaRegistryOptions {
  return {
    businessTypes: BUSINESS_TYPE_OPTIONS,
    contentTypes: CONTENT_TYPE_OPTIONS,
    goals: GOAL_OPTIONS,
    mediaTypes: MEDIA_TYPE_OPTIONS,
    ruleScopes: RULE_SCOPE_OPTIONS,
    promptTemplateCategories: [...new Set(promptTemplates.map((template) => template.category))].sort(),
  };
}

function mapPromptTemplate(
  row: PromptTemplateRow,
): AdminPromptTemplateRecord {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    category: row.category,
    templateBody: row.template_body,
    variables: normalizeStringArray(row.variables),
    notes: row.notes ?? undefined,
    version: row.version,
    isActive: row.is_active,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function mapDecisionRule(
  row: DecisionRuleRow,
): AdminDecisionRuleRecord {
  return {
    id: row.id,
    ruleName: row.rule_name,
    ruleScope: row.rule_scope,
    businessType: row.business_type ?? undefined,
    businessId: row.business_id ?? undefined,
    businessName: row.business_name ?? undefined,
    conditions: normalizeRecord(row.conditions),
    outputs: normalizeRecord(row.outputs),
    priority: row.priority,
    isActive: row.is_active,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function mapPreset(
  row: MediaPresetRow,
  promptTemplateByMediaType: Partial<Record<MediaSuggestionType, string>>,
): AdminMediaPresetRecord {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description ?? undefined,
    supportedBusinessTypes: normalizeStringArray(row.supported_business_types) as BusinessMediaProfileType[],
    supportedContentTypes: normalizeStringArray(row.supported_content_types) as MediaRecommendationContentType[],
    supportedGoals: normalizeStringArray(row.supported_goals) as MediaRecommendationGoal[],
    mediaTypes: normalizeStringArray(row.media_types) as MediaSuggestionType[],
    fallbackOrder: normalizeStringArray(row.fallback_order) as MediaSuggestionType[],
    uiLabel: row.ui_label ?? undefined,
    priority: row.priority,
    isActive: row.is_active,
    promptTemplateByMediaType,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

async function loadPromptMaps(client?: PoolClient): Promise<Map<string, Partial<Record<MediaSuggestionType, string>>>> {
  const result = await executeQuery<PromptMapRow>(
    `
      select
        media_preset_id,
        media_type,
        prompt_template_id
      from media_preset_prompt_map
      order by media_preset_id asc, media_type asc
    `,
    [],
    client,
  );

  const mapping = new Map<string, Partial<Record<MediaSuggestionType, string>>>();

  for (const row of result.rows) {
    const bucket = mapping.get(row.media_preset_id) ?? {};
    bucket[row.media_type as MediaSuggestionType] = row.prompt_template_id;
    mapping.set(row.media_preset_id, bucket);
  }

  return mapping;
}

async function loadPromptTemplates(client?: PoolClient): Promise<AdminPromptTemplateRecord[]> {
  const result = await executeQuery<PromptTemplateRow>(
    `
      select
        id,
        slug,
        name,
        category,
        template_body,
        variables,
        notes,
        version,
        is_active,
        created_at,
        updated_at
      from prompt_templates
      order by category asc, name asc, version desc
    `,
    [],
    client,
  );

  return result.rows.map(mapPromptTemplate);
}

async function loadDecisionRules(client?: PoolClient): Promise<AdminDecisionRuleRecord[]> {
  const result = await executeQuery<DecisionRuleRow>(
    `
      select
        decision_rules.id,
        decision_rules.rule_name,
        decision_rules.rule_scope,
        decision_rules.business_type,
        decision_rules.business_id,
        businesses.name as business_name,
        decision_rules.conditions,
        decision_rules.outputs,
        decision_rules.priority,
        decision_rules.is_active,
        decision_rules.created_at,
        decision_rules.updated_at
      from decision_rules
      left join businesses
        on businesses.id = decision_rules.business_id
      order by decision_rules.priority asc, decision_rules.created_at asc
    `,
    [],
    client,
  );

  return result.rows.map(mapDecisionRule);
}

async function loadPresets(client?: PoolClient): Promise<AdminMediaPresetRecord[]> {
  const [presetResult, promptMap] = await Promise.all([
    executeQuery<MediaPresetRow>(
      `
        select
          id,
          slug,
          name,
          description,
          supported_business_types,
          supported_content_types,
          supported_goals,
          media_types,
          fallback_order,
          ui_label,
          priority,
          is_active,
          created_at,
          updated_at
        from media_presets
        order by priority asc, created_at asc
      `,
      [],
      client,
    ),
    loadPromptMaps(client),
  ]);

  return presetResult.rows.map((row) => mapPreset(row, promptMap.get(row.id) ?? {}));
}

async function loadRegistry(client?: PoolClient): Promise<AdminMediaRegistryResponse> {
  const [presets, promptTemplates, decisionRules] = await Promise.all([
    loadPresets(client),
    loadPromptTemplates(client),
    loadDecisionRules(client),
  ]);

  return {
    options: buildOptions(promptTemplates),
    presets,
    promptTemplates,
    decisionRules,
  };
}

async function ensurePromptTemplateIdsExist(ids: string[], client?: PoolClient): Promise<void> {
  if (ids.length === 0) {
    return;
  }

  const result = await executeQuery<{ id: string }>(
    `
      select id
      from prompt_templates
      where id = any ($1::uuid[])
    `,
    [ids],
    client,
  );

  const foundIds = new Set(result.rows.map((row) => row.id));
  const missingId = ids.find((id) => !foundIds.has(id));

  if (missingId) {
    throw new HttpError(400, "prompt_template_not_found", `Prompt template ${missingId} was not found.`);
  }
}

async function ensureBusinessExists(businessId: string, client?: PoolClient): Promise<void> {
  const result = await executeQuery<BusinessLookupRow>(
    `
      select id
      from businesses
      where id = $1
      limit 1
    `,
    [businessId],
    client,
  );

  if (!result.rows[0]) {
    throw new HttpError(404, "business_not_found", "Workspace not found.");
  }
}

export async function listAdminMediaRegistry(): Promise<AdminMediaRegistryResponse> {
  return loadRegistry();
}

export async function upsertAdminPromptTemplate(
  input: UpsertAdminPromptTemplateRequest,
  actorUserId?: string,
): Promise<AdminPromptTemplateRecord> {
  const slug = normalizeSlug(input.slug);
  const name = input.name.trim();
  const category = input.category.trim();
  const templateBody = input.templateBody.trim();
  const variables = [...new Set(input.variables.map((value) => value.trim()).filter(Boolean))];
  const version = normalizePositiveInteger(input.version, 1);

  if (!slug) {
    throw new HttpError(400, "prompt_template_slug_required", "Prompt template slug is required.");
  }

  if (!name) {
    throw new HttpError(400, "prompt_template_name_required", "Prompt template name is required.");
  }

  if (!category) {
    throw new HttpError(400, "prompt_template_category_required", "Prompt template category is required.");
  }

  if (!templateBody) {
    throw new HttpError(400, "prompt_template_body_required", "Prompt template body is required.");
  }

  return withDbTransaction(async (client) => {
    let templateId = input.id?.trim();

    if (templateId) {
      const result = await executeQuery<PromptTemplateRow>(
        `
          update prompt_templates
          set
            slug = $2,
            name = $3,
            category = $4,
            template_body = $5,
            variables = $6::jsonb,
            notes = $7,
            version = $8,
            is_active = $9,
            updated_at = now()
          where id = $1
          returning
            id
        `,
        [
          templateId,
          slug,
          name,
          category,
          templateBody,
          JSON.stringify(variables),
          normalizeOptionalText(input.notes) ?? null,
          version,
          input.isActive,
        ],
        client,
      );

      if (!result.rows[0]) {
        throw new HttpError(404, "prompt_template_not_found", "Prompt template not found.");
      }
    } else {
      const result = await executeQuery<{ id: string }>(
        `
          insert into prompt_templates (
            slug,
            name,
            category,
            template_body,
            variables,
            notes,
            version,
            is_active
          ) values (
            $1,
            $2,
            $3,
            $4,
            $5::jsonb,
            $6,
            $7,
            $8
          )
          returning id
        `,
        [
          slug,
          name,
          category,
          templateBody,
          JSON.stringify(variables),
          normalizeOptionalText(input.notes) ?? null,
          version,
          input.isActive,
        ],
        client,
      );
      templateId = result.rows[0]?.id;
    }

    if (!templateId) {
      throw new HttpError(500, "prompt_template_save_failed", "Unable to save prompt template.");
    }

    await logAdminAction(actorUserId, "prompt_template", templateId, "upsert_prompt_template", {
      slug,
      category,
      version,
      isActive: input.isActive,
    }, client);

    logInfo("Upserted admin prompt template.", {
      actorUserId,
      promptTemplateId: templateId,
      slug,
    });

    const registry = await loadRegistry(client);
    const promptTemplate = registry.promptTemplates.find((candidate) => candidate.id === templateId);

    if (!promptTemplate) {
      throw new HttpError(500, "prompt_template_load_failed", "Unable to load prompt template.");
    }

    return promptTemplate;
  });
}

export async function upsertAdminMediaPreset(
  input: UpsertAdminMediaPresetRequest,
  actorUserId?: string,
): Promise<AdminMediaPresetRecord> {
  const slug = normalizeSlug(input.slug);
  const name = input.name.trim();
  const supportedBusinessTypes = assertAllowedArray(
    input.supportedBusinessTypes,
    BUSINESS_TYPE_OPTIONS,
    "supportedBusinessTypes",
  );
  const supportedContentTypes = assertAllowedArray(
    input.supportedContentTypes,
    CONTENT_TYPE_OPTIONS,
    "supportedContentTypes",
  );
  const supportedGoals = assertAllowedArray(input.supportedGoals, GOAL_OPTIONS, "supportedGoals");
  const mediaTypes = assertAllowedArray(input.mediaTypes, MEDIA_TYPE_OPTIONS, "mediaTypes");
  const fallbackOrder = assertAllowedArray(input.fallbackOrder, MEDIA_TYPE_OPTIONS, "fallbackOrder");

  if (!slug) {
    throw new HttpError(400, "media_preset_slug_required", "Preset slug is required.");
  }

  if (!name) {
    throw new HttpError(400, "media_preset_name_required", "Preset name is required.");
  }

  if (mediaTypes.length === 0) {
    throw new HttpError(400, "media_preset_media_types_required", "Select at least one media type for the preset.");
  }

  const missingFallback = fallbackOrder.find((mediaType) => !mediaTypes.includes(mediaType));

  if (missingFallback) {
    throw new HttpError(400, "media_preset_invalid_fallback_order", `${missingFallback} must be included in mediaTypes before it can appear in fallbackOrder.`);
  }

  const promptTemplateByMediaType = Object.fromEntries(
    Object.entries(input.promptTemplateByMediaType ?? {})
      .filter(([, value]) => typeof value === "string" && value.trim().length > 0)
      .map(([mediaType, promptTemplateId]) => [mediaType, promptTemplateId!.trim()]),
  ) as Partial<Record<MediaSuggestionType, string>>;

  const invalidMappedType = Object.keys(promptTemplateByMediaType).find(
    (mediaType) => !mediaTypes.includes(mediaType as MediaSuggestionType),
  );

  if (invalidMappedType) {
    throw new HttpError(400, "media_preset_invalid_prompt_map", `${invalidMappedType} is not enabled for this preset.`);
  }

  return withDbTransaction(async (client) => {
    await ensurePromptTemplateIdsExist(Object.values(promptTemplateByMediaType), client);

    let presetId = input.id?.trim();

    if (presetId) {
      const result = await executeQuery<MediaPresetRow>(
        `
          update media_presets
          set
            slug = $2,
            name = $3,
            description = $4,
            supported_business_types = $5::jsonb,
            supported_content_types = $6::jsonb,
            supported_goals = $7::jsonb,
            media_types = $8::jsonb,
            fallback_order = $9::jsonb,
            ui_label = $10,
            priority = $11,
            is_active = $12,
            updated_at = now()
          where id = $1
          returning id
        `,
        [
          presetId,
          slug,
          name,
          normalizeOptionalText(input.description) ?? null,
          JSON.stringify(supportedBusinessTypes),
          JSON.stringify(supportedContentTypes),
          JSON.stringify(supportedGoals),
          JSON.stringify(mediaTypes),
          JSON.stringify(fallbackOrder),
          normalizeOptionalText(input.uiLabel) ?? null,
          normalizePositiveInteger(input.priority, 100),
          input.isActive,
        ],
        client,
      );

      if (!result.rows[0]) {
        throw new HttpError(404, "media_preset_not_found", "Media preset not found.");
      }
    } else {
      const result = await executeQuery<{ id: string }>(
        `
          insert into media_presets (
            slug,
            name,
            description,
            supported_business_types,
            supported_content_types,
            supported_goals,
            media_types,
            fallback_order,
            ui_label,
            priority,
            is_active
          ) values (
            $1,
            $2,
            $3,
            $4::jsonb,
            $5::jsonb,
            $6::jsonb,
            $7::jsonb,
            $8::jsonb,
            $9,
            $10,
            $11
          )
          returning id
        `,
        [
          slug,
          name,
          normalizeOptionalText(input.description) ?? null,
          JSON.stringify(supportedBusinessTypes),
          JSON.stringify(supportedContentTypes),
          JSON.stringify(supportedGoals),
          JSON.stringify(mediaTypes),
          JSON.stringify(fallbackOrder),
          normalizeOptionalText(input.uiLabel) ?? null,
          normalizePositiveInteger(input.priority, 100),
          input.isActive,
        ],
        client,
      );
      presetId = result.rows[0]?.id;
    }

    if (!presetId) {
      throw new HttpError(500, "media_preset_save_failed", "Unable to save media preset.");
    }

    await executeQuery(
      `
        delete from media_preset_prompt_map
        where media_preset_id = $1
      `,
      [presetId],
      client,
    );

    for (const [mediaType, promptTemplateId] of Object.entries(promptTemplateByMediaType)) {
      await executeQuery(
        `
          insert into media_preset_prompt_map (
            media_preset_id,
            media_type,
            prompt_template_id
          ) values (
            $1,
            $2,
            $3
          )
        `,
        [presetId, mediaType, promptTemplateId],
        client,
      );
    }

    await logAdminAction(actorUserId, "media_preset", presetId, "upsert_media_preset", {
      slug,
      mediaTypes,
      isActive: input.isActive,
    }, client);

    logInfo("Upserted admin media preset.", {
      actorUserId,
      mediaPresetId: presetId,
      slug,
    });

    const registry = await loadRegistry(client);
    const preset = registry.presets.find((candidate) => candidate.id === presetId);

    if (!preset) {
      throw new HttpError(500, "media_preset_load_failed", "Unable to load media preset.");
    }

    return preset;
  });
}

export async function upsertAdminDecisionRule(
  input: UpsertAdminDecisionRuleRequest,
  actorUserId?: string,
): Promise<AdminDecisionRuleRecord> {
  const ruleName = input.ruleName.trim();
  const ruleScope = input.ruleScope;
  const priority = normalizePositiveInteger(input.priority, 100);
  const conditions = normalizeRecord(input.conditions);
  const outputs = normalizeRecord(input.outputs);
  let businessType = input.businessType;
  let businessId = input.businessId?.trim() || undefined;

  if (!ruleName) {
    throw new HttpError(400, "decision_rule_name_required", "Rule name is required.");
  }

  if (!RULE_SCOPE_OPTIONS.includes(ruleScope)) {
    throw new HttpError(400, "decision_rule_scope_invalid", "Rule scope is invalid.");
  }

  if (ruleScope === "global") {
    businessType = undefined;
    businessId = undefined;
  } else if (ruleScope === "business_type") {
    if (!businessType) {
      throw new HttpError(400, "decision_rule_business_type_required", "businessType is required for business_type rules.");
    }
    if (!BUSINESS_TYPE_OPTIONS.includes(businessType)) {
      throw new HttpError(400, "decision_rule_business_type_invalid", "businessType is invalid.");
    }
    businessId = undefined;
  } else {
    businessType = undefined;

    if (!businessId) {
      throw new HttpError(400, "decision_rule_business_required", "businessId is required for workspace rules.");
    }
  }

  return withDbTransaction(async (client) => {
    if (ruleScope === "workspace" && businessId) {
      await ensureBusinessExists(businessId, client);
    }

    let decisionRuleId = input.id?.trim();

    if (decisionRuleId) {
      const result = await executeQuery<DecisionRuleRow>(
        `
          update decision_rules
          set
            rule_name = $2,
            rule_scope = $3,
            business_type = $4,
            business_id = $5,
            conditions = $6::jsonb,
            outputs = $7::jsonb,
            priority = $8,
            is_active = $9,
            updated_at = now()
          where id = $1
          returning id
        `,
        [
          decisionRuleId,
          ruleName,
          ruleScope,
          businessType ?? null,
          businessId ?? null,
          JSON.stringify(conditions),
          JSON.stringify(outputs),
          priority,
          input.isActive,
        ],
        client,
      );

      if (!result.rows[0]) {
        throw new HttpError(404, "decision_rule_not_found", "Decision rule not found.");
      }
    } else {
      const result = await executeQuery<{ id: string }>(
        `
          insert into decision_rules (
            rule_name,
            rule_scope,
            business_type,
            business_id,
            conditions,
            outputs,
            priority,
            is_active
          ) values (
            $1,
            $2,
            $3,
            $4,
            $5::jsonb,
            $6::jsonb,
            $7,
            $8
          )
          returning id
        `,
        [
          ruleName,
          ruleScope,
          businessType ?? null,
          businessId ?? null,
          JSON.stringify(conditions),
          JSON.stringify(outputs),
          priority,
          input.isActive,
        ],
        client,
      );
      decisionRuleId = result.rows[0]?.id;
    }

    if (!decisionRuleId) {
      throw new HttpError(500, "decision_rule_save_failed", "Unable to save decision rule.");
    }

    await logAdminAction(actorUserId, "decision_rule", decisionRuleId, "upsert_decision_rule", {
      ruleName,
      ruleScope,
      businessType,
      businessId,
      isActive: input.isActive,
    }, client);

    logInfo("Upserted admin decision rule.", {
      actorUserId,
      decisionRuleId,
      ruleName,
      ruleScope,
    });

    const registry = await loadRegistry(client);
    const decisionRule = registry.decisionRules.find((candidate) => candidate.id === decisionRuleId);

    if (!decisionRule) {
      throw new HttpError(500, "decision_rule_load_failed", "Unable to load decision rule.");
    }

    return decisionRule;
  });
}
