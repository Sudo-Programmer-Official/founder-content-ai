import type { PoolClient, QueryResultRow } from "pg";
import type {
  AdminFeatureFlag,
  AdminFeatureFlagTarget,
  AdminFeatureFlagsResponse,
  AdminWorkspaceAccessState,
  AdminWorkspaceLimitSnapshot,
  AdminWorkspaceListItem,
  BusinessPlanCode,
  FeatureFlagTargetType,
  UpdateAdminWorkspaceAccessRequest,
  UpsertAdminFeatureFlagRequest,
  UpsertAdminFeatureFlagTargetRequest,
} from "../../../../packages/shared-types/index.ts";
import { queryDb, withDbTransaction } from "./db/client.ts";
import { HttpError } from "../utils/http.ts";
import { logInfo } from "../utils/logger.ts";

interface WorkspaceAccessRow extends QueryResultRow {
  id: string;
  plan_code: BusinessPlanCode;
  trial_ends_at: Date | string | null;
  grace_until: Date | string | null;
  is_active: boolean;
  admin_override_note: string | null;
}

interface UsageLimitRow extends QueryResultRow {
  id: string;
  business_id: string;
  date: string;
  posts_limit: string | number;
  posts_used: string | number;
  emails_limit: string | number;
  emails_used: string | number;
  outreach_limit: string | number;
  outreach_used: string | number;
  created_at: Date | string;
  updated_at: Date | string;
}

interface AdminActionRow extends QueryResultRow {
  id: string;
  action: string;
  metadata_json: Record<string, unknown> | null;
  created_at: Date | string;
}

interface WorkspaceRow extends QueryResultRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  created_at: Date | string;
  owner_email: string | null;
  member_count: string | number;
  last_active_at: Date | string | null;
}

interface FeatureFlagRow extends QueryResultRow {
  id: string;
  key: string;
  description: string | null;
  enabled_globally: boolean;
  created_at: Date | string;
}

interface FeatureFlagTargetRow extends QueryResultRow {
  id: string;
  feature_flag_id: string;
  target_type: FeatureFlagTargetType;
  target_id: string;
  enabled: boolean;
  created_at: Date | string;
  business_name: string | null;
  user_email: string | null;
}

const PLAN_LIMIT_DEFAULTS: Record<
  BusinessPlanCode,
  Omit<AdminWorkspaceLimitSnapshot, "date" | "postsUsed" | "emailsUsed" | "outreachUsed">
> = {
  free: {
    postsLimit: 2,
    emailsLimit: 20,
    outreachLimit: 20,
  },
  pro: {
    postsLimit: 5,
    emailsLimit: 200,
    outreachLimit: 100,
  },
  growth: {
    postsLimit: 100000,
    emailsLimit: 500,
    outreachLimit: 250,
  },
  custom: {
    postsLimit: 100000,
    emailsLimit: 2500,
    outreachLimit: 500,
  },
};

const PLAN_SCHEDULED_QUEUE_LIMITS: Record<BusinessPlanCode, number | null> = {
  free: 1,
  pro: null,
  growth: null,
  custom: null,
};

function toIsoString(value: Date | string | null | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  return new Date(value).toISOString();
}

function toDateKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function toNumber(value: string | number | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeDays(value: number | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(1, Math.min(30, Math.round(parsed)));
}

function resolvePlanDefaults(planCode: BusinessPlanCode) {
  return PLAN_LIMIT_DEFAULTS[planCode] ?? PLAN_LIMIT_DEFAULTS.free;
}

export function resolveScheduledQueueLimit(planCode: BusinessPlanCode): number | null {
  return PLAN_SCHEDULED_QUEUE_LIMITS[planCode] ?? PLAN_SCHEDULED_QUEUE_LIMITS.free;
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

function mapLimitSnapshot(row: UsageLimitRow): AdminWorkspaceLimitSnapshot {
  return {
    date: row.date,
    postsLimit: toNumber(row.posts_limit),
    postsUsed: toNumber(row.posts_used),
    emailsLimit: toNumber(row.emails_limit),
    emailsUsed: toNumber(row.emails_used),
    outreachLimit: toNumber(row.outreach_limit),
    outreachUsed: toNumber(row.outreach_used),
  };
}

async function getWorkspaceAccessRow(
  businessId: string,
  client?: PoolClient,
): Promise<WorkspaceAccessRow> {
  const result = await executeQuery<WorkspaceAccessRow>(
    `
      select
        id,
        plan_code,
        trial_ends_at,
        grace_until,
        is_active,
        admin_override_note
      from businesses
      where id = $1
      limit 1
    `,
    [businessId],
    client,
  );

  const row = result.rows[0];

  if (!row) {
    throw new HttpError(404, "business_not_found", "Workspace not found.");
  }

  return row;
}

async function getLatestAdminAction(
  businessId: string,
  client?: PoolClient,
): Promise<AdminActionRow | null> {
  const result = await executeQuery<AdminActionRow>(
    `
      select
        id,
        action,
        metadata_json,
        created_at
      from admin_actions
      where target_type = 'business'
        and target_id = $1
      order by created_at desc
      limit 1
    `,
    [businessId],
    client,
  );

  return result.rows[0] ?? null;
}

async function ensureDailyUsageLimitSnapshot(
  businessId: string,
  client?: PoolClient,
): Promise<AdminWorkspaceLimitSnapshot> {
  const dateKey = toDateKey();
  const access = await getWorkspaceAccessRow(businessId, client);
  const defaults = resolvePlanDefaults(access.plan_code);
  const existingResult = await executeQuery<UsageLimitRow>(
    `
      select
        id,
        business_id,
        date::text as date,
        posts_limit,
        posts_used,
        emails_limit,
        emails_used,
        outreach_limit,
        outreach_used,
        created_at,
        updated_at
      from usage_limits_daily
      where business_id = $1
        and date = $2::date
      limit 1
    `,
    [businessId, dateKey],
    client,
  );

  const existing = existingResult.rows[0];

  if (existing) {
    if (
      toNumber(existing.posts_limit) !== defaults.postsLimit ||
      toNumber(existing.emails_limit) !== defaults.emailsLimit ||
      toNumber(existing.outreach_limit) !== defaults.outreachLimit
    ) {
      const syncedResult = await executeQuery<UsageLimitRow>(
        `
          update usage_limits_daily
          set
            posts_limit = $3,
            emails_limit = $4,
            outreach_limit = $5,
            updated_at = now()
          where business_id = $1
            and date = $2::date
          returning
            id,
            business_id,
            date::text as date,
            posts_limit,
            posts_used,
            emails_limit,
            emails_used,
            outreach_limit,
            outreach_used,
            created_at,
            updated_at
        `,
        [businessId, dateKey, defaults.postsLimit, defaults.emailsLimit, defaults.outreachLimit],
        client,
      );

      return mapLimitSnapshot(syncedResult.rows[0]);
    }

    return mapLimitSnapshot(existing);
  }

  const insertedResult = await executeQuery<UsageLimitRow>(
    `
      insert into usage_limits_daily (
        business_id,
        date,
        posts_limit,
        emails_limit,
        outreach_limit
      ) values (
        $1,
        $2::date,
        $3,
        $4,
        $5
      )
      on conflict (business_id, date)
      do update set
        posts_limit = usage_limits_daily.posts_limit
      returning
        id,
        business_id,
        date::text as date,
        posts_limit,
        posts_used,
        emails_limit,
        emails_used,
        outreach_limit,
        outreach_used,
        created_at,
        updated_at
    `,
    [
      businessId,
      dateKey,
      defaults.postsLimit,
      defaults.emailsLimit,
      defaults.outreachLimit,
    ],
    client,
  );

  return mapLimitSnapshot(insertedResult.rows[0]);
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

async function buildWorkspaceAccessState(
  businessId: string,
  client?: PoolClient,
): Promise<AdminWorkspaceAccessState> {
  const [access, dailyLimits, latestAction] = await Promise.all([
    getWorkspaceAccessRow(businessId, client),
    ensureDailyUsageLimitSnapshot(businessId, client),
    getLatestAdminAction(businessId, client),
  ]);

  const actionNote =
    typeof latestAction?.metadata_json?.note === "string"
      ? latestAction.metadata_json.note
      : undefined;

  return {
    planCode: access.plan_code,
    trialEndsAt: toIsoString(access.trial_ends_at),
    graceUntil: toIsoString(access.grace_until),
    isActive: access.is_active,
    adminOverrideNote: access.admin_override_note ?? actionNote,
    dailyLimits,
    recentAdminActionSummary: latestAction ? latestAction.action.replace(/_/g, " ") : undefined,
    recentAdminActionAt: latestAction ? toIsoString(latestAction.created_at) : undefined,
  };
}

function mapFeatureFlagTarget(row: FeatureFlagTargetRow): AdminFeatureFlagTarget {
  return {
    id: row.id,
    targetType: row.target_type,
    targetId: row.target_id,
    targetName: row.business_name ?? row.user_email ?? undefined,
    enabled: row.enabled,
    createdAt: toIsoString(row.created_at) ?? new Date().toISOString(),
  };
}

function mapFeatureFlag(
  row: FeatureFlagRow,
  targets: AdminFeatureFlagTarget[],
): AdminFeatureFlag {
  return {
    id: row.id,
    key: row.key,
    description: row.description ?? undefined,
    enabledGlobally: row.enabled_globally,
    createdAt: toIsoString(row.created_at) ?? new Date().toISOString(),
    targetCount: targets.length,
    targets,
  };
}

async function getFeatureFlagOrThrow(
  featureKey: string,
  client?: PoolClient,
): Promise<FeatureFlagRow> {
  const result = await executeQuery<FeatureFlagRow>(
    `
      select
        id,
        key,
        description,
        enabled_globally,
        created_at
      from feature_flags
      where key = $1
      limit 1
    `,
    [featureKey],
    client,
  );

  const row = result.rows[0];

  if (!row) {
    throw new HttpError(404, "feature_flag_not_found", "Feature flag not found.");
  }

  return row;
}

async function validateFeatureFlagTarget(
  targetType: FeatureFlagTargetType,
  targetId: string,
  client?: PoolClient,
): Promise<void> {
  if (targetType === "business") {
    await getWorkspaceAccessRow(targetId, client);
    return;
  }

  const result = await executeQuery<{ id: string }>(
    `
      select id
      from users
      where id = $1
      limit 1
    `,
    [targetId],
    client,
  );

  if (!result.rows[0]) {
    throw new HttpError(404, "user_not_found", "User not found.");
  }
}

export async function listAdminWorkspacesWithAccess(): Promise<AdminWorkspaceListItem[]> {
  const result = await queryDb<WorkspaceRow>(
    `
      select
        b.id,
        b.name,
        b.slug,
        b.status,
        b.created_at,
        owner.email as owner_email,
        count(distinct bm.user_id)::int as member_count,
        max(ue.created_at) as last_active_at
      from businesses b
      left join users owner on owner.id = b.owner_user_id
      left join business_members bm on bm.business_id = b.id
      left join usage_events ue on ue.business_id = b.id
      group by b.id, owner.email
      order by b.created_at desc
      limit 100
    `,
  );

  const items = await Promise.all(
    result.rows.map(async (row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      status: row.status,
      createdAt: toIsoString(row.created_at) ?? new Date().toISOString(),
      ownerEmail: row.owner_email ?? undefined,
      memberCount: toNumber(row.member_count),
      lastActiveAt: toIsoString(row.last_active_at),
      access: await buildWorkspaceAccessState(row.id),
    })),
  );

  return items;
}

export async function updateAdminWorkspaceAccess(
  businessId: string,
  actorUserId: string | undefined,
  input: UpdateAdminWorkspaceAccessRequest,
): Promise<AdminWorkspaceAccessState> {
  return withDbTransaction(async (client) => {
    const workspace = await getWorkspaceAccessRow(businessId, client);
    const note = input.note?.trim() || null;

    switch (input.action) {
      case "grant_pro_access":
        await executeQuery(
          `
            update businesses
            set
              plan_code = 'pro',
              is_active = true,
              status = 'active',
              admin_override_note = coalesce($2, admin_override_note),
              updated_at = now()
            where id = $1
          `,
          [businessId, note],
          client,
        );
        break;
      case "set_plan":
        if (!input.planCode) {
          throw new HttpError(400, "plan_required", "planCode is required for set_plan.");
        }
        await executeQuery(
          `
            update businesses
            set
              plan_code = $2,
              admin_override_note = coalesce($3, admin_override_note),
              updated_at = now()
            where id = $1
          `,
          [businessId, input.planCode, note],
          client,
        );
        break;
      case "extend_trial": {
        const trialDays = normalizeDays(input.trialDays, 7);
        await executeQuery(
          `
            update businesses
            set
              trial_ends_at = greatest(coalesce(trial_ends_at, now()), now()) + make_interval(days => $2),
              admin_override_note = coalesce($3, admin_override_note),
              updated_at = now()
            where id = $1
          `,
          [businessId, trialDays, note],
          client,
        );
        break;
      }
      case "extend_grace": {
        const graceDays = normalizeDays(input.graceDays, 3);
        await executeQuery(
          `
            update businesses
            set
              grace_until = greatest(coalesce(grace_until, now()), now()) + make_interval(days => $2),
              admin_override_note = coalesce($3, admin_override_note),
              updated_at = now()
            where id = $1
          `,
          [businessId, graceDays, note],
          client,
        );
        break;
      }
      case "disable_business":
        await executeQuery(
          `
            update businesses
            set
              is_active = false,
              status = 'disabled',
              admin_override_note = coalesce($2, admin_override_note),
              updated_at = now()
            where id = $1
          `,
          [businessId, note],
          client,
        );
        break;
      case "enable_business":
        await executeQuery(
          `
            update businesses
            set
              is_active = true,
              status = 'active',
              admin_override_note = coalesce($2, admin_override_note),
              updated_at = now()
            where id = $1
          `,
          [businessId, note],
          client,
        );
        break;
      case "reset_limits": {
        const limits = await ensureDailyUsageLimitSnapshot(businessId, client);
        await executeQuery(
          `
            update usage_limits_daily
            set
              posts_used = 0,
              emails_used = 0,
              outreach_used = 0,
              updated_at = now()
            where business_id = $1
              and date = $2::date
          `,
          [businessId, limits.date],
          client,
        );
        break;
      }
      default:
        throw new HttpError(400, "unsupported_admin_action", "Unsupported admin action.");
    }

    await logAdminAction(actorUserId, "business", businessId, input.action, {
      note: note ?? undefined,
      planCodeBefore: workspace.plan_code,
      planCodeAfter: input.action === "grant_pro_access" ? "pro" : input.planCode,
      trialDays: input.trialDays,
      graceDays: input.graceDays,
    }, client);

    logInfo("Applied admin workspace access action.", {
      actorUserId,
      businessId,
      action: input.action,
    });

    return buildWorkspaceAccessState(businessId, client);
  });
}

export async function getBusinessAccessState(
  businessId: string,
  client?: PoolClient,
): Promise<AdminWorkspaceAccessState> {
  return buildWorkspaceAccessState(businessId, client);
}

export async function incrementBusinessDailyUsage(
  businessId: string,
  metric: "posts" | "emails" | "outreach",
  quantity = 1,
): Promise<AdminWorkspaceLimitSnapshot> {
  return withDbTransaction(async (client) => {
    const snapshot = await ensureDailyUsageLimitSnapshot(businessId, client);
    const dateKey = snapshot.date;

    const config =
      metric === "emails"
        ? {
            limitColumn: "emails_limit",
            usedColumn: "emails_used",
            code: "email_limit_reached",
            message: "You've reached your daily email limit. Upgrade or try again tomorrow.",
          }
        : metric === "outreach"
          ? {
              limitColumn: "outreach_limit",
              usedColumn: "outreach_used",
              code: "outreach_limit_reached",
              message: "You've reached your daily outreach limit. Upgrade or try again tomorrow.",
            }
          : {
              limitColumn: "posts_limit",
              usedColumn: "posts_used",
              code: "post_limit_reached",
              message: "You've reached your daily post limit. Upgrade or try again tomorrow.",
            };

    const updateResult = await executeQuery<UsageLimitRow>(
      `
        update usage_limits_daily
        set
          ${config.usedColumn} = ${config.usedColumn} + $3,
          updated_at = now()
        where business_id = $1
          and date = $2::date
          and ${config.usedColumn} + $3 <= ${config.limitColumn}
        returning
          id,
          business_id,
          date::text as date,
          posts_limit,
          posts_used,
          emails_limit,
          emails_used,
          outreach_limit,
          outreach_used,
          created_at,
          updated_at
      `,
      [businessId, dateKey, Math.max(1, Math.floor(quantity))],
      client,
    );

    const updated = updateResult.rows[0];

    if (!updated) {
      throw new HttpError(429, config.code, config.message);
    }

    return mapLimitSnapshot(updated);
  });
}

export async function listAdminFeatureFlags(
  client?: PoolClient,
): Promise<AdminFeatureFlagsResponse> {
  const [flagResult, targetResult] = await Promise.all([
    executeQuery<FeatureFlagRow>(
      `
        select
          id,
          key,
          description,
          enabled_globally,
          created_at
        from feature_flags
        order by key asc
      `,
      [],
      client,
    ),
    executeQuery<FeatureFlagTargetRow>(
      `
        select
          fft.id,
          fft.feature_flag_id,
          fft.target_type,
          fft.target_id::text as target_id,
          fft.enabled,
          fft.created_at,
          b.name as business_name,
          u.email as user_email
        from feature_flag_targets fft
        left join businesses b on fft.target_type = 'business' and b.id = fft.target_id
        left join users u on fft.target_type = 'user' and u.id = fft.target_id
        order by fft.created_at desc
      `,
      [],
      client,
    ),
  ]);

  const targetsByFlagId = new Map<string, AdminFeatureFlagTarget[]>();

  for (const target of targetResult.rows) {
    const nextTargets = targetsByFlagId.get(target.feature_flag_id) ?? [];
    nextTargets.push(mapFeatureFlagTarget(target));
    targetsByFlagId.set(target.feature_flag_id, nextTargets);
  }

  return {
    flags: flagResult.rows.map((row) => mapFeatureFlag(row, targetsByFlagId.get(row.id) ?? [])),
  };
}

export async function upsertAdminFeatureFlag(
  input: UpsertAdminFeatureFlagRequest,
  actorUserId?: string,
): Promise<AdminFeatureFlag> {
  const key = input.key.trim().toLowerCase();

  if (!key) {
    throw new HttpError(400, "feature_key_required", "Feature flag key is required.");
  }

  return withDbTransaction(async (client) => {
    const result = await executeQuery<FeatureFlagRow>(
      `
        insert into feature_flags (
          key,
          description,
          enabled_globally
        ) values (
          $1,
          $2,
          $3
        )
        on conflict (key)
        do update set
          description = excluded.description,
          enabled_globally = excluded.enabled_globally
        returning
          id,
          key,
          description,
          enabled_globally,
          created_at
      `,
      [key, input.description?.trim() || null, input.enabledGlobally],
      client,
    );

    const flag = result.rows[0];

    await logAdminAction(actorUserId, "feature_flag", flag.id, "upsert_feature_flag", {
      key,
      enabledGlobally: input.enabledGlobally,
    }, client);

    const response = await listAdminFeatureFlags(client);
    const mappedFlag = response.flags.find((item) => item.id === flag.id);

    if (!mappedFlag) {
      throw new HttpError(500, "feature_flag_load_failed", "Unable to load feature flag.");
    }

    return mappedFlag;
  });
}

export async function upsertAdminFeatureFlagTarget(
  input: UpsertAdminFeatureFlagTargetRequest,
  actorUserId?: string,
): Promise<AdminFeatureFlag> {
  return withDbTransaction(async (client) => {
    await validateFeatureFlagTarget(input.targetType, input.targetId, client);
    const flag = await getFeatureFlagOrThrow(input.featureKey.trim().toLowerCase(), client);

    await executeQuery(
      `
        insert into feature_flag_targets (
          feature_flag_id,
          target_type,
          target_id,
          enabled
        ) values (
          $1,
          $2,
          $3::uuid,
          $4
        )
        on conflict (feature_flag_id, target_type, target_id)
        do update set
          enabled = excluded.enabled
      `,
      [flag.id, input.targetType, input.targetId, input.enabled],
      client,
    );

    await logAdminAction(actorUserId, "feature_flag", flag.id, "upsert_feature_flag_target", {
      key: flag.key,
      targetType: input.targetType,
      targetId: input.targetId,
      enabled: input.enabled,
    }, client);

    const response = await listAdminFeatureFlags(client);
    const mappedFlag = response.flags.find((item) => item.id === flag.id);

    if (!mappedFlag) {
      throw new HttpError(500, "feature_flag_load_failed", "Unable to load feature flag.");
    }

    return mappedFlag;
  });
}

export async function isFeatureEnabled(input: {
  key: string;
  businessId?: string;
  userId?: string;
}): Promise<boolean> {
  const key = input.key.trim().toLowerCase();

  if (!key) {
    return false;
  }

  const flagResult = await queryDb<FeatureFlagRow>(
    `
      select
        id,
        key,
        description,
        enabled_globally,
        created_at
      from feature_flags
      where key = $1
      limit 1
    `,
    [key],
  );

  const flag = flagResult.rows[0];

  if (!flag) {
    return false;
  }

  if (flag.enabled_globally) {
    return true;
  }

  const targetIds = [
    input.businessId ? { type: "business" as const, id: input.businessId } : null,
    input.userId ? { type: "user" as const, id: input.userId } : null,
  ].filter(Boolean) as Array<{ type: FeatureFlagTargetType; id: string }>;

  for (const target of targetIds) {
    const result = await queryDb<{ enabled: boolean }>(
      `
        select enabled
        from feature_flag_targets
        where feature_flag_id = $1
          and target_type = $2
          and target_id = $3::uuid
        limit 1
      `,
      [flag.id, target.type, target.id],
    );

    if (typeof result.rows[0]?.enabled === "boolean") {
      return result.rows[0].enabled;
    }
  }

  return false;
}
