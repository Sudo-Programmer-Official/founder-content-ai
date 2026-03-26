import type { EmailDnsRecord } from "../../../../../packages/shared-types/index.ts";
import { HttpError } from "../../utils/http.ts";
import { SesApiError, sendSesJsonRequest } from "./sesApi.ts";

interface SesGetEmailIdentityResponse {
  DkimAttributes?: {
    Status?: string;
    Tokens?: string[];
  };
  MailFromAttributes?: {
    MailFromDomainStatus?: string;
  };
  VerificationStatus?: string;
  VerifiedForSendingStatus?: boolean;
}

export interface SesDomainIdentitySnapshot {
  sesIdentity: string;
  domainStatus: string;
  dkimStatus: string;
  spfStatus: string;
  dnsRecords: EmailDnsRecord[];
  verifiedForSending: boolean;
}

function normalizeSesStatus(value: string | undefined, isVerified = false): string {
  if (isVerified) {
    return "verified";
  }

  switch ((value ?? "").trim().toUpperCase()) {
    case "SUCCESS":
      return "verified";
    case "PENDING":
      return "pending";
    case "FAILED":
      return "failed";
    case "TEMPORARY_FAILURE":
      return "temporary_failure";
    case "NOT_STARTED":
      return "not_started";
    default:
      return value?.trim().toLowerCase() || "pending";
  }
}

function buildDnsRecords(domainName: string, dkimTokens: string[]): EmailDnsRecord[] {
  const uniqueTokens = Array.from(
    new Set(
      dkimTokens
        .map((token) => token.trim())
        .filter(Boolean),
    ),
  );

  return [
    ...uniqueTokens.map((token) => ({
      type: "CNAME" as const,
      name: `${token}._domainkey.${domainName}`,
      value: `${token}.dkim.amazonses.com`,
    })),
    {
      type: "TXT" as const,
      name: domainName,
      value: "v=spf1 include:amazonses.com ~all",
    },
  ];
}

function toUpstreamIdentityError(error: SesApiError, action: string): HttpError {
  return new HttpError(
    error.statusCode >= 500 ? 502 : 400,
    "ses_identity_request_failed",
    error.message || `SES could not ${action} right now.`,
  );
}

function mapIdentitySnapshot(
  domainName: string,
  payload: SesGetEmailIdentityResponse,
): SesDomainIdentitySnapshot {
  const verifiedForSending = Boolean(payload.VerifiedForSendingStatus);

  return {
    sesIdentity: domainName,
    domainStatus: normalizeSesStatus(payload.VerificationStatus, verifiedForSending),
    dkimStatus: normalizeSesStatus(payload.DkimAttributes?.Status),
    spfStatus: normalizeSesStatus(payload.MailFromAttributes?.MailFromDomainStatus),
    dnsRecords: buildDnsRecords(domainName, payload.DkimAttributes?.Tokens ?? []),
    verifiedForSending,
  };
}

export async function getSesDomainIdentity(
  domainName: string,
): Promise<SesDomainIdentitySnapshot> {
  try {
    const payload = await sendSesJsonRequest<SesGetEmailIdentityResponse>({
      method: "GET",
      path: `/v2/email/identities/${encodeURIComponent(domainName)}`,
    });

    return mapIdentitySnapshot(domainName, payload);
  } catch (error) {
    if (error instanceof SesApiError && error.type === "NotFoundException") {
      throw new HttpError(
        404,
        "email_domain_identity_missing",
        "SES email identity was not found for this domain.",
      );
    }

    if (error instanceof SesApiError) {
      throw toUpstreamIdentityError(error, "load the SES domain identity");
    }

    throw error;
  }
}

export async function ensureSesDomainIdentity(
  domainName: string,
): Promise<SesDomainIdentitySnapshot> {
  try {
    await sendSesJsonRequest<Record<string, unknown>>({
      method: "POST",
      path: "/v2/email/identities",
      body: {
        EmailIdentity: domainName,
        DkimSigningAttributes: {
          NextSigningKeyLength: "RSA_2048_BIT",
        },
      },
    });
  } catch (error) {
    if (!(error instanceof SesApiError && error.type === "AlreadyExistsException")) {
      if (error instanceof SesApiError) {
        throw toUpstreamIdentityError(error, "create the SES domain identity");
      }

      throw error;
    }
  }

  return getSesDomainIdentity(domainName);
}
