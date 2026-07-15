import type { PoolClient, QueryResultRow } from "pg";
import type {
  RevenueAgentContactEmailVerificationStatus,
  RevenueAgentContactEnrichmentBatchRequest,
  RevenueAgentContactEnrichmentProviderName,
  RevenueAgentContactEnrichmentStatus,
  RevenueAgentContactRecord,
  RevenueAgentEnrichedPerson,
  RevenueAgentOpportunityReport,
  RevenueAgentOrganizationMatch,
  RevenueAgentPersonCandidate,
  RevenueAgentProspectStatus,
} from "../../../../../packages/shared-types/index.ts";
import { queryDb } from "../db/client.ts";
import { HttpError } from "../../utils/http.ts";
import { computeRevenueAgentReachability } from "./reachabilityService.ts";

interface ProviderHealth {
  enabled: boolean;
  configured: boolean;
  available: boolean;
  quotaRemaining?: number;
  reason?: string;
}

export interface ContactEnrichmentProvider {
  health: ProviderHealth;
  findOrganization(input: {
    companyName: string;
    domain?: string;
    website?: string;
    city?: string;
    state?: string;
  }): Promise<RevenueAgentOrganizationMatch | null>;

  searchPeople(input: {
    organization: RevenueAgentOrganizationMatch;
    targetTitles: string[];
    limit: number;
  }): Promise<RevenueAgentPersonCandidate[]>;

  enrichPerson(candidate: RevenueAgentPersonCandidate): Promise<RevenueAgentEnrichedPerson>;
}

type ProviderHealthState = ProviderHealth;
type ProviderHealthName = "apollo" | "hunter" | "fallback";

interface ProspectContactRow extends QueryResultRow {
  id: string;
  business_id: string;
  prospect_id: string;
  source: string;
  source_id: string;
  organization_source_id: string | null;
  person_source_id: string | null;
  dedupe_key: string;
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  title: string;
  department: string | null;
  email: string | null;
  email_normalized: string | null;
  email_verification_status: RevenueAgentContactEmailVerificationStatus;
  email_verified_at: Date | string | null;
  verification_source: string | null;
  verified_email: string | null;
  verified_domain: string | null;
  verified_reason: string | null;
  direct_phone: string | null;
  direct_phone_normalized: string | null;
  linkedin_url: string | null;
  organization_name: string;
  organization_domain: string | null;
  organization_website: string | null;
  city: string | null;
  state: string | null;
  status: RevenueAgentContactEnrichmentStatus;
  match_confidence: string | number;
  contact_confidence: string | number;
  source_ids_json: unknown;
  source_names_json: unknown;
  enrichment_events_json: unknown;
  is_primary: boolean;
  manual_override: boolean;
  manually_corrected_at: Date | string | null;
  last_enriched_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface ProspectRow extends QueryResultRow {
  id: string;
  business_id: string;
  business_name: string;
  website: string | null;
  website_normalized: string | null;
  email: string | null;
  email_normalized: string | null;
  phone: string | null;
  phone_normalized: string | null;
  city: string | null;
  state: string | null;
  status: string;
  industry: string;
  source: string;
  source_url: string | null;
  review_count: string | number;
  opportunity_score: string | number;
  last_contact_enriched_at: Date | string | null;
}

interface BusinessRow extends QueryResultRow {
  id: string;
  name: string;
  brand_name: string;
  website_url: string | null;
  niche: string | null;
}

interface ApolloOrganizationResult {
  id?: string;
  name?: string;
  domain?: string;
  website_url?: string;
  primary_domain?: string;
  city?: string;
  state?: string;
  country?: string;
  confidence?: number;
  raw?: Record<string, unknown>;
}

interface ApolloPeopleResult {
  id?: string;
  first_name?: string;
  last_name?: string;
  name?: string;
  title?: string;
  department?: string;
  email?: string;
  direct_phone?: string;
  linkedin_url?: string;
  confidence?: number;
  organization?: {
    id?: string;
    name?: string;
    domain?: string;
    website_url?: string;
  };
}

interface ApolloSearchResponse<T> {
  organizations?: T[];
  people?: T[];
  results?: T[];
  data?: T[];
}

interface ApolloOrganizationEnrichResponse {
  organization?: ApolloOrganizationResult;
  organizations?: ApolloOrganizationResult[];
  data?: ApolloOrganizationResult[];
  result?: ApolloOrganizationResult;
}

interface ApolloPeopleMatchResponse {
  person?: ApolloPeopleResult;
  people?: ApolloPeopleResult[];
  data?: ApolloPeopleResult[];
  result?: ApolloPeopleResult;
}

interface HunterDomainSearchResponse {
  data?: {
    domain?: string;
    organization?: string;
    email_addresses?: Array<{
      value?: string;
      type?: string;
      confidence?: number;
      first_name?: string;
      last_name?: string;
      position?: string;
      department?: string;
      linkedin_url?: string;
      phone_number?: string;
    }>;
  };
}

interface HunterEmailFinderResponse {
  data?: {
    email?: string;
    score?: number;
    first_name?: string;
    last_name?: string;
    position?: string;
    department?: string;
    linkedin_url?: string;
    phone_number?: string;
  };
}

interface HunterEmailVerifyResponse {
  data?: {
    status?: string;
    score?: number;
    result?: string;
    regexp?: boolean;
    gibberish?: boolean;
    disposable?: boolean;
    webmail?: boolean;
    mx_records?: boolean;
    smtp_server?: boolean;
    smtp_check?: boolean;
    accept_all?: boolean;
    email?: string;
    reason?: string;
  };
}

type HunterEmailAddress = NonNullable<HunterDomainSearchResponse["data"]> extends { email_addresses?: infer T }
  ? NonNullable<T> extends Array<infer U>
    ? U
    : never
  : never;

function normalizeOptional(value: string | undefined | null): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function normalizeNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getApolloHeaders(apiKey: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "Cache-Control": "no-cache",
    "x-api-key": apiKey,
  };
}

function normalizeDomain(value: string | undefined | null): string | undefined {
  const raw = normalizeOptional(value);
  if (!raw) {
    return undefined;
  }

  try {
    const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const url = new URL(candidate);
    return url.hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return raw.toLowerCase().replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0];
  }
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join(" ");
}

function buildSourceEvent(
  source: string,
  sourceId: string,
  action: string,
  note: string,
): Record<string, unknown> {
  return {
    source,
    sourceId,
    action,
    note,
    timestamp: new Date().toISOString(),
  };
}

async function recordContactTimelineEvent(
  businessId: string,
  prospectId: string,
  eventType: string,
  title: string,
  description: string,
  payload: Record<string, unknown>,
  client?: PoolClient,
): Promise<void> {
  await executeQuery(
    `
      insert into revenue_agent_email_events (
        business_id,
        prospect_id,
        event_type,
        payload_json,
        occurred_at
      ) values (
        $1::uuid,
        $2::uuid,
        $3,
        $4::jsonb,
        now()
      )
    `,
    [businessId, prospectId, eventType, JSON.stringify({ title, description, ...payload })],
    client,
  );
}

function computeContactConfidence(candidate: RevenueAgentPersonCandidate, options: { verified: boolean }): number {
  let score = Math.max(0, Math.min(100, Math.round(candidate.confidence)));
  score += Math.max(0, candidate.titleRank / 2);

  if (options.verified) {
    score += 18;
  }

  if (candidate.directPhone) {
    score += 8;
  }

  if (candidate.source === "apollo") {
    score += 10;
  }

  if (candidate.titleRank >= 90) {
    score += 8;
  } else if (candidate.titleRank >= 70) {
    score += 4;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

function toIsoString(value: Date | string | null | undefined): string | undefined {
  return value ? new Date(value).toISOString() : undefined;
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

function getApolloApiKey(): string | undefined {
  return process.env.APOLLO_API_KEY?.trim();
}

function getHunterApiKey(): string | undefined {
  return process.env.HUNTER_API_KEY?.trim();
}

function createProviderHealth(
  enabled: boolean,
  configured: boolean,
  available: boolean,
  reason?: string,
  quotaRemaining?: number,
): ProviderHealthState {
  return {
    enabled,
    configured,
    available,
    reason,
    quotaRemaining,
  };
}

function describeProviderFailure(provider: string, error: unknown): string {
  if (error instanceof HttpError) {
    const status = typeof error.details?.status === "number" ? Number(error.details.status) : error.statusCode;
    if (status === 401 || status === 403) {
      return `${provider} authentication failed.`;
    }

    if (status === 429) {
      return `${provider} rate limit or quota exhausted.`;
    }

    if (status === 504) {
      return `${provider} request timed out.`;
    }

    return `${provider} request failed with status ${status}.`;
  }

  if (error instanceof DOMException && error.name === "AbortError") {
    return `${provider} request timed out.`;
  }

  if (error instanceof Error) {
    const message = error.message.trim();
    if (/timeout/i.test(message)) {
      return `${provider} request timed out.`;
    }

    if (/network|fetch/i.test(message)) {
      return `${provider} network failure.`;
    }
  }

  return `${provider} unavailable.`;
}

function extractQuotaRemaining(error: unknown): number | undefined {
  if (error instanceof HttpError && typeof error.details?.quotaRemaining === "number") {
    return Number(error.details.quotaRemaining);
  }

  return undefined;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const timeoutMs = 15000;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const onAbort = () => controller.abort();
  if (init?.signal) {
    if (init.signal.aborted) {
      controller.abort();
    } else {
      init.signal.addEventListener("abort", onAbort, { once: true });
    }
  }

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new HttpError(502, "contact_enrichment_provider_failed", text.trim() || `Request failed with status ${response.status}.`, {
        status: response.status,
      });
    }

    try {
      return (await response.json()) as T;
    } catch (error) {
      throw new HttpError(502, "contact_enrichment_provider_failed", "Failed to parse provider response.", {
        reason: "parse_error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  } catch (error) {
    if (timedOut) {
      throw new HttpError(504, "contact_enrichment_provider_timeout", "Request timed out.", {
        reason: "timeout",
      });
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
    if (init?.signal) {
      init.signal.removeEventListener("abort", onAbort);
    }
  }
}

function parseApolloMatches<T extends ApolloOrganizationResult | ApolloPeopleResult>(payload: ApolloSearchResponse<T>): T[] {
  if (Array.isArray(payload.organizations)) {
    return payload.organizations;
  }

  if (Array.isArray(payload.people)) {
    return payload.people;
  }

  if (Array.isArray(payload.results)) {
    return payload.results;
  }

  if (Array.isArray(payload.data)) {
    return payload.data;
  }

  return [];
}

function normalizeApolloOrganization(result: ApolloOrganizationResult, fallbackDomain?: string): RevenueAgentOrganizationMatch | null {
  const sourceId = normalizeOptional(result.id);
  const name = normalizeOptional(result.name);
  const domain = normalizeDomain(result.domain ?? result.primary_domain ?? fallbackDomain);
  const website = normalizeOptional(result.website_url);

  if (!sourceId || !name) {
    return null;
  }

  return {
    source: "apollo",
    sourceId,
    name,
    domain,
    website,
    confidence: Math.max(0, Math.min(100, normalizeNumber(result.confidence, 78))),
    raw: result.raw ?? {},
  };
}

function normalizeApolloPerson(result: ApolloPeopleResult, organization: RevenueAgentOrganizationMatch): RevenueAgentPersonCandidate | null {
  const sourceId = normalizeOptional(result.id);
  const fullName = normalizeOptional(result.name) || [result.first_name, result.last_name].filter(Boolean).join(" ").trim();
  const firstName = normalizeOptional(result.first_name) || fullName.split(/\s+/)[0] || "";
  const lastName = normalizeOptional(result.last_name) || fullName.split(/\s+/).slice(1).join(" ");
  const title = normalizeOptional(result.title);

  if (!sourceId || !fullName || !title) {
    return null;
  }

  return {
    source: "apollo",
    sourceId,
    organizationSourceId: organization.sourceId,
    organizationName: organization.name,
    firstName,
    lastName,
    fullName,
    title,
    department: normalizeOptional(result.department),
    email: normalizeOptional(result.email),
    directPhone: normalizeOptional(result.direct_phone),
    linkedinUrl: normalizeOptional(result.linkedin_url),
    confidence: Math.max(0, Math.min(100, normalizeNumber(result.confidence, organization.confidence - 6))),
    titleRank: 0,
    raw: result as Record<string, unknown>,
  };
}

function parseApolloOrganizationMatch(payload: ApolloOrganizationEnrichResponse | ApolloSearchResponse<ApolloOrganizationResult>): ApolloOrganizationResult | null {
  const typedPayload = payload as ApolloOrganizationEnrichResponse;
  const searchPayload = payload as ApolloSearchResponse<ApolloOrganizationResult>;
  return typedPayload.organization ?? typedPayload.result ?? searchPayload.organizations?.[0] ?? searchPayload.data?.[0] ?? null;
}

function parseApolloPeopleMatch(payload: ApolloPeopleMatchResponse | ApolloSearchResponse<ApolloPeopleResult>): ApolloPeopleResult | null {
  const typedPayload = payload as ApolloPeopleMatchResponse;
  const searchPayload = payload as ApolloSearchResponse<ApolloPeopleResult>;
  return typedPayload.person ?? typedPayload.result ?? searchPayload.people?.[0] ?? searchPayload.data?.[0] ?? null;
}

function normalizeHunterCandidate(
  item: HunterEmailAddress,
  organization: RevenueAgentOrganizationMatch,
): RevenueAgentPersonCandidate | null {
  const email = normalizeOptional(item.value);
  if (!email) {
    return null;
  }

  const nameParts = [normalizeOptional(item.first_name), normalizeOptional(item.last_name)].filter(Boolean);
  const fullName = nameParts.join(" ").trim() || email.split("@")[0].replace(/[._-]+/g, " ");
  const firstName = normalizeOptional(item.first_name) || fullName.split(/\s+/)[0] || "";
  const lastName = normalizeOptional(item.last_name) || fullName.split(/\s+/).slice(1).join(" ");

  return {
    source: "hunter",
    sourceId: email,
    organizationSourceId: organization.sourceId,
    organizationName: organization.name,
    firstName,
    lastName,
    fullName,
    title: normalizeOptional(item.position) || "Decision maker",
    department: normalizeOptional(item.department),
    email,
    directPhone: normalizeOptional(item.phone_number),
    linkedinUrl: normalizeOptional(item.linkedin_url),
    confidence: Math.max(0, Math.min(100, normalizeNumber(item.confidence, 70))),
    titleRank: 0,
    raw: item as Record<string, unknown>,
  };
}

function createApolloProvider(): ContactEnrichmentProvider {
  const apiKey = getApolloApiKey();
  const health = createProviderHealth(true, Boolean(apiKey), Boolean(apiKey), apiKey ? undefined : "APOLLO_API_KEY is not configured.");

  const markAvailable = () => {
    health.configured = true;
    health.available = true;
    health.reason = undefined;
    health.quotaRemaining = undefined;
  };

  const markUnavailable = (reason: string, quotaRemaining?: number) => {
    health.configured = Boolean(apiKey);
    health.available = false;
    health.reason = reason;
    if (typeof quotaRemaining === "number") {
      health.quotaRemaining = quotaRemaining;
    }
  };

  return {
    health,
    async findOrganization(input: {
      companyName: string;
      domain?: string;
      website?: string;
      city?: string;
      state?: string;
    }): Promise<RevenueAgentOrganizationMatch | null> {
      if (!apiKey) {
        return null;
      }

      try {
        const payload = await fetchJson<ApolloSearchResponse<ApolloOrganizationResult>>("https://api.apollo.io/api/v1/organizations/search", {
          method: "POST",
          headers: getApolloHeaders(apiKey),
          body: JSON.stringify({
            q_organization_name: input.companyName,
            organization_domains: [input.domain].filter(Boolean),
            page: 1,
            per_page: 5,
            city: input.city,
            state: input.state,
          }),
        });

        const matches = parseApolloMatches(payload)
          .map((result) => normalizeApolloOrganization(result, input.domain))
          .filter((item): item is RevenueAgentOrganizationMatch => Boolean(item));

        const match = matches[0] ?? null;
        if (!match) {
          markAvailable();
          return null;
        }

        const enriched = await fetchJson<ApolloOrganizationEnrichResponse>("https://api.apollo.io/api/v1/organizations/enrich", {
          method: "POST",
          headers: getApolloHeaders(apiKey),
          body: JSON.stringify({
            organization_id: match.sourceId,
            organization_name: match.name,
            organization_domain: match.domain,
          }),
        }).catch(() => null);

        const enrichedMatch = enriched ? normalizeApolloOrganization(parseApolloOrganizationMatch(enriched) ?? {}, input.domain) : null;
        markAvailable();
        return enrichedMatch ?? match;
      } catch (error) {
        markUnavailable(describeProviderFailure("Apollo", error), extractQuotaRemaining(error));
        return null;
      }
    },
    async searchPeople(input: {
      organization: RevenueAgentOrganizationMatch;
      targetTitles: string[];
      limit: number;
    }): Promise<RevenueAgentPersonCandidate[]> {
      if (!apiKey) {
        return [];
      }

      try {
        const payload = await fetchJson<ApolloSearchResponse<ApolloPeopleResult>>("https://api.apollo.io/api/v1/mixed_people/api_search", {
          method: "POST",
          headers: getApolloHeaders(apiKey),
          body: JSON.stringify({
            organization_ids: [input.organization.sourceId],
            person_titles: input.targetTitles,
            page: 1,
            per_page: Math.max(1, Math.min(25, input.limit)),
            sort_by_field: "confidence",
            sort_ascending: false,
          }),
        });

        markAvailable();
        return parseApolloMatches(payload)
          .map((result) => normalizeApolloPerson(result, input.organization))
          .filter((item): item is RevenueAgentPersonCandidate => Boolean(item));
      } catch (error) {
        markUnavailable(describeProviderFailure("Apollo", error), extractQuotaRemaining(error));
        return [];
      }
    },
    async enrichPerson(candidate: RevenueAgentPersonCandidate): Promise<RevenueAgentEnrichedPerson> {
      if (!apiKey) {
        return {
          ...candidate,
          emailVerificationStatus: "not_started",
        };
      }

      try {
        const payload = await fetchJson<ApolloPeopleMatchResponse>("https://api.apollo.io/api/v1/people/match", {
          method: "POST",
          headers: getApolloHeaders(apiKey),
          body: JSON.stringify({
            first_name: candidate.firstName,
            last_name: candidate.lastName,
            name: candidate.fullName,
            title: candidate.title,
            organization_name: candidate.organizationName,
            organization_domain: candidate.organizationDomain,
            organization_id: candidate.organizationSourceId,
            person_email: candidate.email,
          }),
        });

        const matched = parseApolloPeopleMatch(payload);
        if (!matched) {
          markAvailable();
          return {
            ...candidate,
            emailVerificationStatus: "not_started",
          };
        }

        markAvailable();
        const email = normalizeOptional(matched.email) || candidate.email;
        return {
          ...candidate,
          firstName: normalizeOptional(matched.first_name) || candidate.firstName,
          lastName: normalizeOptional(matched.last_name) || candidate.lastName,
          fullName: normalizeOptional(matched.name) || candidate.fullName,
          title: normalizeOptional(matched.title) || candidate.title,
          department: normalizeOptional(matched.department) || candidate.department,
          email,
          directPhone: normalizeOptional(matched.direct_phone) || candidate.directPhone,
          linkedinUrl: normalizeOptional(matched.linkedin_url) || candidate.linkedinUrl,
          confidence: Math.max(candidate.confidence, normalizeNumber(matched.confidence, candidate.confidence)),
          emailVerificationStatus: "not_started",
        };
      } catch (error) {
        markUnavailable(describeProviderFailure("Apollo", error), extractQuotaRemaining(error));
        return {
          ...candidate,
          emailVerificationStatus: "not_started",
        };
      }
    },
  };
}

function findHunterEmail(input: {
  apiKey: string;
  firstName?: string;
  lastName?: string;
  domain?: string;
  fullName?: string;
}): Promise<HunterEmailFinderResponse> {
  const params = new URLSearchParams({
    api_key: input.apiKey,
  });

  const domain = normalizeDomain(input.domain);
  if (domain) {
    params.set("domain", domain);
  }

  if (input.firstName?.trim()) {
    params.set("first_name", input.firstName.trim());
  }

  if (input.lastName?.trim()) {
    params.set("last_name", input.lastName.trim());
  }

  if (input.fullName?.trim()) {
    params.set("full_name", input.fullName.trim());
  }

  return fetchJson<HunterEmailFinderResponse>(`https://api.hunter.io/v2/email-finder?${params.toString()}`);
}

function createHunterProvider(): ContactEnrichmentProvider {
  const apiKey = getHunterApiKey();
  const health = createProviderHealth(true, Boolean(apiKey), Boolean(apiKey), apiKey ? undefined : "HUNTER_API_KEY is not configured.");

  const markAvailable = () => {
    health.configured = true;
    health.available = true;
    health.reason = undefined;
    health.quotaRemaining = undefined;
  };

  const markUnavailable = (reason: string, quotaRemaining?: number) => {
    health.configured = Boolean(apiKey);
    health.available = false;
    health.reason = reason;
    if (typeof quotaRemaining === "number") {
      health.quotaRemaining = quotaRemaining;
    }
  };

  return {
    health,
    async findOrganization(input: {
      companyName: string;
      domain?: string;
      website?: string;
      city?: string;
      state?: string;
    }): Promise<RevenueAgentOrganizationMatch | null> {
      if (!apiKey) {
        return null;
      }

      const domain = normalizeDomain(input.domain ?? input.website);

      if (!domain) {
        return null;
      }

      try {
        const payload = await fetchJson<HunterDomainSearchResponse>(
          `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&api_key=${encodeURIComponent(apiKey)}`,
        );
        const organizationName = normalizeOptional(payload.data?.organization) || input.companyName;
        markAvailable();

        return {
          source: "hunter",
          sourceId: domain,
          name: organizationName,
          domain,
          website: input.website,
          city: input.city,
          state: input.state,
          confidence: 72,
          raw: payload.data as Record<string, unknown>,
        };
      } catch (error) {
        markUnavailable(describeProviderFailure("Hunter", error), extractQuotaRemaining(error));
        return null;
      }
    },
    async searchPeople(input: {
      organization: RevenueAgentOrganizationMatch;
      targetTitles: string[];
      limit: number;
    }): Promise<RevenueAgentPersonCandidate[]> {
      if (!apiKey) {
        return [];
      }

      const domain = normalizeDomain(input.organization.domain);
      if (!domain) {
        return [];
      }

      try {
        const payload = await fetchJson<HunterDomainSearchResponse>(
          `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&api_key=${encodeURIComponent(apiKey)}`,
        );

        const candidates = (payload.data?.email_addresses ?? [])
          .map((item) => normalizeHunterCandidate(item, input.organization))
          .filter((item): item is RevenueAgentPersonCandidate => Boolean(item));

        markAvailable();
        return candidates.slice(0, Math.max(1, Math.min(25, input.limit)));
      } catch (error) {
        markUnavailable(describeProviderFailure("Hunter", error), extractQuotaRemaining(error));
        return [];
      }
    },
    async enrichPerson(candidate: RevenueAgentPersonCandidate): Promise<RevenueAgentEnrichedPerson> {
      if (!candidate.email) {
        if (apiKey) {
          try {
            const response = await findHunterEmail({
              apiKey,
              firstName: candidate.firstName,
              lastName: candidate.lastName,
              domain: candidate.organizationDomain || candidate.organizationWebsite,
              fullName: candidate.fullName,
            });
            const email = normalizeOptional(response.data?.email);
            if (email) {
              markAvailable();
              const verified = await verifyHunterEmail(email);
              if (verified.providerError) {
                markUnavailable(verified.reason || "Hunter email verification failed.");
              }
              return {
                ...candidate,
                email,
                emailVerificationStatus: verified.status,
                emailVerifiedAt: verified.status === "verified" ? new Date().toISOString() : undefined,
                verificationSource: "hunter",
                verifiedEmail: verified.email ?? email,
                verifiedDomain: verified.domain,
                verifiedReason: verified.reason,
              };
            }
          } catch (error) {
            markUnavailable(describeProviderFailure("Hunter", error), extractQuotaRemaining(error));
          }
        }

        return {
          ...candidate,
          emailVerificationStatus: "not_started",
        };
      }

      try {
        const verified = await verifyHunterEmail(candidate.email);
        if (verified.providerError) {
          markUnavailable(verified.reason || "Hunter email verification failed.");
        } else {
          markAvailable();
        }
        return {
          ...candidate,
          email: verified.email ?? candidate.email,
          emailVerificationStatus: verified.status,
          emailVerifiedAt: verified.status === "verified" ? new Date().toISOString() : undefined,
          verificationSource: "hunter",
          verifiedEmail: verified.email ?? candidate.email,
          verifiedDomain: verified.domain,
          verifiedReason: verified.reason,
        };
      } catch (error) {
        markUnavailable(describeProviderFailure("Hunter", error), extractQuotaRemaining(error));
        return {
          ...candidate,
          emailVerificationStatus: "unknown",
        };
      }
    },
  };
}

async function verifyHunterEmail(email: string): Promise<{
  email: string;
  status: RevenueAgentContactEmailVerificationStatus;
  domain?: string;
  reason?: string;
  providerError?: boolean;
}> {
  const apiKey = getHunterApiKey();

  if (!apiKey) {
    return {
      email,
      status: "unknown",
    };
  }

  try {
    const payload = await fetchJson<HunterEmailVerifyResponse>(
      `https://api.hunter.io/v2/email-verifier?email=${encodeURIComponent(email)}&api_key=${encodeURIComponent(apiKey)}`,
    );
    const data = payload.data;
    const normalized = (data?.status ?? data?.result ?? "").trim().toLowerCase();

    let status: RevenueAgentContactEmailVerificationStatus = "unknown";
    if (normalized === "valid" || normalized === "deliverable") {
      status = "verified";
    } else if (normalized === "invalid" || normalized === "undeliverable") {
      status = "invalid";
    } else if (normalized === "risky" || normalized === "accept_all") {
      status = "risky";
    }

    return {
      email: data?.email?.trim() || email,
      status,
      domain: normalizeDomain(email.split("@")[1] || ""),
      reason: data?.reason?.trim() || undefined,
      providerError: false,
    };
  } catch (error) {
    return {
      email,
      status: "unknown",
      reason: describeProviderFailure("Hunter", error),
      providerError: true,
    };
  }
}

const FALLBACK_PROVIDER: ContactEnrichmentProvider = {
  health: createProviderHealth(true, true, true, "Fallback provider is active."),
  async findOrganization(input) {
    const domain = normalizeDomain(input.domain ?? input.website);
    if (!domain) {
      return null;
    }

    return {
      source: "hunter",
      sourceId: domain,
      name: input.companyName,
      domain,
      website: input.website,
      city: input.city,
      state: input.state,
      confidence: 60,
    };
  },
  async searchPeople(input) {
    const titles = input.targetTitles.slice(0, Math.max(1, Math.min(25, input.limit)));
    return titles.map((title, index) => ({
      source: "hunter",
      sourceId: `${input.organization.sourceId}:${index}`,
      organizationSourceId: input.organization.sourceId,
      organizationName: input.organization.name,
      firstName: "Decision",
      lastName: "Maker",
      fullName: `${titleCase(title)} Lead`,
      title,
      confidence: 45,
      titleRank: index,
    }));
  },
  async enrichPerson(candidate) {
    return {
      ...candidate,
      emailVerificationStatus: "not_started",
    };
  },
};

interface ContactEnrichmentRuntime {
  provider: ContactEnrichmentProvider;
  providers: Array<{
    name: ProviderHealthName;
    health: ProviderHealthState;
  }>;
}

function providerLabel(name: ProviderHealthName): string {
  if (name === "apollo") {
    return "Apollo";
  }

  if (name === "hunter") {
    return "Hunter";
  }

  return "Fallback";
}

async function recordUnavailableProviderEvents(
  businessId: string,
  prospectId: string,
  providers: ContactEnrichmentRuntime["providers"],
  client?: PoolClient,
): Promise<void> {
  for (const provider of providers) {
    if (provider.health.available) {
      continue;
    }

    await recordContactTimelineEvent(
      businessId,
      prospectId,
      "contact_enrichment_skipped",
      `${providerLabel(provider.name)} skipped`,
      `${providerLabel(provider.name)} was skipped because ${provider.health.reason || "it is unavailable"}.`,
      {
        provider: provider.name,
        available: provider.health.available,
        configured: provider.health.configured,
        enabled: provider.health.enabled,
        reason: provider.health.reason,
        quotaRemaining: provider.health.quotaRemaining,
      },
      client,
    );
  }
}

function normalizeText(value: string | undefined | null): string {
  return value?.trim().toLowerCase() ?? "";
}

function extractDomainFromProspect(prospect: Pick<ProspectRow, "website" | "website_normalized" | "source_url">): string | undefined {
  const source = normalizeOptional(prospect.website) || normalizeOptional(prospect.source_url);

  if (!source) {
    return prospect.website_normalized ?? undefined;
  }

  return normalizeDomain(source);
}

function getTargetTitles(industry: string): string[] {
  const normalized = normalizeText(industry);
  const base = [
    "owner",
    "founder",
    "co-owner",
    "president",
    "general manager",
    "operations manager",
    "office manager",
    "marketing manager",
  ];

  if (normalized.includes("hvac") || normalized.includes("plumb")) {
    return [
      "owner",
      "founder",
      "president",
      "general manager",
      "operations manager",
      "service manager",
      "office manager",
      "dispatcher",
      "marketing manager",
    ];
  }

  if (normalized.includes("salon") || normalized.includes("spa") || normalized.includes("med spa") || normalized.includes("medspa")) {
    return [
      "owner",
      "founder",
      "general manager",
      "practice manager",
      "salon manager",
      "spa director",
      "operations manager",
      "marketing manager",
    ];
  }

  if (normalized.includes("dental") || normalized.includes("dentist")) {
    return [
      "owner",
      "founder",
      "dentist",
      "practice owner",
      "practice manager",
      "office manager",
      "operations manager",
      "marketing manager",
    ];
  }

  return base;
}

function scoreTitle(title: string, targetTitles: string[]): number {
  const normalized = normalizeText(title);
  const rankedTargets = targetTitles.map((item) => normalizeText(item));

  let score = 0;
  for (let index = 0; index < rankedTargets.length; index += 1) {
    const target = rankedTargets[index];
    if (!target) {
      continue;
    }

    if (normalized === target) {
      score += 100 - index * 7;
      break;
    }

    if (normalized.includes(target) || target.includes(normalized)) {
      score += 82 - index * 6;
      break;
    }
  }

  if (/\bowner|founder|president|ceo|principal\b/.test(normalized)) {
    score += 20;
  }

  if (/\bmanager|director|head|chief|operator\b/.test(normalized)) {
    score += 12;
  }

  return Math.max(0, Math.min(100, score));
}

function rankCandidates(candidates: RevenueAgentPersonCandidate[], targetTitles: string[]): RevenueAgentPersonCandidate[] {
  return [...candidates]
    .map((candidate) => ({
      ...candidate,
      titleRank: scoreTitle(candidate.title, targetTitles),
      confidence: Math.max(0, Math.min(100, candidate.confidence + scoreTitle(candidate.title, targetTitles) / 5)),
    }))
    .sort((left, right) => {
      const confidenceDelta = right.confidence - left.confidence;
      if (confidenceDelta !== 0) {
        return confidenceDelta;
      }

      return right.titleRank - left.titleRank;
    });
}

function mapStatusFromEnrichment(
  candidates: RevenueAgentContactRecord[],
  primaryContact?: RevenueAgentContactRecord,
): RevenueAgentContactEnrichmentStatus {
  if (candidates.length === 0) {
    return "no_match";
  }

  if (primaryContact?.emailVerificationStatus === "verified") {
    return "verified";
  }

  if (primaryContact) {
    return "found";
  }

  return "needs_review";
}

function parseJsonArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => (typeof item === "string" ? item.trim() : "")).filter((item) => item.length > 0)
    : [];
}

function mapContactRow(row: ProspectContactRow): RevenueAgentContactRecord {
  return {
    id: row.id,
    businessId: row.business_id,
    prospectId: row.prospect_id,
    source: row.source as RevenueAgentContactEnrichmentProviderName,
    sourceId: row.source_id,
    organizationSourceId: row.organization_source_id ?? row.source_id,
    personSourceId: row.person_source_id ?? row.source_id,
    sourceIds: parseJsonArray(row.source_ids_json),
    sourceNames: parseJsonArray(row.source_names_json).filter((value): value is RevenueAgentContactEnrichmentProviderName => value === "apollo" || value === "hunter"),
    isPrimary: row.is_primary,
    manualOverride: row.manual_override,
    status: row.status,
    matchConfidence: normalizeNumber(row.match_confidence),
    fullName: row.full_name,
    firstName: row.first_name ?? "",
    lastName: row.last_name ?? "",
    title: row.title,
    department: row.department ?? undefined,
    email: row.email ?? undefined,
    directPhone: row.direct_phone ?? undefined,
    linkedinUrl: row.linkedin_url ?? undefined,
    organizationName: row.organization_name,
    organizationDomain: row.organization_domain ?? undefined,
    organizationWebsite: row.organization_website ?? undefined,
    city: row.city ?? undefined,
    state: row.state ?? undefined,
    confidence: normalizeNumber(row.match_confidence),
    contactConfidence: normalizeNumber(row.contact_confidence),
    titleRank: 0,
    emailVerificationStatus: row.email_verification_status,
    emailVerifiedAt: toIsoString(row.email_verified_at),
    verificationSource: row.verification_source === "apollo" || row.verification_source === "hunter" ? row.verification_source : undefined,
    verifiedEmail: row.verified_email ?? undefined,
    verifiedDomain: row.verified_domain ?? undefined,
    verifiedReason: row.verified_reason ?? undefined,
    raw: {
      sourceEvents: Array.isArray(row.enrichment_events_json) ? row.enrichment_events_json : [],
    },
    manuallyCorrectedAt: toIsoString(row.manually_corrected_at),
    lastEnrichedAt: toIsoString(row.last_enriched_at),
    createdAt: toIsoString(row.created_at) ?? new Date().toISOString(),
    updatedAt: toIsoString(row.updated_at) ?? undefined,
  };
}

async function getBusinessRow(businessId: string, client?: PoolClient): Promise<BusinessRow> {
  const result = await executeQuery<BusinessRow>(
    `
      select id, name, brand_name, website_url, niche
      from businesses
      where id = $1::uuid
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

async function loadProspectRow(prospectId: string, client?: PoolClient): Promise<ProspectRow> {
  const result = await executeQuery<ProspectRow>(
    `
      select id, business_id, business_name, website, website_normalized, email, email_normalized, phone, phone_normalized, city, state, industry, source, source_url, opportunity_score
      from prospects
      where id = $1::uuid
      limit 1
    `,
    [prospectId],
    client,
  );

  const row = result.rows[0];
  if (!row) {
    throw new HttpError(404, "prospect_not_found", "Prospect not found.");
  }

  return row;
}

async function loadProspectContacts(prospectId: string, client?: PoolClient): Promise<RevenueAgentContactRecord[]> {
  const result = await executeQuery<ProspectContactRow>(
    `
      select
        id,
        business_id,
        prospect_id,
        source,
        source_id,
        organization_source_id,
        person_source_id,
        dedupe_key,
        full_name,
        first_name,
        last_name,
        title,
        department,
        email,
        email_normalized,
        email_verification_status,
        email_verified_at,
        verification_source,
        verified_email,
        verified_domain,
        verified_reason,
        direct_phone,
        direct_phone_normalized,
        linkedin_url,
        organization_name,
        organization_domain,
        organization_website,
        city,
        state,
        status,
        match_confidence,
        contact_confidence,
        source_ids_json,
        source_names_json,
        enrichment_events_json,
        is_primary,
        manual_override,
        manually_corrected_at,
        last_enriched_at,
        created_at,
        updated_at
      from prospect_contacts
      where prospect_id = $1::uuid
      order by is_primary desc, match_confidence desc, updated_at desc, created_at desc
    `,
    [prospectId],
    client,
  );

  return result.rows.map(mapContactRow);
}

async function persistContact(
  businessId: string,
  prospectId: string,
  candidate: RevenueAgentEnrichedPerson,
  options: {
    organization: RevenueAgentOrganizationMatch;
    isPrimary: boolean;
    status: RevenueAgentContactEnrichmentStatus;
    sourceIds: string[];
    sourceNames: RevenueAgentContactEnrichmentProviderName[];
    manualOverride?: boolean;
    events: Record<string, unknown>[];
  },
  client?: PoolClient,
): Promise<RevenueAgentContactRecord> {
  const sourceIds = [...new Set(options.sourceIds.filter(Boolean))];
  const sourceNames = [...new Set(options.sourceNames.filter(Boolean))];
  const dedupeKey = [
    normalizeText(candidate.email),
    normalizeText(candidate.fullName),
    normalizeText(candidate.title),
    normalizeText(options.organization.domain),
    normalizeText(options.organization.name),
  ]
    .filter(Boolean)
    .join("|");

  const existing = await executeQuery<ProspectContactRow>(
    `
      select
        id,
        business_id,
        prospect_id,
        source,
        source_id,
        organization_source_id,
        person_source_id,
        dedupe_key,
        full_name,
        first_name,
        last_name,
        title,
        department,
        email,
        email_normalized,
        email_verification_status,
        email_verified_at,
        verification_source,
        verified_email,
        verified_domain,
        verified_reason,
        direct_phone,
        direct_phone_normalized,
        linkedin_url,
        organization_name,
        organization_domain,
        organization_website,
        city,
        state,
        status,
        match_confidence,
        contact_confidence,
        source_ids_json,
        source_names_json,
        enrichment_events_json,
        is_primary,
        manual_override,
        manually_corrected_at,
        last_enriched_at,
        created_at,
        updated_at
      from prospect_contacts
      where business_id = $1::uuid
        and prospect_id = $2::uuid
        and dedupe_key = $3
      limit 1
    `,
    [businessId, prospectId, dedupeKey],
    client,
  );

  const now = new Date().toISOString();
  const mergedEvents = [
    ...((existing.rows[0] && Array.isArray(existing.rows[0].enrichment_events_json))
      ? (existing.rows[0].enrichment_events_json as Record<string, unknown>[])
      : []),
    ...options.events,
    buildSourceEvent(candidate.source, candidate.sourceId, "persist", options.status),
  ];

  const result = existing.rows[0]
    ? await executeQuery<ProspectContactRow>(
        `
          update prospect_contacts
          set
            source = $4,
            source_id = $5,
            organization_source_id = coalesce($6::text, organization_source_id),
            person_source_id = coalesce($7::text, person_source_id),
            full_name = case when manual_override then full_name else $8 end,
            first_name = case when manual_override then first_name else $9 end,
            last_name = case when manual_override then last_name else $10 end,
            title = case when manual_override then title else $11 end,
            department = case when manual_override then department else $12 end,
            email = case when manual_override then email else $13 end,
            email_normalized = case when manual_override then email_normalized else $14 end,
            email_verification_status = case when manual_override then email_verification_status else $15 end,
            email_verified_at = case when manual_override then email_verified_at else $16::timestamptz end,
            verification_source = case when manual_override then verification_source else $17 end,
            verified_email = case when manual_override then verified_email else $18 end,
            verified_domain = case when manual_override then verified_domain else $19 end,
            verified_reason = case when manual_override then verified_reason else $20 end,
            direct_phone = case when manual_override then direct_phone else $21 end,
            direct_phone_normalized = case when manual_override then direct_phone_normalized else $22 end,
            linkedin_url = case when manual_override then linkedin_url else $23 end,
            organization_name = case when manual_override then organization_name else $24 end,
            organization_domain = case when manual_override then organization_domain else $25 end,
            organization_website = case when manual_override then organization_website else $26 end,
            city = case when manual_override then city else $27 end,
            state = case when manual_override then state else $28 end,
            status = case when manual_override then status else $29 end,
            match_confidence = case when manual_override then match_confidence else $30::int end,
            contact_confidence = case when manual_override then contact_confidence else $31::int end,
            source_ids_json = $32::jsonb,
            source_names_json = $33::jsonb,
            enrichment_events_json = $34::jsonb,
            is_primary = $35::boolean,
            manual_override = manual_override OR $36::boolean,
            last_enriched_at = coalesce($37::timestamptz, last_enriched_at),
            updated_at = now()
          where id = $1::uuid
          returning
            id,
            business_id,
            prospect_id,
            source,
            source_id,
            organization_source_id,
            person_source_id,
            dedupe_key,
            full_name,
            first_name,
            last_name,
            title,
            department,
            email,
            email_normalized,
            email_verification_status,
            email_verified_at,
            verification_source,
            verified_email,
            verified_domain,
            verified_reason,
            direct_phone,
            direct_phone_normalized,
            linkedin_url,
            organization_name,
            organization_domain,
            organization_website,
            city,
            state,
            status,
            match_confidence,
            contact_confidence,
            source_ids_json,
            source_names_json,
            enrichment_events_json,
            is_primary,
            manual_override,
            manually_corrected_at,
            last_enriched_at,
            created_at,
            updated_at
        `,
        [
          existing.rows[0].id,
          dedupeKey,
          prospectId,
          candidate.source,
          candidate.sourceId,
          candidate.organizationSourceId,
          candidate.sourceId,
          candidate.fullName,
          candidate.firstName,
          candidate.lastName,
          candidate.title,
          candidate.department ?? null,
          candidate.email ?? null,
          normalizeOptional(candidate.email),
          candidate.emailVerificationStatus,
          candidate.emailVerifiedAt ?? null,
          candidate.verificationSource ?? null,
          candidate.verifiedEmail ?? null,
          candidate.verifiedDomain ?? null,
          candidate.verifiedReason ?? null,
          candidate.directPhone ?? null,
          normalizeOptional(candidate.directPhone),
          candidate.linkedinUrl ?? null,
          candidate.organizationName,
          candidate.organizationDomain ?? null,
          candidate.organizationWebsite ?? null,
          candidate.city ?? null,
          candidate.state ?? null,
          options.status,
          Math.max(0, Math.min(100, Math.round(candidate.confidence))),
          computeContactConfidence(candidate, { verified: candidate.emailVerificationStatus === "verified" }),
          JSON.stringify(sourceIds),
          JSON.stringify(sourceNames),
          JSON.stringify(mergedEvents),
          options.isPrimary,
          Boolean(options.manualOverride),
          Boolean(options.manualOverride) ? now : null,
          now,
        ],
        client,
      )
    : await executeQuery<ProspectContactRow>(
        `
          insert into prospect_contacts (
            business_id,
            prospect_id,
            source,
            source_id,
            organization_source_id,
            person_source_id,
            dedupe_key,
            full_name,
            first_name,
            last_name,
            title,
            department,
            email,
            email_normalized,
            email_verification_status,
            email_verified_at,
            verification_source,
            verified_email,
            verified_domain,
            verified_reason,
            direct_phone,
            direct_phone_normalized,
            linkedin_url,
            organization_name,
            organization_domain,
            organization_website,
            city,
            state,
            status,
            match_confidence,
            contact_confidence,
            source_ids_json,
            source_names_json,
            enrichment_events_json,
            is_primary,
            manual_override,
            manually_corrected_at,
            last_enriched_at
          ) values (
            $1::uuid,
            $2::uuid,
            $3,
            $4,
            $5,
            $6,
            $7,
            $8,
            $9,
            $10,
            $11,
            $12,
            $13,
            $14,
            $15,
            $16::timestamptz,
            $17,
            $18,
            $19,
            $20,
            $21,
            $22,
            $23,
            $24,
            $25,
            $26,
            $27,
            $28,
            $29,
            $30,
            $31::jsonb,
            $32::jsonb,
            $33::jsonb,
            $34::boolean,
            $35::boolean,
            $36::timestamptz,
            $37::timestamptz
          )
          returning
            id,
            business_id,
            prospect_id,
            source,
            source_id,
            organization_source_id,
            person_source_id,
            dedupe_key,
            full_name,
            first_name,
            last_name,
            title,
            department,
            email,
            email_normalized,
            email_verification_status,
            email_verified_at,
            verification_source,
            verified_email,
            verified_domain,
            verified_reason,
            direct_phone,
            direct_phone_normalized,
            linkedin_url,
            organization_name,
            organization_domain,
            organization_website,
            city,
            state,
            status,
            match_confidence,
            contact_confidence,
            source_ids_json,
            source_names_json,
            enrichment_events_json,
            is_primary,
            manual_override,
            manually_corrected_at,
            last_enriched_at,
            created_at,
            updated_at
        `,
        [
          businessId,
          prospectId,
          candidate.source,
          candidate.sourceId,
          candidate.organizationSourceId,
          candidate.sourceId,
          dedupeKey,
          candidate.fullName,
          candidate.firstName,
          candidate.lastName,
          candidate.title,
          candidate.department ?? null,
          candidate.email ?? null,
          normalizeOptional(candidate.email),
          candidate.emailVerificationStatus,
          candidate.emailVerifiedAt ?? null,
          candidate.verificationSource ?? null,
          candidate.verifiedEmail ?? null,
          candidate.verifiedDomain ?? null,
          candidate.verifiedReason ?? null,
          candidate.directPhone ?? null,
          normalizeOptional(candidate.directPhone),
          candidate.linkedinUrl ?? null,
          candidate.organizationName,
          candidate.organizationDomain ?? null,
          candidate.organizationWebsite ?? null,
          candidate.city ?? null,
          candidate.state ?? null,
          options.status,
          Math.max(0, Math.min(100, Math.round(candidate.confidence))),
          computeContactConfidence(candidate, { verified: candidate.emailVerificationStatus === "verified" }),
          JSON.stringify(sourceIds),
          JSON.stringify(sourceNames),
          JSON.stringify(mergedEvents),
          options.isPrimary,
          Boolean(options.manualOverride),
          new Date().toISOString(),
        ],
        client,
      );

  return mapContactRow(result.rows[0]);
}

async function updatePrimaryContact(
  businessId: string,
  prospectId: string,
  contactId: string | null,
  client?: PoolClient,
): Promise<void> {
  await executeQuery(
    `
      update prospect_contacts
      set is_primary = case when id = $3::uuid then true else false end,
          updated_at = now()
      where business_id = $1::uuid
        and prospect_id = $2::uuid
    `,
    [businessId, prospectId, contactId],
    client,
  );
}

async function markProspectContactEnriched(
  businessId: string,
  prospectId: string,
  client?: PoolClient,
): Promise<void> {
  await executeQuery(
    `
      update prospects
      set last_contact_enriched_at = now(),
          updated_at = now()
      where business_id = $1::uuid
        and id = $2::uuid
    `,
    [businessId, prospectId],
    client,
  );
}

async function updateProspectReachability(
  businessId: string,
  prospect: Pick<ProspectRow, "id" | "website" | "source_url" | "status" | "review_count" | "opportunity_score" | "last_contact_enriched_at">,
  contacts: RevenueAgentContactRecord[],
  report?: RevenueAgentOpportunityReport | null,
  client?: PoolClient,
): Promise<void> {
  const snapshot = computeRevenueAgentReachability({
    prospect: {
      website: prospect.website ?? undefined,
      sourceUrl: prospect.source_url ?? undefined,
      status: prospect.status as RevenueAgentProspectStatus,
      reviewCount: Number(prospect.review_count ?? 0),
      lastContactEnrichedAt: prospect.last_contact_enriched_at ? new Date(prospect.last_contact_enriched_at).toISOString() : undefined,
      opportunityScore: Number(prospect.opportunity_score ?? 0),
    },
    contacts,
    report,
  });

  await executeQuery(
    `
      update prospects
      set
        decision_maker_confidence = $2::int,
        website_quality_score = $3::int,
        reachability_score = $4::int,
        reachability_reasons_json = $5::jsonb,
        ai_recommendation = $6,
        reachability_updated_at = now(),
        updated_at = now()
      where business_id = $1::uuid
        and id = $7::uuid
    `,
    [
      businessId,
      snapshot.decisionMakerConfidence,
      snapshot.websiteQualityScore,
      snapshot.reachabilityScore,
      JSON.stringify(snapshot.reachabilityReasons),
      snapshot.aiRecommendation,
      prospect.id,
    ],
    client,
  );
}

function buildContactEnrichmentRuntime(): ContactEnrichmentRuntime {
  const apollo = createApolloProvider();
  const hunter = createHunterProvider();

  return {
    provider: {
      health: FALLBACK_PROVIDER.health,
      async findOrganization(input) {
        return (await apollo.findOrganization(input)) ?? (await hunter.findOrganization(input)) ?? FALLBACK_PROVIDER.findOrganization(input);
      },
      async searchPeople(input) {
        const apolloResults = await apollo.searchPeople(input);
        if (apolloResults.length > 0) {
          return apolloResults;
        }

        const hunterResults = await hunter.searchPeople(input);
        if (hunterResults.length > 0) {
          return hunterResults;
        }

        return FALLBACK_PROVIDER.searchPeople(input);
      },
      async enrichPerson(candidate) {
        if (candidate.source === "apollo") {
          return apollo.enrichPerson(candidate);
        }

        if (candidate.source === "hunter") {
          return hunter.enrichPerson(candidate);
        }

        return FALLBACK_PROVIDER.enrichPerson(candidate);
      },
    },
    providers: [
      {
        name: "apollo",
        health: apollo.health,
      },
      {
        name: "hunter",
        health: hunter.health,
      },
    ],
  };
}

export async function enrichProspectContacts(
  input: RevenueAgentContactEnrichmentBatchRequest & { businessId: string },
  client?: PoolClient,
): Promise<{
  processedProspectIds: string[];
  updatedContactCount: number;
  verifiedContactCount: number;
  primaryContactCount: number;
  skippedProspectIds: string[];
}> {
  const runtime = buildContactEnrichmentRuntime();
  const provider = runtime.provider;
  const threshold = Math.max(0, Math.min(100, Math.floor(input.minimumOpportunityScore ?? 80)));
  const batchLimit = Math.max(1, Math.min(10, Math.floor(input.limit ?? 10)));
  const result = await executeQuery<ProspectRow>(
    `
      select
        id,
        business_id,
        business_name,
        website,
        website_normalized,
        email,
        email_normalized,
        phone,
        phone_normalized,
        city,
        state,
        status,
        industry,
        source,
        source_url,
        review_count,
        opportunity_score,
        last_contact_enriched_at
      from prospects
      where business_id = $1::uuid
        and opportunity_score >= $2::int
      order by opportunity_score desc, updated_at desc
      limit $3::int
    `,
    [input.businessId, threshold, batchLimit],
    client,
  );

  const requestedProspects = new Set((input.prospectIds ?? []).filter(Boolean));
  const prospects = result.rows.filter((row) => requestedProspects.size === 0 || requestedProspects.has(row.id));
  const processedProspectIds: string[] = [];
  const skippedProspectIds: string[] = [];
  let updatedContactCount = 0;
  let verifiedContactCount = 0;
  let primaryContactCount = 0;
  const enrichmentFreshnessCutoffMs = Date.now() - 30 * 24 * 60 * 60 * 1000;

  for (const prospect of prospects.slice(0, 10)) {
    processedProspectIds.push(prospect.id);
    const prospectLastEnrichedAt = prospect.last_contact_enriched_at ? new Date(prospect.last_contact_enriched_at).getTime() : 0;
    if (prospectLastEnrichedAt && prospectLastEnrichedAt > enrichmentFreshnessCutoffMs) {
      skippedProspectIds.push(prospect.id);
      await recordContactTimelineEvent(
        input.businessId,
        prospect.id,
        "contact_enrichment_skipped",
        "Contact enrichment skipped",
        "Recent contact enrichment is still fresh, so this prospect was skipped.",
        {
          reason: "freshness_window",
          lastContactEnrichedAt: toIsoString(prospect.last_contact_enriched_at),
          freshnessWindowDays: 30,
        },
        client,
      );
      continue;
    }

    await recordContactTimelineEvent(
      input.businessId,
      prospect.id,
      "contact_enrichment_started",
      "Contact enrichment started",
      "Contact enrichment workflow started for this prospect.",
      {
        threshold,
        domain: extractDomainFromProspect(prospect),
      },
      client,
    );

    await recordUnavailableProviderEvents(input.businessId, prospect.id, runtime.providers, client);

    const domain = extractDomainFromProspect(prospect);
    if (!domain && !normalizeOptional(prospect.website)) {
      skippedProspectIds.push(prospect.id);
      await recordContactTimelineEvent(
        input.businessId,
        prospect.id,
        "contact_enrichment_skipped",
        "Contact enrichment skipped",
        "No usable domain or website was available for contact matching.",
        {
          reason: "missing_domain",
        },
        client,
      );
      continue;
    }

    const organization =
      (await provider.findOrganization({
        companyName: prospect.business_name,
        domain,
        website: prospect.website ?? undefined,
        city: prospect.city ?? undefined,
        state: prospect.state ?? undefined,
      })) ??
      ({
        source: "hunter",
        sourceId: domain || prospect.id,
        name: prospect.business_name,
        domain,
        website: prospect.website ?? undefined,
        city: prospect.city ?? undefined,
        state: prospect.state ?? undefined,
        confidence: 48,
      } satisfies RevenueAgentOrganizationMatch);

    await recordContactTimelineEvent(
      input.businessId,
      prospect.id,
      "contact_match_found",
      "Decision maker match found",
      `Matched organization ${organization.name} for contact enrichment.`,
      {
        organizationSource: organization.source,
        organizationSourceId: organization.sourceId,
        organizationName: organization.name,
        organizationDomain: organization.domain,
        organizationConfidence: organization.confidence,
      },
      client,
    );

    const targetTitles = getTargetTitles(prospect.industry);
    const candidates = rankCandidates(
      await provider.searchPeople({
        organization,
        targetTitles,
        limit: 8,
      }),
      targetTitles,
    );

    if (candidates.length === 0) {
      skippedProspectIds.push(prospect.id);
      await recordContactTimelineEvent(
        input.businessId,
        prospect.id,
        "contact_enrichment_skipped",
        "Contact enrichment skipped",
        "No people matched the target titles for this prospect.",
        {
          reason: "no_person_candidates",
          targetTitles,
        },
        client,
      );
      continue;
    }

    const contactRecords: RevenueAgentContactRecord[] = [];

    for (const candidate of candidates.slice(0, 4)) {
      const enriched = await provider.enrichPerson(candidate);
      const isVerified = enriched.emailVerificationStatus === "verified";
      const status: RevenueAgentContactEnrichmentStatus = isVerified ? "verified" : enriched.email ? "found" : "needs_review";
      const record = await persistContact(
        input.businessId,
        prospect.id,
        {
          ...enriched,
          emailVerificationStatus: enriched.emailVerificationStatus,
        },
        {
          organization,
          isPrimary: false,
          status,
          sourceIds: [organization.sourceId, enriched.sourceId],
          sourceNames: [organization.source, enriched.source],
          events: [
            buildSourceEvent(organization.source, organization.sourceId, "organization_match", `Matched ${organization.name}`),
            buildSourceEvent(enriched.source, enriched.sourceId, "person_candidate", enriched.title),
          ],
        },
        client,
      );

      contactRecords.push(record);
      updatedContactCount += 1;
      if (record.emailVerificationStatus === "verified") {
        verifiedContactCount += 1;
        await recordContactTimelineEvent(
          input.businessId,
          prospect.id,
          "contact_verified",
          "Contact verified",
          `Verified ${record.fullName} at ${record.verifiedEmail || record.email || "unknown email"}.`,
          {
            contactId: record.id,
            source: record.source,
            sourceId: record.sourceId,
            fullName: record.fullName,
            title: record.title,
            email: record.verifiedEmail || record.email,
            contactConfidence: record.contactConfidence,
          },
          client,
        );
      }
    }

    const primaryContact =
      contactRecords.find((item) => item.emailVerificationStatus === "verified") ??
      contactRecords[0] ??
      null;

    if (primaryContact) {
      const updatedPrimary = await persistContact(
        input.businessId,
        prospect.id,
        {
          ...primaryContact,
          emailVerificationStatus: primaryContact.emailVerificationStatus,
        },
        {
          organization,
          isPrimary: true,
          status: mapStatusFromEnrichment(contactRecords, primaryContact),
          sourceIds: primaryContact.sourceIds,
          sourceNames: primaryContact.sourceNames,
          events: [buildSourceEvent(primaryContact.source, primaryContact.sourceId, "primary_contact", "Primary contact selected")],
        },
        client,
      );
      primaryContactCount += updatedPrimary.isPrimary ? 1 : 0;
      await updatePrimaryContact(input.businessId, prospect.id, updatedPrimary.id, client);
      await recordContactTimelineEvent(
        input.businessId,
        prospect.id,
        "contact_primary_selected",
        "Primary contact selected",
        `Selected ${updatedPrimary.fullName} as the primary decision maker.`,
        {
          contactId: updatedPrimary.id,
          source: updatedPrimary.source,
          sourceId: updatedPrimary.sourceId,
          fullName: updatedPrimary.fullName,
          title: updatedPrimary.title,
          email: updatedPrimary.verifiedEmail || updatedPrimary.email,
          contactConfidence: updatedPrimary.contactConfidence,
        },
        client,
      );
      await markProspectContactEnriched(input.businessId, prospect.id, client);
      await updateProspectReachability(
        input.businessId,
        {
          id: prospect.id,
          website: prospect.website,
          source_url: prospect.source_url,
          status: prospect.status,
          review_count: prospect.review_count,
          opportunity_score: prospect.opportunity_score,
          last_contact_enriched_at: prospect.last_contact_enriched_at,
        },
        contactRecords,
        undefined,
        client,
      );
    }
  }

  return {
    processedProspectIds,
    updatedContactCount,
    verifiedContactCount,
    primaryContactCount,
    skippedProspectIds,
  };
}

export async function verifyProspectContacts(
  input: RevenueAgentContactEnrichmentBatchRequest & { businessId: string },
  client?: PoolClient,
): Promise<{
  processedProspectIds: string[];
  updatedContactCount: number;
  verifiedContactCount: number;
  primaryContactCount: number;
  skippedProspectIds: string[];
}> {
  const runtime = buildContactEnrichmentRuntime();
  const batchLimit = Math.max(1, Math.min(10, Math.floor(input.limit ?? 10)));
  const requestedProspects = new Set((input.prospectIds ?? []).filter(Boolean));
  const prospectResult = await executeQuery<ProspectRow>(
    `
      select
        id,
        business_id,
        business_name,
        website,
        website_normalized,
        email,
        email_normalized,
        phone,
        phone_normalized,
        city,
        state,
        status,
        industry,
        source,
        source_url,
        review_count,
        opportunity_score,
        last_contact_enriched_at
      from prospects
      where business_id = $1::uuid
      order by opportunity_score desc, updated_at desc
      limit $2::int
    `,
    [input.businessId, batchLimit],
    client,
  );

  const prospects = prospectResult.rows.filter((row) => requestedProspects.size === 0 || requestedProspects.has(row.id));
  const processedProspectIds: string[] = [];
  const skippedProspectIds: string[] = [];
  let updatedContactCount = 0;
  let verifiedContactCount = 0;
  let primaryContactCount = 0;

  for (const prospect of prospects) {
    processedProspectIds.push(prospect.id);
    const contacts = await loadProspectContacts(prospect.id, client);
    if (contacts.length === 0) {
      skippedProspectIds.push(prospect.id);
      continue;
    }

    await recordUnavailableProviderEvents(input.businessId, prospect.id, runtime.providers, client);

    const organization = {
      source: contacts[0].source,
      sourceId: contacts[0].organizationSourceId,
      name: contacts[0].organizationName,
      domain: contacts[0].organizationDomain,
      website: contacts[0].organizationWebsite,
      city: contacts[0].city,
      state: contacts[0].state,
      confidence: contacts[0].matchConfidence,
    } satisfies RevenueAgentOrganizationMatch;

    const nextContacts: RevenueAgentContactRecord[] = [];
    for (const contact of contacts) {
      if (!contact.email) {
        continue;
      }

      const verified = await verifyHunterEmail(contact.email);
      if (verified.providerError) {
        await recordContactTimelineEvent(
          input.businessId,
          prospect.id,
          "contact_enrichment_skipped",
          "Hunter skipped",
          verified.reason || "Hunter email verification was unavailable.",
          {
            provider: "hunter",
            reason: verified.reason,
            contactId: contact.id,
            email: contact.email,
          },
          client,
        );
      }
      const candidate: RevenueAgentEnrichedPerson = {
        ...contact,
        emailVerificationStatus: verified.status,
        emailVerifiedAt: verified.status === "verified" ? new Date().toISOString() : contact.emailVerifiedAt,
        verificationSource: verified.status === "verified" ? "hunter" : contact.verificationSource,
        verifiedEmail: verified.email,
        verifiedDomain: verified.domain,
        verifiedReason: verified.reason,
      };

      const record = await persistContact(
        input.businessId,
        prospect.id,
        candidate,
        {
          organization,
          isPrimary: contact.isPrimary,
          status: verified.status === "verified" ? "verified" : contact.status,
          sourceIds: contact.sourceIds,
          sourceNames: contact.sourceNames,
          events: [buildSourceEvent("hunter", verified.email, "email_verified", verified.status)],
        },
        client,
      );

      nextContacts.push(record);
      updatedContactCount += 1;
      if (record.emailVerificationStatus === "verified") {
        verifiedContactCount += 1;
        await recordContactTimelineEvent(
          input.businessId,
          prospect.id,
          "contact_verified",
          "Contact verified",
          `Verified ${record.fullName} at ${record.verifiedEmail || record.email || "unknown email"}.`,
          {
            contactId: record.id,
            source: record.source,
            sourceId: record.sourceId,
            fullName: record.fullName,
            title: record.title,
            email: record.verifiedEmail || record.email,
            contactConfidence: record.contactConfidence,
          },
          client,
        );
      }
    }

    const primaryContact =
      nextContacts.find((item) => item.emailVerificationStatus === "verified") ??
      nextContacts.find((item) => item.isPrimary) ??
      nextContacts[0];

    if (primaryContact) {
      await updatePrimaryContact(input.businessId, prospect.id, primaryContact.id, client);
      primaryContactCount += 1;
      await recordContactTimelineEvent(
        input.businessId,
        prospect.id,
        "contact_primary_selected",
        "Primary contact selected",
        `Selected ${primaryContact.fullName} as the primary decision maker.`,
        {
          contactId: primaryContact.id,
          source: primaryContact.source,
          sourceId: primaryContact.sourceId,
          fullName: primaryContact.fullName,
          title: primaryContact.title,
          email: primaryContact.verifiedEmail || primaryContact.email,
          contactConfidence: primaryContact.contactConfidence,
        },
        client,
      );
    }

    if (nextContacts.length > 0) {
      await markProspectContactEnriched(input.businessId, prospect.id, client);
      await updateProspectReachability(
        input.businessId,
        {
          id: prospect.id,
          website: prospect.website,
          source_url: prospect.source_url,
          status: prospect.status,
          review_count: prospect.review_count,
          opportunity_score: prospect.opportunity_score,
          last_contact_enriched_at: prospect.last_contact_enriched_at,
        },
        nextContacts,
        undefined,
        client,
      );
    }
  }

  return {
    processedProspectIds,
    updatedContactCount,
    verifiedContactCount,
    primaryContactCount,
    skippedProspectIds,
  };
}

export async function loadContactEnrichmentSummary(
  businessId: string,
  client?: PoolClient,
): Promise<Map<string, RevenueAgentContactRecord[]>> {
  const result = await executeQuery<ProspectContactRow>(
    `
      select
        id,
        business_id,
        prospect_id,
        source,
        source_id,
        organization_source_id,
        person_source_id,
        dedupe_key,
        full_name,
        first_name,
        last_name,
        title,
        department,
        email,
        email_normalized,
        email_verification_status,
        email_verified_at,
        verification_source,
        verified_email,
        verified_domain,
        verified_reason,
        direct_phone,
        direct_phone_normalized,
        linkedin_url,
        organization_name,
        organization_domain,
        organization_website,
        city,
        state,
        status,
        match_confidence,
        contact_confidence,
        source_ids_json,
        source_names_json,
        enrichment_events_json,
        is_primary,
        manual_override,
        manually_corrected_at,
        last_enriched_at,
        created_at,
        updated_at
      from prospect_contacts
      where business_id = $1::uuid
      order by is_primary desc, match_confidence desc, updated_at desc, created_at desc
    `,
    [businessId],
    client,
  );

  const grouped = new Map<string, RevenueAgentContactRecord[]>();
  for (const row of result.rows) {
    const record = mapContactRow(row);
    const items = grouped.get(record.prospectId) ?? [];
    items.push(record);
    grouped.set(record.prospectId, items);
  }

  return grouped;
}
