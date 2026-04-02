import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Client } from "pg";
import type { AuthenticatedPrincipal } from "../src/middleware/auth.ts";
import {
  createScheduledPost,
  processDueScheduledPosts,
  updateScheduledPost,
} from "../src/services/scheduledPostService.ts";
import { encryptSecret } from "../src/utils/secretCrypto.ts";

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

loadEnvFromFile();
process.env.NODE_ENV ??= "development";

type SmokeResult = {
  name: string;
  passed: boolean;
  details: Record<string, unknown>;
};

type SmokeContext = {
  businessId: string;
  userId: string;
  email: string;
  subject: string;
  principal: AuthenticatedPrincipal;
};

type ScheduledPostRecord = {
  id: string;
  dispatch_job_id: string | null;
  status: string;
  retry_count: number;
  published_at: string | null;
  error_message: string | null;
};

type JobRecord = {
  id: string;
  status: string;
  attempts: number;
  max_attempts: number;
  run_after: string;
  error_message: string | null;
};

type DistributionGroupRecord = {
  id: string;
  status: string;
  editable_until: string | null;
  published_at: string | null;
};

type ScheduleItemRecord = {
  id: string;
  legacy_scheduled_post_id: string | null;
  status: string;
  distribution_group_id: string | null;
};

type ConnectedLinkedInChannelRecord = {
  social_account_id: string;
  selected_identity_id: string | null;
};

type MockPostBehavior =
  | {
      kind: "success";
      externalPostId?: string;
      gate?: {
        requested: Promise<void>;
        onRequested: () => void;
        release: Promise<void>;
      };
    }
  | {
      kind: "failure";
      message: string;
      statusCode?: number;
    };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(message));
    }, ms);

    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function createDeferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve!: () => void;
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve;
  });

  return { promise, resolve };
}

function createPrincipal(userId: string, email: string, subject: string): AuthenticatedPrincipal {
  return {
    subject,
    email,
    fullName: "Scheduler Smoke Runner",
    emailVerified: true,
    provider: "stub",
    userId,
    isSuperAdmin: false,
  };
}

function createDbClient(): Client {
  const connectionString = process.env.DATABASE_URL?.trim();

  if (!connectionString) {
    throw new Error("DATABASE_URL is required to run scheduler smoke checks.");
  }

  return new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });
}

function buildMockFetch(behaviors: Map<string, MockPostBehavior>): typeof fetch {
  return async (input, init) => {
    const requestUrl =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    if (requestUrl.includes("/rest/posts")) {
      const rawBody =
        typeof init?.body === "string"
          ? init.body
          : init?.body
            ? Buffer.from(init.body as ArrayBuffer).toString("utf8")
            : "{}";
      const payload =
        rawBody.trim().length > 0 ? (JSON.parse(rawBody) as Record<string, unknown>) : {};
      const commentary = typeof payload.commentary === "string" ? payload.commentary : "";
      const behavior = behaviors.get(commentary);

      if (!behavior) {
        throw new Error(`No mocked publishing behavior configured for commentary "${commentary}".`);
      }

      if (behavior.kind === "success") {
        if (behavior.gate) {
          behavior.gate.onRequested();
          await behavior.gate.release;
        }

        const externalPostId =
          behavior.externalPostId ?? `urn:li:ugcPost:${Date.now()}${Math.floor(Math.random() * 1000)}`;

        return new Response(
          JSON.stringify({ id: externalPostId }),
          {
            status: 201,
            headers: {
              "Content-Type": "application/json",
              "x-restli-id": externalPostId,
            },
          },
        );
      }

      return new Response(
        JSON.stringify({ message: behavior.message }),
        {
          status: behavior.statusCode ?? 500,
          headers: {
            "Content-Type": "application/json",
          },
        },
      );
    }

    if (requestUrl.includes("/rest/images")) {
      throw new Error("The scheduler smoke runner expects text-post scenarios only.");
    }

    throw new Error(`Unexpected outbound fetch during scheduler smoke run: ${requestUrl}`);
  };
}

async function ensureQueueIsIdle(client: Client): Promise<void> {
  const result = await client.query<{
    due_count: string | number;
    queued_count: string | number;
    processing_count: string | number;
  }>(
    `
      select
        count(*) filter (
          where status = 'queued'
            and type = 'post_publish'
            and run_after <= now()
            and attempts < max_attempts
        )::int as due_count,
        count(*) filter (
          where status = 'queued'
            and type = 'post_publish'
            and attempts < max_attempts
        )::int as queued_count,
        count(*) filter (
          where status = 'processing'
            and type = 'post_publish'
        )::int as processing_count
      from jobs
    `,
  );

  const row = result.rows[0];
  const dueCount = Number(row?.due_count ?? 0);
  const queuedCount = Number(row?.queued_count ?? 0);
  const processingCount = Number(row?.processing_count ?? 0);

  assert(
    dueCount === 0 && queuedCount === 0 && processingCount === 0,
    `Remote post_publish queue is not idle (due=${dueCount}, queued=${queuedCount}, processing=${processingCount}).`,
  );
}

async function ensureFeatureEnabledForBusiness(
  client: Client,
  featureKey: string,
  businessId: string,
): Promise<void> {
  const flagResult = await client.query<{ id: string }>(
    `
      insert into feature_flags (
        key,
        enabled_globally
      ) values (
        $1,
        false
      )
      on conflict (key)
      do update set key = excluded.key
      returning id
    `,
    [featureKey],
  );

  const flagId = flagResult.rows[0].id;

  await client.query(
    `
      insert into feature_flag_targets (
        feature_flag_id,
        target_type,
        target_id,
        enabled
      ) values (
        $1::uuid,
        'business',
        $2::uuid,
        true
      )
      on conflict (feature_flag_id, target_type, target_id)
      do update set enabled = excluded.enabled
    `,
    [flagId, businessId],
  );
}

async function createSmokeWorkspace(client: Client): Promise<{
  businessId: string;
  userId: string;
  email: string;
  subject: string;
}> {
  const suffix = randomUUID().slice(0, 8);
  const userId = randomUUID();
  const businessId = randomUUID();
  const subject = `smoke-user-${suffix}`;
  const email = `smoke-${suffix}@foundercontent.local`;

  await client.query(
    `
      insert into users (
        id,
        auth_subject,
        email,
        full_name,
        status
      ) values (
        $1::uuid,
        $2,
        $3,
        $4,
        'active'
      )
    `,
    [userId, subject, email, "Scheduler Smoke Runner"],
  );

  await client.query(
    `
      insert into businesses (
        id,
        owner_user_id,
        name,
        slug,
        brand_name,
        timezone,
        status,
        plan_code,
        is_active
      ) values (
        $1::uuid,
        $2::uuid,
        $3,
        $4,
        $5,
        'UTC',
        'active',
        'pro',
        true
      )
    `,
    [
      businessId,
      userId,
      `Scheduler Smoke ${suffix}`,
      `scheduler-smoke-${suffix}`,
      `Scheduler Smoke ${suffix}`,
    ],
  );

  await client.query(
    `
      insert into business_members (
        business_id,
        user_id,
        role,
        invited_by,
        status
      ) values (
        $1::uuid,
        $2::uuid,
        'owner',
        $2::uuid,
        'active'
      )
    `,
    [businessId, userId],
  );

  await ensureFeatureEnabledForBusiness(client, "scheduler", businessId);

  return {
    businessId,
    userId,
    email,
    subject,
  };
}

async function connectSmokeLinkedInChannel(
  client: Client,
  input: { businessId: string; userId: string },
): Promise<void> {
  const accountId = randomUUID();
  const identityId = randomUUID();
  const platformUserId = `smoke-linkedin-${randomUUID().slice(0, 8)}`;
  const platformUserUrn = `urn:li:person:${platformUserId}`;
  const encryptedToken = encryptSecret("smoke-linkedin-access-token", "SOCIAL_ACCOUNT_ENCRYPTION_SECRET");

  await client.query(
    `
      insert into social_accounts (
        id,
        business_id,
        user_id,
        platform,
        platform_user_id,
        platform_user_urn,
        account_email,
        access_token,
        refresh_token,
        token_expires_at,
        refresh_token_expires_at,
        scope,
        status,
        metadata_json
      ) values (
        $1::uuid,
        $2::uuid,
        $3::uuid,
        'linkedin',
        $4,
        $5,
        $6,
        $7,
        null,
        now() + interval '7 days',
        null,
        $8::text[],
        'connected',
        $9::jsonb
      )
    `,
    [
      accountId,
      input.businessId,
      input.userId,
      platformUserId,
      platformUserUrn,
      `linkedin-${platformUserId}@foundercontent.local`,
      encryptedToken,
      ["w_member_social"],
      JSON.stringify({ connectedVia: "scheduler_smoke" }),
    ],
  );

  await client.query(
    `
      insert into social_account_identities (
        id,
        social_account_id,
        platform,
        identity_type,
        platform_identity_id,
        platform_identity_urn,
        display_name,
        avatar_url,
        metadata_json
      ) values (
        $1::uuid,
        $2::uuid,
        'linkedin',
        'person',
        $3,
        $4,
        $5,
        null,
        $6::jsonb
      )
    `,
    [
      identityId,
      accountId,
      platformUserId,
      platformUserUrn,
      "Scheduler Smoke Runner",
      JSON.stringify({ seededFrom: "scheduler_smoke" }),
    ],
  );

  await client.query(
    `
      insert into business_social_channels (
        business_id,
        platform,
        social_account_id,
        selected_identity_id,
        status,
        metadata_json
      ) values (
        $1::uuid,
        'linkedin',
        $2::uuid,
        $3::uuid,
        'connected',
        $4::jsonb
      )
    `,
    [
      input.businessId,
      accountId,
      identityId,
      JSON.stringify({ seededFrom: "scheduler_smoke" }),
    ],
  );
}

async function loadScheduledPost(client: Client, scheduledPostId: string): Promise<ScheduledPostRecord> {
  const result = await client.query<ScheduledPostRecord>(
    `
      select
        id,
        dispatch_job_id,
        status,
        retry_count,
        published_at::text,
        error_message
      from scheduled_posts
      where id = $1::uuid
      limit 1
    `,
    [scheduledPostId],
  );

  const row = result.rows[0];
  assert(row, `Scheduled post ${scheduledPostId} was not found.`);
  return {
    ...row,
    retry_count: Number(row.retry_count),
  };
}

async function loadJob(client: Client, jobId: string): Promise<JobRecord> {
  const result = await client.query<JobRecord>(
    `
      select
        id,
        status,
        attempts,
        max_attempts,
        run_after::text,
        error_message
      from jobs
      where id = $1::uuid
      limit 1
    `,
    [jobId],
  );

  const row = result.rows[0];
  assert(row, `Job ${jobId} was not found.`);
  return {
    ...row,
    attempts: Number(row.attempts),
    max_attempts: Number(row.max_attempts),
  };
}

async function loadDistributionGroup(client: Client, distributionGroupId: string): Promise<DistributionGroupRecord> {
  const result = await client.query<DistributionGroupRecord>(
    `
      select
        id,
        status,
        editable_until::text,
        published_at::text
      from content_distribution_groups
      where id = $1::uuid
      limit 1
    `,
    [distributionGroupId],
  );

  const row = result.rows[0];
  assert(row, `Distribution group ${distributionGroupId} was not found.`);
  return row;
}

async function loadScheduleItem(
  client: Client,
  scheduledPostId: string,
): Promise<ScheduleItemRecord> {
  const result = await client.query<ScheduleItemRecord>(
    `
      select
        id,
        legacy_scheduled_post_id,
        status,
        distribution_group_id
      from schedule_items
      where legacy_scheduled_post_id = $1::uuid
      limit 1
    `,
    [scheduledPostId],
  );

  const row = result.rows[0];
  assert(row, `Schedule item for scheduled post ${scheduledPostId} was not found.`);
  return row;
}

async function loadConnectedLinkedInChannel(
  client: Client,
  businessId: string,
): Promise<{
  socialAccountId: string;
  socialAccountIdentityId: string | null;
}> {
  const result = await client.query<ConnectedLinkedInChannelRecord>(
    `
      select
        social_account_id,
        selected_identity_id
      from business_social_channels
      where business_id = $1::uuid
        and platform = 'linkedin'
        and status = 'connected'
      limit 1
    `,
    [businessId],
  );

  const row = result.rows[0];
  assert(row, `Business ${businessId} is missing a connected LinkedIn channel.`);

  return {
    socialAccountId: row.social_account_id,
    socialAccountIdentityId: row.selected_identity_id,
  };
}

async function createScheduledTextPost(
  principal: AuthenticatedPrincipal,
  businessId: string,
  contentText: string,
  scheduledAt: Date,
): Promise<{
  scheduledPostId: string;
  dispatchJobId: string;
  scheduledAt: string;
}> {
  const response = await createScheduledPost(principal, {
    businessId,
    platform: "linkedin",
    contentText,
    slides: [],
    scheduledAt: scheduledAt.toISOString(),
    audienceTimezone: "UTC",
    ignoreSafetyWarnings: true,
  });
  const scheduledPostId = response.scheduledPost.id;
  const scheduledPostRow = await loadScheduledPost(sharedClient, scheduledPostId);
  assert(scheduledPostRow.dispatch_job_id, `Scheduled post ${scheduledPostId} is missing a dispatch job.`);

  await sharedClient.query(
    `
      update jobs
      set run_after = now() - interval '1 second'
      where id = $1::uuid
    `,
    [scheduledPostRow.dispatch_job_id],
  );

  return {
    scheduledPostId,
    dispatchJobId: scheduledPostRow.dispatch_job_id,
    scheduledAt: response.scheduledPost.scheduledAt,
  };
}

async function seedDueScheduledTextPost(
  client: Client,
  input: {
    businessId: string;
    userId: string;
    contentText: string;
    scheduledAt: Date;
    runAfter: Date;
    maxAttempts?: number;
    priority?: number;
  },
): Promise<{
  scheduledPostId: string;
  dispatchJobId: string;
  scheduledAt: string;
}> {
  const scheduledPostId = randomUUID();
  const dispatchJobId = randomUUID();
  const channel = await loadConnectedLinkedInChannel(client, input.businessId);
  const scheduledAtIso = input.scheduledAt.toISOString();

  await client.query("begin");

  try {
    await client.query(
      `
        insert into jobs (
          id,
          business_id,
          job_key,
          type,
          status,
          priority,
          payload_json,
          attempts,
          max_attempts,
          run_after
        ) values (
          $1::uuid,
          $2::uuid,
          $3,
          'post_publish',
          'queued',
          $5::int,
          $4::jsonb,
          0,
          $6::int,
          $7::timestamptz
        )
      `,
      [
        dispatchJobId,
        input.businessId,
        `post_publish:${scheduledPostId}`,
        JSON.stringify({ scheduledPostId }),
        input.priority ?? 40,
        input.maxAttempts ?? 3,
        input.runAfter.toISOString(),
      ],
    );

    await client.query(
      `
        insert into scheduled_posts (
          id,
          business_id,
          user_id,
          social_account_id,
          social_account_identity_id,
          platform,
          content_text,
          asset_payload,
          scheduled_at,
          earliest_dispatch_at,
          latest_dispatch_at,
          dispatch_job_id,
          dispatch_priority,
          audience_timezone,
          status
        ) values (
          $1::uuid,
          $2::uuid,
          $3::uuid,
          $4::uuid,
          $5::uuid,
          'linkedin',
          $6,
          '{"slides":[]}'::jsonb,
          $7::timestamptz,
          $8::timestamptz,
          $9::timestamptz,
          $10::uuid,
          40,
          'UTC',
          'scheduled'
        )
      `,
      [
        scheduledPostId,
        input.businessId,
        input.userId,
        channel.socialAccountId,
        channel.socialAccountIdentityId,
        input.contentText,
        scheduledAtIso,
        scheduledAtIso,
        new Date(input.scheduledAt.getTime() + 30 * 60_000).toISOString(),
        dispatchJobId,
      ],
    );

    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }

  return {
    scheduledPostId,
    dispatchJobId,
    scheduledAt: scheduledAtIso,
  };
}

function toDateKey(value: string): string {
  return new Date(value).toISOString().slice(0, 10);
}

function toTimeValue(value: string): string {
  return new Date(value).toISOString().slice(11, 19);
}

async function createDistributionGroupWithScheduleItems(
  client: Client,
  input: {
    businessId: string;
    userId: string;
    title: string;
    scheduledPosts: Array<{
      scheduledPostId: string;
      scheduledAt: string;
    }>;
  },
): Promise<{ distributionGroupId: string }> {
  const contentItemId = randomUUID();
  const variantId = randomUUID();
  const distributionGroupId = randomUUID();
  const earliestScheduledAt = [...input.scheduledPosts]
    .map((entry) => new Date(entry.scheduledAt).getTime())
    .sort((left, right) => left - right)[0];

  await client.query(
    `
      insert into content_items (
        id,
        business_id,
        user_id,
        idea_text,
        base_text,
        metadata_json
      ) values (
        $1::uuid,
        $2::uuid,
        $3::uuid,
        $4,
        $5,
        $6::jsonb
      )
    `,
    [
      contentItemId,
      input.businessId,
      input.userId,
      input.title,
      input.title,
      JSON.stringify({ seededFrom: "scheduler_smoke" }),
    ],
  );

  await client.query(
    `
      insert into content_variants (
        id,
        business_id,
        user_id,
        content_item_id,
        channel,
        lane,
        title,
        text_content,
        media_json,
        source,
        status,
        metadata_json
      ) values (
        $1::uuid,
        $2::uuid,
        $3::uuid,
        $4::uuid,
        'linkedin',
        'social',
        $5,
        $6,
        '{"images":[],"videos":[]}'::jsonb,
        'manual',
        'scheduled',
        $7::jsonb
      )
    `,
    [
      variantId,
      input.businessId,
      input.userId,
      contentItemId,
      input.title,
      input.title,
      JSON.stringify({ seededFrom: "scheduler_smoke" }),
    ],
  );

  await client.query(
    `
      insert into content_distribution_groups (
        id,
        business_id,
        user_id,
        content_item_id,
        primary_variant_id,
        lane,
        title,
        status,
        editable_until,
        metadata_json
      ) values (
        $1::uuid,
        $2::uuid,
        $3::uuid,
        $4::uuid,
        $5::uuid,
        'social',
        $6,
        'scheduled',
        $7::timestamptz,
        $8::jsonb
      )
    `,
    [
      distributionGroupId,
      input.businessId,
      input.userId,
      contentItemId,
      variantId,
      input.title,
      new Date(earliestScheduledAt - 5 * 60_000).toISOString(),
      JSON.stringify({ seededFrom: "scheduler_smoke" }),
    ],
  );

  for (const post of input.scheduledPosts) {
    await client.query(
      `
        insert into schedule_items (
          business_id,
          user_id,
          content_item_id,
          variant_id,
          distribution_group_id,
          legacy_scheduled_post_id,
          channel,
          lane,
          scheduled_date,
          scheduled_time,
          audience_timezone,
          scheduled_at,
          status,
          metadata_json
        ) values (
          $1::uuid,
          $2::uuid,
          $3::uuid,
          $4::uuid,
          $5::uuid,
          $6::uuid,
          'linkedin',
          'social',
          $7::date,
          $8::time,
          'UTC',
          $9::timestamptz,
          'scheduled',
          $10::jsonb
        )
      `,
      [
        input.businessId,
        input.userId,
        contentItemId,
        variantId,
        distributionGroupId,
        post.scheduledPostId,
        toDateKey(post.scheduledAt),
        toTimeValue(post.scheduledAt),
        post.scheduledAt,
        JSON.stringify({ seededFrom: "scheduler_smoke" }),
      ],
    );
  }

  return { distributionGroupId };
}

async function runCancelVsWorkerRace(
  context: SmokeContext,
  behaviors: Map<string, MockPostBehavior>,
): Promise<SmokeResult> {
  const contentText = `smoke-cancel-race-${randomUUID().slice(0, 8)}`;
  const requested = createDeferred();
  const released = createDeferred();

  behaviors.set(contentText, {
    kind: "success",
    externalPostId: `urn:li:ugcPost:${Date.now()}01`,
    gate: {
      requested: requested.promise,
      onRequested: requested.resolve,
      release: released.promise,
    },
  });

  const created = await createScheduledTextPost(
    context.principal,
    context.businessId,
    contentText,
    new Date(),
  );
  const workerPromise = processDueScheduledPosts(1);

  await withTimeout(
    requested.promise,
    15_000,
    "Cancel-vs-worker smoke timed out before the worker reached the mocked publish request.",
  );

  let cancelRejected = false;

  try {
    await updateScheduledPost(context.principal, created.scheduledPostId, {
      businessId: context.businessId,
      action: "cancel",
    });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      (error as { statusCode?: number }).statusCode === 409
    ) {
      cancelRejected = true;
    } else {
      throw error;
    }
  }

  assert(cancelRejected, "Cancel action should be rejected once the worker has claimed processing.");

  released.resolve();

  const workerResult = await workerPromise;
  const scheduledPost = await loadScheduledPost(sharedClient, created.scheduledPostId);
  const job = await loadJob(sharedClient, created.dispatchJobId);

  assert(workerResult.published === 1, "Worker should publish the claimed post in the overlap scenario.");
  assert(scheduledPost.status === "published", "Scheduled post should end published after worker wins the race.");
  assert(job.status === "completed", "Dispatch job should complete after publish.");

  return {
    name: "cancel_vs_worker_race",
    passed: true,
    details: {
      scheduledPostId: created.scheduledPostId,
      dispatchJobId: created.dispatchJobId,
      finalScheduledPostStatus: scheduledPost.status,
      finalJobStatus: job.status,
    },
  };
}

async function runRetryToTerminalFail(
  context: SmokeContext,
  behaviors: Map<string, MockPostBehavior>,
): Promise<SmokeResult> {
  const contentText = `smoke-retry-fail-${randomUUID().slice(0, 8)}`;

  behaviors.set(contentText, {
    kind: "failure",
    message: "Mock LinkedIn post failure.",
    statusCode: 500,
  });

  const created = await seedDueScheduledTextPost(sharedClient, {
    businessId: context.businessId,
    userId: context.userId,
    contentText,
    scheduledAt: new Date(),
    runAfter: new Date(Date.now() - 1000),
    maxAttempts: 2,
    priority: -1_000,
  });

  const firstRun = await processDueScheduledPosts(1);
  const firstScheduledPost = await loadScheduledPost(sharedClient, created.scheduledPostId);
  const firstJob = await loadJob(sharedClient, created.dispatchJobId);

  assert(firstRun.published === 0, "First retry smoke run should not publish.");
  assert(firstScheduledPost.status === "scheduled", "Scheduled post should return to scheduled after retry queueing.");
  assert(firstScheduledPost.retry_count === 1, "Retry count should be 1 after the first failed attempt.");
  assert(firstJob.status === "queued", "Dispatch job should be re-queued after the first retryable failure.");
  assert(firstJob.attempts === 1, "Dispatch job attempts should increment after the first run.");

  await sharedClient.query(
    `
      update jobs
      set run_after = now() - interval '1 second'
      where id = $1::uuid
    `,
    [created.dispatchJobId],
  );

  await sleep(100);

  let secondRun = {
    backfilled: 0,
    claimed: 0,
    published: 0,
    failed: 0,
  };
  let finalScheduledPost = await loadScheduledPost(sharedClient, created.scheduledPostId);
  let finalJob = await loadJob(sharedClient, created.dispatchJobId);

  await withTimeout(
    (async () => {
      while (finalScheduledPost.status !== "failed" || finalJob.status !== "failed") {
        if (finalJob.status === "queued") {
          await sharedClient.query(
            `
              update jobs
              set run_after = now() - interval '1 second'
              where id = $1::uuid
            `,
            [created.dispatchJobId],
          );
        }

        secondRun = await processDueScheduledPosts(1);
        await sleep(100);
        finalScheduledPost = await loadScheduledPost(sharedClient, created.scheduledPostId);
        finalJob = await loadJob(sharedClient, created.dispatchJobId);

        if (finalJob.attempts >= finalJob.max_attempts && finalJob.status === "processing") {
          await sleep(150);
          finalScheduledPost = await loadScheduledPost(sharedClient, created.scheduledPostId);
          finalJob = await loadJob(sharedClient, created.dispatchJobId);
        }
      }
    })(),
    10_000,
    "Retry smoke timed out before the scheduled post reached a terminal failed state.",
  );

  assert(
    secondRun.failed >= 1 || (finalScheduledPost.status === "failed" && finalJob.status === "failed"),
    `Second retry smoke run should end in a terminal failure. result=${JSON.stringify({
      secondRun,
      scheduledPostStatus: finalScheduledPost.status,
      retryCount: finalScheduledPost.retry_count,
      jobStatus: finalJob.status,
      jobAttempts: finalJob.attempts,
      jobMaxAttempts: finalJob.max_attempts,
      jobRunAfter: finalJob.run_after,
    })}`,
  );
  assert(finalScheduledPost.status === "failed", "Scheduled post should settle in failed after max attempts.");
  assert(finalScheduledPost.retry_count === 2, "Retry count should reflect the terminal attempt.");
  assert(finalJob.status === "failed", "Dispatch job should settle in failed after exhausting attempts.");
  assert(finalJob.attempts === 2, "Dispatch job attempts should stop at max attempts.");

  return {
    name: "retry_to_terminal_fail",
    passed: true,
    details: {
      scheduledPostId: created.scheduledPostId,
      dispatchJobId: created.dispatchJobId,
      finalScheduledPostStatus: finalScheduledPost.status,
      finalJobStatus: finalJob.status,
      attempts: finalJob.attempts,
    },
  };
}

async function runGroupedMultiItemProgression(
  context: SmokeContext,
  behaviors: Map<string, MockPostBehavior>,
): Promise<SmokeResult> {
  const successText = `smoke-group-success-${randomUUID().slice(0, 8)}`;
  const failText = `smoke-group-fail-${randomUUID().slice(0, 8)}`;

  behaviors.set(successText, {
    kind: "success",
    externalPostId: `urn:li:ugcPost:${Date.now()}11`,
  });
  behaviors.set(failText, {
    kind: "failure",
    message: "Mock grouped publish failure.",
    statusCode: 500,
  });

  const firstPost = await seedDueScheduledTextPost(sharedClient, {
    businessId: context.businessId,
    userId: context.userId,
    contentText: successText,
    scheduledAt: new Date(),
    runAfter: new Date(Date.now() - 2000),
    priority: -1_000,
  });
  const secondPost = await seedDueScheduledTextPost(sharedClient, {
    businessId: context.businessId,
    userId: context.userId,
    contentText: failText,
    scheduledAt: new Date(Date.now() + 1000),
    runAfter: new Date(Date.now() + 5 * 60 * 1000),
    maxAttempts: 1,
    priority: -999,
  });

  const { distributionGroupId } = await createDistributionGroupWithScheduleItems(sharedClient, {
    businessId: context.businessId,
    userId: context.userId,
    title: "Grouped scheduler smoke",
    scheduledPosts: [
      {
        scheduledPostId: firstPost.scheduledPostId,
        scheduledAt: firstPost.scheduledAt,
      },
      {
        scheduledPostId: secondPost.scheduledPostId,
        scheduledAt: secondPost.scheduledAt,
      },
    ],
  });

  const initialGroup = await loadDistributionGroup(sharedClient, distributionGroupId);
  assert(initialGroup.status === "scheduled", "Distribution group should start scheduled.");

  let firstRun = {
    backfilled: 0,
    claimed: 0,
    published: 0,
    failed: 0,
  };
  let groupAfterFirst = await loadDistributionGroup(sharedClient, distributionGroupId);
  let firstScheduleItem = await loadScheduleItem(sharedClient, firstPost.scheduledPostId);
  let secondScheduleItemBeforeFailure = await loadScheduleItem(sharedClient, secondPost.scheduledPostId);

  await withTimeout(
    (async () => {
      while (firstScheduleItem.status !== "published") {
        firstRun = await processDueScheduledPosts(1);
        await sleep(100);
        groupAfterFirst = await loadDistributionGroup(sharedClient, distributionGroupId);
        firstScheduleItem = await loadScheduleItem(sharedClient, firstPost.scheduledPostId);
        secondScheduleItemBeforeFailure = await loadScheduleItem(sharedClient, secondPost.scheduledPostId);
      }
    })(),
    15_000,
    "Grouped smoke timed out before the first child item published.",
  );

  assert(
    firstRun.published >= 1 || firstScheduleItem.status === "published",
    `First grouped run should publish the first child item. result=${JSON.stringify({
      firstRun,
      firstScheduleItemStatus: firstScheduleItem.status,
      secondScheduleItemStatus: secondScheduleItemBeforeFailure.status,
      groupStatus: groupAfterFirst.status,
    })}`,
  );
  assert(groupAfterFirst.status === "processing", "Group should become processing after one child publishes while another remains scheduled.");
  assert(firstScheduleItem.status === "published", "First child schedule item should sync to published.");
  assert(secondScheduleItemBeforeFailure.status === "scheduled", "Second child should remain scheduled before its run.");

  await sharedClient.query(
    `
      update jobs
      set run_after = now() - interval '1 second'
      where id = $1::uuid
    `,
    [secondPost.dispatchJobId],
  );

  let secondRun = {
    backfilled: 0,
    claimed: 0,
    published: 0,
    failed: 0,
  };
  let groupAfterSecond = await loadDistributionGroup(sharedClient, distributionGroupId);
  let secondScheduleItem = await loadScheduleItem(sharedClient, secondPost.scheduledPostId);
  let secondScheduledPost = await loadScheduledPost(sharedClient, secondPost.scheduledPostId);

  await withTimeout(
    (async () => {
      while (secondScheduledPost.status !== "failed") {
        secondRun = await processDueScheduledPosts(1);
        await sleep(100);
        groupAfterSecond = await loadDistributionGroup(sharedClient, distributionGroupId);
        secondScheduleItem = await loadScheduleItem(sharedClient, secondPost.scheduledPostId);
        secondScheduledPost = await loadScheduledPost(sharedClient, secondPost.scheduledPostId);
      }
    })(),
    15_000,
    "Grouped smoke timed out before the second child item failed.",
  );

  assert(
    secondRun.failed >= 1 || secondScheduledPost.status === "failed",
    `Second grouped run should end the second child in terminal failure. result=${JSON.stringify({
      secondRun,
      secondScheduledPostStatus: secondScheduledPost.status,
      secondScheduleItemStatus: secondScheduleItem.status,
      groupStatus: groupAfterSecond.status,
    })}`,
  );
  assert(groupAfterSecond.status === "partial", "Group should become partial after published plus failed children.");
  assert(secondScheduleItem.status === "failed", "Second child schedule item should sync to failed.");
  assert(secondScheduledPost.status === "failed", "Second scheduled post should settle failed.");

  return {
    name: "grouped_multi_item_state_progression",
    passed: true,
    details: {
      distributionGroupId,
      initialStatus: initialGroup.status,
      afterFirstStatus: groupAfterFirst.status,
      finalStatus: groupAfterSecond.status,
    },
  };
}

async function cleanupSmokeWorkspace(client: Client, businessId: string, userId: string): Promise<void> {
  await client.query(
    `
      delete from feature_flag_targets
      where target_id = $1::uuid
         or target_id = $2::uuid
    `,
    [businessId, userId],
  );
  await client.query(`delete from businesses where id = $1::uuid`, [businessId]);
  await client.query(`delete from users where id = $1::uuid`, [userId]);
}

let sharedClient!: Client;

async function createScenarioContext(client: Client): Promise<SmokeContext> {
  const base = await createSmokeWorkspace(client);
  await connectSmokeLinkedInChannel(client, base);

  return {
    ...base,
    principal: createPrincipal(base.userId, base.email, base.subject),
  };
}

async function main(): Promise<void> {
  const requestedScenario = process.argv[2]?.trim();
  sharedClient = createDbClient();
  await sharedClient.connect();
  await ensureQueueIsIdle(sharedClient);
  const behaviors = new Map<string, MockPostBehavior>();
  const originalFetch = globalThis.fetch;
  const activeContexts: SmokeContext[] = [];

  globalThis.fetch = buildMockFetch(behaviors);

  try {
    const results: SmokeResult[] = [];

    if (!requestedScenario || requestedScenario === "cancel_vs_worker_race") {
      const context = await createScenarioContext(sharedClient);
      activeContexts.push(context);
      results.push(await runCancelVsWorkerRace(context, behaviors));
      await cleanupSmokeWorkspace(sharedClient, context.businessId, context.userId);
      activeContexts.pop();
      await ensureQueueIsIdle(sharedClient);
    }
    if (!requestedScenario || requestedScenario === "retry_to_terminal_fail") {
      const context = await createScenarioContext(sharedClient);
      activeContexts.push(context);
      results.push(await runRetryToTerminalFail(context, behaviors));
      await cleanupSmokeWorkspace(sharedClient, context.businessId, context.userId);
      activeContexts.pop();
      await ensureQueueIsIdle(sharedClient);
    }
    if (!requestedScenario || requestedScenario === "grouped_multi_item_state_progression") {
      const context = await createScenarioContext(sharedClient);
      activeContexts.push(context);
      results.push(await runGroupedMultiItemProgression(context, behaviors));
      await cleanupSmokeWorkspace(sharedClient, context.businessId, context.userId);
      activeContexts.pop();
    }

    console.log(JSON.stringify({ passed: true, results }, null, 2));
  } finally {
    globalThis.fetch = originalFetch;
    for (const context of activeContexts.reverse()) {
      await cleanupSmokeWorkspace(sharedClient, context.businessId, context.userId);
    }
    await sharedClient.end();
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        passed: false,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
});
