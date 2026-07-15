import type {
  RevenueAgentContactRecord,
  RevenueAgentOpportunityReport,
  RevenueAgentProspect,
} from "../../../../../packages/shared-types/index.ts";

export interface RevenueAgentReachabilitySnapshot {
  reachabilityScore: number;
  decisionMakerConfidence: number;
  websiteQualityScore: number;
  reachabilityReasons: string[];
  aiRecommendation: string;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function scoreWebsiteQuality(
  prospect: Pick<RevenueAgentProspect, "website" | "sourceUrl">,
  report?: RevenueAgentOpportunityReport | null,
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  const website = prospect.website?.trim() || prospect.sourceUrl?.trim();

  if (website) {
    score += 20;
    reasons.push("Valid website found");
  } else {
    reasons.push("No website found");
  }

  const band = report?.businessProfile.techStack.performanceBand;
  if (band === "strong") {
    score += 40;
    reasons.push("Website performance looks strong");
  } else if (band === "moderate") {
    score += 28;
    reasons.push("Website performance looks moderate");
  } else if (band === "weak") {
    score += 12;
    reasons.push("Website performance looks weak");
  } else {
    score += 18;
    reasons.push("Website performance unknown");
  }

  const signals = report?.websiteSignals;
  if (signals?.https) {
    score += 8;
  } else if (website) {
    score -= 8;
  }

  if (signals?.contactForm) {
    score += 8;
  }

  if (signals?.mobileResponsive) {
    score += 5;
  }

  if (signals?.bookingSoftware) {
    score += 5;
  }

  return {
    score: clampScore(score),
    reasons,
  };
}

function scoreDecisionMakerConfidence(contacts: RevenueAgentContactRecord[]): { score: number; reasons: string[]; contact?: RevenueAgentContactRecord } {
  if (contacts.length === 0) {
    return {
      score: 0,
      reasons: ["No decision maker identified"],
    };
  }

  const primaryContact = contacts.find((contact) => contact.isPrimary) ?? contacts[0];
  const bestContact = [...contacts].sort((left, right) => right.contactConfidence - left.contactConfidence)[0] ?? primaryContact;
  const candidate = primaryContact ?? bestContact;
  const score = clampScore(candidate.contactConfidence || bestContact.contactConfidence || 0);
  const reasons = [
    `${candidate.fullName || "Decision maker"} identified`,
    `Confidence ${score}/100`,
  ];

  return {
    score,
    reasons,
    contact: candidate,
  };
}

function scoreVerificationStrength(contact?: RevenueAgentContactRecord): { score: number; reasons: string[] } {
  if (!contact) {
    return {
      score: 0,
      reasons: ["No contact verification available"],
    };
  }

  const reasons: string[] = [];
  let score = 0;

  if (contact.emailVerificationStatus === "verified") {
    score += 70;
    reasons.push("Verified email");
  } else if (contact.emailVerificationStatus === "risky") {
    score += 42;
    reasons.push("Risky email");
  } else if (contact.email) {
    score += 24;
    reasons.push("Email found");
  } else {
    reasons.push("No email found");
  }

  if (contact.directPhone) {
    score += 20;
    reasons.push("Direct phone found");
  }

  if (contact.linkedinUrl) {
    score += 10;
    reasons.push("LinkedIn found");
  }

  return {
    score: clampScore(score),
    reasons,
  };
}

function scoreBusinessActivity(
  prospect: Pick<RevenueAgentProspect, "status" | "reviewCount">,
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  if (prospect.reviewCount >= 100) {
    score += 45;
    reasons.push("High review volume");
  } else if (prospect.reviewCount >= 50) {
    score += 38;
    reasons.push("Healthy review volume");
  } else if (prospect.reviewCount >= 10) {
    score += 30;
    reasons.push("Some review activity");
  } else if (prospect.reviewCount > 0) {
    score += 18;
    reasons.push("Limited review activity");
  } else {
    score += 8;
    reasons.push("No review activity");
  }

  if (prospect.status === "dead" || prospect.status === "not_interested") {
    score -= 18;
    reasons.push("Inactive prospect status");
  } else if (prospect.status === "meeting_booked" || prospect.status === "sent" || prospect.status === "approved") {
    score += 10;
    reasons.push("Active prospect lifecycle");
  }

  return {
    score: clampScore(score),
    reasons,
  };
}

function scoreFreshness(
  prospect: Pick<RevenueAgentProspect, "lastContactEnrichedAt">,
): { score: number; reasons: string[] } {
  const lastEnrichedAt = prospect.lastContactEnrichedAt ? new Date(prospect.lastContactEnrichedAt).getTime() : 0;
  if (!lastEnrichedAt) {
    return {
      score: 15,
      reasons: ["Never enriched"],
    };
  }

  const ageDays = (Date.now() - lastEnrichedAt) / (24 * 60 * 60 * 1000);
  if (ageDays <= 7) {
    return {
      score: 100,
      reasons: ["Freshly enriched"],
    };
  }

  if (ageDays <= 30) {
    return {
      score: 74,
      reasons: ["Recently enriched"],
    };
  }

  if (ageDays <= 90) {
    return {
      score: 42,
      reasons: ["Enrichment older than 30 days"],
    };
  }

  return {
    score: 18,
    reasons: ["Enrichment is stale"],
  };
}

function buildRecommendation(input: {
  score: number;
  verification: { score: number; contact?: RevenueAgentContactRecord };
  website: { score: number };
  freshness: { score: number };
  business: { score: number };
}): string {
  const contact = input.verification.contact;
  const name = contact?.fullName || "the decision maker";
  const emailState = contact?.emailVerificationStatus === "verified" ? "verified email" : contact?.email ? "email still needs verification" : "no direct email";

  if (input.score >= 90) {
    return `High priority. ${name} is reachable and the account is ready for outreach.`;
  }

  if (input.score >= 75) {
    return `Good priority. ${name} is identified, but ${emailState} and website quality could still improve.`;
  }

  if (input.score >= 60) {
    return `Medium priority. The business is promising, but reachability is limited by ${input.website.score < 40 ? "weak website signals" : "incomplete contact data"} and ${input.business.score < 25 ? "light business activity" : "moderate activity"}.`;
  }

  return `Low priority. Reachability is weak, and ${input.freshness.score < 40 ? "the contact data is stale" : "you should find a better decision maker"} before sending.`;
}

export function computeRevenueAgentReachability(input: {
  prospect: Pick<RevenueAgentProspect, "website" | "sourceUrl" | "status" | "reviewCount" | "lastContactEnrichedAt" | "opportunityScore">;
  contacts?: RevenueAgentContactRecord[];
  report?: RevenueAgentOpportunityReport | null;
}): RevenueAgentReachabilitySnapshot {
  const contacts = input.contacts ?? [];
  const decisionMaker = scoreDecisionMakerConfidence(contacts);
  const primaryContact = decisionMaker.contact;
  const verification = scoreVerificationStrength(primaryContact);
  const website = scoreWebsiteQuality(input.prospect, input.report);
  const business = scoreBusinessActivity(input.prospect);
  const freshness = scoreFreshness(input.prospect);

  const opportunityScore = clampScore(input.prospect.opportunityScore ?? input.report?.opportunityScore ?? 0);
  const reachabilityScore = clampScore(
    opportunityScore * 0.26 +
      decisionMaker.score * 0.28 +
      verification.score * 0.18 +
      website.score * 0.12 +
      business.score * 0.1 +
      freshness.score * 0.06,
  );

  const reasons = [
    `Opportunity score ${opportunityScore}/100`,
    ...decisionMaker.reasons,
    ...verification.reasons,
    ...website.reasons,
    ...business.reasons,
    ...freshness.reasons,
  ].slice(0, 6);

  return {
    reachabilityScore,
    decisionMakerConfidence: decisionMaker.score,
    websiteQualityScore: website.score,
    reachabilityReasons: reasons,
    aiRecommendation: buildRecommendation({
      score: reachabilityScore,
      verification,
      website,
      freshness,
      business,
    }),
  };
}
