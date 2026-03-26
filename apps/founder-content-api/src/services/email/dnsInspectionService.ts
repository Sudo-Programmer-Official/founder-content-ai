import { resolveCname, resolveMx, resolveTxt } from "node:dns/promises";
import type {
  EmailDnsRecord,
  EmailDomainConflictFlag,
  EmailMxRecord,
} from "../../../../../packages/shared-types/index.ts";

export interface DnsInspectionSnapshot {
  existingMxRecords: EmailMxRecord[];
  existingSpfValue?: string;
  existingDmarcValue?: string;
  recommendedSpfValue?: string;
  conflictFlags: EmailDomainConflictFlag[];
}

interface DkimLookupResult {
  name: string;
  values: string[];
  expectedValue: string;
}

function normalizeHost(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
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
      .map((entry) => entry.join("").trim())
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
  return values.filter((value) => /^v=spf1\b/i.test(value));
}

function findDmarcRecords(values: string[]): string[] {
  return values.filter((value) => /^v=dmarc1\b/i.test(value));
}

function includesAmazonSes(value: string | undefined): boolean {
  return typeof value === "string" && /\binclude:amazonses\.com\b/i.test(value);
}

function buildRecommendedSpf(existingSpfValue: string | undefined): string {
  if (!existingSpfValue) {
    return "v=spf1 include:amazonses.com ~all";
  }

  if (includesAmazonSes(existingSpfValue)) {
    return existingSpfValue;
  }

  const parts = existingSpfValue.trim().split(/\s+/);
  const allIndex = parts.findIndex((part) => /^[~?-]?all$/i.test(part));

  if (allIndex >= 0) {
    parts.splice(allIndex, 0, "include:amazonses.com");
    return parts.join(" ");
  }

  return [...parts, "include:amazonses.com", "~all"].join(" ");
}

function buildConflictFlags(input: {
  spfRecords: string[];
  dmarcRecords: string[];
  dkimLookups: DkimLookupResult[];
}): EmailDomainConflictFlag[] {
  const conflictFlags: EmailDomainConflictFlag[] = [];

  if (input.spfRecords.length > 1) {
    conflictFlags.push({
      code: "multiple_spf_records",
      severity: "error",
      message:
        "This domain already has multiple SPF records. Ask your DNS admin to consolidate them before sending from this domain.",
    });
  }

  if (input.spfRecords.length === 0) {
    conflictFlags.push({
      code: "spf_record_missing",
      severity: "warning",
      message:
        "No SPF record was found yet. Add the recommended SPF record before using this domain for branded sending.",
    });
  } else if (!includesAmazonSes(input.spfRecords[0])) {
    conflictFlags.push({
      code: "spf_include_missing",
      severity: "warning",
      message:
        "We found an SPF record, but it does not authorize Amazon SES yet. Update the existing SPF record instead of creating a second SPF record.",
    });
  }

  if (
    input.dmarcRecords.length > 1 ||
    input.dmarcRecords.some((record) => !/^v=DMARC1\b/i.test(record))
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
}): Promise<DnsInspectionSnapshot> {
  const [mxRecords, rootTxtRecords, dmarcTxtRecords] = await Promise.all([
    safeResolveMx(input.domainName),
    safeResolveTxt(input.domainName),
    safeResolveTxt(`_dmarc.${input.domainName}`),
  ]);

  const spfRecords = findSpfRecords(rootTxtRecords);
  const dmarcRecords = findDmarcRecords(dmarcTxtRecords);
  const existingSpfValue = spfRecords.length === 1 ? spfRecords[0] : undefined;
  const existingDmarcValue = dmarcRecords.length === 1 ? dmarcRecords[0] : undefined;
  const requiredDkimRecords = input.requiredDnsRecords.filter((record) => record.type === "CNAME");
  const dkimLookups = await Promise.all(
    requiredDkimRecords.map(async (record) => ({
      name: normalizeHost(record.name),
      values: await safeResolveCname(record.name),
      expectedValue: normalizeHost(record.value),
    })),
  );
  const conflictFlags = buildConflictFlags({
    spfRecords,
    dmarcRecords,
    dkimLookups,
  });

  return {
    existingMxRecords: mxRecords,
    existingSpfValue,
    existingDmarcValue,
    recommendedSpfValue:
      spfRecords.length > 1 ? undefined : buildRecommendedSpf(existingSpfValue),
    conflictFlags,
  };
}
