import type { PoolClient, QueryResultRow } from "pg";
import type {
  AppUser,
  AuthIdentityProvider,
  Business,
  BusinessMembership,
  CreateBusinessRequest,
  CreateBusinessResponse,
  MeResponse,
  MyBusinessesResponse,
} from "../../../../packages/shared-types/index.ts";
import type { AuthenticatedPrincipal } from "../middleware/auth.ts";
import { queryDb, withDbTransaction } from "./db/client.ts";
import { sendPlatformEmail } from "./email/emailTransportService.ts";
import { HttpError } from "../utils/http.ts";
import { logInfo, logWarn } from "../utils/logger.ts";

interface UserRow extends QueryResultRow {
  id: string;
  auth_subject: string;
  email: string;
  full_name: string;
  avatar_url: string | null;
  welcome_email_sent_at: Date | string | null;
  status: AppUser["status"];
  created_at: Date | string;
  updated_at: Date | string;
}

interface MembershipRow extends QueryResultRow {
  membership_id: string;
  business_id: string;
  user_id: string;
  membership_role: BusinessMembership["role"];
  membership_status: BusinessMembership["status"];
  invited_by: string | null;
  membership_created_at: Date | string;
  owner_user_id: string;
  business_name: string;
  business_slug: string;
  brand_name: string;
  website_url: string | null;
  niche: string | null;
  timezone: string;
  business_status: Business["status"];
  business_created_at: Date | string;
  business_updated_at: Date | string;
}

interface ProviderRow extends QueryResultRow {
  provider: AuthIdentityProvider;
}

interface BusinessRow extends QueryResultRow {
  id: string;
  owner_user_id: string;
  name: string;
  slug: string;
  brand_name: string;
  website_url: string | null;
  niche: string | null;
  timezone: string;
  status: Business["status"];
  created_at: Date | string;
  updated_at: Date | string;
}

function normalizeOptional(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function resolveWelcomeFirstName(user: UserRow): string {
  const firstName = user.full_name.trim().split(/\s+/).find(Boolean);

  if (firstName) {
    return firstName;
  }

  return user.email.split("@")[0] || "there";
}

function resolveFrontendOrigin(): string {
  const configuredOrigin = process.env.FRONTEND_ORIGIN?.trim().replace(/\/$/, "");
  return configuredOrigin || "https://foundercontent.ai";
}

function buildWelcomeEmailMessage(user: UserRow): {
  subject: string;
  htmlBody: string;
  textBody: string;
} {
  const firstName = resolveWelcomeFirstName(user);
  const appOrigin = resolveFrontendOrigin();
  const htmlFirstName = escapeHtml(firstName);

  return {
    subject: "Welcome to Founder Content",
    htmlBody: [
      `<p>Hi ${htmlFirstName},</p>`,
      "<p>Welcome to Founder Content.</p>",
      "<p>We help you turn rough ideas, notes, customer signals, and existing content into clearer posts, campaigns, and repeatable publishing workflows without starting from a blank page every time.</p>",
      "<p>The fastest way to get value is simple:</p>",
      "<ol>",
      "<li>Bring one real idea or source.</li>",
      "<li>Generate a draft.</li>",
      "<li>Tighten the hook and ship something useful.</li>",
      "</ol>",
      `<p><a href="${escapeHtml(appOrigin)}">Open Founder Content</a> and run one workflow end to end.</p>`,
      "<p>If you get stuck, just reply to this email and tell us what you are trying to publish.</p>",
      "<p>Founder Content</p>",
    ].join(""),
    textBody: [
      `Hi ${firstName},`,
      "",
      "Welcome to Founder Content.",
      "",
      "We help you turn rough ideas, notes, customer signals, and existing content into clearer posts, campaigns, and repeatable publishing workflows without starting from a blank page every time.",
      "",
      "The fastest way to get value is simple:",
      "1. Bring one real idea or source.",
      "2. Generate a draft.",
      "3. Tighten the hook and ship something useful.",
      "",
      `Open Founder Content: ${appOrigin}`,
      "",
      "If you get stuck, reply to this email and tell us what you are trying to publish.",
      "",
      "Founder Content",
    ].join("\n"),
  };
}

async function claimWelcomeEmailSend(userId: string): Promise<boolean> {
  const result = await queryDb<{ id: string }>(
    `
      update users
      set welcome_email_sent_at = now()
      where id = $1
        and welcome_email_sent_at is null
      returning id
    `,
    [userId],
  );

  return Boolean(result.rows[0]);
}

async function releaseWelcomeEmailSendClaim(userId: string): Promise<void> {
  await queryDb(
    `
      update users
      set welcome_email_sent_at = null
      where id = $1
    `,
    [userId],
  );
}

async function sendWelcomeEmail(user: UserRow): Promise<void> {
  const claimed = await claimWelcomeEmailSend(user.id);

  if (!claimed) {
    return;
  }

  try {
    const message = buildWelcomeEmailMessage(user);
    const result = await sendPlatformEmail({
      fromEmail: process.env.SYSTEM_FROM_EMAIL?.trim() || "hello@foundercontent.ai",
      fromName: "Founder Content",
      replyToEmail: process.env.SYSTEM_FROM_EMAIL?.trim() || "hello@foundercontent.ai",
      toEmail: user.email,
      subject: message.subject,
      htmlBody: message.htmlBody,
      textBody: message.textBody,
      tags: {
        notification_type: "welcome_signup",
      },
    });

    logInfo("Sent welcome email to new user.", {
      userId: user.id,
      email: user.email,
      provider: result.provider,
    });
  } catch (error) {
    await releaseWelcomeEmailSendClaim(user.id);
    throw error;
  }
}

function maybeDispatchWelcomeEmail(
  user: UserRow,
  principal: AuthenticatedPrincipal,
  client?: PoolClient,
): void {
  if (client || principal.provider === "stub" || user.welcome_email_sent_at) {
    return;
  }

  void sendWelcomeEmail(user).catch((error) => {
    logWarn("Welcome email failed.", {
      userId: user.id,
      email: user.email,
      message: error instanceof Error ? error.message : "Unknown error",
    });
  });
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function toIsoString(value: Date | string): string {
  return new Date(value).toISOString();
}

function mapUser(row: UserRow): AppUser {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    avatarUrl: row.avatar_url ?? undefined,
    status: row.status,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function mapBusinessRow(row: BusinessRow): Business {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    name: row.name,
    slug: row.slug,
    brandName: row.brand_name,
    websiteUrl: row.website_url ?? undefined,
    niche: row.niche ?? undefined,
    timezone: row.timezone,
    status: row.status,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function mapBusinessFromMembership(row: MembershipRow): Business {
  return {
    id: row.business_id,
    ownerUserId: row.owner_user_id,
    name: row.business_name,
    slug: row.business_slug,
    brandName: row.brand_name,
    websiteUrl: row.website_url ?? undefined,
    niche: row.niche ?? undefined,
    timezone: row.timezone,
    status: row.business_status,
    createdAt: toIsoString(row.business_created_at),
    updatedAt: toIsoString(row.business_updated_at),
  };
}

function mapMembership(row: MembershipRow): BusinessMembership {
  return {
    id: row.membership_id,
    businessId: row.business_id,
    userId: row.user_id,
    role: row.membership_role,
    status: row.membership_status,
    invitedBy: row.invited_by ?? undefined,
    createdAt: toIsoString(row.membership_created_at),
    business: mapBusinessFromMembership(row),
  };
}

async function executeQuery<TRow extends QueryResultRow>(
  text: string,
  values: unknown[],
  client?: PoolClient,
): Promise<{ rows: TRow[] }> {
  if (client) {
    return client.query<TRow>(text, values);
  }

  return queryDb<TRow>(text, values);
}

async function ensureUserRecord(
  principal: AuthenticatedPrincipal,
  client?: PoolClient,
): Promise<UserRow> {
  const existingUserResult = await executeQuery<UserRow>(
    `
      select
        id,
        auth_subject,
        email,
        full_name,
        avatar_url,
        welcome_email_sent_at,
        status,
        created_at,
        updated_at
      from users
      where auth_subject = $1
      limit 1
    `,
    [principal.subject],
    client,
  );

  const existingUser = existingUserResult.rows[0];

  if (existingUser) {
    const updatedUserResult = await executeQuery<UserRow>(
      `
        update users
        set
          email = $2,
          full_name = $3,
          avatar_url = $4,
          updated_at = now()
        where id = $1
        returning
          id,
          auth_subject,
          email,
          full_name,
          avatar_url,
          welcome_email_sent_at,
          status,
          created_at,
          updated_at
      `,
      [
        existingUser.id,
        principal.email,
        principal.fullName,
        principal.avatarUrl ?? null,
      ],
      client,
    );

    const updatedUser = updatedUserResult.rows[0];
    await upsertAuthIdentity(updatedUser.id, principal, client);
    maybeDispatchWelcomeEmail(updatedUser, principal, client);
    return updatedUser;
  }

  const createdUserResult = await executeQuery<UserRow>(
    `
      insert into users (
        auth_subject,
        email,
        full_name,
        avatar_url,
        status
      ) values (
        $1,
        $2,
        $3,
        $4,
        'active'
      )
      on conflict (auth_subject)
      do update set
        email = excluded.email,
        full_name = excluded.full_name,
        avatar_url = excluded.avatar_url,
        updated_at = now()
      returning
        id,
        auth_subject,
        email,
        full_name,
        avatar_url,
        welcome_email_sent_at,
        status,
        created_at,
        updated_at
    `,
    [
      principal.subject,
      principal.email,
      principal.fullName,
      principal.avatarUrl ?? null,
    ],
    client,
  );

  const createdUser = createdUserResult.rows[0];
  await upsertAuthIdentity(createdUser.id, principal, client);
  maybeDispatchWelcomeEmail(createdUser, principal, client);
  logInfo("Bootstrapped authenticated user.", {
    userId: createdUser.id,
    authSubject: principal.subject,
    provider: principal.provider,
  });
  return createdUser;
}

export async function ensureCurrentUser(principal: AuthenticatedPrincipal): Promise<AppUser> {
  const user = await ensureUserRecord(principal);
  principal.userId = user.id;
  return mapUser(user);
}

async function upsertAuthIdentity(
  userId: string,
  principal: AuthenticatedPrincipal,
  client?: PoolClient,
): Promise<void> {
  if (principal.provider === "stub") {
    return;
  }

  await executeQuery(
    `
      insert into auth_identities (
        user_id,
        provider,
        provider_user_id,
        email
      ) values (
        $1,
        $2,
        $3,
        $4
      )
      on conflict (provider, provider_user_id)
      do update set
        user_id = excluded.user_id,
        email = excluded.email
    `,
    [userId, principal.provider, principal.subject, principal.email],
    client,
  );
}

async function loadAuthProviders(
  userId: string,
  principal: AuthenticatedPrincipal,
): Promise<AuthIdentityProvider[]> {
  const result = await queryDb<ProviderRow>(
    `
      select provider
      from auth_identities
      where user_id = $1
      order by created_at asc
    `,
    [userId],
  );

  const providers = result.rows.map((row: ProviderRow) => row.provider);

  if (providers.length > 0) {
    return providers;
  }

  return [principal.provider];
}

async function loadMemberships(userId: string): Promise<BusinessMembership[]> {
  const result = await queryDb<MembershipRow>(
    `
      select
        bm.id as membership_id,
        bm.business_id,
        bm.user_id,
        bm.role as membership_role,
        bm.status as membership_status,
        bm.invited_by,
        bm.created_at as membership_created_at,
        b.id,
        b.owner_user_id,
        b.name as business_name,
        b.slug as business_slug,
        b.brand_name,
        b.website_url,
        b.niche,
        b.timezone,
        b.status as business_status,
        b.created_at as business_created_at,
        b.updated_at as business_updated_at
      from business_members bm
      inner join businesses b on b.id = bm.business_id
      where bm.user_id = $1
      order by bm.created_at asc
    `,
    [userId],
  );

  return result.rows.map(mapMembership);
}

async function loadMembershipForBusiness(
  userId: string,
  businessId: string,
): Promise<BusinessMembership | null> {
  const result = await queryDb<MembershipRow>(
    `
      select
        bm.id as membership_id,
        bm.business_id,
        bm.user_id,
        bm.role as membership_role,
        bm.status as membership_status,
        bm.invited_by,
        bm.created_at as membership_created_at,
        b.id,
        b.owner_user_id,
        b.name as business_name,
        b.slug as business_slug,
        b.brand_name,
        b.website_url,
        b.niche,
        b.timezone,
        b.status as business_status,
        b.created_at as business_created_at,
        b.updated_at as business_updated_at
      from business_members bm
      inner join businesses b on b.id = bm.business_id
      where bm.user_id = $1
        and bm.business_id = $2
      limit 1
    `,
    [userId, businessId],
  );

  return result.rows[0] ? mapMembership(result.rows[0]) : null;
}

async function insertBusinessWithUniqueSlug(
  client: PoolClient,
  ownerUserId: string,
  input: CreateBusinessRequest,
): Promise<Business> {
  const name = input.name.trim();
  const baseSlug = slugify(input.slug ?? name) || "workspace";
  const brandName = normalizeOptional(input.brandName) ?? name;
  const websiteUrl = normalizeOptional(input.websiteUrl);
  const niche = normalizeOptional(input.niche);
  const timezone = normalizeOptional(input.timezone) ?? "UTC";

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const slug = attempt === 0 ? baseSlug : `${baseSlug}-${attempt + 1}`;
    const result = await client.query<BusinessRow>(
      `
        insert into businesses (
          owner_user_id,
          name,
          slug,
          brand_name,
          website_url,
          niche,
          timezone,
          status
        ) values (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          'active'
        )
        on conflict (slug) do nothing
        returning
          id,
          owner_user_id,
          name,
          slug,
          brand_name,
          website_url,
          niche,
          timezone,
          status,
          created_at,
          updated_at
      `,
      [ownerUserId, name, slug, brandName, websiteUrl ?? null, niche ?? null, timezone],
    );

    if (result.rows[0]) {
      return mapBusinessRow(result.rows[0]);
    }
  }

  throw new HttpError(
    409,
    "business_slug_unavailable",
    "Could not allocate a unique business slug after multiple attempts.",
  );
}

export async function getAppSession(principal: AuthenticatedPrincipal): Promise<MeResponse> {
  const user = await ensureUserRecord(principal);
  principal.userId = user.id;
  const [memberships, authProviders] = await Promise.all([
    loadMemberships(user.id),
    loadAuthProviders(user.id, principal),
  ]);

  return {
    user: mapUser(user),
    businesses: memberships,
    activeBusinessId: memberships[0]?.businessId ?? null,
    authProviders,
  };
}

export async function listUserBusinesses(
  principal: AuthenticatedPrincipal,
): Promise<MyBusinessesResponse> {
  const user = await ensureUserRecord(principal);
  principal.userId = user.id;

  return {
    businesses: await loadMemberships(user.id),
  };
}

export async function requireBusinessMembership(
  principal: AuthenticatedPrincipal,
  businessId: string,
): Promise<BusinessMembership> {
  const userId = principal.userId ?? (await ensureUserRecord(principal)).id;
  principal.userId = userId;

  const membership = await loadMembershipForBusiness(userId, businessId);

  if (!membership || membership.status !== "active") {
    throw new HttpError(
      403,
      "business_forbidden",
      "The current user is not an active member of this business.",
    );
  }

  return membership;
}

export async function createBusinessForUser(
  principal: AuthenticatedPrincipal,
  input: CreateBusinessRequest,
): Promise<CreateBusinessResponse> {
  const name = input.name.trim();

  if (!name) {
    throw new HttpError(400, "bad_request", "Business name is required.");
  }

  return withDbTransaction(async (client) => {
    const user = await ensureUserRecord(principal, client);
    principal.userId = user.id;
    const business = await insertBusinessWithUniqueSlug(client, user.id, input);

    await client.query(
      `
        insert into business_members (
          business_id,
          user_id,
          role,
          invited_by,
          status
        ) values (
          $1,
          $2,
          'owner',
          $2,
          'active'
        )
      `,
      [business.id, user.id],
    );

    const membershipResult = await client.query<MembershipRow>(
      `
        select
          bm.id as membership_id,
          bm.business_id,
          bm.user_id,
          bm.role as membership_role,
          bm.status as membership_status,
          bm.invited_by,
          bm.created_at as membership_created_at,
          b.id,
          b.owner_user_id,
          b.name as business_name,
          b.slug as business_slug,
          b.brand_name,
          b.website_url,
          b.niche,
          b.timezone,
          b.status as business_status,
          b.created_at as business_created_at,
          b.updated_at as business_updated_at
        from business_members bm
        inner join businesses b on b.id = bm.business_id
        where bm.user_id = $1
          and bm.business_id = $2
        limit 1
      `,
      [user.id, business.id],
    );

    const membership = membershipResult.rows[0];

    if (!membership) {
      throw new HttpError(
        500,
        "business_membership_missing",
        "Business membership could not be loaded after creation.",
      );
    }

    logInfo("Created business.", {
      businessId: business.id,
      ownerUserId: user.id,
      slug: business.slug,
    });

    return {
      business,
      membership: mapMembership(membership),
    };
  });
}
