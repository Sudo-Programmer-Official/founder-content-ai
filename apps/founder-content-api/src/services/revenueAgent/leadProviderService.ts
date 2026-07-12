import { createHash } from "node:crypto";
import type { RevenueAgentFeedConfig, RevenueAgentLeadSourceProvider } from "../../../../../packages/shared-types/index.ts";
import { HttpError } from "../../utils/http.ts";

export interface LeadSourceLead {
  businessName: string;
  website?: string;
  email?: string;
  phone?: string;
  city?: string;
  state?: string;
  industry: string;
  source: string;
  sourceUrl?: string;
  rating?: number;
  reviewCount?: number;
  painSignals: string[];
  tags: string[];
}

interface LeadSearchInput {
  industry: string;
  city: string;
  state: string;
  limit: number;
  csvText?: string;
}

interface LeadProvider {
  provider: RevenueAgentLeadSourceProvider;
  search(input: LeadSearchInput): Promise<LeadSourceLead[]>;
  enrich(lead: LeadSourceLead): Promise<LeadSourceLead>;
}

const DEFAULT_BUSINESS_PREFIXES = ["Prime", "Luxe", "Bright", "Summit", "Northstar", "True", "Peak", "Harbor"];
const DEFAULT_BUSINESS_SUFFIXES = ["Studio", "Collective", "Group", "Care", "Co", "House", "Bar", "Clinic"];
const GOOGLE_PLACES_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const GOOGLE_PLACES_FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.websiteUri",
  "places.googleMapsUri",
  "places.internationalPhoneNumber",
  "places.nationalPhoneNumber",
  "places.rating",
  "places.userRatingCount",
  "places.primaryType",
  "places.primaryTypeDisplayName",
  "places.types",
  "places.businessStatus",
  "places.pureServiceAreaBusiness",
].join(",");

interface GooglePlacesDisplayName {
  text?: string;
  languageCode?: string;
}

interface GooglePlacesResult {
  id?: string;
  displayName?: GooglePlacesDisplayName;
  formattedAddress?: string;
  websiteUri?: string;
  googleMapsUri?: string;
  internationalPhoneNumber?: string;
  nationalPhoneNumber?: string;
  rating?: number;
  userRatingCount?: number;
  primaryType?: string;
  primaryTypeDisplayName?: GooglePlacesDisplayName;
  types?: string[];
  businessStatus?: string;
  pureServiceAreaBusiness?: boolean;
}

interface GooglePlacesSearchResponse {
  places?: GooglePlacesResult[];
}

const CSV_HEADER_ALIASES: Record<string, string[]> = {
  businessName: ["businessname", "business_name", "name", "company", "company_name", "client", "account"],
  website: ["website", "websiteurl", "website_url", "site", "url", "domain"],
  email: ["email", "emailaddress", "email_address", "contactemail"],
  phone: ["phone", "phonenumber", "phone_number", "telephone", "mobile"],
  city: ["city", "town", "location_city"],
  state: ["state", "region", "province", "territory"],
  industry: ["industry", "category", "vertical", "business_type", "business type"],
  sourceUrl: ["sourceurl", "source_url", "profileurl", "profile_url", "listingurl", "listing_url"],
  rating: ["rating", "stars", "score"],
  reviewCount: ["reviewcount", "review_count", "reviews", "reviewtotal", "review_total"],
  painSignals: ["painsignals", "pain_signals", "pain", "notes", "issues", "signals"],
  tags: ["tags", "tag", "labels", "segments"],
};

function normalizeOptional(value: string | undefined | null): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function buildBusinessNameVariants(industry: string, city: string, index: number): string {
  const base = industry.trim() || "Local Business";
  const cityToken = city.trim().split(/\s+/)[0] || "Local";
  return `${DEFAULT_BUSINESS_PREFIXES[index % DEFAULT_BUSINESS_PREFIXES.length]} ${base} ${
    DEFAULT_BUSINESS_SUFFIXES[index % DEFAULT_BUSINESS_SUFFIXES.length]
  } ${cityToken}`.trim();
}

function splitDelimitedValues(value: string | undefined): string[] {
  return (value ?? "")
    .split(/[|,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseCsvRows(csvText: string): string[][] {
  const rows: string[][] = [];
  let currentCell = "";
  let currentRow: string[] = [];
  let insideQuotes = false;

  for (let index = 0; index < csvText.length; index += 1) {
    const character = csvText[index];
    const nextCharacter = csvText[index + 1];

    if (character === '"') {
      if (insideQuotes && nextCharacter === '"') {
        currentCell += '"';
        index += 1;
      } else {
        insideQuotes = !insideQuotes;
      }
      continue;
    }

    if (character === "," && !insideQuotes) {
      currentRow.push(currentCell.trim());
      currentCell = "";
      continue;
    }

    if ((character === "\n" || character === "\r") && !insideQuotes) {
      if (character === "\r" && nextCharacter === "\n") {
        index += 1;
      }
      currentRow.push(currentCell.trim());
      currentCell = "";
      if (currentRow.some((cell) => cell !== "")) {
        rows.push(currentRow);
      }
      currentRow = [];
      continue;
    }

    currentCell += character;
  }

  if (currentCell !== "" || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    if (currentRow.some((cell) => cell !== "")) {
      rows.push(currentRow);
    }
  }

  return rows;
}

function normalizeColumnName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function uniqueStrings(values: Array<string | undefined | null>): string[] {
  return [...new Set(values.map((item) => normalizeOptional(item)).filter((item): item is string => Boolean(item && item.length > 0)))];
}

function normalizeTag(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function trimTrailingPunctuation(value: string): string {
  return value.replace(/[.,;:]+$/g, "").trim();
}

function getGooglePlacesApiKey(): string | undefined {
  return process.env.GOOGLE_PLACES_API_KEY?.trim() || process.env.GOOGLE_MAPS_API_KEY?.trim();
}

function buildGooglePlacesQueries(input: LeadSearchInput): string[] {
  const location = [input.city.trim(), input.state.trim()].filter(Boolean).join(", ");
  const queries = [
    [input.industry.trim(), location ? `in ${location}` : ""].filter(Boolean).join(" "),
    [input.industry.trim(), location].filter(Boolean).join(" "),
    [input.industry.trim(), location ? `near ${location}` : ""].filter(Boolean).join(" "),
  ];

  return uniqueStrings(queries.map((query) => trimTrailingPunctuation(query)));
}

function getDisplayText(displayName: GooglePlacesDisplayName | string | undefined): string | undefined {
  if (typeof displayName === "string") {
    return normalizeOptional(displayName);
  }

  return normalizeOptional(displayName?.text);
}

function getGoogleMapsUrl(place: GooglePlacesResult, businessName: string, locationLabel: string): string | undefined {
  return (
    normalizeOptional(place.googleMapsUri) ||
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([businessName, locationLabel].filter(Boolean).join(", "))}`
  );
}

function isOperationalGooglePlace(place: GooglePlacesResult): boolean {
  const status = normalizeOptional(place.businessStatus)?.toUpperCase();
  return !status || status === "OPERATIONAL";
}

function buildGoogleBusinessTags(place: GooglePlacesResult, input: LeadSearchInput): string[] {
  const tags = [
    "google-business",
    normalizeTag(input.industry),
    normalizeTag(place.primaryType ?? ""),
    normalizeTag(getDisplayText(place.primaryTypeDisplayName) ?? ""),
    ...(place.types ?? []).slice(0, 3).map(normalizeTag),
    place.pureServiceAreaBusiness ? "service-area-business" : "storefront-business",
    place.websiteUri ? "website-present" : "website-missing",
    place.nationalPhoneNumber || place.internationalPhoneNumber ? "phone-present" : "phone-missing",
    typeof place.rating === "number"
      ? place.rating >= 4.5
        ? "high-rated"
        : place.rating < 4.3
          ? "rating-friction"
          : "solid-rated"
      : "rating-unknown",
    typeof place.userRatingCount === "number"
      ? place.userRatingCount < 50
        ? "light-reviews"
        : place.userRatingCount < 200
          ? "moderate-reviews"
          : "review-rich"
      : "review-count-unknown",
  ];

  return uniqueStrings(tags);
}

function buildGoogleBusinessPainSignals(place: GooglePlacesResult, input: LeadSearchInput): string[] {
  const location = [input.city.trim(), input.state.trim()].filter(Boolean).join(", ");
  const signals = [
    `Google Business lead for ${input.industry.trim()} in ${location || "the target market"}`,
    typeof place.rating === "number" && place.rating < 4.4 ? `rating pressure (${place.rating.toFixed(1)}/5)` : undefined,
    typeof place.userRatingCount === "number" && place.userRatingCount < 50 ? "light review volume" : undefined,
    !place.websiteUri ? "website not surfaced in Google Business profile" : undefined,
    !place.nationalPhoneNumber && !place.internationalPhoneNumber ? "phone number not surfaced in Google Business profile" : undefined,
    place.pureServiceAreaBusiness ? "service-area business without a storefront" : undefined,
    place.primaryTypeDisplayName?.text ? `category: ${trimTrailingPunctuation(place.primaryTypeDisplayName.text)}` : undefined,
  ];

  return uniqueStrings(signals);
}

async function readGooglePlacesErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: string; status?: string } } | null;
    const errorMessage = body?.error?.message?.trim();
    const errorStatus = body?.error?.status?.trim();

    if (errorMessage) {
      return errorMessage;
    }

    if (errorStatus) {
      return errorStatus;
    }
  } catch {
    // Fall through to a generic message below.
  }

  const fallback = await response.text().catch(() => "");
  return fallback.trim() || `Google Places request failed with status ${response.status}.`;
}

async function searchGooglePlaces(textQuery: string, pageSize: number, apiKey: string): Promise<GooglePlacesResult[]> {
  const response = await fetch(GOOGLE_PLACES_SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": GOOGLE_PLACES_FIELD_MASK,
    },
    body: JSON.stringify({
      textQuery,
      pageSize: Math.max(1, Math.min(20, Math.floor(pageSize))),
      includePureServiceAreaBusinesses: true,
      languageCode: "en",
    }),
  });

  if (!response.ok) {
    const message = await readGooglePlacesErrorMessage(response);
    throw new HttpError(502, "google_places_request_failed", message);
  }

  const payload = (await response.json()) as GooglePlacesSearchResponse;
  return Array.isArray(payload.places) ? payload.places : [];
}

function mapGooglePlaceToLead(place: GooglePlacesResult, input: LeadSearchInput): LeadSourceLead {
  const businessName = getDisplayText(place.displayName) || input.industry.trim() || "Local Business";
  const locationLabel = [input.city.trim(), input.state.trim()].filter(Boolean).join(", ");
  const website = normalizeOptional(place.websiteUri);
  const phone = normalizeOptional(place.internationalPhoneNumber || place.nationalPhoneNumber);

  return {
    businessName,
    website,
    email: undefined,
    phone,
    city: normalizeOptional(input.city),
    state: normalizeOptional(input.state),
    industry: normalizeOptional(input.industry) || "local business",
    source: "google_business",
    sourceUrl: getGoogleMapsUrl(place, businessName, locationLabel),
    rating: typeof place.rating === "number" ? place.rating : undefined,
    reviewCount: typeof place.userRatingCount === "number" ? place.userRatingCount : 0,
    painSignals: buildGoogleBusinessPainSignals(place, input),
    tags: buildGoogleBusinessTags(place, input),
  };
}

function buildGoogleBusinessLeadSource(): LeadProvider {
  const apiKey = getGooglePlacesApiKey();

  if (!apiKey) {
    throw new HttpError(
      503,
      "google_places_not_configured",
      "GOOGLE_PLACES_API_KEY is required to use the Google Business lead provider.",
    );
  }

  return {
    provider: "google_business",
    async search(input: LeadSearchInput): Promise<LeadSourceLead[]> {
      const limit = Math.max(1, Math.min(25, Math.floor(input.limit || 20)));
      const leads: LeadSourceLead[] = [];
      const seenPlaceIds = new Set<string>();

      for (const query of buildGooglePlacesQueries(input)) {
        if (leads.length >= limit) {
          break;
        }

        const remaining = limit - leads.length;
        const results = await searchGooglePlaces(query, Math.min(20, remaining), apiKey);

        for (const place of results) {
          if (!isOperationalGooglePlace(place)) {
            continue;
          }

          const placeId = normalizeOptional(place.id);
          if (placeId && seenPlaceIds.has(placeId)) {
            continue;
          }

          const lead = mapGooglePlaceToLead(place, input);
          const leadFingerprint = placeId || [lead.businessName, lead.website, lead.phone, lead.sourceUrl].filter(Boolean).join("|");

          if (!leadFingerprint || seenPlaceIds.has(leadFingerprint)) {
            continue;
          }

          seenPlaceIds.add(leadFingerprint);
          if (placeId) {
            seenPlaceIds.add(placeId);
          }

          leads.push(lead);

          if (leads.length >= limit) {
            break;
          }
        }
      }

      return leads;
    },
    async enrich(lead: LeadSourceLead): Promise<LeadSourceLead> {
      return {
        ...lead,
        website: normalizeOptional(lead.website),
        email: normalizeOptional(lead.email),
        phone: normalizeOptional(lead.phone),
        city: normalizeOptional(lead.city),
        state: normalizeOptional(lead.state),
        sourceUrl: normalizeOptional(lead.sourceUrl) ?? normalizeOptional(lead.website),
      };
    },
  };
}

function looksLikeHeaderRow(row: string[]): boolean {
  const normalized = row.map((cell) => normalizeColumnName(cell));
  return normalized.some((cell) =>
    Object.values(CSV_HEADER_ALIASES).some((aliases) =>
      aliases.map(normalizeColumnName).some((alias) => alias === cell),
    ),
  );
}

function readHeaderValue(row: Record<string, string>, header: string): string | undefined {
  const aliases = CSV_HEADER_ALIASES[header].map(normalizeColumnName);

  for (const [key, value] of Object.entries(row)) {
    if (aliases.includes(normalizeColumnName(key))) {
      return normalizeOptional(value);
    }
  }

  return undefined;
}

function parseNumber(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseLeadRows(csvText: string, input: LeadSearchInput): LeadSourceLead[] {
  const rows = parseCsvRows(csvText);

  if (rows.length === 0) {
    throw new HttpError(400, "revenue_agent_csv_empty", "CSV input is empty.");
  }

  const hasHeader = looksLikeHeaderRow(rows[0]);
  const columns = hasHeader ? rows[0] : rows[0].map((_, index) => `column_${index + 1}`);
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const limit = Math.max(1, Math.min(200, Math.floor(input.limit || 20)));
  const leads: LeadSourceLead[] = [];

  for (const row of dataRows) {
    const rowObject = Object.fromEntries(columns.map((column, index) => [column, row[index]?.trim() || ""]));
    const businessName =
      readHeaderValue(rowObject, "businessName") ||
      (!hasHeader ? normalizeOptional(rowObject[columns[0]]) : undefined) ||
      "";

    if (!businessName) {
      continue;
    }

    const website = readHeaderValue(rowObject, "website");
    const email = readHeaderValue(rowObject, "email");
    const phone = readHeaderValue(rowObject, "phone");
    const city = readHeaderValue(rowObject, "city") ?? normalizeOptional(input.city);
    const state = readHeaderValue(rowObject, "state") ?? normalizeOptional(input.state);
    const industry = readHeaderValue(rowObject, "industry") ?? normalizeOptional(input.industry) ?? "local business";
    const sourceUrl = readHeaderValue(rowObject, "sourceUrl") ?? website;
    const rating = parseNumber(readHeaderValue(rowObject, "rating"));
    const reviewCount = parseNumber(readHeaderValue(rowObject, "reviewCount"));
    const painSignals = splitDelimitedValues(readHeaderValue(rowObject, "painSignals"));
    const tags = splitDelimitedValues(readHeaderValue(rowObject, "tags"));

    leads.push({
      businessName,
      website,
      email,
      phone,
      city,
      state,
      industry,
      source: "csv_import",
      sourceUrl,
      rating,
      reviewCount,
      painSignals: painSignals.length > 0 ? painSignals : ["manual follow-up is still likely"],
      tags: tags.length > 0 ? tags : ["csv-import"],
    });

    if (leads.length >= limit) {
      break;
    }
  }

  if (leads.length === 0) {
    throw new HttpError(400, "revenue_agent_csv_invalid", "CSV must include at least one business name.");
  }

  return leads;
}

function buildCsvImportLeadSource(): LeadProvider {
  return {
    provider: "csv_import",
    async search(input: LeadSearchInput): Promise<LeadSourceLead[]> {
      if (!input.csvText?.trim()) {
        throw new HttpError(400, "revenue_agent_csv_required", "CSV text is required for the CSV import provider.");
      }

      return parseLeadRows(input.csvText, input);
    },
    async enrich(lead: LeadSourceLead): Promise<LeadSourceLead> {
      return {
        ...lead,
        website: normalizeOptional(lead.website),
        email: normalizeOptional(lead.email),
        phone: normalizeOptional(lead.phone),
        city: normalizeOptional(lead.city),
        state: normalizeOptional(lead.state),
        sourceUrl: normalizeOptional(lead.sourceUrl) ?? normalizeOptional(lead.website),
      };
    },
  };
}

export function resolveLeadSourceProvider(provider?: RevenueAgentLeadSourceProvider): RevenueAgentLeadSourceProvider {
  return provider === "csv_import" ? "csv_import" : "google_business";
}

export function resolveLeadSourceProviderInstance(provider?: RevenueAgentLeadSourceProvider): LeadProvider {
  const resolvedProvider = resolveLeadSourceProvider(provider);

  if (resolvedProvider === "csv_import") {
    return buildCsvImportLeadSource();
  }

  return buildGoogleBusinessLeadSource();
}

export function buildLeadSourceQueryJson(
  input: RevenueAgentFeedConfig,
  provider: RevenueAgentLeadSourceProvider,
): Record<string, unknown> {
  const queryJson: Record<string, unknown> = {
    industry: input.industry,
    city: input.city,
    state: input.state,
    provider,
  };

  if (provider === "csv_import" && input.csvText?.trim()) {
    queryJson.csvChecksum = createHash("sha256").update(input.csvText.trim()).digest("hex");
    queryJson.csvLineCount = parseCsvRows(input.csvText.trim()).length;
  }

  return queryJson;
}
