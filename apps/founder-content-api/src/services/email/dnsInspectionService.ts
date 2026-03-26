import { resolveCname, resolveMx, resolveTxt } from "node:dns/promises";
import type {
  EmailDnsRecord,
  EmailDomainConflictFlag,
  EmailMxRecord,
  EmailSpfValidationState,
} from "../../../../../packages/shared-types/index.ts";

export interface DnsInspectionSnapshot {
  existingMxRecords: EmailMxRecord[];
  existingSpfValue?: string;
  existingDmarcValue?: string;
  recommendedSpfValue?: string;
  spfValidationState: EmailSpfValidationState;
  conflictFlags: EmailDomainConflictFlag[];
}

interface DkimLookupResult {
  name: string;
  values: string[];
  expectedValue: string;
}

interface SpfAnalysis {
  state: EmailSpfValidationState;
  existingSpfValue?: string;
  recommendedSpfValue?: string;
}

interface DnsInspectionCacheEntry {
  expiresAt: number;
  snapshot: DnsInspectionSnapshot;
}

const DNS_INSPECTION_CACHE_TTL_MS = 45_000;
const dnsInspectionCache = new Map<string, DnsInspectionCacheEntry>();

function normalizeHost(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

function normalizeTxtValue(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function isMissingDnsRecordError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return /ENODATA|ENOTFOUND|ENODOMAIN|ENOTIMP|ETIMEOUT|ESERVFAIL/i.test(error.message);
}

async function safeResolveMx(domainName: string): Promise<EmailMxRecord[]> {
  try {
    const records = await resolveMx(domainName);
    return records
      .map((record) => ({
        priority: record.priority,
        exchange: normalizeHost(record.exchange),
      }))
      .sort((left, right) => left.priority - right.priority || left.exchange.localeCompare(right.exchange));
  } catch (error) {
    if (isMissingDnsRecordError(error)) {
      return [];
    }

    throw error;
  }
}

async function safeResolveTxt(name: string): Promise<string[]> {
  try {
    const records = await resolveTxt(name);
    return records
      .map((entry) => normalizeTxtValue(entry.join("")))
      .filter(Boolean);
  } catch (error) {
    if (isMissingDnsRecordError(error)) {
      return [];
    }

    throw error;
  }
}

async function safeResolveCname(name: string): Promise<string[]> {
  try {
    const records = await resolveCname(name);
    return records.map(normalizeHost);
  } catch (error) {
    if (isMissingDnsRecordError(error)) {
      return [];
    }

    throw error;
  }
}

function findSpfRecords(values: string[]): string[] {
  return values.filter((value) => /^v=spf1(?:\s|$)/i.test(value));
}

function findDmarcRecords(values: string[]): string[] {
  return values.filter((value) => /^v=dmarc1(?:\s|;|$)/i.test(value));
}

function includesAmazonSes(value: string | undefined): boolean {
  return typeof value === "string" && /\binclude:amazonses\.com\b/i.test(value);
}

function analyzeSpfRecords(spfRecords: string[]): SpfAnalysis {
  if (spfRecords.length === 0) {
    return {
      state: "missing",
      recommendedSpfValue: "v=spf1 include:amazonses.com ~all",
    };
  }

  if (spfRecords.length > 1) {
    return {
      state: "multiple_records",
    };
  }

  const existingSpfValue = normalizeTxtValue(spfRecords[0]);
  const tokens = existingSpfValue.split(" ").filter(Boolean);
  const allTokens = tokens.filter((token) => /^(?:~|-|\+|\?)all$/i.test(token));
  const terminalToken = tokens[tokens.length - 1];
  const hasValidTerminal = terminalToken === "~all" || terminalToken === "-all";

  if (
    tokens[0] !== "v=spf1" ||
    tokens.length < 2 ||
    allTokens.length !== 1 ||
    !hasValidTerminal
  ) {
    return {
      state: "malformed",
      existingSpfValue,
    };
  }

  if (includesAmazonSes(existingSpfValue)) {
    return {
      state: "valid",
      existingSpfValue,
      recommendedSpfValue: existingSpfValue,
    };
  }

  const mergedTokens = [...tokens];
  mergedTokens.splice(mergedTokens.length - 1, 0, "include:amazonses.com");

  return {
    state: "missing_ses_include",
    existingSpfValue,
    recommendedSpfValue: mergedTokens.join(" "),
  };
}

function buildConflictFlags(input: {
  spfAnalysis: SpfAnalysis;
  dmarcRecords: string[];
  dkimLookups: DkimLookupResult[];
}): EmailDomainConflictFlag[] {
  const conflictFlags: EmailDomainConflictFlag[] = [];

  switch (input.spfAnalysis.state) {
    case "multiple_records":
      conflictFlags.push({
        code: "multiple_spf_records",
        severity: "error",
        message:
          "This domain already has multiple SPF records. Ask your DNS admin to consolidate them before sending from this domain.",
      });
      break;
    case "malformed":
      conflictFlags.push({
        code: "spf_malformed",
        severity: "error",
        message:
          "The current SPF record is malformed. It must start with v=spf1 and end with ~all or -all before branded sending can be enabled.",
      });
      break;
    case "missing":
      conflictFlags.push({
        code: "spf_record_missing",
        severity: "warning",
        message:
          "No SPF record was found yet. Add the recommended SPF record before using this domain for branded sending.",
      });
      break;
    case "missing_ses_include":
      conflictFlags.push({
        code: "spf_include_missing",
        severity: "warning",
        message:
          "We found an SPF record, but it does not authorize Amazon SES yet. Update the existing SPF record instead of creating a second SPF record.",
      });
      break;
    default:
      break;
  }

  if (
    input.dmarcRecords.length > 1 ||
    input.dmarcRecords.some((record) => !/^v=dmarc1(?:\s|;|$)/i.test(record))
  ) {
    conflictFlags.push({
      code: "malformed_dmarc",
      severity: "error",
      message:
        "This domain has a malformed or conflicting DMARC setup. Keep your current inbox provider unchanged and ask your DNS admin to review the DMARC record.",
    });
  }

  for (const lookup of input.dkimLookups) {
    if (lookup.values.length > 0 && !lookup.values.includes(lookup.expectedValue)) {
      conflictFlags.push({
        code: "dkim_record_conflict",
        severity: "error",
        message:
          `The DKIM record ${lookup.name} already exists with a different value. Ask your DNS admin to update that record instead of adding a second one.`,
      });
    }
  }

  const detectedCount = input.dkimLookups.filter((lookup) =>
    lookup.values.includes(lookup.expectedValue),
  ).length;

  if (detectedCount > 0 && detectedCount < input.dkimLookups.length) {
    conflictFlags.push({
      code: "dkim_records_incomplete",
      severity: "warning",
      message:
        "Some SES DKIM records are already present, but the full set is not complete yet. Add the remaining DKIM CNAME records before expecting verification.",
    });
  }

  return conflictFlags;
}

function buildInspectionCacheKey(input: {
  domainName: string;
  requiredDnsRecords: EmailDnsRecord[];
}): string {
  const normalizedDomain = normalizeHost(input.domainName);
  const normalizedRecords = input.requiredDnsRecords
    .filter((record) => record.type === "CNAME")
    .map((record) => `${normalizeHost(record.name)}=>${normalizeHost(record.value)}`)
    .sort()
    .join("|");

  return `${normalizedDomain}::${normalizedRecords}`;
}

function readInspectionCache(cacheKey: string): DnsInspectionSnapshot | null {
  const entry = dnsInspectionCache.get(cacheKey);

  if (!entry) {
    return null;
  }

  if (entry.expiresAt <= Date.now()) {
    dnsInspectionCache.delete(cacheKey);
    return null;
  }

  return entry.snapshot;
}

function writeInspectionCache(cacheKey: string, snapshot: DnsInspectionSnapshot): void {
  dnsInspectionCache.set(cacheKey, {
    expiresAt: Date.now() + DNS_INSPECTION_CACHE_TTL_MS,
    snapshot,
  });
}

export function deriveProviderSignals(mxRecords: EmailMxRecord[]): string[] {
  const exchanges = mxRecords.map((record) => record.exchange);
  const signals = new Set<string>();

  if (exchanges.some((exchange) => /google\.com$/i.test(exchange))) {
    signals.add("Google Workspace detected");
  }

  if (exchanges.some((exchange) => /outlook\.com$|protection\.outlook\.com$/i.test(exchange))) {
    signals.add("Microsoft 365 / Outlook detected");
  }

  if (exchanges.some((exchange) => /zoho\.(com|eu|in)$/i.test(exchange))) {
    signals.add("Zoho Mail detected");
  }

  if (exchanges.some((exchange) => /protonmail\.(ch|com)$/i.test(exchange))) {
    signals.add("Proton Mail detected");
  }

  if (exchanges.some((exchange) => /messagingengine\.com$/i.test(exchange))) {
    signals.add("Fastmail detected");
  }

  if (signals.size === 0 && exchanges.length > 0) {
    signals.add("Existing inbox provider detected");
  }

  return Array.from(signals);
}

export async function inspectDomainDns(input: {
  domainName: string;
  requiredDnsRecords: EmailDnsRecord[];
  bypassCache?: boolean;
}): Promise<DnsInspectionSnapshot> {
  const cacheKey = buildInspectionCacheKey(input);

  if (!input.bypassCache) {
    const cachedSnapshot = readInspectionCache(cacheKey);

    if (cachedSnapshot) {
      return cachedSnapshot;
    }
  }

  const [mxRecords, rootTxtRecords, dmarcTxtRecords] = await Promise.all([
    safeResolveMx(input.domainName),
    safeResolveTxt(input.domainName),
    safeResolveTxt(`_dmarc.${input.domainName}`),
  ]);

  const spfAnalysis = analyzeSpfRecords(findSpfRecords(rootTxtRecords));
  const dmarcRecords = findDmarcRecords(dmarcTxtRecords);
  const requiredDkimRecords = input.requiredDnsRecords.filter((record) => record.type === "CNAME");
  const dkimLookups = await Promise.all(
    requiredDkimRecords.map(async (record) => ({
      name: normalizeHost(record.name),
      values: await safeResolveCname(record.name),
      expectedValue: normalizeHost(record.value),
    })),
  );
  const snapshot: DnsInspectionSnapshot = {
    existingMxRecords: mxRecords,
    existingSpfValue: spfAnalysis.existingSpfValue,
    existingDmarcValue: dmarcRecords.length === 1 ? dmarcRecords[0] : undefined,
    recommendedSpfValue: spfAnalysis.recommendedSpfValue,
    spfValidationState: spfAnalysis.state,
    conflictFlags: buildConflictFlags({
      spfAnalysis,
      dmarcRecords,
      dkimLookups,
    }),
  };

  writeInspectionCache(cacheKey, snapshot);

  return snapshot;
}
