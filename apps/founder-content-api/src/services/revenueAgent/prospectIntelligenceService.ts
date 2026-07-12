import { generateCompletion } from "../../../../../packages/ai-core/src/generateCompletion.ts";
import type {
  RevenueAgentOpportunityReport,
  RevenueAgentWebsitePerformanceBand,
  RevenueAgentWebsiteSignals,
  RevenueAgentWorkspaceKnowledgeContext,
} from "../../../../../packages/shared-types/index.ts";
import { logWarn } from "../../utils/logger.ts";

export interface ProspectIntelligenceInput {
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
  offer: string;
  workspaceKnowledge?: RevenueAgentWorkspaceKnowledgeContext;
}

export interface ProspectIntelligenceResult {
  websiteUrl?: string;
  painSummary: string;
  opportunityScore: number;
  opportunityTags: string[];
  suggestedOfferAngle: string;
  emailSubject: string;
  emailBody: string;
  report: RevenueAgentOpportunityReport;
}

interface WebsiteSnapshot {
  url?: string;
  finalUrl?: string;
  title: string;
  metaDescription: string;
  headings: string[];
  services: string[];
  ctas: string[];
  textSample: string;
  bookingSoftware?: string;
  bookingSoftwareEvidence: string[];
  cms?: string;
  analytics: string[];
  marketingPixels: string[];
  crm?: string;
  contactForm: boolean;
  chatWidget: boolean;
  mobileResponsive: boolean;
  performanceBand: RevenueAgentWebsitePerformanceBand;
  https: boolean;
  socialLinks: string[];
  notes: string[];
}

interface RevenueAgentTechStackSnapshot extends RevenueAgentWebsiteSignals {}

interface RevenueAgentSourceCoverageSnapshot {
  status: "available" | "partial" | "missing" | "unknown";
  evidence: string[];
  note?: string;
}

interface RevenueAgentBusinessProfileSnapshot {
  businessHealthScore: number;
  websiteScore: number;
  reviewsScore: number;
  bookingScore: number;
  crmScore: number | null;
  aiReadinessScore: number;
  growthSignals: string[];
  ownerSignals: string[];
  sourceCoverage: {
    googleBusiness: RevenueAgentSourceCoverageSnapshot;
    linkedinCompany: RevenueAgentSourceCoverageSnapshot;
    facebookPage: RevenueAgentSourceCoverageSnapshot;
    instagram: RevenueAgentSourceCoverageSnapshot;
    yelp: RevenueAgentSourceCoverageSnapshot;
    bbb: RevenueAgentSourceCoverageSnapshot;
    whois: RevenueAgentSourceCoverageSnapshot;
    techStack: RevenueAgentSourceCoverageSnapshot;
  };
  techStack: RevenueAgentTechStackSnapshot;
  notes: string[];
}

interface RevenueAgentSalesObjectionSnapshot {
  objection: string;
  response: string;
}

interface RevenueAgentSalesStrategySnapshot {
  primaryPain: string;
  recommendedOffer: string;
  openingHook: string;
  objections: RevenueAgentSalesObjectionSnapshot[];
  cta: string;
  strategyRationale: string[];
}

interface CompletedAnalysis {
  businessSummary: string;
  websiteSummary: string;
  painPoints: string[];
  automationOpportunities: string[];
  estimatedRoiHoursPerWeekMin: number;
  estimatedRoiHoursPerWeekMax: number;
  opportunityScore: number;
  opportunityScoreReasons: string[];
  suggestedOutreachAngle: string;
  emailSubject: string;
  emailBody: string;
  opportunityTags: string[];
  businessProfile: RevenueAgentBusinessProfileSnapshot;
  salesStrategy: RevenueAgentSalesStrategySnapshot;
  websiteSignals: RevenueAgentWebsiteSignals;
}

const BOOKING_KEYWORDS: Array<{ keyword: string; label: string }> = [
  { keyword: "calendly", label: "Calendly" },
  { keyword: "acuity", label: "Acuity" },
  { keyword: "square appointments", label: "Square Appointments" },
  { keyword: "squareup.com/appointments", label: "Square Appointments" },
  { keyword: "fresha", label: "Fresha" },
  { keyword: "booksy", label: "Booksy" },
  { keyword: "setmore", label: "Setmore" },
  { keyword: "simplybook", label: "SimplyBook.me" },
  { keyword: "mindbody", label: "Mindbody" },
  { keyword: "vagaro", label: "Vagaro" },
  { keyword: "styleseat", label: "StyleSeat" },
  { keyword: "honeybook", label: "HoneyBook" },
];

const CHAT_KEYWORDS: Array<{ keyword: string; label: string }> = [
  { keyword: "intercom", label: "Intercom" },
  { keyword: "drift", label: "Drift" },
  { keyword: "crisp", label: "Crisp" },
  { keyword: "tawk.to", label: "Tawk.to" },
  { keyword: "freshchat", label: "Freshchat" },
  { keyword: "livechat", label: "LiveChat" },
  { keyword: "hubspot", label: "HubSpot Chat" },
  { keyword: "zendesk", label: "Zendesk Chat" },
  { keyword: "olark", label: "Olark" },
];

const SOCIAL_DOMAINS = ["instagram.com", "facebook.com", "linkedin.com", "tiktok.com", "youtube.com", "x.com", "twitter.com"];
const CMS_KEYWORDS: Array<{ keyword: string; label: string }> = [
  { keyword: "wp-content", label: "WordPress" },
  { keyword: "wordpress", label: "WordPress" },
  { keyword: "wix.com", label: "Wix" },
  { keyword: "wixstatic.com", label: "Wix" },
  { keyword: "squarespace.com", label: "Squarespace" },
  { keyword: "static.squarespace.com", label: "Squarespace" },
  { keyword: "shopify", label: "Shopify" },
  { keyword: "cdn.shopify.com", label: "Shopify" },
  { keyword: "webflow", label: "Webflow" },
  { keyword: "assets.website-files.com", label: "Webflow" },
  { keyword: "showit", label: "Showit" },
  { keyword: "kajabi", label: "Kajabi" },
  { keyword: "godaddy", label: "GoDaddy" },
  { keyword: "weebly", label: "Weebly" },
];

const ANALYTICS_KEYWORDS: Array<{ keyword: string; label: string }> = [
  { keyword: "googletagmanager", label: "Google Tag Manager" },
  { keyword: "gtm.js", label: "Google Tag Manager" },
  { keyword: "google-analytics", label: "Google Analytics" },
  { keyword: "gtag(", label: "Google Analytics" },
  { keyword: "ga4", label: "Google Analytics 4" },
  { keyword: "plausible", label: "Plausible" },
  { keyword: "matomo", label: "Matomo" },
  { keyword: "fathom", label: "Fathom" },
  { keyword: "mixpanel", label: "Mixpanel" },
  { keyword: "posthog", label: "PostHog" },
  { keyword: "hotjar", label: "Hotjar" },
];

const PIXEL_KEYWORDS: Array<{ keyword: string; label: string }> = [
  { keyword: "connect.facebook.net", label: "Meta Pixel" },
  { keyword: "facebook.com/tr", label: "Meta Pixel" },
  { keyword: "fbq(", label: "Meta Pixel" },
  { keyword: "tiktok.com/i18n/pixel", label: "TikTok Pixel" },
  { keyword: "snap.licdn.com/li.lms-analytics", label: "LinkedIn Insight Tag" },
  { keyword: "linkedin.com/px", label: "LinkedIn Insight Tag" },
];

const CRM_KEYWORDS: Array<{ keyword: string; label: string }> = [
  { keyword: "hubspot", label: "HubSpot" },
  { keyword: "salesforce", label: "Salesforce" },
  { keyword: "highlevel", label: "GoHighLevel" },
  { keyword: "gohighlevel", label: "GoHighLevel" },
  { keyword: "keap", label: "Keap" },
  { keyword: "zoho", label: "Zoho CRM" },
  { keyword: "pipedrive", label: "Pipedrive" },
  { keyword: "jobber", label: "Jobber" },
  { keyword: "housecall pro", label: "Housecall Pro" },
  { keyword: "mindbody", label: "Mindbody" },
  { keyword: "vagaro", label: "Vagaro" },
  { keyword: "podium", label: "Podium" },
];

function normalizeOptional(value: string | undefined | null): string {
  return typeof value === "string" ? value.trim() : "";
}

function uniqueStrings(values: Array<string | undefined | null>): string[] {
  return [...new Set(values.map((item) => normalizeOptional(item)).filter((item) => item.length > 0))];
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  const truncated = value.slice(0, maxLength);
  const lastSpaceIndex = truncated.lastIndexOf(" ");
  return (lastSpaceIndex > 80 ? truncated.slice(0, lastSpaceIndex) : truncated).trim();
}

function buildWorkspaceKnowledgePromptContext(
  workspaceKnowledge: ProspectIntelligenceInput["workspaceKnowledge"],
): Record<string, unknown> | undefined {
  if (!workspaceKnowledge) {
    return undefined;
  }

  const profile = workspaceKnowledge.profile;
  const emailIdentity = workspaceKnowledge.emailIdentity;
  const sources = (workspaceKnowledge.sources ?? []).slice(0, 4).map((source) => {
    const excerpt = truncateText(
      normalizeOptional(source.extractedText) || normalizeOptional(source.rawText) || "",
      240,
    );

    return {
      id: source.id,
      sourceType: source.sourceType,
      title: source.title,
      sourceUrl: source.sourceUrl,
      processingStatus: source.processingStatus,
      excerpt: excerpt || undefined,
    };
  });

  return {
    businessName: workspaceKnowledge.businessName,
    websiteUrl: workspaceKnowledge.websiteUrl,
    niche: workspaceKnowledge.niche,
    profile: profile
      ? {
          voiceSummary: profile.voiceSummary,
          audienceSummary: profile.audienceSummary,
          positioningSummary: profile.positioningSummary,
          beliefs: profile.beliefs,
          topicClusters: profile.topicClusters,
          sourceCount: profile.sourceCount,
          processingStatus: profile.processingStatus,
          processingError: profile.processingError,
          lastProcessedAt: profile.lastProcessedAt,
        }
      : undefined,
    emailIdentity,
    sourceCount: workspaceKnowledge.sources?.length ?? 0,
    sourceHighlights: sources,
  };
}

function resolveWorkspaceSignature(
  workspaceKnowledge: ProspectIntelligenceInput["workspaceKnowledge"],
): string {
  const signatureText = workspaceKnowledge?.emailIdentity?.signatureText?.trim();
  if (signatureText) {
    return signatureText;
  }

  const fromName = workspaceKnowledge?.emailIdentity?.fromName?.trim();
  const replyToEmail = workspaceKnowledge?.emailIdentity?.replyToEmail?.trim();
  const fromEmail = workspaceKnowledge?.emailIdentity?.fromEmail?.trim();

  const identityLines = [fromName, replyToEmail || fromEmail].filter((value): value is string => Boolean(value));
  if (identityLines.length > 0) {
    return identityLines.join("\n");
  }

  return "Best,\nFounder Content";
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function normalizeWebsiteUrl(value: string | undefined): string | undefined {
  const raw = normalizeOptional(value);
  if (!raw) {
    return undefined;
  }

  const candidate = raw.startsWith("http://") || raw.startsWith("https://") ? raw : `https://${raw}`;

  try {
    return new URL(candidate).toString();
  } catch {
    return undefined;
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .trim();
}

function extractTagTexts(html: string, tagName: "h1" | "h2" | "h3" | "a" | "button"): string[] {
  const matches = Array.from(html.matchAll(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\/${tagName}>`, "gi")));
  return uniqueStrings(
    matches.map((match) => stripHtml(match[1] ?? "")).filter((value) => value.length > 0 && value.length < 140),
  ).slice(0, 12);
}

function extractMetaDescription(html: string): string {
  const match =
    html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["'][^>]*>/i) ||
    html.match(/<meta\s+content=["']([^"']+)["']\s+name=["']description["'][^>]*>/i);

  return normalizeOptional(match?.[1]) || "";
}

function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return normalizeOptional(match?.[1]) || "";
}

function extractSocialLinks(html: string): string[] {
  const hrefs = Array.from(html.matchAll(/href=["']([^"']+)["']/gi)).map((match) => normalizeOptional(match[1]));
  return uniqueStrings(
    hrefs.filter((href) => SOCIAL_DOMAINS.some((domain) => href.includes(domain))),
  ).slice(0, 10);
}

function detectFromKeywords(html: string, keywords: Array<{ keyword: string; label: string }>): { label?: string; evidence: string[] } {
  const lowerHtml = html.toLowerCase();
  for (const entry of keywords) {
    if (lowerHtml.includes(entry.keyword)) {
      return {
        label: entry.label,
        evidence: [entry.keyword],
      };
    }
  }

  return { evidence: [] };
}

function detectContactForm(html: string): boolean {
  return /<form[\s>]/i.test(html) || /contact-form|book-now|schedule-appointment|request-consultation/i.test(html);
}

function detectChatWidget(html: string): boolean {
  return Boolean(detectFromKeywords(html, CHAT_KEYWORDS).label);
}

function detectTechStack(html: string): {
  cms?: string;
  analytics: string[];
  marketingPixels: string[];
  crm?: string;
} {
  const cms = detectFromKeywords(html, CMS_KEYWORDS).label;
  const analytics = uniqueStrings(
    ANALYTICS_KEYWORDS.filter((entry) => html.toLowerCase().includes(entry.keyword)).map((entry) => entry.label),
  );
  const marketingPixels = uniqueStrings(
    PIXEL_KEYWORDS.filter((entry) => html.toLowerCase().includes(entry.keyword)).map((entry) => entry.label),
  );
  const crm = detectFromKeywords(html, CRM_KEYWORDS).label;

  return {
    cms,
    analytics,
    marketingPixels,
    crm,
  };
}

function detectMobileResponsive(html: string): boolean {
  return /<meta[^>]+name=["']viewport["']/i.test(html) || /responsive|viewport/i.test(html);
}

function detectGrowthSignals(input: ProspectIntelligenceInput, snapshot: WebsiteSnapshot, techStack: { cms?: string; analytics: string[]; marketingPixels: string[]; crm?: string }): string[] {
  return uniqueStrings([
    (input.reviewCount ?? 0) >= 100 ? "Healthy review volume" : undefined,
    (input.rating ?? 0) >= 4.6 ? "Strong public reputation" : undefined,
    snapshot.socialLinks.some((link) => link.includes("linkedin.com")) ? "LinkedIn presence detected" : undefined,
    snapshot.socialLinks.some((link) => link.includes("instagram.com")) ? "Instagram presence detected" : undefined,
    snapshot.socialLinks.some((link) => link.includes("facebook.com")) ? "Facebook presence detected" : undefined,
    snapshot.services.length > 0 ? "Services are clearly listed" : undefined,
    snapshot.ctas.some((cta) => /book|schedule|contact/i.test(cta)) ? "Conversion-oriented calls to action" : undefined,
    snapshot.bookingSoftware ? "Online booking path exists" : undefined,
    techStack.analytics.length > 0 ? "Analytics installed" : undefined,
    techStack.marketingPixels.length > 0 ? "Paid media tracking active" : undefined,
    techStack.crm ? `CRM / operations stack detected: ${techStack.crm}` : undefined,
    /hiring|join our team|careers|we're hiring|now hiring/i.test(snapshot.textSample) ? "Hiring signal on site" : undefined,
    /second location|new location|multiple locations|locations/i.test(snapshot.textSample) ? "Expansion language on site" : undefined,
    snapshot.socialLinks.some((link) => /linkedin\.com/.test(link)) ? "Owner or company appears active on LinkedIn" : undefined,
  ]);
}

function buildCoverageFromPresence(
  present: boolean,
  evidence: string[],
  note?: string,
): RevenueAgentSourceCoverageSnapshot {
  return {
    status: present ? (evidence.length > 0 ? "available" : "partial") : "missing",
    evidence,
    note,
  };
}

function buildSourceCoverage(
  input: ProspectIntelligenceInput,
  snapshot: WebsiteSnapshot,
  techStack: { cms?: string; analytics: string[]; marketingPixels: string[]; crm?: string },
): RevenueAgentBusinessProfileSnapshot["sourceCoverage"] {
  const socialLinks = snapshot.socialLinks;
  const linkedinEvidence = socialLinks.filter((link) => /linkedin\.com/i.test(link));
  const facebookEvidence = socialLinks.filter((link) => /facebook\.com/i.test(link));
  const instagramEvidence = socialLinks.filter((link) => /instagram\.com/i.test(link));
  const yelpEvidence = socialLinks.filter((link) => /yelp\.com/i.test(link));
  const bbbEvidence = socialLinks.filter((link) => /bbb\.org/i.test(link));

  return {
    googleBusiness: buildCoverageFromPresence(
      input.source === "google_business" || (typeof input.rating === "number" && typeof input.reviewCount === "number"),
      [
        typeof input.rating === "number" ? `Rating ${input.rating.toFixed(1)}` : "",
        typeof input.reviewCount === "number" ? `${input.reviewCount} reviews` : "",
      ].filter((item) => item.length > 0),
      "Derived from the prospect feed and review data.",
    ),
    linkedinCompany: buildCoverageFromPresence(
      linkedinEvidence.length > 0,
      linkedinEvidence,
      linkedinEvidence.length > 0 ? undefined : "No LinkedIn company page was surfaced from the website links.",
    ),
    facebookPage: buildCoverageFromPresence(
      facebookEvidence.length > 0,
      facebookEvidence,
      facebookEvidence.length > 0 ? undefined : "No Facebook Page was surfaced from the website links.",
    ),
    instagram: buildCoverageFromPresence(
      instagramEvidence.length > 0,
      instagramEvidence,
      instagramEvidence.length > 0 ? undefined : "No Instagram profile was surfaced from the website links.",
    ),
    yelp: buildCoverageFromPresence(
      yelpEvidence.length > 0,
      yelpEvidence,
      yelpEvidence.length > 0 ? undefined : "No Yelp presence was surfaced from the website links.",
    ),
    bbb: buildCoverageFromPresence(
      bbbEvidence.length > 0,
      bbbEvidence,
      bbbEvidence.length > 0 ? undefined : "No BBB listing was surfaced from the website links.",
    ),
    whois: {
      status: snapshot.url ? "unknown" : "missing",
      evidence: snapshot.url ? [snapshot.url] : [],
      note: snapshot.url ? "WHOIS / domain age lookup is not connected yet." : "No website URL available.",
    },
    techStack: buildCoverageFromPresence(
      Boolean(snapshot.bookingSoftware || techStack.cms || techStack.analytics.length > 0 || techStack.marketingPixels.length > 0 || techStack.crm),
      uniqueStrings([
        snapshot.bookingSoftware,
        techStack.cms,
        ...techStack.analytics,
        ...techStack.marketingPixels,
        techStack.crm,
      ]),
      "Derived from the public website HTML.",
    ),
  };
}

function buildBusinessProfile(
  input: ProspectIntelligenceInput,
  snapshot: WebsiteSnapshot,
  techStack: { cms?: string; analytics: string[]; marketingPixels: string[]; crm?: string },
): RevenueAgentBusinessProfileSnapshot {
  const websiteScore = clampNumber(
    42 +
      (snapshot.https ? 12 : 0) +
      (snapshot.mobileResponsive ? 10 : -6) +
      (snapshot.contactForm ? 10 : -8) +
      (snapshot.chatWidget ? 6 : 0) +
      (snapshot.bookingSoftware ? 14 : -10) +
      (techStack.analytics.length > 0 ? 6 : 0) +
      (techStack.cms ? 4 : 0) +
      (snapshot.performanceBand === "strong" ? 8 : snapshot.performanceBand === "moderate" ? 2 : -10),
    0,
    100,
  );

  const reviewsScore = clampNumber(
    34 +
      ((input.reviewCount ?? 0) >= 200 ? 30 : (input.reviewCount ?? 0) >= 75 ? 20 : (input.reviewCount ?? 0) >= 20 ? 10 : 0) +
      ((input.rating ?? 0) >= 4.8 ? 30 : (input.rating ?? 0) >= 4.5 ? 20 : (input.rating ?? 0) >= 4.2 ? 10 : (input.rating ?? 0) > 0 ? -8 : -15),
    0,
    100,
  );

  const bookingScore = clampNumber(
    snapshot.bookingSoftware
      ? 82 + (snapshot.contactForm ? 4 : 0) + (snapshot.chatWidget ? 4 : 0)
      : snapshot.contactForm
        ? 48
        : 12,
    0,
    100,
  );

  const crmScore = techStack.crm
    ? clampNumber(72 + (techStack.analytics.length > 0 ? 8 : 0) + (techStack.marketingPixels.length > 0 ? 4 : 0), 0, 100)
    : null;

  const aiReadinessScore = clampNumber(
    18 +
      Math.round(websiteScore * 0.28) +
      Math.round(bookingScore * 0.22) +
      Math.round(reviewsScore * 0.12) +
      (techStack.analytics.length > 0 ? 8 : 0) +
      (techStack.marketingPixels.length > 0 ? 5 : 0) +
      (techStack.crm ? 6 : 0),
    0,
    100,
  );

  const growthSignals = detectGrowthSignals(input, snapshot, techStack);
  const sourceCoverage = buildSourceCoverage(input, snapshot, techStack);
  const ownerSignals = uniqueStrings([
    input.source === "google_business" ? "Owner visible on local search" : undefined,
    growthSignals.includes("LinkedIn presence detected") ? "Owner or team active on LinkedIn" : undefined,
    growthSignals.includes("Hiring signal on site") ? "Hiring support staff" : undefined,
    growthSignals.includes("Expansion language on site") ? "Expansion or second-location momentum" : undefined,
  ]);

  const notes = uniqueStrings([
    sourceCoverage.whois.note,
    sourceCoverage.googleBusiness.note,
    sourceCoverage.linkedinCompany.note,
    sourceCoverage.facebookPage.note,
    sourceCoverage.instagram.note,
    sourceCoverage.yelp.note,
    sourceCoverage.bbb.note,
  ]);

  const businessHealthScore = clampNumber(
    Math.round((websiteScore + reviewsScore + bookingScore + aiReadinessScore) / 4),
    0,
    100,
  );

  return {
    businessHealthScore,
    websiteScore,
    reviewsScore,
    bookingScore,
    crmScore,
    aiReadinessScore,
    growthSignals,
    ownerSignals,
    sourceCoverage,
    techStack: {
      bookingSoftware: snapshot.bookingSoftware,
      bookingSoftwareEvidence: snapshot.bookingSoftwareEvidence,
      cms: snapshot.cms,
      analytics: snapshot.analytics,
      marketingPixels: snapshot.marketingPixels,
      contactForm: snapshot.contactForm,
      chatWidget: snapshot.chatWidget,
      mobileResponsive: snapshot.mobileResponsive,
      performanceBand: snapshot.performanceBand,
      https: snapshot.https,
      socialLinks: snapshot.socialLinks,
      services: snapshot.services,
      notes: snapshot.notes,
    },
    notes,
  };
}

function buildSalesStrategy(
  input: ProspectIntelligenceInput,
  snapshot: WebsiteSnapshot,
  profile: RevenueAgentBusinessProfileSnapshot,
  analysis: {
    painPoints: string[];
    automationOpportunities: string[];
    suggestedOutreachAngle: string;
  },
): RevenueAgentSalesStrategySnapshot {
  const primaryPain =
    analysis.painPoints[0] ||
    (snapshot.bookingSoftware ? "Follow-up is still manual enough to miss opportunities." : "The website does not convert traffic into bookings cleanly.");
  const recommendedOffer = input.offer.trim() || analysis.suggestedOutreachAngle || "AI booking assistant";
  const openingHook = snapshot.bookingSoftware
    ? `I noticed your site already has a booking layer, but the bigger opportunity looks like tightening the lead capture and follow-up around it.`
    : `I noticed the site does not make it easy to convert visitors into booked conversations, which usually hides a lot of missed revenue.`;
  const objections: RevenueAgentSalesObjectionSnapshot[] = [
    {
      objection: "We already have receptionists.",
      response: "This complements your team by catching missed leads and reducing repetitive follow-up, so staff spends less time chasing the same tasks.",
    },
    {
      objection: "We already use a booking tool.",
      response: "That helps, but the real lift is in the gaps around it: missed calls, abandoned forms, no-response follow-up, and slower lead recovery.",
    },
    {
      objection: "We do not want another system to manage.",
      response: "The point is to remove manual work, not add it. The workflow should fit around what you already use.",
    },
  ];

  const cta =
    profile.aiReadinessScore >= 40
      ? "15-minute workflow audit"
      : "Quick audit call";

  const strategyRationale = uniqueStrings([
    primaryPain,
    `Business health score ${profile.businessHealthScore}/100`,
    `Website score ${profile.websiteScore}/100`,
    `Review score ${profile.reviewsScore}/100`,
    profile.crmScore !== null ? `CRM score ${profile.crmScore}/100` : "No CRM signal detected",
    profile.growthSignals[0],
    profile.ownerSignals[0],
  ]);

  return {
    primaryPain,
    recommendedOffer,
    openingHook,
    objections,
    cta,
    strategyRationale,
  };
}

function detectServices(html: string, textSample: string, headings: string[]): string[] {
  const candidates = uniqueStrings([
    ...headings,
    ...extractTagTexts(html, "a"),
    ...extractTagTexts(html, "button"),
  ]);

  const filtered = candidates.filter((candidate) => {
    const value = candidate.toLowerCase();
    return (
      value.length > 2 &&
      !["home", "about", "contact", "book", "book now", "schedule", "menu", "login", "sign in", "call now"].includes(value)
    );
  });

  if (filtered.length > 0) {
    return filtered.slice(0, 8);
  }

  const textMatches = Array.from(
    textSample.matchAll(
      /\b(?:service|services|treatment|treatments|package|packages|consultation|consultations|booking|appointments?|hair|skin|spa|care|repair|design|marketing|strategy)\b/gi,
    ),
  ).map((match) => normalizeOptional(match[0]));

  return uniqueStrings(textMatches).slice(0, 8);
}

function buildPerformanceBand(loadMs: number | undefined, htmlLength: number, scriptCount: number): RevenueAgentWebsitePerformanceBand {
  if (!loadMs && htmlLength === 0) {
    return "unknown";
  }

  if ((loadMs ?? 0) > 4500 || htmlLength > 700000 || scriptCount > 24) {
    return "weak";
  }

  if ((loadMs ?? 0) > 2500 || htmlLength > 350000 || scriptCount > 14) {
    return "moderate";
  }

  return "strong";
}

function buildOpportunityTags(input: {
  bookingSoftware?: string;
  contactForm: boolean;
  chatWidget: boolean;
  mobileResponsive: boolean;
  performanceBand: RevenueAgentWebsitePerformanceBand;
  socialLinks: string[];
  painPoints: string[];
  automationOpportunities: string[];
}): string[] {
  return uniqueStrings([
    input.bookingSoftware ? `booking-${slugify(input.bookingSoftware)}` : "no-booking-software",
    input.contactForm ? "contact-form" : "no-contact-form",
    input.chatWidget ? "chat-widget" : "no-chat-widget",
    input.mobileResponsive ? "mobile-friendly" : "mobile-friction",
    input.performanceBand === "weak"
      ? "slow-website"
      : input.performanceBand === "moderate"
        ? "website-needs-optimization"
        : "website-fast",
    input.socialLinks.length > 0 ? "social-presence" : "missing-social-links",
    ...input.painPoints.slice(0, 2).map((item) => slugify(item).slice(0, 40)),
    ...input.automationOpportunities.slice(0, 2).map((item) => slugify(item).slice(0, 40)),
  ]).slice(0, 8);
}

function buildWebsiteSnapshot(input: ProspectIntelligenceInput, html: string | undefined, loadMs?: number, finalUrl?: string): WebsiteSnapshot {
  const title = html ? extractTitle(html) : "";
  const metaDescription = html ? extractMetaDescription(html) : "";
  const headings = html ? uniqueStrings([...extractTagTexts(html, "h1"), ...extractTagTexts(html, "h2"), ...extractTagTexts(html, "h3")]).slice(0, 10) : [];
  const textSample = html ? stripHtml(html).slice(0, 4000) : "";
  const booking = html ? detectFromKeywords(html, BOOKING_KEYWORDS) : { evidence: [] };
  const techStack: { cms?: string; analytics: string[]; marketingPixels: string[]; crm?: string } = html
    ? detectTechStack(html)
    : { analytics: [], marketingPixels: [] };
  const socialLinks = html ? extractSocialLinks(html) : [];
  const services = html ? detectServices(html, textSample, headings) : [];
  const scripts = html ? Array.from(html.matchAll(/<script\b/gi)).map(() => "script") : [];
  const ctas = html ? uniqueStrings([...extractTagTexts(html, "a"), ...extractTagTexts(html, "button")].filter((item) => /book|schedule|contact|call|quote|estimate|consult/i.test(item))).slice(0, 8) : [];

  return {
    url: normalizeWebsiteUrl(input.website),
    finalUrl,
    title,
    metaDescription,
    headings,
    services,
    ctas,
    textSample,
    bookingSoftware: booking.label,
    bookingSoftwareEvidence: booking.evidence,
    cms: techStack.cms,
    analytics: techStack.analytics,
    marketingPixels: techStack.marketingPixels,
    crm: techStack.crm,
    contactForm: html ? detectContactForm(html) : false,
    chatWidget: html ? detectChatWidget(html) : false,
    mobileResponsive: html ? detectMobileResponsive(html) : false,
    performanceBand: buildPerformanceBand(loadMs, html?.length ?? 0, scripts.length),
    https: Boolean(finalUrl?.startsWith("https://") || normalizeWebsiteUrl(input.website)?.startsWith("https://")),
    socialLinks,
    notes: [
      html ? undefined : "Website fetch unavailable.",
      !booking.label ? "No obvious booking software detected." : undefined,
      html && !detectContactForm(html) ? "No obvious contact form detected." : undefined,
      html && !detectChatWidget(html) ? "No obvious chat widget detected." : undefined,
      html && !detectMobileResponsive(html) ? "No responsive viewport signal detected." : undefined,
    ].filter((item): item is string => Boolean(item)),
  };
}

function buildFallbackAnalysis(input: ProspectIntelligenceInput, snapshot: WebsiteSnapshot): CompletedAnalysis {
  const workspaceKnowledge = input.workspaceKnowledge;
  const techStack = {
    cms: snapshot.cms,
    analytics: snapshot.analytics,
    marketingPixels: snapshot.marketingPixels,
    crm: snapshot.crm,
  };
  const noBooking = !snapshot.bookingSoftware;
  const noForm = !snapshot.contactForm;
  const noChat = !snapshot.chatWidget;
  const slowSite = snapshot.performanceBand === "weak";
  const ratingPressure = typeof input.rating === "number" && input.rating <= 4.4;
  const lowReviewVolume = (input.reviewCount ?? 0) < 50;

  const painPoints = uniqueStrings([
    noBooking ? "No online booking flow" : undefined,
    noForm ? "No clear lead capture form" : undefined,
    noChat ? "No live chat or instant response path" : undefined,
    slowSite ? "Site performance looks weak" : undefined,
    !snapshot.mobileResponsive ? "Mobile experience may leak leads" : undefined,
    ratingPressure ? "Reviews suggest missed response opportunities" : undefined,
    lowReviewVolume ? "Review volume is still light enough to gain ground quickly" : undefined,
  ]);

  const automationOpportunities = uniqueStrings([
    noBooking ? "Add booking and appointment routing" : undefined,
    noForm ? "Install a lead capture flow and missed-call recovery" : undefined,
    noChat ? "Add instant-response chat for high-intent visitors" : undefined,
    slowSite ? "Trim the site for faster conversion" : undefined,
    "Build auto follow-up for new inquiries and quote requests",
  ]);

  const scoreBase =
    44 +
    (noBooking ? 18 : 0) +
    (noForm ? 12 : 0) +
    (noChat ? 8 : 0) +
    (slowSite ? 8 : snapshot.performanceBand === "moderate" ? 4 : 0) +
    (!snapshot.mobileResponsive ? 6 : 0) +
    (ratingPressure ? 5 : 0) +
    (lowReviewVolume ? 4 : 0);

  const opportunityScore = clampNumber(scoreBase, 0, 100);
  const painSummary =
    painPoints.length > 0
      ? painPoints.slice(0, 2).join(" ")
      : `${input.businessName} has visible demand signals, but the website does not clearly show a high-conversion booking path.`;
  const websiteSummary = snapshot.title || snapshot.metaDescription
    ? `The site presents ${snapshot.title || input.businessName} and signals ${snapshot.metaDescription || "a simple public presence"}, but the conversion path still looks limited.`
    : "The website does not provide enough obvious conversion signals to suggest a strong self-serve booking path.";
  const workspacePositioning = workspaceKnowledge?.profile?.positioningSummary?.trim();
  const workspaceVoice = workspaceKnowledge?.profile?.voiceSummary?.trim();
  const workspaceAudience = workspaceKnowledge?.profile?.audienceSummary?.trim();
  const businessProfile = buildBusinessProfile(input, snapshot, techStack);
  const salesStrategy = buildSalesStrategy(input, snapshot, businessProfile, {
    painPoints,
    automationOpportunities,
    suggestedOutreachAngle: input.offer.trim()
      ? input.offer.trim()
      : "AI booking and follow-up automation that reduces front-desk work",
  });
  const signature = resolveWorkspaceSignature(workspaceKnowledge);
  const introduction = workspaceVoice
    ? `I kept this aligned to the workspace voice and focused it on ${workspaceVoice.toLowerCase()}.`
    : "I kept this tight and focused on a practical next step.";
  const angleLine = workspacePositioning
    ? `I think ${salesStrategy.recommendedOffer.toLowerCase()} fits your positioning around ${workspacePositioning.toLowerCase()}.`
    : `I think ${salesStrategy.recommendedOffer.toLowerCase()} could recover more inbound opportunities without adding front-desk work.`;
  const audienceLine = workspaceAudience
    ? `The note is written for ${workspaceAudience.toLowerCase()}.`
    : "The note is written for the owner or manager who wants a cleaner follow-up process.";

  return {
    businessSummary: `${input.businessName} is a ${input.industry.toLowerCase()} business in ${[input.city, input.state].filter(Boolean).join(", ") || "its local market"}.`,
    websiteSummary,
    painPoints,
    automationOpportunities,
    estimatedRoiHoursPerWeekMin: clampNumber(6 + automationOpportunities.length * 2, 4, 24),
    estimatedRoiHoursPerWeekMax: clampNumber(12 + automationOpportunities.length * 3, 8, 40),
    opportunityScore,
    opportunityScoreReasons: uniqueStrings([
      noBooking ? "No online booking system found." : "Online booking is visible.",
      noForm ? "Lead capture could be stronger." : "The site already captures leads directly.",
      noChat ? "No live response layer was detected." : "The site has a chat path.",
      slowSite ? "Performance signals look weak." : `Performance signals look ${snapshot.performanceBand}.`,
      !snapshot.mobileResponsive ? "Mobile responsiveness is not obvious." : "The site appears mobile-friendly.",
    ]),
    suggestedOutreachAngle: salesStrategy.recommendedOffer,
    emailSubject: `${input.businessName} quick idea`,
    emailBody: [
      `Hi ${input.businessName},`,
      "",
      introduction,
      "",
      `I took a quick look at your website and noticed a few places where lead capture and follow-up could be tighter.`,
      "",
      painSummary,
      "",
      angleLine,
      "",
      audienceLine,
      "",
      "If helpful, I can send a short audit with the exact gaps I would test first.",
      "",
      signature,
    ].join("\n"),
    opportunityTags: buildOpportunityTags({
      bookingSoftware: snapshot.bookingSoftware,
      contactForm: snapshot.contactForm,
      chatWidget: snapshot.chatWidget,
      mobileResponsive: snapshot.mobileResponsive,
      performanceBand: snapshot.performanceBand,
      socialLinks: snapshot.socialLinks,
      painPoints,
      automationOpportunities,
    }),
    businessProfile,
    salesStrategy,
    websiteSignals: {
      bookingSoftware: snapshot.bookingSoftware,
      bookingSoftwareEvidence: snapshot.bookingSoftwareEvidence,
      cms: snapshot.cms,
      analytics: snapshot.analytics,
      marketingPixels: snapshot.marketingPixels,
      contactForm: snapshot.contactForm,
      chatWidget: snapshot.chatWidget,
      mobileResponsive: snapshot.mobileResponsive,
      performanceBand: snapshot.performanceBand,
      https: snapshot.https,
      socialLinks: snapshot.socialLinks,
      services: snapshot.services,
      notes: snapshot.notes,
    },
  };
}

function buildPrompt(input: ProspectIntelligenceInput, snapshot: WebsiteSnapshot, analysis: ProspectIntelligenceResult): string {
  const workspaceKnowledgeContext = buildWorkspaceKnowledgePromptContext(input.workspaceKnowledge);
  return [
    "You are a revenue operator analyzing a local business website for outreach.",
    "Return a single JSON object only.",
    "Be specific, practical, and founder-led. No hype.",
    "Do not mention that you are an AI model.",
    "Prefer grounded conclusions from the website signals and the business context.",
    "Use the workspace knowledge as the source of truth for tone, services, CTA, and signature whenever it exists.",
    "Never invent services, brand facts, or signature details that are not supported by the workspace context.",
    "",
    "JSON SHAPE",
    JSON.stringify(
      {
        businessSummary: "string",
        websiteSummary: "string",
        painPoints: ["string"],
        automationOpportunities: ["string"],
        estimatedRoiHoursPerWeekMin: 8,
        estimatedRoiHoursPerWeekMax: 16,
        opportunityScore: 92,
        opportunityScoreReasons: ["string"],
        suggestedOutreachAngle: "string",
        emailSubject: "string",
        emailBody: "string",
        opportunityTags: ["string"],
        businessProfile: {
          businessHealthScore: 82,
          websiteScore: 78,
          reviewsScore: 90,
          bookingScore: 40,
          crmScore: 65,
          aiReadinessScore: 54,
          growthSignals: ["string"],
          ownerSignals: ["string"],
          sourceCoverage: {
            googleBusiness: { status: "available", evidence: ["string"], note: "string" },
            linkedinCompany: { status: "missing", evidence: ["string"], note: "string" },
            facebookPage: { status: "missing", evidence: ["string"], note: "string" },
            instagram: { status: "missing", evidence: ["string"], note: "string" },
            yelp: { status: "missing", evidence: ["string"], note: "string" },
            bbb: { status: "unknown", evidence: ["string"], note: "string" },
            whois: { status: "unknown", evidence: ["string"], note: "string" },
            techStack: { status: "available", evidence: ["string"], note: "string" },
          },
          techStack: {
            bookingSoftware: "string or null",
            bookingSoftwareEvidence: ["string"],
            cms: "string or null",
            analytics: ["string"],
            marketingPixels: ["string"],
            contactForm: true,
            chatWidget: true,
            mobileResponsive: true,
            performanceBand: "strong",
            https: true,
            socialLinks: ["string"],
            services: ["string"],
            notes: ["string"],
          },
          notes: ["string"],
        },
        salesStrategy: {
          primaryPain: "string",
          recommendedOffer: "string",
          openingHook: "string",
          objections: [{ objection: "string", response: "string" }],
          cta: "string",
          strategyRationale: ["string"],
        },
        websiteSignals: {
          bookingSoftware: "string or null",
          bookingSoftwareEvidence: ["string"],
          cms: "string or null",
          analytics: ["string"],
          marketingPixels: ["string"],
          contactForm: true,
          chatWidget: true,
          mobileResponsive: true,
          performanceBand: "strong",
          https: true,
          socialLinks: ["string"],
          services: ["string"],
          notes: ["string"],
        },
      },
      null,
      2,
    ),
    "",
    "RULES",
    "- opportunityScore must be an integer between 0 and 100.",
    "- estimatedRoiHoursPerWeekMin and estimatedRoiHoursPerWeekMax must be integers.",
    "- businessProfile scores must be integers from 0 to 100.",
    "- Keep pain points and automation opportunities concise, specific, and easy to use in sales copy.",
    "- Make the outreach angle feel like a real sales argument, not a generic summary.",
    "- Make the email easy to approve in one glance.",
    "- Make salesStrategy feel like a real sales plan with a primary pain, offer, opening hook, objection handling, and CTA.",
    "- Mirror the provided websiteSignals unless the website page clearly contradicts them.",
    workspaceKnowledgeContext ? "- Keep the draft aligned to the workspace voice and signature provided below." : "- If no workspace knowledge exists, fall back to a clean founder-led tone.",
    "",
    "BUSINESS CONTEXT",
    JSON.stringify(
      {
        businessName: input.businessName,
        industry: input.industry,
        location: [input.city, input.state].filter(Boolean).join(", "),
        website: snapshot.finalUrl || snapshot.url || input.website || null,
        source: input.source,
        sourceUrl: input.sourceUrl ?? null,
        rating: input.rating ?? null,
        reviewCount: input.reviewCount ?? null,
        painSignals: input.painSignals,
        offer: input.offer,
        websiteSnapshot: snapshot,
        workspaceKnowledge: workspaceKnowledgeContext,
      },
      null,
      2,
    ),
    "",
    "REFERENCE ANSWER",
    JSON.stringify(analysis, null, 2),
  ].join("\n");
}

function safeParseJson(value: string): Partial<CompletedAnalysis> | undefined {
  try {
    const parsed = JSON.parse(value) as Partial<CompletedAnalysis>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

function sanitizeAnalysis(
  parsed: Partial<CompletedAnalysis> | undefined,
  fallback: CompletedAnalysis,
): CompletedAnalysis {
  const response = parsed ?? {};
  const websiteSignalsFallback = fallback.websiteSignals;

  return {
    businessSummary: normalizeOptional(response.businessSummary) || fallback.businessSummary,
    websiteSummary: normalizeOptional(response.websiteSummary) || fallback.websiteSummary,
    painPoints: uniqueStrings(response.painPoints ?? fallback.painPoints).slice(0, 6),
    automationOpportunities: uniqueStrings(response.automationOpportunities ?? fallback.automationOpportunities).slice(0, 6),
    estimatedRoiHoursPerWeekMin: clampNumber(
      Number(response.estimatedRoiHoursPerWeekMin ?? fallback.estimatedRoiHoursPerWeekMin),
      0,
      80,
    ),
    estimatedRoiHoursPerWeekMax: Math.max(
      clampNumber(Number(response.estimatedRoiHoursPerWeekMax ?? fallback.estimatedRoiHoursPerWeekMax), 0, 120),
      clampNumber(Number(response.estimatedRoiHoursPerWeekMin ?? fallback.estimatedRoiHoursPerWeekMin), 0, 80),
    ),
    opportunityScore: clampNumber(Number(response.opportunityScore ?? fallback.opportunityScore), 0, 100),
    opportunityScoreReasons: uniqueStrings(response.opportunityScoreReasons ?? fallback.opportunityScoreReasons).slice(0, 6),
    suggestedOutreachAngle: normalizeOptional(response.suggestedOutreachAngle) || fallback.suggestedOutreachAngle,
    emailSubject: normalizeOptional(response.emailSubject) || fallback.emailSubject,
    emailBody: normalizeOptional(response.emailBody) || fallback.emailBody,
    opportunityTags: uniqueStrings(response.opportunityTags ?? fallback.opportunityTags).slice(0, 8),
    websiteSignals: {
      bookingSoftware:
        normalizeOptional(response.websiteSignals?.bookingSoftware) ||
        websiteSignalsFallback.bookingSoftware,
      bookingSoftwareEvidence: uniqueStrings(
        response.websiteSignals?.bookingSoftwareEvidence ?? websiteSignalsFallback.bookingSoftwareEvidence,
      ).slice(0, 6),
      cms: normalizeOptional(response.websiteSignals?.cms) || websiteSignalsFallback.cms,
      analytics: uniqueStrings(response.websiteSignals?.analytics ?? websiteSignalsFallback.analytics).slice(0, 10),
      marketingPixels: uniqueStrings(
        response.websiteSignals?.marketingPixels ?? websiteSignalsFallback.marketingPixels,
      ).slice(0, 10),
      contactForm: response.websiteSignals?.contactForm ?? websiteSignalsFallback.contactForm,
      chatWidget: response.websiteSignals?.chatWidget ?? websiteSignalsFallback.chatWidget,
      mobileResponsive: response.websiteSignals?.mobileResponsive ?? websiteSignalsFallback.mobileResponsive,
      performanceBand: response.websiteSignals?.performanceBand ?? websiteSignalsFallback.performanceBand,
      https: response.websiteSignals?.https ?? websiteSignalsFallback.https,
      socialLinks: uniqueStrings(response.websiteSignals?.socialLinks ?? websiteSignalsFallback.socialLinks).slice(0, 10),
      services: uniqueStrings(response.websiteSignals?.services ?? websiteSignalsFallback.services).slice(0, 10),
      notes: uniqueStrings(response.websiteSignals?.notes ?? websiteSignalsFallback.notes).slice(0, 10),
    },
    businessProfile: sanitizeBusinessProfile(response.businessProfile, fallback.businessProfile),
    salesStrategy: sanitizeSalesStrategy(response.salesStrategy, fallback.salesStrategy),
  };
}

function buildFallbackOutput(input: ProspectIntelligenceInput, snapshot: WebsiteSnapshot): ProspectIntelligenceResult {
  const analysis = buildFallbackAnalysis(input, snapshot);
  return {
    websiteUrl: snapshot.finalUrl || snapshot.url,
    painSummary: analysis.painPoints.join(" ") || analysis.websiteSummary,
    opportunityScore: analysis.opportunityScore,
    opportunityTags: analysis.opportunityTags,
    suggestedOfferAngle: analysis.suggestedOutreachAngle,
    emailSubject: analysis.emailSubject,
    emailBody: analysis.emailBody,
    report: {
      ...analysis,
      generatedAt: new Date().toISOString(),
    },
  };
}

function buildAnalysisFallback(
  report: RevenueAgentOpportunityReport,
  extras: {
    emailSubject?: string;
    emailBody?: string;
    opportunityTags?: string[];
  } = {},
): CompletedAnalysis {
  return {
    businessSummary: report.businessSummary,
    websiteSummary: report.websiteSummary,
    painPoints: report.painPoints,
    automationOpportunities: report.automationOpportunities,
    estimatedRoiHoursPerWeekMin: report.estimatedRoiHoursPerWeekMin,
    estimatedRoiHoursPerWeekMax: report.estimatedRoiHoursPerWeekMax,
    opportunityScore: report.opportunityScore,
    opportunityScoreReasons: report.opportunityScoreReasons,
    suggestedOutreachAngle: report.suggestedOutreachAngle,
    emailSubject: extras.emailSubject || report.suggestedOutreachAngle || "",
    emailBody: extras.emailBody || "",
    opportunityTags: uniqueStrings(extras.opportunityTags ?? []),
    businessProfile: report.businessProfile,
    salesStrategy: report.salesStrategy,
    websiteSignals: report.websiteSignals,
  };
}

function sanitizeCoverage(
  response: Partial<RevenueAgentSourceCoverageSnapshot> | undefined,
  fallback: RevenueAgentSourceCoverageSnapshot,
): RevenueAgentSourceCoverageSnapshot {
  return {
    status: response?.status ?? fallback.status,
    evidence: uniqueStrings(response?.evidence ?? fallback.evidence).slice(0, 6),
    note: normalizeOptional(response?.note) || fallback.note,
  };
}

function sanitizeBusinessProfile(
  response: Partial<RevenueAgentBusinessProfileSnapshot> | undefined,
  fallback: RevenueAgentBusinessProfileSnapshot,
): RevenueAgentBusinessProfileSnapshot {
  const sourceCoverage: Partial<RevenueAgentBusinessProfileSnapshot["sourceCoverage"]> = response?.sourceCoverage ?? {};
  const techStack: Partial<RevenueAgentBusinessProfileSnapshot["techStack"]> = response?.techStack ?? {};

  return {
    businessHealthScore: clampNumber(Number(response?.businessHealthScore ?? fallback.businessHealthScore), 0, 100),
    websiteScore: clampNumber(Number(response?.websiteScore ?? fallback.websiteScore), 0, 100),
    reviewsScore: clampNumber(Number(response?.reviewsScore ?? fallback.reviewsScore), 0, 100),
    bookingScore: clampNumber(Number(response?.bookingScore ?? fallback.bookingScore), 0, 100),
    crmScore:
      response?.crmScore === null || response?.crmScore === undefined
        ? fallback.crmScore
        : clampNumber(Number(response.crmScore), 0, 100),
    aiReadinessScore: clampNumber(Number(response?.aiReadinessScore ?? fallback.aiReadinessScore), 0, 100),
    growthSignals: uniqueStrings(response?.growthSignals ?? fallback.growthSignals).slice(0, 10),
    ownerSignals: uniqueStrings(response?.ownerSignals ?? fallback.ownerSignals).slice(0, 10),
    sourceCoverage: {
      googleBusiness: sanitizeCoverage(sourceCoverage.googleBusiness, fallback.sourceCoverage.googleBusiness),
      linkedinCompany: sanitizeCoverage(sourceCoverage.linkedinCompany, fallback.sourceCoverage.linkedinCompany),
      facebookPage: sanitizeCoverage(sourceCoverage.facebookPage, fallback.sourceCoverage.facebookPage),
      instagram: sanitizeCoverage(sourceCoverage.instagram, fallback.sourceCoverage.instagram),
      yelp: sanitizeCoverage(sourceCoverage.yelp, fallback.sourceCoverage.yelp),
      bbb: sanitizeCoverage(sourceCoverage.bbb, fallback.sourceCoverage.bbb),
      whois: sanitizeCoverage(sourceCoverage.whois, fallback.sourceCoverage.whois),
      techStack: sanitizeCoverage(sourceCoverage.techStack, fallback.sourceCoverage.techStack),
    },
    techStack: {
      bookingSoftware:
        normalizeOptional(techStack.bookingSoftware) ||
        fallback.techStack.bookingSoftware,
      bookingSoftwareEvidence: uniqueStrings(techStack.bookingSoftwareEvidence ?? fallback.techStack.bookingSoftwareEvidence).slice(0, 6),
      cms: normalizeOptional(techStack.cms) || fallback.techStack.cms,
      analytics: uniqueStrings(techStack.analytics ?? fallback.techStack.analytics).slice(0, 10),
      marketingPixels: uniqueStrings(techStack.marketingPixels ?? fallback.techStack.marketingPixels).slice(0, 10),
      contactForm: techStack.contactForm ?? fallback.techStack.contactForm,
      chatWidget: techStack.chatWidget ?? fallback.techStack.chatWidget,
      mobileResponsive: techStack.mobileResponsive ?? fallback.techStack.mobileResponsive,
      performanceBand: techStack.performanceBand ?? fallback.techStack.performanceBand,
      https: techStack.https ?? fallback.techStack.https,
      socialLinks: uniqueStrings(techStack.socialLinks ?? fallback.techStack.socialLinks).slice(0, 10),
      services: uniqueStrings(techStack.services ?? fallback.techStack.services).slice(0, 10),
      notes: uniqueStrings(techStack.notes ?? fallback.techStack.notes).slice(0, 10),
    },
    notes: uniqueStrings(response?.notes ?? fallback.notes).slice(0, 10),
  };
}

function sanitizeSalesStrategy(
  response: Partial<RevenueAgentSalesStrategySnapshot> | undefined,
  fallback: RevenueAgentSalesStrategySnapshot,
): RevenueAgentSalesStrategySnapshot {
  const objections = Array.isArray(response?.objections) && response.objections.length > 0
    ? response.objections
        .map((item) =>
          item && typeof item === "object" && !Array.isArray(item)
            ? {
                objection: normalizeOptional((item as RevenueAgentSalesObjectionSnapshot).objection),
                response: normalizeOptional((item as RevenueAgentSalesObjectionSnapshot).response),
              }
            : { objection: "", response: "" },
        )
        .filter((item) => item.objection.length > 0 && item.response.length > 0)
    : fallback.objections;

  return {
    primaryPain: normalizeOptional(response?.primaryPain) || fallback.primaryPain,
    recommendedOffer: normalizeOptional(response?.recommendedOffer) || fallback.recommendedOffer,
    openingHook: normalizeOptional(response?.openingHook) || fallback.openingHook,
    objections,
    cta: normalizeOptional(response?.cta) || fallback.cta,
    strategyRationale: uniqueStrings(response?.strategyRationale ?? fallback.strategyRationale).slice(0, 8),
  };
}

async function fetchWebsiteHtml(url: string): Promise<{ html?: string; finalUrl?: string; loadMs?: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  const startedAt = Date.now();

  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; FounderContentRevenueAgent/1.0; +https://foundercontent.ai)",
      },
    });

    const html = await response.text();
    return {
      html,
      finalUrl: response.url,
      loadMs: Date.now() - startedAt,
    };
  } catch (error) {
    logWarn("Revenue agent website fetch failed.", {
      url,
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return {
      loadMs: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function normalizeRevenueAgentWebsiteReport(
  value: unknown,
  fallback: RevenueAgentOpportunityReport,
): RevenueAgentOpportunityReport {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fallback;
  }

  const parsed = value as Partial<CompletedAnalysis>;
  const normalized = sanitizeAnalysis(parsed, buildAnalysisFallback(fallback));

  return {
    ...normalized,
    generatedAt: fallback.generatedAt,
  };
}

export async function analyzeProspectIntelligence(
  input: ProspectIntelligenceInput,
): Promise<ProspectIntelligenceResult> {
  const normalizedWebsite = normalizeWebsiteUrl(input.website);
  const htmlResult = normalizedWebsite ? await fetchWebsiteHtml(normalizedWebsite) : { html: undefined, finalUrl: undefined, loadMs: undefined };
  const snapshot = buildWebsiteSnapshot(input, htmlResult.html, htmlResult.loadMs, htmlResult.finalUrl);
  const fallback = buildFallbackOutput(input, snapshot);

  if (!snapshot.url) {
    return fallback;
  }

  try {
    const prompt = buildPrompt(input, snapshot, fallback);
    const completion = await generateCompletion(prompt, { jsonMode: true });
    const parsed = safeParseJson(completion);
    const analysis = sanitizeAnalysis(
      parsed,
      buildAnalysisFallback(fallback.report, {
        emailSubject: fallback.emailSubject,
        emailBody: fallback.emailBody,
        opportunityTags: fallback.opportunityTags,
      }),
    );

    return {
      websiteUrl: snapshot.finalUrl || snapshot.url,
      painSummary: analysis.painPoints.join(" ") || analysis.websiteSummary,
      opportunityScore: analysis.opportunityScore,
      opportunityTags: analysis.opportunityTags,
      suggestedOfferAngle: analysis.suggestedOutreachAngle,
      emailSubject: analysis.emailSubject,
      emailBody: analysis.emailBody,
      report: {
        ...analysis,
        generatedAt: new Date().toISOString(),
      },
    };
  } catch (error) {
    logWarn("Revenue agent intelligence generation fell back to deterministic output.", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return fallback;
  }
}
