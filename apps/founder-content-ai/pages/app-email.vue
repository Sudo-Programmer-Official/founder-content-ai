<script setup lang="ts">
import type {
  BrandKit,
  BusinessEmailSettings,
  BusinessMembership,
  EmailContact,
  EmailBodyBlock,
  EmailContactAttributes,
  EmailCampaignContent,
  EmailContactImportDuplicateStrategy,
  EmailContactImportField,
  EmailContactImportJob,
  EmailContactImportMapping,
  EmailContactStatus,
  GenerateVisualResponse,
  ImportEmailContactsPreviewResponse,
  EmailCampaign,
  EmailCampaignStats,
  EmailFooterSettings,
  EmailFooterSocialPlatform,
  EmailList,
  ImportEmailContactsRequest,
  MediaRecommendationSuggestion,
  PreviewEmailCampaignRequest,
  PostAsset,
  WorkspaceAsset,
} from "../../../packages/shared-types";
import { parseEmailBodyBlocks } from "../../../packages/shared-types";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useProductAccessContext } from "../access/product-access-context";
import { useAuthContext } from "../auth/auth-context";
import { requestBrandKit, requestUpdateBrandKit } from "../services/brand-kit-service";
import WorkspaceAssetPickerModal from "../components/WorkspaceAssetPickerModal.vue";
import EmailSkeleton from "../components/skeletons/EmailSkeleton.vue";
import {
  getActivationDraft,
  listActivationDrafts,
  type ActivationDraftRecord,
} from "../services/activation-flow-service";
import { requestMyBusinesses } from "../services/admin-analytics-service";
import {
  requestEmailCampaignCreate,
  requestEmailCampaignDelete,
  requestEmailCampaignPreview,
  requestEmailCampaignSend,
  requestEmailCampaignStats,
  requestEmailCampaignTestSend,
  requestEmailCampaigns,
  requestEmailCampaignUpdate,
  requestEmailContactDelete,
  requestEmailContactImportJobs,
  requestEmailContactUpdate,
  requestEmailContacts,
  requestEmailContactsImport,
  requestEmailContactsImportPreview,
  requestEmailDomainCreate,
  requestEmailDomainSettings,
  requestEmailLists,
} from "../services/email-service";
import { requestVisualGeneration } from "../services/generation-service";
import {
  requestCreatePostAsset,
  requestMediaUploadUrl,
  requestPostAssets,
} from "../services/post-assets-service";
import {
  requestCreateWorkspaceAsset,
  requestRecordWorkspaceAssetUsage,
  requestWorkspaceAssetUploadUrl,
} from "../services/workspace-assets-service";
import { appRoutes } from "../utils/routes";

function buildSuggestedSubject(value: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");

  if (!normalized) {
    return "Quick thought for founders trying to stay consistent";
  }

  return normalized.length <= 68 ? normalized : `${normalized.slice(0, 65).trim()}...`;
}

function htmlToPreviewText(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/p>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value !== ""))];
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function linkifyHtmlText(value: string): string {
  const urlPattern = /https?:\/\/[^\s<]+/gi;
  let html = "";
  let lastIndex = 0;

  for (const match of value.matchAll(urlPattern)) {
    const rawUrl = match[0];
    const index = match.index ?? 0;

    html += escapeHtml(value.slice(lastIndex, index));
    html += `<a href="${escapeHtml(rawUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(rawUrl)}</a>`;
    lastIndex = index + rawUrl.length;
  }

  html += escapeHtml(value.slice(lastIndex));
  return html.replace(/\n/g, "<br />");
}

function renderEmailPreviewBlock(block: EmailBodyBlock): string {
  if (block.type === "paragraph") {
    return `<p>${linkifyHtmlText(block.text)}</p>`;
  }

  if (block.type === "cta_button") {
    return `<div class="email-preview-cta-row"><a href="${escapeHtml(block.url)}" target="_blank" rel="noopener noreferrer" class="email-preview-cta-button">${escapeHtml(block.label)}</a></div>`;
  }

  if (block.type === "feature_list") {
    const titleHtml = block.title
      ? `<h3 class="email-preview-section-title">${escapeHtml(block.title)}</h3>`
      : "";
    const itemsHtml = block.items
      .map((item) => `<li>${linkifyHtmlText(item)}</li>`)
      .join("");

    return `<section class="email-preview-feature-block">${titleHtml}<ul class="email-preview-feature-list">${itemsHtml}</ul></section>`;
  }

  const sectionClass = block.type === "hero" ? "email-preview-hero" : "email-preview-cta-section";
  const headlineHtml = block.headline
    ? `<h2 class="email-preview-section-title">${escapeHtml(block.headline)}</h2>`
    : "";
  const bodyHtml = block.body
    ? `<p class="email-preview-section-body">${linkifyHtmlText(block.body)}</p>`
    : "";
  const buttonHtml =
    block.buttonLabel && block.buttonUrl
      ? `<div class="email-preview-cta-row"><a href="${escapeHtml(block.buttonUrl)}" target="_blank" rel="noopener noreferrer" class="email-preview-cta-button">${escapeHtml(block.buttonLabel)}</a></div>`
      : "";

  return `<section class="${sectionClass}">${headlineHtml}${bodyHtml}${buttonHtml}</section>`;
}

function buildSourceTitle(text: string, fallback?: string): string {
  const normalized = text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line !== "");

  return fallback?.trim() || buildSuggestedSubject(normalized || text);
}

function buildSourcePreview(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 180);
}

function formatContactAttributeLabel(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function buildContactAttributeSummary(attributes: EmailContactAttributes): string {
  return Object.entries(attributes)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim() !== "")
    .map(([key, value]) => `${formatContactAttributeLabel(key)}: ${value}`)
    .join(" · ");
}

function buildDuplicateCampaignName(value: string): string {
  const normalized = value.trim();
  return normalized ? `${normalized} Copy` : "Campaign Copy";
}

function buildEmailBodyFromSource(sourceText: string, tone: "direct" | "story" | "educational"): string {
  const paragraphs = sourceText
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== "");

  const opener = "Hi {{first_name}},";
  const bodyCore = paragraphs.slice(0, 3).join("\n\n");

  if (!bodyCore) {
    return `${opener}\n\n`;
  }

  if (tone === "story") {
    return `${opener}\n\nOne thing that kept coming back for me this week:\n\n${bodyCore}\n\nIf this hits home, reply and tell me what you're seeing too.`;
  }

  if (tone === "educational") {
    return `${opener}\n\nHere is the clean takeaway:\n\n${bodyCore}\n\nIf helpful, reply and I will send a few more ideas like this.`;
  }

  return `${opener}\n\n${bodyCore}\n\nIf this is useful, hit reply and tell me what stands out.`;
}

function resolveToneFromCampaignIntent(intent: CampaignComposerIntent): CampaignToneMode {
  if (intent === "story_email") {
    return "story";
  }

  if (intent === "weekly_newsletter") {
    return "educational";
  }

  return "direct";
}

function buildFreshCampaignTemplate(intent: CampaignComposerIntent): {
  name: string;
  subject: string;
  bodyText: string;
} {
  if (intent === "promotion") {
    return {
      name: "Offer Campaign",
      subject: "A quick offer for you",
      bodyText:
        "Hi {{first_name}},\n\n[Hero]\nHeadline: One clear update for your daycare\nBody: Share the feature, launch, or offer in one sentence that makes the value obvious.\nButton: See what's new\nLink: https://your-link.com\n[/Hero]\n\n[Feature List]\nTitle: Why it matters\n- Add the first benefit here\n- Add the second benefit here\n- Add the third benefit here\n[/Feature List]\n\n[CTA Section]\nHeadline: Ready to take a look?\nBody: Add one final line that makes the next step feel simple.\nButton: Claim your spot\nLink: https://your-link.com\n[/CTA Section]",
    };
  }

  if (intent === "story_email") {
    return {
      name: "Story Email",
      subject: "One story worth sharing",
      bodyText:
        "Hi {{first_name}},\n\nA short story from this week:\n\nWhat happened:\n\nWhat it changed:\n\nThe takeaway:\n\nIf this resonates, hit reply and tell me what you are seeing too.",
    };
  }

  if (intent === "weekly_newsletter") {
    return {
      name: "Weekly Newsletter",
      subject: "Your weekly update",
      bodyText:
        "Hi {{first_name}},\n\nHere is the quick weekly update:\n\n1. What happened\n2. What matters\n3. What to watch next\n\nReply if you want me to go deeper on any part of this.",
    };
  }

  return {
    name: "Quick Update",
    subject: "Quick update",
    bodyText:
      "Hi {{first_name}},\n\nOne quick update for you:\n\nWhat changed:\n\nWhy it matters:\n\nWhat to do next:\n\nReply if you want the full details.",
  };
}

function normalizeDomainInput(value: string | undefined | null): string {
  const normalized = (value ?? "").trim().toLowerCase();

  if (!normalized) {
    return "";
  }

  if (normalized.includes("@") && !normalized.includes("://")) {
    const [, domainPart = ""] = normalized.split("@");
    return domainPart.replace(/^www\./, "").replace(/\.$/, "");
  }

  const withoutProtocol = normalized.replace(/^[a-z]+:\/\//i, "");
  const urlCandidate = /^[a-z]+:\/\//i.test(normalized) ? normalized : `https://${withoutProtocol}`;

  try {
    return new URL(urlCandidate).hostname.replace(/^www\./, "").replace(/\.$/, "");
  } catch {
    return withoutProtocol.split(/[/?#]/)[0]?.replace(/^www\./, "").replace(/\.$/, "") || "";
  }
}

function normalizeEmailInput(value: string | undefined | null): string {
  return (value ?? "").trim().toLowerCase();
}

function isValidDomainInput(value: string): boolean {
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(value);
}

function buildDefaultSenderEmail(domainName: string): string {
  return domainName ? `hello@${domainName}` : "";
}

function normalizeWebsiteUrlForSignature(value: string | undefined | null, domainName: string): string {
  const normalized = (value ?? "").trim();

  if (!normalized) {
    return domainName ? `https://${domainName}` : "";
  }

  return /^[a-z]+:\/\//i.test(normalized) ? normalized : `https://${normalized}`;
}

type EmailFooterForm = {
  signoff: string;
  businessName: string;
  websiteUrl: string;
  supportEmail: string;
  streetAddress: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  additionalText: string;
  socialLinks: Record<EmailFooterSocialPlatform, string>;
};

const EMAIL_FOOTER_SOCIAL_PLATFORMS: EmailFooterSocialPlatform[] = [
  "facebook",
  "instagram",
  "x",
  "youtube",
  "linkedin",
];

const EMAIL_FOOTER_SOCIAL_LABELS: Record<EmailFooterSocialPlatform, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  x: "X",
  youtube: "YouTube",
  linkedin: "LinkedIn",
};

const EMAIL_FOOTER_SOCIAL_BADGE_LABELS: Record<EmailFooterSocialPlatform, string> = {
  facebook: "f",
  instagram: "ig",
  x: "x",
  youtube: "yt",
  linkedin: "in",
};

const EMAIL_FOOTER_SOCIAL_BADGE_COLORS: Record<EmailFooterSocialPlatform, string> = {
  facebook: "#1877F2",
  instagram: "#E4405F",
  x: "#111827",
  youtube: "#FF0000",
  linkedin: "#0A66C2",
};

function createEmptyFooterForm(): EmailFooterForm {
  return {
    signoff: "",
    businessName: "",
    websiteUrl: "",
    supportEmail: "",
    streetAddress: "",
    addressLine2: "",
    city: "",
    state: "",
    postalCode: "",
    country: "",
    additionalText: "",
    socialLinks: {
      facebook: "",
      instagram: "",
      x: "",
      youtube: "",
      linkedin: "",
    },
  };
}

function normalizeOptionalPublicUrl(value: string | undefined | null): string {
  const normalized = (value ?? "").trim();

  if (!normalized) {
    return "";
  }

  const candidate = /^[a-z]+:\/\//i.test(normalized) ? normalized : `https://${normalized}`;

  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function normalizeFooterSocialUrl(platform: EmailFooterSocialPlatform, value: string | undefined | null): string {
  const normalized = (value ?? "").trim();

  if (!normalized) {
    return "";
  }

  const directUrl = normalizeOptionalPublicUrl(normalized);

  if (directUrl) {
    return directUrl;
  }

  const handle = normalized.replace(/^@/, "").replace(/^\/+|\/+$/g, "");

  if (!handle) {
    return "";
  }

  if (platform === "facebook") {
    return `https://www.facebook.com/${handle}`;
  }

  if (platform === "instagram") {
    return `https://www.instagram.com/${handle}`;
  }

  if (platform === "x") {
    return `https://x.com/${handle}`;
  }

  if (platform === "youtube") {
    return handle.includes("/") || handle.startsWith("@")
      ? `https://www.youtube.com/${handle.replace(/^\/+/, "")}`
      : `https://www.youtube.com/@${handle}`;
  }

  return `https://www.linkedin.com/company/${handle}`;
}

function normalizeFooterForm(value: EmailFooterForm): EmailFooterSettings {
  const socialLinks = EMAIL_FOOTER_SOCIAL_PLATFORMS.reduce<Record<EmailFooterSocialPlatform, string>>(
    (accumulator, platform) => {
      const normalized = normalizeFooterSocialUrl(platform, value.socialLinks[platform]);

      if (normalized) {
        accumulator[platform] = normalized;
      }

      return accumulator;
    },
    {} as Record<EmailFooterSocialPlatform, string>,
  );

  return {
    signoff: value.signoff.trim() || undefined,
    businessName: value.businessName.trim() || undefined,
    websiteUrl: normalizeOptionalPublicUrl(value.websiteUrl) || undefined,
    supportEmail: normalizeEmailInput(value.supportEmail) || undefined,
    streetAddress: value.streetAddress.trim() || undefined,
    addressLine2: value.addressLine2.trim() || undefined,
    city: value.city.trim() || undefined,
    state: value.state.trim() || undefined,
    postalCode: value.postalCode.trim() || undefined,
    country: value.country.trim() || undefined,
    additionalText: value.additionalText.trim() || undefined,
    socialLinks: Object.keys(socialLinks).length > 0 ? socialLinks : undefined,
  };
}

function buildFooterFormFromSettings(
  footer: EmailFooterSettings | undefined,
  options: {
    fallbackBusinessName?: string;
    fallbackWebsiteUrl?: string;
    fallbackSupportEmail?: string;
    legacySignatureText?: string;
  } = {},
): EmailFooterForm {
  const next = createEmptyFooterForm();
  const hasStructuredSource = hasFooterContent(footer);

  next.businessName = footer?.businessName || options.fallbackBusinessName || "";
  next.websiteUrl = footer?.websiteUrl || options.fallbackWebsiteUrl || "";
  next.supportEmail = footer?.supportEmail || options.fallbackSupportEmail || "";
  next.signoff =
    footer?.signoff ||
    (!hasStructuredSource && options.legacySignatureText ? "" : next.businessName ? `Sincerely,\n${next.businessName}` : "");
  next.streetAddress = footer?.streetAddress || "";
  next.addressLine2 = footer?.addressLine2 || "";
  next.city = footer?.city || "";
  next.state = footer?.state || "";
  next.postalCode = footer?.postalCode || "";
  next.country = footer?.country || "";
  next.additionalText = footer?.additionalText || (!hasStructuredSource ? options.legacySignatureText || "" : "");

  for (const platform of EMAIL_FOOTER_SOCIAL_PLATFORMS) {
    next.socialLinks[platform] = footer?.socialLinks?.[platform] || "";
  }

  return next;
}

function hasFooterContent(footer: EmailFooterSettings | undefined): boolean {
  if (!footer) {
    return false;
  }

  return Boolean(
    footer.signoff ||
      footer.businessName ||
      footer.websiteUrl ||
      footer.supportEmail ||
      footer.streetAddress ||
      footer.addressLine2 ||
      footer.city ||
      footer.state ||
      footer.postalCode ||
      footer.country ||
      footer.additionalText ||
      Object.keys(footer.socialLinks ?? {}).length > 0,
  );
}

function buildFooterAddressSegments(footer: EmailFooterSettings | undefined): string[] {
  if (!footer) {
    return [];
  }

  const locality = [footer.city, footer.state, footer.postalCode].filter(Boolean).join(", ").replace(", ,", ",");

  return [footer.streetAddress, footer.addressLine2, locality, footer.country]
    .map((segment) => segment?.trim() || "")
    .filter((segment) => segment !== "");
}

function buildFooterAddressText(footer: EmailFooterSettings | undefined): string {
  return buildFooterAddressSegments(footer).join(", ");
}

function buildFooterAddressUrl(footer: EmailFooterSettings | undefined): string {
  const addressText = buildFooterAddressText(footer);
  return addressText ? `https://maps.google.com/?q=${encodeURIComponent(addressText)}` : "";
}

function buildFooterText(
  footer: EmailFooterSettings | undefined,
  fallbackSignatureText = "",
): string {
  if (!hasFooterContent(footer)) {
    return fallbackSignatureText.trim();
  }

  const lines: string[] = [];

  if (footer?.signoff) {
    lines.push(footer.signoff.trim());
  }

  if (footer?.businessName) {
    lines.push(footer.businessName);
  }

  if (footer?.websiteUrl) {
    lines.push(footer.websiteUrl);
  }

  if (footer?.supportEmail) {
    lines.push(footer.supportEmail);
  }

  const addressText = buildFooterAddressText(footer);

  if (addressText) {
    lines.push(addressText);
  }

  for (const platform of EMAIL_FOOTER_SOCIAL_PLATFORMS) {
    const url = footer?.socialLinks?.[platform];

    if (url) {
      lines.push(`${EMAIL_FOOTER_SOCIAL_LABELS[platform]}: ${url}`);
    }
  }

  if (footer?.additionalText) {
    lines.push(footer.additionalText);
  }

  return lines.join("\n");
}

function renderFooterPreviewHtml(input: {
  footer?: EmailFooterSettings;
  logoUrl?: string;
  logoAltText?: string;
  fallbackSignatureText?: string;
}): string {
  const footer = input.footer;
  const logoUrl = input.logoUrl?.trim() || "";
  const footerText = buildFooterText(footer, input.fallbackSignatureText);

  if (!hasFooterContent(footer)) {
    if (!footerText && !logoUrl) {
      return "";
    }

    const signatureParagraphs = footerText
      .split(/\n{2,}/)
      .map((paragraph) => paragraph.trim())
      .filter((paragraph) => paragraph !== "");

    const htmlParts = ['<div class="email-preview-signature">'];

    if (logoUrl) {
      htmlParts.push(
        `<div class="email-preview-signature-logo"><img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(input.logoAltText || "Brand logo")}" /></div>`,
      );
    }

    for (const paragraph of signatureParagraphs) {
      htmlParts.push(`<p>${linkifyHtmlText(paragraph)}</p>`);
    }

    htmlParts.push("</div>");
    return htmlParts.join("");
  }

  const primaryLinks = [
    footer?.businessName ? `<strong>${escapeHtml(footer.businessName)}</strong>` : "",
    footer?.websiteUrl
      ? `<a href="${escapeHtml(footer.websiteUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(footer.websiteUrl)}</a>`
      : "",
    footer?.supportEmail
      ? `<a href="mailto:${escapeHtml(footer.supportEmail)}">${escapeHtml(footer.supportEmail)}</a>`
      : "",
  ].filter(Boolean);
  const addressText = buildFooterAddressText(footer);
  const addressUrl = buildFooterAddressUrl(footer);
  const additionalParagraphs = (footer?.additionalText || "")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== "")
    .map((paragraph) => `<p class="email-preview-footer-note">${linkifyHtmlText(paragraph)}</p>`)
    .join("");
  const socialButtons = EMAIL_FOOTER_SOCIAL_PLATFORMS
    .map((platform) => {
      const url = footer?.socialLinks?.[platform];

      if (!url) {
        return "";
      }

      return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="email-preview-footer-social-button" style="--footer-social-accent:${EMAIL_FOOTER_SOCIAL_BADGE_COLORS[platform]};">${escapeHtml(EMAIL_FOOTER_SOCIAL_BADGE_LABELS[platform])}</a>`;
    })
    .filter(Boolean)
    .join("");

  return [
    '<div class="email-preview-signature email-preview-signature-rich">',
    logoUrl
      ? `<div class="email-preview-signature-logo"><img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(input.logoAltText || "Brand logo")}" /></div>`
      : "",
    footer?.signoff
      ? `<div class="email-preview-footer-signoff">${footer.signoff
          .split(/\n+/)
          .map((line) => line.trim())
          .filter((line) => line !== "")
          .map((line) => `<p>${escapeHtml(line)}</p>`)
          .join("")}</div>`
      : "",
    primaryLinks.length > 0
      ? `<p class="email-preview-footer-links">${primaryLinks.join('<span class="email-preview-footer-separator">|</span>')}</p>`
      : "",
    addressText
      ? `<p class="email-preview-footer-address">${
          addressUrl
            ? `<a href="${escapeHtml(addressUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(addressText)}</a>`
            : escapeHtml(addressText)
        }</p>`
      : "",
    socialButtons ? `<div class="email-preview-footer-social-row">${socialButtons}</div>` : "",
    additionalParagraphs,
    "</div>",
  ].join("");
}

const route = useRoute();
const router = useRouter();
const auth = useAuthContext();
const {
  bootstrap: productAccess,
  activeBusinessId,
  setActiveBusinessId,
  refreshProductAccess,
  isFeatureEnabled,
} = useProductAccessContext();
const routeCampaignId = computed(() =>
  typeof route.params.campaignId === "string" ? route.params.campaignId.trim() : "",
);
const duplicateCampaignId = computed(() =>
  typeof route.query.duplicateCampaignId === "string" ? route.query.duplicateCampaignId.trim() : "",
);
const isEmailDashboardRoute = computed(() => route.name === "app-email");
const isEmailNewRoute = computed(() => route.name === "app-email-new");
const isEmailEditRoute = computed(() => route.name === "app-email-edit");
const isEmailComposerRoute = computed(() => isEmailNewRoute.value || isEmailEditRoute.value);

const businesses = ref<BusinessMembership[]>([]);
const selectedBusinessId = ref("");
const emailLists = ref<EmailList[]>([]);
const emailContacts = ref<EmailContact[]>([]);
const emailContactsTotal = ref(0);
const contactImportJobs = ref<EmailContactImportJob[]>([]);
const campaigns = ref<EmailCampaign[]>([]);
const latestStats = ref<EmailCampaignStats | null>(null);
const domainSettings = ref<BusinessEmailSettings | null>(null);
const isLoading = ref(true);
const isImporting = ref(false);
const isCreatingCampaign = ref(false);
const isSending = ref(false);
const deletingCampaignId = ref("");
const isSavingDomain = ref(false);
const isEditingDomainSetup = ref(false);
const isLoadingDraftMedia = ref(false);
const isUploadingDraftMedia = ref(false);
const isWorkspaceAssetPickerOpen = ref(false);
const isFooterLogoPickerOpen = ref(false);
const isLoadingMediaRecommendations = ref(false);
const isGeneratingMediaRecommendationId = ref("");
const isSavingFooterLogo = ref(false);
const errorMessage = ref("");
const feedbackMessage = ref("");
const domainSaveErrorMessage = ref("");
const emailToast = ref<{
  message: string;
  tone: "neutral" | "error";
} | null>(null);
const latestStatsCampaignId = ref("");
const editingCampaignId = ref("");
const emailMediaAssets = ref<PostAsset[]>([]);
const mediaRecommendations = ref<MediaRecommendationSuggestion[]>([]);
const footerBrandKit = ref<BrandKit | null>(null);
let campaignProgressPollHandle: number | null = null;
let importJobPollHandle: number | null = null;
let emailToastTimeoutHandle: number | null = null;

type EmailTabKey = "campaigns" | "contacts" | "settings";
type CampaignSourceMode = "current" | "draft-library" | "fresh";
type CampaignToneMode = "direct" | "story" | "educational";
type CampaignEditorMode = "edit" | "preview";
type CampaignComposerIntent = "quick_update" | "promotion" | "story_email" | "weekly_newsletter";
type DomainValidationField = "domainName" | "fromEmail";
type EmailComposerBlockType = EmailBodyBlock["type"];
type EmailRoutePrefill = {
  title: string;
  subject: string;
  body: string;
  ctaLabel: string;
  ctaUrl: string;
  headerImageUrl: string;
};

type EmailComposerBlockDraft = {
  id: string;
  type: EmailComposerBlockType;
  text: string;
  label: string;
  url: string;
  headline: string;
  body: string;
  buttonLabel: string;
  buttonUrl: string;
  title: string;
  itemsText: string;
};

const EMAIL_TABS: Array<{ key: EmailTabKey; label: string }> = [
  { key: "campaigns", label: "Campaigns" },
  { key: "contacts", label: "Contacts" },
  { key: "settings", label: "Settings" },
];
const CAMPAIGN_INTENT_OPTIONS: Array<{
  value: CampaignComposerIntent;
  label: string;
  description: string;
}> = [
  {
    value: "quick_update",
    label: "Quick update",
    description: "Send one clear update without extra production around it.",
  },
  {
    value: "promotion",
    label: "Offer / promotion",
    description: "Drive a specific action around one offer, deadline, or CTA.",
  },
  {
    value: "story_email",
    label: "Story email",
    description: "Lead with a story, then pull the reader toward one takeaway.",
  },
  {
    value: "weekly_newsletter",
    label: "Weekly newsletter",
    description: "Package the week into a tighter recurring email format.",
  },
];
const CONTACT_IMPORT_FIELDS: Array<{
  field: EmailContactImportField;
  label: string;
  required: boolean;
}> = [
  { field: "email", label: "Email", required: true },
  { field: "name", label: "Full name", required: false },
  { field: "firstName", label: "First name", required: false },
  { field: "lastName", label: "Last name", required: false },
  { field: "lists", label: "Lists", required: false },
  { field: "tags", label: "Tags", required: false },
  { field: "state", label: "State", required: false },
  { field: "city", label: "City", required: false },
  { field: "business_type", label: "Business type", required: false },
  { field: "audience_type", label: "Audience type", required: false },
  { field: "language", label: "Language", required: false },
  { field: "plan", label: "Plan", required: false },
];

const EMAIL_COMPOSER_BLOCK_LIBRARY: Array<{
  type: EmailComposerBlockType;
  label: string;
  description: string;
}> = [
  {
    type: "paragraph",
    label: "Paragraph",
    description: "Plain copy for updates, intros, or closing notes.",
  },
  {
    type: "hero",
    label: "Hero",
    description: "Lead with one clear announcement and CTA.",
  },
  {
    type: "feature_list",
    label: "Feature list",
    description: "Package benefits or reasons in one scannable block.",
  },
  {
    type: "cta_section",
    label: "CTA section",
    description: "Finish with one clear next step and button.",
  },
  {
    type: "cta_button",
    label: "Button",
    description: "Drop in a single clickable CTA block.",
  },
];

let emailComposerBlockSeed = 0;

function nextEmailComposerBlockId(): string {
  emailComposerBlockSeed += 1;
  return `email-block-${Date.now()}-${emailComposerBlockSeed}`;
}

function createEmailComposerBlockDraft(
  type: EmailComposerBlockType,
  overrides: Partial<EmailComposerBlockDraft> = {},
): EmailComposerBlockDraft {
  const base: EmailComposerBlockDraft = {
    id: nextEmailComposerBlockId(),
    type,
    text: "",
    label: type === "cta_button" ? "Claim your spot" : "",
    url: type === "cta_button" ? "https://your-link.com" : "",
    headline:
      type === "hero"
        ? "Big update for your audience"
        : type === "cta_section"
          ? "Ready to take the next step?"
          : "",
    body:
      type === "hero"
        ? "Share the announcement in one clear sentence."
        : type === "cta_section"
          ? "Add one sentence that makes the action obvious."
          : "",
    buttonLabel: type === "hero" || type === "cta_section" ? "Claim your spot" : "",
    buttonUrl: type === "hero" || type === "cta_section" ? "https://your-link.com" : "",
    title: type === "feature_list" ? "Why it matters" : "",
    itemsText: type === "feature_list" ? "First benefit\nSecond benefit\nThird benefit" : "",
  };

  return {
    ...base,
    ...overrides,
  };
}

function emailBodyBlockToDraft(block: EmailBodyBlock): EmailComposerBlockDraft {
  if (block.type === "paragraph") {
    return createEmailComposerBlockDraft("paragraph", { text: block.text });
  }

  if (block.type === "cta_button") {
    return createEmailComposerBlockDraft("cta_button", {
      label: block.label,
      url: block.url,
    });
  }

  if (block.type === "feature_list") {
    return createEmailComposerBlockDraft("feature_list", {
      title: block.title || "",
      itemsText: block.items.join("\n"),
    });
  }

  return createEmailComposerBlockDraft(block.type, {
    headline: block.headline || "",
    body: block.body || "",
    buttonLabel: block.buttonLabel || "",
    buttonUrl: block.buttonUrl || "",
  });
}

function parseEmailBodyBlocksToDrafts(bodyText: string): EmailComposerBlockDraft[] {
  return parseEmailBodyBlocks(bodyText).map(emailBodyBlockToDraft);
}

function draftToEmailBodyBlock(draft: EmailComposerBlockDraft): EmailBodyBlock | null {
  if (draft.type === "paragraph") {
    const text = draft.text.trim();
    return text ? { type: "paragraph", text } : null;
  }

  if (draft.type === "cta_button") {
    const label = draft.label.trim();
    const url = draft.url.trim();
    return label && url ? { type: "cta_button", label, url } : null;
  }

  if (draft.type === "feature_list") {
    const title = draft.title.trim();
    const items = draft.itemsText
      .split("\n")
      .map((item) => item.trim())
      .filter((item) => item !== "");

    if (!title && items.length === 0) {
      return null;
    }

    return {
      type: "feature_list",
      title: title || undefined,
      items,
    };
  }

  const headline = draft.headline.trim();
  const body = draft.body.trim();
  const buttonLabel = draft.buttonLabel.trim();
  const buttonUrl = draft.buttonUrl.trim();

  if (!headline && !body && !buttonLabel && !buttonUrl) {
    return null;
  }

  return {
    type: draft.type,
    headline: headline || undefined,
    body: body || undefined,
    buttonLabel: buttonLabel || undefined,
    buttonUrl: buttonUrl || undefined,
  };
}

function serializeEmailComposerBlock(block: EmailBodyBlock): string {
  switch (block.type) {
    case "paragraph":
      return block.text.trim();
    case "cta_button":
      return `[Button: ${block.label}](${block.url})`;
    case "hero":
      return [
        "[Hero]",
        block.headline ? `Headline: ${block.headline}` : "",
        block.body ? `Body: ${block.body}` : "",
        block.buttonLabel ? `Button: ${block.buttonLabel}` : "",
        block.buttonUrl ? `Link: ${block.buttonUrl}` : "",
        "[/Hero]",
      ]
        .filter((line) => line !== "")
        .join("\n");
    case "cta_section":
      return [
        "[CTA Section]",
        block.headline ? `Headline: ${block.headline}` : "",
        block.body ? `Body: ${block.body}` : "",
        block.buttonLabel ? `Button: ${block.buttonLabel}` : "",
        block.buttonUrl ? `Link: ${block.buttonUrl}` : "",
        "[/CTA Section]",
      ]
        .filter((line) => line !== "")
        .join("\n");
    case "feature_list":
      return [
        "[Feature List]",
        block.title ? `Title: ${block.title}` : "",
        ...block.items.map((item) => `- ${item}`),
        "[/Feature List]",
      ]
        .filter((line) => line !== "")
        .join("\n");
    default:
      return "";
  }
}

function serializeEmailComposerBlocks(drafts: EmailComposerBlockDraft[]): string {
  return drafts
    .map(draftToEmailBodyBlock)
    .filter((block): block is EmailBodyBlock => Boolean(block))
    .map(serializeEmailComposerBlock)
    .filter((block) => block !== "")
    .join("\n\n")
    .trim();
}

function formatEmailComposerBlockLabel(type: EmailComposerBlockType): string {
  return EMAIL_COMPOSER_BLOCK_LIBRARY.find((entry) => entry.type === type)?.label || "Block";
}

function summarizeEmailComposerBlock(draft: EmailComposerBlockDraft): string {
  if (draft.type === "paragraph") {
    return draft.text.trim() || "Write the copy for this section.";
  }

  if (draft.type === "cta_button") {
    return draft.label.trim() || "Add a button label and destination.";
  }

  if (draft.type === "feature_list") {
    return draft.title.trim() || "Add a title and one item per line.";
  }

  return draft.headline.trim() || "Add a headline and supporting message.";
}

const resolvedUserName = computed(
  () =>
    auth.currentUser.value?.fullName?.trim() ||
    auth.authSession.value?.displayName?.trim() ||
    "",
);

const contactImport = ref<ImportEmailContactsRequest>({
  listName: "",
  csvText: "",
});
const contactImportPreview = ref<ImportEmailContactsPreviewResponse | null>(null);
const contactImportMapping = ref<EmailContactImportMapping>({});
const contactImportDuplicateStrategy = ref<EmailContactImportDuplicateStrategy>("upsert");
const contactImportFileName = ref("");
const isPreviewingContacts = ref(false);
const contactSearch = ref("");
const contactStatusFilter = ref<EmailContactStatus | "all">("all");
const contactStateFilter = ref("all");
const contactPlanFilter = ref("all");
const contactTagFilter = ref("all");
const latestImportJobId = ref("");
const editingContactId = ref("");
const isSavingContact = ref(false);
const deletingContactId = ref("");
const contactForm = ref<{
  email: string;
  firstName: string;
  lastName: string;
  status: EmailContactStatus;
}>({
  email: "",
  firstName: "",
  lastName: "",
  status: "active",
});
const activationDraftLibrary = ref<ActivationDraftRecord[]>([]);
const campaignSourceMode = ref<CampaignSourceMode>("fresh");
const campaignTone = ref<CampaignToneMode>("direct");
const campaignEditorMode = ref<CampaignEditorMode>("preview");
const campaignAdvancedOpen = ref(false);
const campaignIntent = ref<CampaignComposerIntent>("quick_update");
const campaignSearch = ref("");
const campaignStatusFilter = ref<EmailCampaign["status"] | "all">("all");
const campaignSort = ref<"updated_desc" | "name_asc" | "last_send_desc" | "status">("updated_desc");
const selectedLibraryDraftId = ref("");
const campaignRouteSyncKey = ref("");

const campaignForm = ref({
  listId: "",
  name: "First Campaign",
  subject: "Quick thought for founders trying to stay consistent",
  bodyText:
    "Hi {{first_name}},\n\nI am sharing one idea that might help you post more consistently without overthinking every draft.",
  replyToEmail: "",
  headerImageUrl: "",
  inlineImageUrls: [] as string[],
  includeSignature: true,
  mediaUrlInput: "",
});
const campaignBlocks = ref<EmailComposerBlockDraft[]>([]);
const syncedPreviewEmailHtml = ref("");
const previewSyncErrorMessage = ref("");
const isRefreshingComposerPreview = ref(false);
const testRecipientEmail = ref("");
const isSendingTestEmail = ref(false);
let isSyncingCampaignBlocksFromBody = false;
let isSyncingCampaignBodyFromBlocks = false;
let composerPreviewDebounceHandle: number | null = null;

const domainForm = ref({
  domainName: "",
  fromName: "",
  fromEmail: "",
  replyToEmail: "",
  footer: createEmptyFooterForm(),
});

const emailFeatureEnabled = computed(
  () =>
    !selectedBusinessId.value ||
    !productAccess.value?.activeBusinessId ||
    isFeatureEnabled("email_campaigns"),
);
const currentBusinessMembership = computed(
  () => businesses.value.find((membership) => membership.businessId === selectedBusinessId.value) ?? null,
);
const workspaceSuggestedDomain = computed(() =>
  normalizeDomainInput(currentBusinessMembership.value?.business.websiteUrl),
);
const recommendedDomainForm = computed(() => {
  const business = currentBusinessMembership.value?.business;
  const domainName = workspaceSuggestedDomain.value;
  const fromName = business?.brandName?.trim() || business?.name?.trim() || resolvedUserName.value || "";
  const fromEmail = buildDefaultSenderEmail(domainName);
  const footer = buildFooterFormFromSettings(undefined, {
    fallbackBusinessName: business?.brandName?.trim() || business?.name?.trim() || fromName,
    fallbackWebsiteUrl: normalizeWebsiteUrlForSignature(business?.websiteUrl, domainName),
    fallbackSupportEmail: fromEmail,
  });

  return {
    domainName,
    fromName,
    fromEmail,
    replyToEmail: fromEmail,
    footer,
  };
});
const emailLimitText = computed(() => {
  const limits = productAccess.value?.limits;
  return limits ? `Emails left today: ${limits.emailsRemaining}` : "";
});
const hasConfiguredDomain = computed(() => Boolean(domainSettings.value?.domainName));
const isDkimReady = computed(() => {
  const settings = domainSettings.value;

  if (!settings?.domainName) {
    return false;
  }

  return settings.domainSetupAnalysis?.dkimReady ?? settings.dkimStatus === "verified";
});
const isSpfReady = computed(() => {
  const settings = domainSettings.value;

  if (!settings?.domainName) {
    return false;
  }

  return settings.domainSetupAnalysis?.spfReady ?? settings.spfStatus === "verified";
});
const isBrandedSendingReady = computed(() => {
  const settings = domainSettings.value;

  if (!settings?.domainName) {
    return false;
  }

  if (settings.deliverability?.sendingBlocked) {
    return false;
  }

  return (
    settings.domainSetupAnalysis?.brandedSendingReady
    ?? (settings.domainStatus === "verified" && isDkimReady.value && isSpfReady.value)
  );
});
const spfReadinessSummary = computed(() => {
  const settings = domainSettings.value;

  if (!settings?.domainName) {
    return "Not configured";
  }

  if (isSpfReady.value) {
    return "Ready";
  }

  const validationState = settings.domainSetupAnalysis?.spfValidationState;

  if (validationState === "multiple_records" || validationState === "malformed") {
    return "Needs fix";
  }

  if (settings.domainSetupAnalysis?.existingSpfValue) {
    return "Needs update";
  }

  return formatStatus(settings.spfStatus);
});
const domainStatusSummary = computed(() => {
  const settings = domainSettings.value;

  if (!settings?.domainName) {
    return "Not configured";
  }

  if (isBrandedSendingReady.value) {
    return "Ready to send";
  }

  if (settings.domainStatus === "verified" && isDkimReady.value) {
    return "DNS needs attention";
  }

  return "Verification in progress";
});
const campaignComposerOpen = computed(() => isEmailComposerRoute.value);
const activeEmailTab = computed<EmailTabKey>(() => {
  if (isEmailComposerRoute.value) {
    return "campaigns";
  }

  const requestedTab = typeof route.query.tab === "string" ? route.query.tab : "";

  if (EMAIL_TABS.some((tab) => tab.key === requestedTab)) {
    return requestedTab as EmailTabKey;
  }

  if (activationSeed.value) {
    return "campaigns";
  }

  if (!hasConfiguredDomain.value) {
    return "settings";
  }

  return "campaigns";
});
const overviewStats = computed(() => {
  const totals = campaigns.value.reduce(
    (accumulator, campaign) => ({
      campaigns: accumulator.campaigns + 1,
      recipients: accumulator.recipients + campaign.recipientCount,
      sent: accumulator.sent + campaign.sentCount,
      delivered: accumulator.delivered + campaign.deliveredCount,
      failed: accumulator.failed + campaign.failedCount,
    }),
    {
      campaigns: 0,
      recipients: 0,
      sent: 0,
      delivered: 0,
      failed: 0,
    },
  );

  return [
    { label: "Lists", value: String(emailLists.value.length), tone: "default" as const },
    { label: "Campaigns", value: String(totals.campaigns), tone: "default" as const },
    { label: "Sent", value: String(totals.sent), tone: totals.sent > 0 ? "success" as const : "default" as const },
    { label: "Delivered", value: String(totals.delivered), tone: totals.delivered > 0 ? "success" as const : "default" as const },
    { label: "Failed", value: String(totals.failed), tone: totals.failed > 0 ? "warning" as const : "default" as const },
  ];
});
const recentCampaigns = computed(() => campaigns.value.slice(0, 4));
const campaignDashboardCards = computed(() =>
  recentCampaigns.value.map((campaign) => ({
    ...campaign,
    preview: htmlToPreviewText(campaign.bodyText || campaign.bodyHtml).slice(0, 180).trim(),
  })),
);
function findEmailListByReference(listId: string | undefined | null): EmailList | null {
  const normalized = listId?.trim();

  if (!normalized) {
    return null;
  }

  return (
    emailLists.value.find((list) => list.id === normalized || list.memberListIds?.includes(normalized))
    ?? null
  );
}

const selectedCampaignList = computed(() => findEmailListByReference(campaignForm.value.listId));
const selectedCampaignAudienceCount = computed(() => selectedCampaignList.value?.contactCount ?? 0);
const selectedCampaignAudienceSummary = computed(() => {
  if (!selectedCampaignList.value) {
    return "Pick a list to define who this campaign reaches.";
  }

  const count = selectedCampaignAudienceCount.value;
  return `${selectedCampaignList.value.name} · ${count.toLocaleString()} contact${count === 1 ? "" : "s"} in this audience before suppressions.`;
});
const isEditingCampaign = computed(() => Boolean(editingCampaignId.value));
const campaignComposerTitle = computed(() =>
  isEditingCampaign.value ? "Edit email" : "New email",
);
const campaignComposerIntentSelection = computed(
  () =>
    CAMPAIGN_INTENT_OPTIONS.find((option) => option.value === campaignIntent.value)
    ?? CAMPAIGN_INTENT_OPTIONS[0],
);
const campaignComposerPrimaryLabel = computed(() =>
  isCreatingCampaign.value ? "Sending..." : "Send now",
);
const campaignComposerSecondaryLabel = computed(() =>
  isEditingCampaign.value
    ? isCreatingCampaign.value
      ? "Saving..."
      : "Save draft"
    : isCreatingCampaign.value
      ? "Saving..."
      : "Save draft",
);
const campaignSendHistory = computed(() =>
  campaigns.value
    .filter((campaign) => campaign.status !== "draft")
    .slice(0, 5),
);
const filteredCampaigns = computed(() => {
  const searchValue = campaignSearch.value.trim().toLowerCase();

  const nextCampaigns = campaigns.value.filter((campaign) => {
    if (campaignStatusFilter.value !== "all" && campaign.status !== campaignStatusFilter.value) {
      return false;
    }

    if (!searchValue) {
      return true;
    }

    return (
      campaign.name.toLowerCase().includes(searchValue) ||
      campaign.subject.toLowerCase().includes(searchValue) ||
      resolveCampaignListName(campaign).toLowerCase().includes(searchValue)
    );
  });

  return [...nextCampaigns].sort((left, right) => {
    if (campaignSort.value === "name_asc") {
      return left.name.localeCompare(right.name);
    }

    if (campaignSort.value === "status") {
      return left.status.localeCompare(right.status);
    }

    if (campaignSort.value === "last_send_desc") {
      const leftTimestamp = left.sendCompletedAt || left.updatedAt || left.createdAt;
      const rightTimestamp = right.sendCompletedAt || right.updatedAt || right.createdAt;
      return new Date(rightTimestamp).getTime() - new Date(leftTimestamp).getTime();
    }

    const leftTimestamp = left.updatedAt || left.createdAt;
    const rightTimestamp = right.updatedAt || right.createdAt;
    return new Date(rightTimestamp).getTime() - new Date(leftTimestamp).getTime();
  });
});
const contactImportColumns = computed(() => contactImportPreview.value?.columns ?? []);
const hasMappedImportLists = computed(() => {
  if (contactImportMapping.value.lists?.trim()) {
    return true;
  }

  return Boolean(
    contactImportPreview.value?.fields.some(
      (field) => field.field === "lists" && Boolean(field.columnName?.trim()),
    ),
  );
});
const canPreviewContacts = computed(() => contactImport.value.csvText.trim().length > 0);
const canImportContacts = computed(
  () =>
    Boolean(selectedBusinessId.value) &&
    contactImport.value.csvText.trim().length > 0 &&
    (contactImport.value.listName.trim().length > 0 || hasMappedImportLists.value) &&
    Boolean(contactImportMapping.value.email || contactImportPreview.value?.suggestedMapping.email),
);
const contactStateOptions = computed(() =>
  [...new Set(emailContacts.value.map((contact) => contact.attributes.state?.trim()).filter((value): value is string => Boolean(value)))]
    .sort((left, right) => left.localeCompare(right)),
);
const contactPlanOptions = computed(() =>
  [...new Set(emailContacts.value.map((contact) => contact.attributes.plan?.trim()).filter((value): value is string => Boolean(value)))]
    .sort((left, right) => left.localeCompare(right)),
);
const contactTagOptions = computed(() =>
  [...new Set(emailContacts.value.flatMap((contact) => contact.tags))]
    .sort((left, right) => left.localeCompare(right)),
);
const filteredContacts = computed(() => {
  const searchValue = contactSearch.value.trim().toLowerCase();

  return emailContacts.value.filter((contact) => {
    if (contactStatusFilter.value !== "all" && contact.status !== contactStatusFilter.value) {
      return false;
    }

    if (contactStateFilter.value !== "all" && contact.attributes.state !== contactStateFilter.value) {
      return false;
    }

    if (contactPlanFilter.value !== "all" && contact.attributes.plan !== contactPlanFilter.value) {
      return false;
    }

    if (contactTagFilter.value !== "all" && !contact.tags.includes(contactTagFilter.value)) {
      return false;
    }

    if (!searchValue) {
      return true;
    }

    const fullName = [contact.firstName, contact.lastName].filter(Boolean).join(" ").toLowerCase();
    const attributeValues = Object.values(contact.attributes)
      .filter((value): value is string => Boolean(value))
      .map((value) => value.toLowerCase());
    return (
      contact.email.toLowerCase().includes(searchValue) ||
      fullName.includes(searchValue) ||
      contact.tags.some((tag) => tag.toLowerCase().includes(searchValue)) ||
      attributeValues.some((value) => value.includes(searchValue))
    );
  });
});
const activeImportJob = computed(() => {
  if (latestImportJobId.value) {
    const matchingJob = contactImportJobs.value.find((job) => job.id === latestImportJobId.value);

    if (matchingJob) {
      return matchingJob;
    }
  }

  return (
    contactImportJobs.value.find((job) => job.status === "queued" || job.status === "processing") ||
    contactImportJobs.value[0] ||
    null
  );
});
const editingContact = computed(
  () => emailContacts.value.find((contact) => contact.id === editingContactId.value) ?? null,
);
const hasProcessingImportJobs = computed(() =>
  contactImportJobs.value.some((job) => job.status === "queued" || job.status === "processing"),
);
const contactCoverageSummary = computed(() => {
  return emailContacts.value.reduce(
    (summary, contact) => {
      summary.total += 1;

      if (contact.status === "active") {
        summary.active += 1;
      } else if (contact.status === "unsubscribed") {
        summary.unsubscribed += 1;
      } else {
        summary.suppressed += 1;
      }

      return summary;
    },
    {
      total: 0,
      active: 0,
      unsubscribed: 0,
      suppressed: 0,
    },
  );
});
const hasProcessingCampaigns = computed(() =>
  campaigns.value.some((campaign) => campaign.status === "queued" || campaign.status === "sending"),
);
const activationSeed = computed(() => {
  const draftId = typeof route.query.draftId === "string" ? route.query.draftId : "";
  const prefillText = typeof route.query.prefill === "string" ? route.query.prefill.trim() : "";

  if (prefillText) {
    return prefillText;
  }

  if (draftId) {
    return getActivationDraft(draftId)?.result.post ?? "";
  }

  return "";
});
const activationDraft = computed(() => {
  const draftId = typeof route.query.draftId === "string" ? route.query.draftId : "";
  return draftId ? getActivationDraft(draftId) : null;
});
const activationEmailPrefill = computed<EmailRoutePrefill | null>(() => {
  const routeTitle = typeof route.query.emailTitle === "string" ? route.query.emailTitle.trim() : "";
  const routeSubject = typeof route.query.emailSubject === "string" ? route.query.emailSubject.trim() : "";
  const routeBody = typeof route.query.emailBody === "string" ? route.query.emailBody.trim() : "";
  const routeCtaLabel = typeof route.query.emailCtaLabel === "string" ? route.query.emailCtaLabel.trim() : "";
  const routeCtaUrl = typeof route.query.emailCtaUrl === "string" ? route.query.emailCtaUrl.trim() : "";
  const routeHeaderImageUrl =
    typeof route.query.emailHeaderImageUrl === "string" ? route.query.emailHeaderImageUrl.trim() : "";
  const businessOutput = activationDraft.value?.result.businessOutput;
  const title =
    routeTitle
    || activationDraft.value?.result.idea.title?.trim()
    || (activationSeed.value ? buildSourceTitle(activationSeed.value) : "");
  const subject = routeSubject || businessOutput?.email?.subject?.trim() || "";
  const body = routeBody || businessOutput?.email?.body?.trim() || "";
  const ctaLabel = routeCtaLabel || businessOutput?.cta.label?.trim() || "";
  const ctaUrl = routeCtaUrl || businessOutput?.cta.url?.trim() || "";

  if (!subject && !body && !ctaLabel && !ctaUrl && !routeHeaderImageUrl) {
    return null;
  }

  return {
    title,
    subject,
    body,
    ctaLabel,
    ctaUrl,
    headerImageUrl: routeHeaderImageUrl,
  };
});
const selectedLibraryDraft = computed(() =>
  selectedLibraryDraftId.value ? getActivationDraft(selectedLibraryDraftId.value) : null,
);
const activationSourcePostId = computed(() => {
  const assetId = activationDraft.value?.result.asset?.id;
  return assetId || "";
});
const effectiveSourcePostId = computed(() => {
  if (campaignSourceMode.value === "draft-library") {
    return selectedLibraryDraft.value?.result.asset?.id || "";
  }

  if (campaignSourceMode.value === "current") {
    return activationSourcePostId.value;
  }

  return "";
});
const effectiveSourceIdeaId = computed(() => {
  if (campaignSourceMode.value === "draft-library") {
    return selectedLibraryDraft.value?.result.asset?.sourceIdeaId || "";
  }

  if (campaignSourceMode.value === "current") {
    return activationDraft.value?.result.asset?.sourceIdeaId || "";
  }

  return "";
});
const effectiveSourceTitle = computed(() => {
  if (campaignSourceMode.value === "draft-library" && selectedLibraryDraft.value) {
    return buildSourceTitle(selectedLibraryDraft.value.result.post, selectedLibraryDraft.value.result.idea.title);
  }

  if (campaignSourceMode.value === "current" && activationSeed.value) {
    return buildSourceTitle(activationSeed.value, activationDraft.value?.result.idea.title);
  }

  return "";
});
const currentSourceSummary = computed(() => {
  if (!activationSeed.value) {
    return null;
  }

  return {
    title: buildSourceTitle(activationSeed.value, activationDraft.value?.result.idea.title),
    preview: buildSourcePreview(activationSeed.value),
    typeLabel: activationDraft.value ? "Existing draft" : "Inbox idea",
  };
});
const libraryDraftCards = computed(() =>
  activationDraftLibrary.value.map((draft) => ({
    id: draft.id,
    title: buildSourceTitle(draft.result.post, draft.result.idea.title),
    preview: buildSourcePreview(draft.result.post),
    createdAtLabel: new Date(draft.createdAt).toLocaleDateString(),
    modeLabel: draft.mode === "improve" ? "Improved draft" : "Draft",
  })),
);
const previewEmailHtml = computed(() => {
  const bodyText = campaignForm.value.bodyText.trim();
  const signatureText = campaignForm.value.includeSignature ? effectiveSignatureText.value.trim() : "";
  const footerLogoUrl = campaignForm.value.includeSignature ? effectiveFooterLogoUrl.value : "";
  const footerLogoAlt = effectiveFooterLogoAltText.value;
  const blocks = parseEmailBodyBlocks(bodyText);

  const htmlParts: string[] = ['<div class="email-preview-frame-inner">'];

  if (campaignForm.value.headerImageUrl) {
    htmlParts.push(
      `<div class="email-preview-image is-header"><img src="${escapeHtml(campaignForm.value.headerImageUrl)}" alt="${escapeHtml(campaignForm.value.subject || "Email header image")}" /></div>`,
    );
  }

  blocks.forEach((block, index) => {
    htmlParts.push(renderEmailPreviewBlock(block));

    if (index === 0) {
      for (const imageUrl of campaignForm.value.inlineImageUrls) {
        htmlParts.push(
          `<div class="email-preview-image"><img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(campaignForm.value.subject || "Email image")}" /></div>`,
        );
      }
    }
  });

  if (blocks.length === 0) {
    htmlParts.push('<p class="email-preview-placeholder">Write the email body here to see the preview.</p>');
  }

  if (hasFooterContent(effectiveFooterSettings.value) || signatureText || footerLogoUrl) {
    htmlParts.push(
      renderFooterPreviewHtml({
        footer: effectiveFooterSettings.value,
        logoUrl: footerLogoUrl,
        logoAltText: footerLogoAlt,
        fallbackSignatureText: fallbackSenderSignatureText.value,
      }),
    );
  }

  htmlParts.push("</div>");
  return htmlParts.join("");
});
const previewRequestPayload = computed<PreviewEmailCampaignRequest>(() => ({
  subject: campaignForm.value.subject.trim(),
  bodyText: campaignForm.value.bodyText,
  replyToEmail: normalizedDomainForm.value.replyToEmail || campaignForm.value.replyToEmail || undefined,
  content: campaignContentPayload.value,
  sender: {
    fromName: normalizedDomainForm.value.fromName || undefined,
    fromEmail: normalizedDomainForm.value.fromEmail || undefined,
    replyToEmail: normalizedDomainForm.value.replyToEmail || undefined,
    signatureText: normalizedDomainForm.value.signatureText || undefined,
    footer: effectiveFooterSettings.value,
  },
}));
const effectivePreviewEmailHtml = computed(() =>
  syncedPreviewEmailHtml.value.trim() || previewEmailHtml.value,
);
const availableDraftImages = computed(() =>
  emailMediaAssets.value.map((asset) => ({
    id: asset.id,
    url: asset.previewUrl || asset.storageUrl,
    label: `Image ${asset.orderIndex + 1}`,
  })),
);
const effectiveFooterSettings = computed(() => normalizeFooterForm(domainForm.value.footer));
const fallbackSenderSignatureText = computed(() =>
  [domainForm.value.fromName || domainSettings.value?.fromName, domainForm.value.fromEmail || domainSettings.value?.fromEmail]
    .map((value) => value?.trim() || "")
    .filter((value) => value !== "")
    .join("\n"),
);
const effectiveSignatureText = computed(() => {
  return buildFooterText(effectiveFooterSettings.value, fallbackSenderSignatureText.value);
});
const footerDetailsPlaceholderText = computed(() => {
  return "Add compliance copy, licensing notes, or any extra footer text here.";
});
const footerDetailsStatusText = computed(() => {
  if (!campaignForm.value.includeSignature) {
    return "Footer is hidden in this email. Turn it back on if you need the logo or legal address in the message.";
  }

  if (hasFooterContent(effectiveFooterSettings.value)) {
    if (!buildFooterAddressText(effectiveFooterSettings.value)) {
      return "Footer is included, but add a mailing address before using this for production sends.";
    }

    return "Footer is included in this email. Save the defaults once and the next email will reuse the same logo and footer details.";
  }

  return "No custom footer details are saved yet. This email falls back to the sender identity until you add brand or address copy.";
});
const effectiveFooterLogoUrl = computed(() => footerBrandKit.value?.logoUrl?.trim() || "");
const effectiveFooterLogoAltText = computed(() => {
  const brandLabel =
    domainForm.value.footer.businessName.trim()
    || domainForm.value.fromName.trim()
    || domainSettings.value?.fromName?.trim()
    || currentBusinessMembership.value?.business.brandName?.trim()
    || currentBusinessMembership.value?.business.name?.trim()
    || "Brand";

  return `${brandLabel} logo`;
});
const footerPreviewHtml = computed(() =>
  renderFooterPreviewHtml({
    footer: effectiveFooterSettings.value,
    logoUrl: effectiveFooterLogoUrl.value,
    logoAltText: effectiveFooterLogoAltText.value,
    fallbackSignatureText: fallbackSenderSignatureText.value,
  }),
);
const selectedInlineImagePreviews = computed(() =>
  campaignForm.value.inlineImageUrls.map((url, index) => ({
    id: `${url}-${index}`,
    url,
  })),
);
const visibleMediaRecommendations = computed(() =>
  mediaRecommendations.value.filter((suggestion) => suggestion.actionType !== "skip"),
);
const campaignContentPayload = computed<EmailCampaignContent>(() => ({
  headerImage: campaignForm.value.headerImageUrl
    ? { url: campaignForm.value.headerImageUrl, altText: campaignForm.value.subject }
    : undefined,
  inlineImages: campaignForm.value.inlineImageUrls.map((url) => ({
    url,
    altText: campaignForm.value.subject,
  })),
  includeSignature: campaignForm.value.includeSignature,
}));
const previewSenderIdentitySummary = computed(() => {
  const fromName = normalizedDomainForm.value.fromName.trim();
  const fromEmail = normalizedDomainForm.value.fromEmail.trim();

  if (!fromEmail) {
    return senderIdentitySummary.value;
  }

  return fromName ? `${fromName} · ${fromEmail}` : fromEmail;
});
const campaignTestSendBlockReason = computed(() => {
  if (!campaignForm.value.subject.trim()) {
    return "Add a subject line before sending a test.";
  }

  if (!campaignForm.value.bodyText.trim()) {
    return "Write the email before sending a test.";
  }

  if (!hasConfiguredDomain.value && !normalizedDomainForm.value.fromEmail.trim()) {
    return "Finish sender setup before sending a test.";
  }

  if (!testRecipientEmail.value.trim()) {
    return "Add a test inbox so you can send a preview to yourself.";
  }

  const normalizedTestEmail = normalizeEmailInput(testRecipientEmail.value);

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/i.test(normalizedTestEmail)) {
    return "Use a valid test email address.";
  }

  return "";
});
const senderIdentitySummary = computed(() => {
  if (!domainSettings.value?.fromEmail) {
    return "No sender configured";
  }

  const fromName = domainSettings.value.fromName?.trim();
  return fromName
    ? `${fromName} · ${domainSettings.value.fromEmail}`
    : domainSettings.value.fromEmail;
});
const verificationStatusSummary = computed(() => {
  const settings = domainSettings.value;

  if (!settings?.domainName) {
    return "Not configured";
  }

  if (isBrandedSendingReady.value) {
    return "Ready for branded sending";
  }

  if (settings.domainStatus === "verified" && isDkimReady.value) {
    return isSpfReady.value ? "Ready for branded sending" : "SES verified, SPF review needed";
  }

  return "Needs DNS attention";
});
const domainHealthSummary = computed(() => {
  const deliverability = domainSettings.value?.deliverability;

  if (!domainSettings.value?.domainName) {
    return "Domain not configured";
  }

  if (!deliverability) {
    return domainStatusSummary.value;
  }

  if (deliverability.scoreBand === "excellent") {
    return "Healthy sending domain";
  }

  if (deliverability.scoreBand === "at_risk") {
    return "Deliverability at risk";
  }

  return "Needs attention";
});
const systemWarnings = computed(() => {
  const warnings: string[] = [];
  const settings = domainSettings.value;

  if (!settings?.domainName) {
    warnings.push("Add a branded sending domain before scaling campaigns.");
    return warnings;
  }

  if (!isSpfReady.value) {
    warnings.push(
      settings.domainSetupAnalysis?.existingSpfValue
        ? "SPF still needs an update."
        : "SPF record is not ready yet.",
    );
  }

  if (!isDkimReady.value) {
    warnings.push("DKIM is not verified yet.");
  }

  if (settings.deliverability?.scoreBand === "at_risk") {
    warnings.push("Recent deliverability signals are at risk.");
  }

  for (const blocker of settings.deliverability?.blockers ?? []) {
    if (warnings.length >= 3) {
      break;
    }
    warnings.push(blocker.message);
  }

  return warnings.slice(0, 3);
});
const normalizedDomainForm = computed(() => {
  const recommended = recommendedDomainForm.value;
  const domainName =
    normalizeDomainInput(domainForm.value.domainName) ||
    normalizeDomainInput(domainForm.value.fromEmail) ||
    recommended.domainName;
  const fromName = domainForm.value.fromName.trim() || recommended.fromName;
  const fromEmail = normalizeEmailInput(domainForm.value.fromEmail) || buildDefaultSenderEmail(domainName);
  const replyToEmail = normalizeEmailInput(domainForm.value.replyToEmail) || fromEmail;
  const footer = normalizeFooterForm(domainForm.value.footer);
  const signatureText = buildFooterText(footer, fallbackSenderSignatureText.value);

  return {
    domainName,
    fromName,
    fromEmail,
    replyToEmail,
    signatureText,
    footer,
  };
});
const domainSetupHints = computed(() => {
  const hints: string[] = [];

  if (!normalizedDomainForm.value.domainName) {
    hints.push("Add a website URL, root domain, or branded sender email.");
  } else if (!isValidDomainInput(normalizedDomainForm.value.domainName)) {
    hints.push("Use a root domain like yourbrand.com.");
  }

  if (
    normalizedDomainForm.value.fromEmail &&
    normalizeDomainInput(normalizedDomainForm.value.fromEmail) !== normalizedDomainForm.value.domainName
  ) {
    hints.push("From email must use the same domain you plan to verify.");
  }

  if (!domainForm.value.domainName.trim() && workspaceSuggestedDomain.value) {
    hints.push(`Using ${workspaceSuggestedDomain.value} from this workspace website as the default sending domain.`);
  }

  return hints.slice(0, 3);
});
const domainValidationState = computed<{
  field: DomainValidationField;
  message: string;
} | null>(() => {
  if (!normalizedDomainForm.value.domainName) {
    return {
      field: "domainName",
      message: "Add a website URL, sender email, or root domain before saving.",
    };
  }

  if (!isValidDomainInput(normalizedDomainForm.value.domainName)) {
    return {
      field: "domainName",
      message: "Use a root domain like yourbrand.com.",
    };
  }

  if (
    normalizedDomainForm.value.fromEmail &&
    normalizeDomainInput(normalizedDomainForm.value.fromEmail) !== normalizedDomainForm.value.domainName
  ) {
    return {
      field: "fromEmail",
      message: "From email must use the same domain you are setting up for sending.",
    };
  }

  return null;
});
const domainValidationField = computed(() => domainValidationState.value?.field || "");
const domainValidationMessage = computed(() => domainValidationState.value?.message || "");
const canSaveDomainSetup = computed(
  () => Boolean(selectedBusinessId.value) && !domainValidationState.value && !isSavingDomain.value,
);
const hasPendingDomainSetupChanges = computed(() => {
  const recommended = recommendedDomainForm.value;
  const saved = domainSettings.value
    ? {
        domainName: normalizeDomainInput(domainSettings.value.domainName) || "",
        fromName: domainSettings.value.fromName?.trim() || "",
        fromEmail: normalizeEmailInput(domainSettings.value.fromEmail) || "",
        replyToEmail: normalizeEmailInput(domainSettings.value.replyToEmail) || "",
        footer: JSON.stringify(
          normalizeFooterForm(
            buildFooterFormFromSettings(domainSettings.value.footer, {
              fallbackBusinessName: domainSettings.value.fromName?.trim() || "",
              fallbackWebsiteUrl:
                currentBusinessMembership.value?.business.websiteUrl
                  ? normalizeWebsiteUrlForSignature(
                      currentBusinessMembership.value.business.websiteUrl,
                      normalizeDomainInput(domainSettings.value.domainName) || "",
                    )
                  : "",
              fallbackSupportEmail: normalizeEmailInput(domainSettings.value.replyToEmail || domainSettings.value.fromEmail),
              legacySignatureText: domainSettings.value.signatureText,
            }),
          ),
        ),
      }
    : {
        domainName: recommended.domainName,
        fromName: recommended.fromName.trim(),
        fromEmail: normalizeEmailInput(recommended.fromEmail) || "",
        replyToEmail: normalizeEmailInput(recommended.replyToEmail) || "",
        footer: JSON.stringify(normalizeFooterForm(recommended.footer)),
      };
  const current = {
    domainName: normalizeDomainInput(domainForm.value.domainName) || "",
    fromName: domainForm.value.fromName.trim(),
    fromEmail: normalizeEmailInput(domainForm.value.fromEmail) || "",
    replyToEmail: normalizeEmailInput(domainForm.value.replyToEmail) || "",
    footer: JSON.stringify(normalizeFooterForm(domainForm.value.footer)),
  };

  return (
    current.domainName !== saved.domainName ||
    current.fromName !== saved.fromName ||
    current.fromEmail !== saved.fromEmail ||
    current.replyToEmail !== saved.replyToEmail ||
    current.footer !== saved.footer
  );
});
const campaignSendBlockReason = computed(() => {
  if (!campaignForm.value.listId) {
    return "Select an audience before sending.";
  }

  if (!campaignForm.value.subject.trim()) {
    return "Add a subject line before sending.";
  }

  if (!campaignForm.value.bodyText.trim()) {
    return "Write the email before sending.";
  }

  if (!hasConfiguredDomain.value) {
    return "Finish sender setup before sending.";
  }

  return "";
});

function clearEmailToastTimer(): void {
  if (emailToastTimeoutHandle === null || typeof window === "undefined") {
    return;
  }

  window.clearTimeout(emailToastTimeoutHandle);
  emailToastTimeoutHandle = null;
}

function showEmailToast(message: string, tone: "neutral" | "error" = "neutral"): void {
  if (!message) {
    return;
  }

  emailToast.value = { message, tone };
  clearEmailToastTimer();

  if (typeof window === "undefined") {
    return;
  }

  emailToastTimeoutHandle = window.setTimeout(() => {
    emailToast.value = null;
    emailToastTimeoutHandle = null;
  }, tone === "error" ? 5200 : 3600);
}

function loadActivationDraftLibrary(): void {
  activationDraftLibrary.value = listActivationDrafts().slice(0, 8);

  if (!selectedLibraryDraftId.value && activationDraftLibrary.value[0]) {
    selectedLibraryDraftId.value = activationDraftLibrary.value[0].id;
  }
}

function resetSelectedMedia(): void {
  campaignForm.value.headerImageUrl = "";
  campaignForm.value.inlineImageUrls = [];
  campaignForm.value.mediaUrlInput = "";
}

function applySourceToCampaign(sourceText: string, titleFallback?: string): void {
  const normalizedSource = sourceText.trim();

  if (!normalizedSource) {
    return;
  }

  campaignForm.value.subject = buildSourceTitle(normalizedSource, titleFallback);
  campaignForm.value.bodyText = buildEmailBodyFromSource(normalizedSource, campaignTone.value);
  campaignEditorMode.value = "preview";
}

function syncCampaignBlocksFromBodyText(): void {
  if (isSyncingCampaignBodyFromBlocks) {
    return;
  }

  isSyncingCampaignBlocksFromBody = true;
  campaignBlocks.value = parseEmailBodyBlocksToDrafts(campaignForm.value.bodyText);
  isSyncingCampaignBlocksFromBody = false;
}

function syncCampaignBodyTextFromBlocks(): void {
  if (isSyncingCampaignBlocksFromBody) {
    return;
  }

  isSyncingCampaignBodyFromBlocks = true;
  campaignForm.value.bodyText = serializeEmailComposerBlocks(campaignBlocks.value);
  isSyncingCampaignBodyFromBlocks = false;
}

function appendCampaignBlock(type: EmailComposerBlockType): void {
  campaignBlocks.value = [...campaignBlocks.value, createEmailComposerBlockDraft(type)];
}

function removeCampaignBlock(blockId: string): void {
  campaignBlocks.value = campaignBlocks.value.filter((block) => block.id !== blockId);
}

function moveCampaignBlock(blockId: string, direction: "up" | "down"): void {
  const currentIndex = campaignBlocks.value.findIndex((block) => block.id === blockId);

  if (currentIndex < 0) {
    return;
  }

  const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;

  if (targetIndex < 0 || targetIndex >= campaignBlocks.value.length) {
    return;
  }

  const nextBlocks = [...campaignBlocks.value];
  const [moved] = nextBlocks.splice(currentIndex, 1);
  nextBlocks.splice(targetIndex, 0, moved);
  campaignBlocks.value = nextBlocks;
}

function applyActivationSeed(): void {
  if (!activationSeed.value || campaignSourceMode.value !== "current") {
    return;
  }

  applySourceToCampaign(activationSeed.value, activationDraft.value?.result.idea.title);
}

function buildEmailBlocksFromPrefill(
  bodyText: string,
  ctaLabel: string,
  ctaUrl: string,
): EmailComposerBlockDraft[] {
  const blocks = parseEmailBodyBlocksToDrafts(bodyText);
  const hasExistingCta = blocks.some((block) => block.type === "cta_button" || block.type === "cta_section");

  if (ctaLabel && ctaUrl && !hasExistingCta) {
    blocks.push(
      createEmailComposerBlockDraft("cta_button", {
        label: ctaLabel,
        url: ctaUrl,
      }),
    );
  }

  return blocks;
}

function applyActivationEmailPrefill(prefill: EmailRoutePrefill): void {
  if (prefill.title) {
    campaignForm.value.name = prefill.title;
  }

  if (prefill.subject) {
    campaignForm.value.subject = prefill.subject;
  }

  const nextBodyText = prefill.body || campaignForm.value.bodyText.trim();

  if (prefill.body) {
    campaignForm.value.bodyText = prefill.body;
  }

  const nextBlocks = buildEmailBlocksFromPrefill(nextBodyText, prefill.ctaLabel, prefill.ctaUrl);

  if (nextBlocks.length > 0) {
    campaignBlocks.value = nextBlocks;
  }

  if (prefill.headerImageUrl) {
    campaignForm.value.headerImageUrl = prefill.headerImageUrl;
    campaignAdvancedOpen.value = true;
  }
}

function useCurrentSource(): void {
  campaignSourceMode.value = "current";
  resetSelectedMedia();

  if (activationSeed.value) {
    applySourceToCampaign(activationSeed.value, activationDraft.value?.result.idea.title);
  }
}

function useLibraryDraft(draftId: string): void {
  const draft = getActivationDraft(draftId);

  if (!draft) {
    return;
  }

  selectedLibraryDraftId.value = draftId;
  campaignSourceMode.value = "draft-library";
  resetSelectedMedia();
  applySourceToCampaign(draft.result.post, draft.result.idea.title);
}

function startFreshCampaign(): void {
  editingCampaignId.value = "";
  campaignSourceMode.value = "fresh";
  campaignTone.value = resolveToneFromCampaignIntent(campaignIntent.value);
  const template = buildFreshCampaignTemplate(campaignIntent.value);
  campaignForm.value.name = template.name;
  campaignForm.value.subject = template.subject;
  campaignForm.value.bodyText = template.bodyText;
  campaignForm.value.replyToEmail = domainSettings.value?.replyToEmail || "";
  campaignForm.value.includeSignature = true;
  resetSelectedMedia();
  campaignEditorMode.value = "preview";
}

function loadCampaignIntoComposer(
  campaign: EmailCampaign,
  options: { duplicate?: boolean } = {},
): void {
  editingCampaignId.value = options.duplicate ? "" : campaign.id;
  campaignSourceMode.value = "fresh";
  campaignEditorMode.value = "preview";
  campaignAdvancedOpen.value = false;
  errorMessage.value = "";
  campaignForm.value.listId =
    findEmailListByReference(campaign.listId)?.id
    || campaign.listId
    || emailLists.value[0]?.id
    || campaignForm.value.listId;
  campaignForm.value.name = options.duplicate ? buildDuplicateCampaignName(campaign.name) : campaign.name;
  campaignForm.value.subject = campaign.subject;
  campaignForm.value.bodyText = campaign.bodyText || htmlToPreviewText(campaign.bodyHtml);
  campaignForm.value.replyToEmail = campaign.replyToEmail || domainSettings.value?.replyToEmail || "";
  campaignForm.value.includeSignature = true;
  resetSelectedMedia();
}

function buildCampaignRouteSyncKey(): string {
  const draftId = typeof route.query.draftId === "string" ? route.query.draftId : "";
  const duplicateId = duplicateCampaignId.value;
  const prefill = typeof route.query.prefill === "string" ? route.query.prefill.trim() : "";
  const emailTitle = typeof route.query.emailTitle === "string" ? route.query.emailTitle.trim() : "";
  const emailSubject = typeof route.query.emailSubject === "string" ? route.query.emailSubject.trim() : "";
  const emailBody = typeof route.query.emailBody === "string" ? route.query.emailBody.trim() : "";
  const emailCtaLabel = typeof route.query.emailCtaLabel === "string" ? route.query.emailCtaLabel.trim() : "";
  const emailCtaUrl = typeof route.query.emailCtaUrl === "string" ? route.query.emailCtaUrl.trim() : "";
  const emailHeaderImageUrl =
    typeof route.query.emailHeaderImageUrl === "string" ? route.query.emailHeaderImageUrl.trim() : "";

  if (isEmailEditRoute.value) {
    return `edit:${routeCampaignId.value}`;
  }

  if (isEmailNewRoute.value) {
    return `new:${draftId}:${duplicateId}:${prefill}:${emailTitle}:${emailSubject}:${emailBody}:${emailCtaLabel}:${emailCtaUrl}:${emailHeaderImageUrl}`;
  }

  return `dashboard:${activeEmailTab.value}`;
}

function syncCampaignComposerToRoute(options: { force?: boolean } = {}): void {
  const nextRouteKey = buildCampaignRouteSyncKey();

  if (!options.force && campaignRouteSyncKey.value === nextRouteKey) {
    return;
  }

  if (isEmailNewRoute.value) {
    campaignAdvancedOpen.value = false;
    errorMessage.value = "";

    if (duplicateCampaignId.value) {
      const duplicatedCampaign = campaigns.value.find((entry) => entry.id === duplicateCampaignId.value);

      if (!duplicatedCampaign) {
        if (!isLoading.value) {
          errorMessage.value = "That campaign is not available to duplicate anymore.";
          campaignRouteSyncKey.value = "";
          void router.replace({ path: appRoutes.appEmail });
        }
        return;
      }

      loadCampaignIntoComposer(duplicatedCampaign, { duplicate: true });
      feedbackMessage.value = "Campaign copied into the editor. Review the audience and body, then save or send.";
      campaignRouteSyncKey.value = nextRouteKey;
      return;
    }

    startFreshCampaign();

    if (activationSeed.value) {
      campaignSourceMode.value = "current";
      applyActivationSeed();
    }

    if (activationDraft.value?.result.idea.title?.trim()) {
      campaignForm.value.name = activationDraft.value.result.idea.title.trim();
    }

    if (activationEmailPrefill.value) {
      applyActivationEmailPrefill(activationEmailPrefill.value);
      feedbackMessage.value =
        activationEmailPrefill.value.headerImageUrl
          ? "Draft pulled into the email composer with subject, CTA, and media prefilled."
          : activationEmailPrefill.value.ctaLabel && activationEmailPrefill.value.ctaUrl
            ? "Draft pulled into the email composer with subject and CTA prefilled."
            : "Draft pulled into the email composer with subject and body prefilled.";
    }

    campaignRouteSyncKey.value = nextRouteKey;
    return;
  }

  if (isEmailEditRoute.value) {
    const campaign = campaigns.value.find((entry) => entry.id === routeCampaignId.value);

    if (!campaign) {
      if (!isLoading.value) {
        errorMessage.value = "That campaign no longer exists.";
        campaignRouteSyncKey.value = "";
        void router.replace({ path: appRoutes.appEmail });
      }
      return;
    }

    loadCampaignIntoComposer(campaign);
    feedbackMessage.value = campaign.bodyHtml.includes("<img")
      ? "Campaign loaded into the editor. Review visuals before saving because media attachments are not reconstructed yet."
      : "Campaign loaded into the editor. Review the audience and body, then save changes.";
    campaignRouteSyncKey.value = nextRouteKey;
    return;
  }

  campaignAdvancedOpen.value = false;
  campaignRouteSyncKey.value = nextRouteKey;
}

function goToEmailDashboard(tab: EmailTabKey = "campaigns"): void {
  const nextQuery = tab === "campaigns" ? {} : { tab };

  if (isEmailDashboardRoute.value) {
    void router.replace({ path: appRoutes.appEmail, query: nextQuery });
    return;
  }

  void router.push({ path: appRoutes.appEmail, query: nextQuery });
}

function setCampaignTone(nextTone: CampaignToneMode): void {
  campaignTone.value = nextTone;

  if (campaignSourceMode.value === "draft-library" && selectedLibraryDraft.value) {
    applySourceToCampaign(selectedLibraryDraft.value.result.post, selectedLibraryDraft.value.result.idea.title);
    return;
  }

  if (campaignSourceMode.value === "current" && activationSeed.value) {
    applySourceToCampaign(activationSeed.value, activationDraft.value?.result.idea.title);
  }
}

function setCampaignIntent(nextIntent: CampaignComposerIntent): void {
  campaignIntent.value = nextIntent;
  campaignTone.value = resolveToneFromCampaignIntent(nextIntent);

  if (campaignSourceMode.value === "draft-library" && selectedLibraryDraft.value) {
    applySourceToCampaign(selectedLibraryDraft.value.result.post, selectedLibraryDraft.value.result.idea.title);
    return;
  }

  if (campaignSourceMode.value === "current" && activationSeed.value) {
    applySourceToCampaign(activationSeed.value, activationDraft.value?.result.idea.title);
    return;
  }

  const template = buildFreshCampaignTemplate(nextIntent);
  campaignForm.value.name = template.name;
  campaignForm.value.subject = template.subject;
  campaignForm.value.bodyText = template.bodyText;
}

function openNewCampaign(nextIntent: CampaignComposerIntent = campaignIntent.value): void {
  setCampaignIntent(nextIntent);
  campaignAdvancedOpen.value = false;
  feedbackMessage.value = "";
  errorMessage.value = "";
  void router.push({ path: appRoutes.appEmailNew });
}

function closeCampaignComposer(): void {
  campaignAdvancedOpen.value = false;
  editingCampaignId.value = "";
  errorMessage.value = "";
  startFreshCampaign();
  goToEmailDashboard("campaigns");
}

function insertLinkPlaceholder(): void {
  const paragraphBlock = [...campaignBlocks.value].reverse().find((block) => block.type === "paragraph");

  if (paragraphBlock) {
    const nextValue = paragraphBlock.text.trimEnd();
    paragraphBlock.text = nextValue ? `${nextValue}\nhttps://` : "https://";
    return;
  }

  appendCampaignBlock("paragraph");
  const nextBlock = campaignBlocks.value[campaignBlocks.value.length - 1];

  if (nextBlock) {
    nextBlock.text = "https://";
  }
}

function insertCtaButtonPlaceholder(): void {
  appendCampaignBlock("cta_button");
}

function insertHeroAnnouncementBlock(): void {
  appendCampaignBlock("hero");
}

function insertFeatureListBlock(): void {
  appendCampaignBlock("feature_list");
}

function insertCtaSectionBlock(): void {
  appendCampaignBlock("cta_section");
}

function toggleSignature(): void {
  campaignForm.value.includeSignature = !campaignForm.value.includeSignature;
}

function useHeaderImage(url: string): void {
  campaignForm.value.headerImageUrl = url;
}

function toggleInlineImage(url: string): void {
  if (campaignForm.value.inlineImageUrls.includes(url)) {
    campaignForm.value.inlineImageUrls = campaignForm.value.inlineImageUrls.filter((value) => value !== url);
    return;
  }

  campaignForm.value.inlineImageUrls = dedupeStrings([...campaignForm.value.inlineImageUrls, url]);
}

function moveInlineImage(url: string, direction: "up" | "down"): void {
  const currentIndex = campaignForm.value.inlineImageUrls.findIndex((value) => value === url);

  if (currentIndex === -1) {
    return;
  }

  const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;

  if (targetIndex < 0 || targetIndex >= campaignForm.value.inlineImageUrls.length) {
    return;
  }

  const nextImages = [...campaignForm.value.inlineImageUrls];
  const [image] = nextImages.splice(currentIndex, 1);
  nextImages.splice(targetIndex, 0, image);
  campaignForm.value.inlineImageUrls = nextImages;
}

function addManualMediaUrl(mode: "header" | "inline"): void {
  const nextUrl = campaignForm.value.mediaUrlInput.trim();

  if (!nextUrl) {
    return;
  }

  if (mode === "header") {
    campaignForm.value.headerImageUrl = nextUrl;
  } else {
    campaignForm.value.inlineImageUrls = dedupeStrings([...campaignForm.value.inlineImageUrls, nextUrl]);
  }

  campaignForm.value.mediaUrlInput = "";
}

async function loadDraftMedia(): Promise<void> {
  if (!selectedBusinessId.value || !effectiveSourcePostId.value) {
    emailMediaAssets.value = [];
    return;
  }

  isLoadingDraftMedia.value = true;

  try {
    const response = await requestPostAssets(selectedBusinessId.value, effectiveSourcePostId.value);
    emailMediaAssets.value = response.assets;

    const firstImageUrl = response.assets[0]?.previewUrl || response.assets[0]?.storageUrl;

    if (firstImageUrl && !campaignForm.value.headerImageUrl && campaignForm.value.inlineImageUrls.length === 0) {
      campaignForm.value.headerImageUrl = firstImageUrl;
    }
  } catch {
    emailMediaAssets.value = [];
  } finally {
    isLoadingDraftMedia.value = false;
  }
}

function buildEmailVisualBulletPoints(): string[] {
  return campaignForm.value.bodyText
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter((paragraph) => paragraph.length > 0)
    .slice(0, 3)
    .map((paragraph) =>
      paragraph.length > 96 ? `${paragraph.slice(0, 93).trimEnd()}...` : paragraph,
    );
}

function buildEmailGeneratedMediaFileName(suggestion: MediaRecommendationSuggestion): string {
  const base =
    (campaignForm.value.subject || "email-visual")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "email-visual";
  const suffix = suggestion.suggestedMediaType || suggestion.visualTemplateType || "visual";

  return `${base}-${suffix}.png`;
}

function buildEmailVisualFeedback(
  successMessage: string,
  generatedVisual: GenerateVisualResponse,
): string {
  return generatedVisual.brandConsistency.tone === "review"
    ? `${successMessage} ${generatedVisual.brandConsistency.summary}`
    : successMessage;
}

async function loadEmailMediaRecommendations(): Promise<void> {
  mediaRecommendations.value = [];
  isLoadingMediaRecommendations.value = false;
}

async function handleEmailMediaSelection(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement | null;
  const files = Array.from(input?.files ?? []);

  if (!files.length) {
    return;
  }

  if (!selectedBusinessId.value || !effectiveSourcePostId.value) {
    feedbackMessage.value = "Paste an image URL, or start from a saved draft to upload media directly.";
    if (input) {
      input.value = "";
    }
    return;
  }

  isUploadingDraftMedia.value = true;
  errorMessage.value = "";

  try {
    for (const file of files) {
      const uploadTarget = await requestMediaUploadUrl({
        businessId: selectedBusinessId.value,
        postId: effectiveSourcePostId.value,
        fileType: file.type,
        fileName: file.name,
        sizeBytes: file.size,
      });

      const uploadResponse = await fetch(uploadTarget.uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": file.type,
        },
        body: file,
      });

      if (!uploadResponse.ok) {
        throw new Error("Image upload failed. Check storage configuration and try again.");
      }

      await requestCreatePostAsset({
        businessId: selectedBusinessId.value,
        postId: effectiveSourcePostId.value,
        storageKey: uploadTarget.storageKey,
        storageUrl: uploadTarget.storageUrl,
        mimeType: file.type,
        sizeBytes: file.size,
        source: "upload",
      });
    }

    await loadDraftMedia();
    feedbackMessage.value = `${files.length} image${files.length === 1 ? "" : "s"} added for this email draft.`;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Unable to upload email media right now.";
  } finally {
    isUploadingDraftMedia.value = false;
    if (input) {
      input.value = "";
    }
  }
}

async function attachWorkspaceAssetsToEmail(selectedAssets: WorkspaceAsset[]): Promise<void> {
  if (!selectedBusinessId.value) {
    feedbackMessage.value = "Select a workspace before attaching assets.";
    return;
  }

  errorMessage.value = "";

  try {
    const nextInlineImages = [...campaignForm.value.inlineImageUrls];

    for (const asset of selectedAssets) {
      const sourceUrl = asset.previewUrl || asset.storageUrl;

      if (!campaignForm.value.headerImageUrl) {
        campaignForm.value.headerImageUrl = sourceUrl;
      } else if (!nextInlineImages.includes(sourceUrl)) {
        nextInlineImages.push(sourceUrl);
      }

      await requestRecordWorkspaceAssetUsage(asset.id, {
        businessId: selectedBusinessId.value,
        usageSurface: "email",
        referenceId: effectiveSourcePostId.value || "email-composer",
        metadata: {
          editorMode: campaignEditorMode.value,
        },
      });
    }

    campaignForm.value.inlineImageUrls = dedupeStrings(nextInlineImages);
    isWorkspaceAssetPickerOpen.value = false;
    feedbackMessage.value = `${selectedAssets.length} workspace asset${selectedAssets.length === 1 ? "" : "s"} added to this email.`;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Unable to use workspace assets right now.";
  }
}

async function generateRecommendedEmailMedia(
  suggestion: MediaRecommendationSuggestion,
): Promise<void> {
  if (!selectedBusinessId.value || !suggestion.visualTemplateType) {
    return;
  }

  isGeneratingMediaRecommendationId.value = suggestion.id;
  errorMessage.value = "";

  try {
    const generatedVisual = await requestVisualGeneration({
      businessId: selectedBusinessId.value,
      templateType: suggestion.visualTemplateType,
      content: {
        headline: campaignForm.value.subject.trim() || "Email visual",
        supportingText:
          campaignForm.value.bodyText
            .split(/\n{2,}/)
            .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
            .find((paragraph) => paragraph.length > 0)
            ?.slice(0, 140) || undefined,
        bulletPoints: buildEmailVisualBulletPoints(),
      },
      mediaPresetId: suggestion.mediaPresetId,
      promptTemplateId: suggestion.promptTemplateId,
      generatedMediaType: suggestion.suggestedMediaType,
      contentAssetId: effectiveSourcePostId.value || undefined,
      sourceAssetIds: suggestion.recommendedAssetIds,
    });

    const blob = await fetch(generatedVisual.imageDataUrl).then(async (response) => {
      if (!response.ok) {
        throw new Error("Unable to prepare the generated visual for upload.");
      }

      return response.blob();
    });

    const fileName = buildEmailGeneratedMediaFileName(suggestion);
    let nextUrl = "";

    if (effectiveSourcePostId.value) {
      const uploadTarget = await requestMediaUploadUrl({
        businessId: selectedBusinessId.value,
        postId: effectiveSourcePostId.value,
        fileType: blob.type || generatedVisual.mimeType,
        fileName,
        sizeBytes: blob.size,
      });

      const uploadResponse = await fetch(uploadTarget.uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": blob.type || generatedVisual.mimeType,
        },
        body: blob,
      });

      if (!uploadResponse.ok) {
        throw new Error("Unable to upload the generated visual.");
      }

      await requestCreatePostAsset({
        businessId: selectedBusinessId.value,
        postId: effectiveSourcePostId.value,
        storageKey: uploadTarget.storageKey,
        storageUrl: uploadTarget.storageUrl,
        mimeType: blob.type || generatedVisual.mimeType,
        sizeBytes: blob.size,
        source: "generated",
      });

      nextUrl = uploadTarget.storageUrl;
      await loadDraftMedia();
    } else {
      const uploadTarget = await requestWorkspaceAssetUploadUrl({
        businessId: selectedBusinessId.value,
        fileType: blob.type || generatedVisual.mimeType,
        fileName,
        sizeBytes: blob.size,
        assetType: "image",
      });

      const uploadResponse = await fetch(uploadTarget.uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": blob.type || generatedVisual.mimeType,
        },
        body: blob,
      });

      if (!uploadResponse.ok) {
        throw new Error("Unable to upload the generated visual.");
      }

      const createdAsset = await requestCreateWorkspaceAsset({
        businessId: selectedBusinessId.value,
        storageKey: uploadTarget.storageKey,
        storageUrl: uploadTarget.storageUrl,
        mimeType: blob.type || generatedVisual.mimeType,
        sizeBytes: blob.size,
        title: campaignForm.value.subject || "Generated email visual",
        assetType: "image",
        sourceType: "generated",
        metadata: {
          mediaPresetId: suggestion.mediaPresetId,
          promptTemplateId: suggestion.promptTemplateId,
        },
      });

      nextUrl = createdAsset.asset.previewUrl || createdAsset.asset.storageUrl;
      await requestRecordWorkspaceAssetUsage(createdAsset.asset.id, {
        businessId: selectedBusinessId.value,
        usageSurface: "email",
        referenceId: "email-composer",
        metadata: {
          recommendationId: suggestion.id,
        },
      });
    }

    if (!campaignForm.value.headerImageUrl) {
      campaignForm.value.headerImageUrl = nextUrl;
    } else {
      campaignForm.value.inlineImageUrls = dedupeStrings([
        ...campaignForm.value.inlineImageUrls,
        nextUrl,
      ]);
    }

    feedbackMessage.value = buildEmailVisualFeedback(
      `${suggestion.title} added to this email.`,
      generatedVisual,
    );
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "Unable to generate recommended media.";
  } finally {
    isGeneratingMediaRecommendationId.value = "";
  }
}

async function applyEmailMediaRecommendation(
  suggestion: MediaRecommendationSuggestion,
): Promise<void> {
  if (suggestion.actionType === "use_existing_asset") {
    isWorkspaceAssetPickerOpen.value = true;
    feedbackMessage.value = "Pick an existing workspace asset for this email.";
    return;
  }

  if (suggestion.actionType === "skip") {
    feedbackMessage.value = "Keeping this email text-first for now.";
    return;
  }

  await generateRecommendedEmailMedia(suggestion);
}

function formatStatus(value?: string): string {
  return (value ?? "pending")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatImportProgress(job: EmailContactImportJob): string {
  return `${job.processedRows} / ${job.totalRows} rows processed`;
}

function getImportProgressPercent(job: EmailContactImportJob): number {
  if (job.totalRows <= 0) {
    return 0;
  }

  return Math.min(100, Math.round((job.processedRows / job.totalRows) * 100));
}

function getProcessedRecipientCount(campaign: EmailCampaign): number {
  return campaign.sentCount + campaign.failedCount + campaign.unsubscribedCount;
}

function getCampaignProgressPercent(campaign: EmailCampaign): number {
  if (campaign.recipientCount <= 0) {
    return 0;
  }

  const processedCount = getProcessedRecipientCount(campaign);
  return Math.min(100, Math.round((processedCount / campaign.recipientCount) * 100));
}

function formatCampaignProgress(campaign: EmailCampaign): string {
  if (campaign.recipientCount <= 0) {
    return "No recipients";
  }

  return `${getProcessedRecipientCount(campaign)} / ${campaign.recipientCount} processed`;
}

function getCampaignActionLabel(campaign: EmailCampaign): string {
  if (campaign.status === "queued") {
    return "Queued";
  }

  if (campaign.status === "sending") {
    return "Sending...";
  }

  if (campaign.status === "sent") {
    return "Sent";
  }

  if (campaign.status === "failed") {
    return "Retry";
  }

  return isSending.value ? "Starting..." : "Send";
}

function resolveCampaignListName(campaign: EmailCampaign): string {
  return findEmailListByReference(campaign.listId)?.name || "Selected audience";
}

function formatCampaignStatusChipLabel(campaign: EmailCampaign): string {
  if (campaign.status === "queued") {
    return "Queued";
  }

  if (campaign.status === "sending") {
    return "Sending";
  }

  return formatStatus(campaign.status);
}

function getCampaignStatusChipClass(campaign: EmailCampaign): string {
  if (campaign.status === "sent") {
    return "success";
  }

  if (campaign.status === "failed") {
    return "warning";
  }

  if (campaign.status === "queued" || campaign.status === "sending") {
    return "info";
  }

  return "draft";
}

function formatCampaignReadySummary(campaign: EmailCampaign): string {
  const prefix =
    campaign.status === "queued" || campaign.status === "sending"
      ? "Current send"
      : campaign.status === "failed"
        ? "Retry target"
        : "Next send";
  return `${prefix}: ${resolveCampaignListName(campaign)} · ${resolveCampaignAudienceSize(campaign).toLocaleString()} contacts before suppressions`;
}

function formatCampaignLastSendSummary(campaign: EmailCampaign): string | null {
  if (campaign.status === "sent" && campaign.sendCompletedAt) {
    const sentCount = Math.max(campaign.sentCount, campaign.deliveredCount, campaign.recipientCount);
    return `Last sent ${new Date(campaign.sendCompletedAt).toLocaleDateString()} · ${sentCount.toLocaleString()} contacts`;
  }

  if (campaign.status === "failed") {
    const timestamp = campaign.sendStartedAt || campaign.updatedAt;
    if (!timestamp) {
      return null;
    }
    return `Last attempt ${new Date(timestamp).toLocaleDateString()} · ${resolveCampaignAudienceSize(campaign).toLocaleString()} contacts`;
  }

  return null;
}

function buildCampaignSendConfirmationMessage(campaign: EmailCampaign): string {
  const verb = campaign.status === "failed" ? "Retry" : "Send";
  return [
    `${verb} "${campaign.name}" now?`,
    "",
    "You are sending to:",
    `- ${resolveCampaignListName(campaign)}`,
    `- ${resolveCampaignAudienceSize(campaign).toLocaleString()} contacts before suppressions`,
    "",
    "Unsubscribed, bounced, and complained contacts stay excluded.",
  ].join("\n");
}

function stopCampaignProgressPolling(): void {
  if (campaignProgressPollHandle === null || typeof window === "undefined") {
    return;
  }

  window.clearInterval(campaignProgressPollHandle);
  campaignProgressPollHandle = null;
}

function stopImportJobPolling(): void {
  if (importJobPollHandle === null || typeof window === "undefined") {
    return;
  }

  window.clearInterval(importJobPollHandle);
  importJobPollHandle = null;
}

async function refreshCampaignProgress(): Promise<void> {
  if (!selectedBusinessId.value || !emailFeatureEnabled.value) {
    stopCampaignProgressPolling();
    return;
  }

  await loadEmailState();

  if (!latestStatsCampaignId.value) {
    return;
  }

  try {
    const statsResponse = await requestEmailCampaignStats(selectedBusinessId.value, latestStatsCampaignId.value);
    latestStats.value = statsResponse.stats;
  } catch {
    // Keep the last known stats visible; the list itself still refreshes.
  }
}

async function refreshImportJobProgress(): Promise<void> {
  if (!selectedBusinessId.value || !emailFeatureEnabled.value) {
    stopImportJobPolling();
    return;
  }

  await loadEmailState();
}

function startCampaignProgressPolling(): void {
  stopCampaignProgressPolling();

  if (!hasProcessingCampaigns.value || typeof window === "undefined") {
    return;
  }

  campaignProgressPollHandle = window.setInterval(() => {
    if (isLoading.value || isSending.value) {
      return;
    }

    void refreshCampaignProgress();
  }, 5000);
}

function startImportJobPolling(): void {
  stopImportJobPolling();

  if (!hasProcessingImportJobs.value || typeof window === "undefined") {
    return;
  }

  importJobPollHandle = window.setInterval(() => {
    if (isLoading.value || isImporting.value) {
      return;
    }

    void refreshImportJobProgress();
  }, 5000);
}

function applyDomainSettings(
  settings: BusinessEmailSettings | null,
  options: { syncForm?: boolean } = {},
): void {
  domainSettings.value = settings;
  domainSaveErrorMessage.value = "";
  testRecipientEmail.value = settings?.testRecipientEmail ?? "";

  if (!options.syncForm) {
    return;
  }

  const recommended = recommendedDomainForm.value;

  domainForm.value = {
    domainName: settings?.domainName ?? recommended.domainName,
    fromName: settings?.fromName ?? recommended.fromName,
    fromEmail: settings?.fromEmail ?? recommended.fromEmail,
    replyToEmail: settings?.replyToEmail ?? recommended.replyToEmail,
    footer: buildFooterFormFromSettings(settings?.footer, {
      fallbackBusinessName: settings?.fromName ?? recommended.fromName,
      fallbackWebsiteUrl:
        normalizeWebsiteUrlForSignature(
          currentBusinessMembership.value?.business.websiteUrl,
          settings?.domainName ?? recommended.domainName,
        ) || recommended.footer.websiteUrl,
      fallbackSupportEmail: settings?.replyToEmail ?? settings?.fromEmail ?? recommended.replyToEmail,
      legacySignatureText: settings?.signatureText,
    }),
  };
}

function applyRecommendedDomainSetup(): void {
  domainForm.value = {
    ...recommendedDomainForm.value,
    footer: buildFooterFormFromSettings(normalizeFooterForm(recommendedDomainForm.value.footer)),
  };
  domainSaveErrorMessage.value = "";
  feedbackMessage.value = workspaceSuggestedDomain.value
    ? `Prefilled sender setup from ${workspaceSuggestedDomain.value}.`
    : "Prefilled the recommended sender defaults for this workspace.";
}

async function loadFooterBranding(): Promise<void> {
  if (!selectedBusinessId.value) {
    footerBrandKit.value = null;
    return;
  }

  try {
    const response = await requestBrandKit(selectedBusinessId.value);
    footerBrandKit.value = response.brandKit;
  } catch {
    footerBrandKit.value = null;
  }
}

async function handleFooterLogoSelection(assets: WorkspaceAsset[]): Promise<void> {
  if (!selectedBusinessId.value || assets.length === 0) {
    return;
  }

  const [asset] = assets;
  const logoUrl = asset.storageUrl?.trim() || asset.previewUrl?.trim();

  if (!logoUrl) {
    domainSaveErrorMessage.value = "The selected asset does not have a usable image URL.";
    return;
  }

  isSavingFooterLogo.value = true;
  domainSaveErrorMessage.value = "";

  try {
    const response = await requestUpdateBrandKit({
      businessId: selectedBusinessId.value,
      brandKit: {
        logoUrl,
      },
    });
    footerBrandKit.value = response.brandKit;
    await requestRecordWorkspaceAssetUsage(asset.id, {
      businessId: selectedBusinessId.value,
      usageSurface: "brand_kit",
      metadata: {
        slot: "email_footer_logo",
      },
    }).catch(() => undefined);
    isFooterLogoPickerOpen.value = false;
    feedbackMessage.value = "Footer logo saved. Future emails will reuse it automatically.";
  } catch (error) {
    domainSaveErrorMessage.value = error instanceof Error ? error.message : "Unable to save the footer logo.";
  } finally {
    isSavingFooterLogo.value = false;
  }
}

async function clearFooterLogo(): Promise<void> {
  if (!selectedBusinessId.value || !effectiveFooterLogoUrl.value) {
    return;
  }

  isSavingFooterLogo.value = true;
  domainSaveErrorMessage.value = "";

  try {
    const response = await requestUpdateBrandKit({
      businessId: selectedBusinessId.value,
      brandKit: {
        logoUrl: "",
      },
    });
    footerBrandKit.value = response.brandKit;
    feedbackMessage.value = "Footer logo removed from future emails.";
  } catch (error) {
    domainSaveErrorMessage.value = error instanceof Error ? error.message : "Unable to remove the footer logo.";
  } finally {
    isSavingFooterLogo.value = false;
  }
}

function setEmailTab(tab: EmailTabKey): void {
  if (isEmailDashboardRoute.value) {
    const nextQuery: Record<string, string | string[] | null | undefined> = {
      ...route.query,
      tab: tab === "campaigns" ? undefined : tab,
    };

    delete nextQuery.draftId;
    delete nextQuery.prefill;
    delete nextQuery.emailTitle;
    delete nextQuery.emailSubject;
    delete nextQuery.emailBody;
    delete nextQuery.emailCtaLabel;
    delete nextQuery.emailCtaUrl;
    delete nextQuery.emailHeaderImageUrl;
    void router.replace({ path: appRoutes.appEmail, query: nextQuery });
    return;
  }

  goToEmailDashboard(tab);
}

function resetContactImportPreview(): void {
  contactImportPreview.value = null;
  contactImportMapping.value = {};
}

function applySuggestedContactImportMapping(preview: ImportEmailContactsPreviewResponse): void {
  const nextMapping: EmailContactImportMapping = {};

  for (const field of preview.fields) {
    if (field.columnName) {
      nextMapping[field.field] = field.columnName;
    }
  }

  contactImportMapping.value = nextMapping;
}

async function handleContactFileSelection(event: Event): Promise<void> {
  const target = event.target as HTMLInputElement | null;
  const file = target?.files?.[0];

  if (!file) {
    return;
  }

  contactImport.value.csvText = await file.text();
  contactImportFileName.value = file.name;
  resetContactImportPreview();

  if (target) {
    target.value = "";
  }
}

async function loadBusinesses(): Promise<void> {
  const response = await requestMyBusinesses();
  businesses.value = response.businesses;
  selectedBusinessId.value =
    productAccess.value?.activeBusinessId ||
    activeBusinessId.value ||
    response.businesses[0]?.businessId ||
    "";

  if (!productAccess.value?.activeBusinessId && selectedBusinessId.value) {
    await setActiveBusinessId(selectedBusinessId.value);
  }
}

function buildContactDirectoryRequestOptions(): {
  status?: EmailContactStatus;
  attributeFilters?: Record<string, string>;
  limit: number;
} {
  const attributeFilters: Record<string, string> = {};

  if (contactStateFilter.value !== "all") {
    attributeFilters.state = contactStateFilter.value;
  }

  if (contactPlanFilter.value !== "all") {
    attributeFilters.plan = contactPlanFilter.value;
  }

  return {
    status: contactStatusFilter.value !== "all" ? contactStatusFilter.value : undefined,
    attributeFilters: Object.keys(attributeFilters).length > 0 ? attributeFilters : undefined,
    limit: 500,
  };
}

async function loadEmailContactsDirectory(): Promise<void> {
  if (!selectedBusinessId.value || !emailFeatureEnabled.value) {
    emailContacts.value = [];
    emailContactsTotal.value = 0;
    return;
  }

  const contactsResponse = await requestEmailContacts(selectedBusinessId.value, buildContactDirectoryRequestOptions());
  emailContacts.value = contactsResponse.contacts;
  emailContactsTotal.value = contactsResponse.total;
}

async function loadEmailState(options: { syncDomainForm?: boolean } = {}): Promise<void> {
  if (!selectedBusinessId.value || !emailFeatureEnabled.value) {
    stopCampaignProgressPolling();
    stopImportJobPolling();
    emailLists.value = [];
    emailContacts.value = [];
    emailContactsTotal.value = 0;
    contactImportJobs.value = [];
    campaigns.value = [];
    latestStats.value = null;
    footerBrandKit.value = null;
    applyDomainSettings(null, { syncForm: options.syncDomainForm });
    return;
  }

  const [listsResponse, campaignsResponse, domainResponse, contactsResponse, importJobsResponse] = await Promise.all([
    requestEmailLists(selectedBusinessId.value),
    requestEmailCampaigns(selectedBusinessId.value),
    requestEmailDomainSettings(selectedBusinessId.value),
    requestEmailContacts(selectedBusinessId.value, buildContactDirectoryRequestOptions()),
    requestEmailContactImportJobs(selectedBusinessId.value),
  ]);

  emailLists.value = listsResponse.lists;
  emailContacts.value = contactsResponse.contacts;
  emailContactsTotal.value = contactsResponse.total;
  contactImportJobs.value = importJobsResponse.importJobs;
  campaigns.value = campaignsResponse.campaigns;
  applyDomainSettings(domainResponse.settings, { syncForm: options.syncDomainForm });

  if (latestStatsCampaignId.value) {
    const matchingCampaign = campaigns.value.find((campaign) => campaign.id === latestStatsCampaignId.value);

    if (!matchingCampaign) {
      latestStatsCampaignId.value = "";
      latestStats.value = null;
    } else {
      latestStats.value = {
        campaignId: matchingCampaign.id,
        sendCount: 0,
        recipientCount: matchingCampaign.recipientCount,
        pendingCount: matchingCampaign.pendingCount,
        sentCount: matchingCampaign.sentCount,
        deliveredCount: matchingCampaign.deliveredCount,
        failedCount: matchingCampaign.failedCount,
        unsubscribedCount: matchingCampaign.unsubscribedCount,
        uniqueOpens: 0,
        totalOpens: 0,
        uniqueClicks: 0,
        totalClicks: 0,
      };
    }
  }

  startCampaignProgressPolling();
  startImportJobPolling();

  if (!campaignForm.value.listId && emailLists.value[0]) {
    campaignForm.value.listId = emailLists.value[0].id;
  } else {
    const canonicalList = findEmailListByReference(campaignForm.value.listId);

    if (canonicalList && campaignForm.value.listId !== canonicalList.id) {
      campaignForm.value.listId = canonicalList.id;
    }
  }

  await loadDraftMedia();
  await loadFooterBranding();
}

async function initializePage(): Promise<void> {
  isLoading.value = true;
  errorMessage.value = "";

  try {
    loadActivationDraftLibrary();

    await loadBusinesses();
    await loadEmailState({ syncDomainForm: true });
    syncCampaignComposerToRoute({ force: true });
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Unable to load email.";
  } finally {
    isLoading.value = false;
  }
}

async function previewContactsImport(): Promise<void> {
  if (!selectedBusinessId.value) {
    errorMessage.value = "Select a workspace before previewing contacts.";
    return;
  }

  if (!contactImport.value.csvText.trim()) {
    errorMessage.value = "Paste or upload a CSV before previewing contacts.";
    return;
  }

  isPreviewingContacts.value = true;
  errorMessage.value = "";

  try {
    const response = await requestEmailContactsImportPreview(selectedBusinessId.value, {
      csvText: contactImport.value.csvText,
      mapping: Object.keys(contactImportMapping.value).length > 0 ? contactImportMapping.value : undefined,
    });
    contactImportPreview.value = response;

    if (Object.keys(contactImportMapping.value).length === 0) {
      applySuggestedContactImportMapping(response);
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Unable to preview contacts.";
  } finally {
    isPreviewingContacts.value = false;
  }
}

async function importContacts(): Promise<void> {
  if (!selectedBusinessId.value) {
    errorMessage.value = "Select a workspace before importing contacts.";
    return;
  }

  isImporting.value = true;
  errorMessage.value = "";

  try {
    const response = await requestEmailContactsImport(selectedBusinessId.value, {
      ...contactImport.value,
      mapping: Object.keys(contactImportMapping.value).length > 0 ? contactImportMapping.value : undefined,
      duplicateStrategy: contactImportDuplicateStrategy.value,
    });
    latestImportJobId.value = "";
    feedbackMessage.value = [
      `Contacts imported into ${response.list.name}.`,
      `Created ${response.createdCount}, updated ${response.updatedCount}, skipped ${response.skippedCount}.`,
    ].join(" ");
    contactImport.value.csvText = "";
    contactImport.value.listName = "";
    contactImportFileName.value = "";
    resetContactImportPreview();
    await loadEmailState();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Unable to import contacts.";
  } finally {
    isImporting.value = false;
  }
}

function startEditContact(contact: EmailContact): void {
  editingContactId.value = contact.id;
  contactForm.value.email = contact.email;
  contactForm.value.firstName = contact.firstName || "";
  contactForm.value.lastName = contact.lastName || "";
  contactForm.value.status = contact.status;
}

function cancelContactEdit(): void {
  editingContactId.value = "";
  contactForm.value.email = "";
  contactForm.value.firstName = "";
  contactForm.value.lastName = "";
  contactForm.value.status = "active";
}

async function saveContactEdits(): Promise<void> {
  if (!selectedBusinessId.value || !editingContactId.value) {
    return;
  }

  if (!contactForm.value.email.trim()) {
    showEmailToast("Email address is required.", "error");
    return;
  }

  isSavingContact.value = true;
  errorMessage.value = "";

  try {
    const response = await requestEmailContactUpdate(selectedBusinessId.value, editingContactId.value, {
      email: contactForm.value.email,
      firstName: contactForm.value.firstName || undefined,
      lastName: contactForm.value.lastName || undefined,
      status: contactForm.value.status,
    });
    await loadEmailState();
    cancelContactEdit();
    feedbackMessage.value = `Contact updated: ${response.contact.email}.`;
  } catch (error) {
    showEmailToast(error instanceof Error ? error.message : "Unable to update contact.", "error");
  } finally {
    isSavingContact.value = false;
  }
}

async function deleteContact(contact: EmailContact): Promise<void> {
  if (!selectedBusinessId.value) {
    return;
  }

  const confirmed =
    typeof window === "undefined"
    || window.confirm(`Delete ${contact.email}?\n\nThis removes the contact from this workspace and any attached email lists.`);

  if (!confirmed) {
    return;
  }

  deletingContactId.value = contact.id;
  errorMessage.value = "";

  try {
    await requestEmailContactDelete(selectedBusinessId.value, contact.id);

    if (editingContactId.value === contact.id) {
      cancelContactEdit();
    }

    await loadEmailState();
    feedbackMessage.value = `Contact deleted: ${contact.email}.`;
  } catch (error) {
    showEmailToast(error instanceof Error ? error.message : "Unable to delete contact.", "error");
  } finally {
    deletingContactId.value = "";
  }
}

async function createCampaign(sendNow = false): Promise<void> {
  if (!selectedBusinessId.value || !campaignForm.value.listId) {
    errorMessage.value = "Import contacts first so a list exists for this campaign.";
    return;
  }

  if (!campaignForm.value.subject.trim()) {
    errorMessage.value = "Subject line is required.";
    return;
  }

  if (!campaignForm.value.bodyText.trim()) {
    errorMessage.value = "Email body is required.";
    return;
  }

  isCreatingCampaign.value = true;
  errorMessage.value = "";

  try {
    if (hasPendingDomainSetupChanges.value) {
      const persistedSettings = await persistDomainSetup({ showSuccessFeedback: false });

      if (!persistedSettings) {
        errorMessage.value = domainSaveErrorMessage.value || "Unable to save sender and footer defaults.";
        return;
      }
    }

    if (sendNow && !hasConfiguredDomain.value) {
      errorMessage.value = "Finish sender setup before sending.";
      return;
    }

    const payload = {
      listId: campaignForm.value.listId,
      name:
        campaignForm.value.name.trim()
        || campaignForm.value.subject.trim()
        || campaignComposerIntentSelection.value.label,
      subject: campaignForm.value.subject,
      bodyText: campaignForm.value.bodyText,
      replyToEmail: domainSettings.value?.replyToEmail || campaignForm.value.replyToEmail || undefined,
      sourceAssetId: effectiveSourcePostId.value || undefined,
      sourceIdeaId: effectiveSourceIdeaId.value || undefined,
      sourceTitle: effectiveSourceTitle.value || undefined,
      content: campaignContentPayload.value,
    };
    const response = editingCampaignId.value
      ? await requestEmailCampaignUpdate(selectedBusinessId.value, editingCampaignId.value, payload)
      : await requestEmailCampaignCreate(selectedBusinessId.value, payload);
    if (sendNow) {
      const sendResponse = await requestEmailCampaignSend(selectedBusinessId.value, response.campaign.id);
      latestStatsCampaignId.value = response.campaign.id;
      latestStats.value = sendResponse.stats;
      feedbackMessage.value = `Campaign queued: ${response.campaign.name}. Processing ${sendResponse.stats.recipientCount} recipients in the background.`;
      await Promise.all([
        loadEmailState(),
        refreshProductAccess(selectedBusinessId.value),
      ]);
    } else {
      feedbackMessage.value = editingCampaignId.value
        ? `Draft updated: ${response.campaign.name}.`
        : `Draft saved: ${response.campaign.name}.`;
      await loadEmailState();
    }

    closeCampaignComposer();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Unable to save email campaign.";
  } finally {
    isCreatingCampaign.value = false;
  }
}

function duplicateCampaign(campaign: EmailCampaign): void {
  campaignRouteSyncKey.value = "";
  void router.push({
    path: appRoutes.appEmailNew,
    query: {
      duplicateCampaignId: campaign.id,
    },
  });

  if (typeof window !== "undefined") {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
}

function canEditCampaign(campaign: EmailCampaign): boolean {
  return campaign.status === "draft" || campaign.status === "failed";
}

function canDeleteCampaign(campaign: EmailCampaign): boolean {
  return campaign.status === "draft" || campaign.status === "failed";
}

function formatCampaignLifecycleLabel(campaign: EmailCampaign): string {
  if (campaign.status === "sent" && campaign.sendCompletedAt) {
    return `Sent ${new Date(campaign.sendCompletedAt).toLocaleDateString()}`;
  }

  if ((campaign.status === "queued" || campaign.status === "sending") && campaign.updatedAt) {
    return `In progress · ${new Date(campaign.updatedAt).toLocaleDateString()}`;
  }

  if (campaign.status === "failed" && campaign.updatedAt) {
    return `Needs review · ${new Date(campaign.updatedAt).toLocaleDateString()}`;
  }

  const timestamp = campaign.updatedAt || campaign.createdAt;
  return `Draft · ${new Date(timestamp).toLocaleDateString()}`;
}

function resolveCampaignAudienceSize(campaign: EmailCampaign): number {
  if (campaign.recipientCount > 0) {
    return campaign.recipientCount;
  }

  const matchingList = findEmailListByReference(campaign.listId);
  return matchingList?.contactCount ?? 0;
}

function editCampaign(campaign: EmailCampaign): void {
  campaignRouteSyncKey.value = "";
  void router.push({
    name: "app-email-edit",
    params: { campaignId: campaign.id },
  });

  if (typeof window !== "undefined") {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
}

async function deleteCampaign(campaign: EmailCampaign): Promise<void> {
  if (!selectedBusinessId.value || !canDeleteCampaign(campaign)) {
    return;
  }

  const confirmed =
    typeof window === "undefined" ||
    window.confirm(`Delete "${campaign.name}"?\n\nThis cannot be undone. Only draft or failed campaigns can be removed.`);

  if (!confirmed) {
    return;
  }

  deletingCampaignId.value = campaign.id;
  errorMessage.value = "";

  try {
    await requestEmailCampaignDelete(selectedBusinessId.value, campaign.id);
    if (editingCampaignId.value === campaign.id) {
      editingCampaignId.value = "";
      startFreshCampaign();
    }
    feedbackMessage.value = `Campaign deleted: ${campaign.name}.`;
    await loadEmailState();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Unable to delete email campaign.";
  } finally {
    deletingCampaignId.value = "";
  }
}

async function sendCampaign(campaign: EmailCampaign): Promise<void> {
  if (!selectedBusinessId.value) {
    return;
  }

  if (!hasConfiguredDomain.value) {
    showEmailToast("Finish sender setup before sending.", "error");
    setEmailTab("settings");
    return;
  }

  const confirmed =
    typeof window === "undefined" ||
    window.confirm(buildCampaignSendConfirmationMessage(campaign));

  if (!confirmed) {
    return;
  }

  isSending.value = true;
  errorMessage.value = "";

  try {
    const response = await requestEmailCampaignSend(selectedBusinessId.value, campaign.id);
    latestStatsCampaignId.value = campaign.id;
    latestStats.value = response.stats;
    feedbackMessage.value = `Campaign queued. Processing ${response.stats.recipientCount} recipients in the background.`;
    await Promise.all([
      loadEmailState(),
      refreshProductAccess(selectedBusinessId.value),
      requestEmailCampaignStats(selectedBusinessId.value, campaign.id).then((statsResponse) => {
        latestStats.value = statsResponse.stats;
      }),
    ]);
  } catch (error) {
    errorMessage.value =
      error instanceof Error
        ? error.message
        : "Something failed sending your email. Try again or contact support.";
  } finally {
    isSending.value = false;
  }
}

async function persistDomainSetup(
  options: {
    closeEditor?: boolean;
    showSuccessFeedback?: boolean;
    successMessage?: string;
  } = {},
): Promise<BusinessEmailSettings | null> {
  const normalizedPayload = normalizedDomainForm.value;

  if (!selectedBusinessId.value) {
    domainSaveErrorMessage.value = "Select a workspace before saving the sender setup.";
    return null;
  }

  if (domainValidationMessage.value) {
    domainSaveErrorMessage.value = domainValidationMessage.value;
    return null;
  }

  isSavingDomain.value = true;
  domainSaveErrorMessage.value = "";

  try {
    const response = await requestEmailDomainCreate(selectedBusinessId.value, normalizedPayload);
    applyDomainSettings(response.settings, { syncForm: true });

    if (options.closeEditor) {
      isEditingDomainSetup.value = false;
    }

    if (options.showSuccessFeedback !== false) {
      feedbackMessage.value = options.successMessage || `Domain setup saved for ${response.settings.domainName}.`;
    }

    return response.settings;
  } catch (error) {
    domainSaveErrorMessage.value = error instanceof Error ? error.message : "Unable to save domain settings.";
    return null;
  } finally {
    isSavingDomain.value = false;
  }
}

async function saveDomainUpgrade(): Promise<void> {
  await persistDomainSetup({ closeEditor: true });
}

async function saveFooterDefaults(): Promise<void> {
  await persistDomainSetup({
    successMessage: "Footer defaults saved. Future emails will reuse them automatically.",
  });
}

function clearComposerPreviewDebounce(): void {
  if (composerPreviewDebounceHandle === null || typeof window === "undefined") {
    return;
  }

  window.clearTimeout(composerPreviewDebounceHandle);
  composerPreviewDebounceHandle = null;
}

async function refreshComposerPreview(): Promise<void> {
  if (!selectedBusinessId.value || !campaignComposerOpen.value) {
    syncedPreviewEmailHtml.value = "";
    previewSyncErrorMessage.value = "";
    return;
  }

  if (!previewRequestPayload.value.subject.trim() || !campaignForm.value.bodyText.trim()) {
    syncedPreviewEmailHtml.value = "";
    previewSyncErrorMessage.value = "";
    return;
  }

  isRefreshingComposerPreview.value = true;

  try {
    const response = await requestEmailCampaignPreview(selectedBusinessId.value, previewRequestPayload.value);
    syncedPreviewEmailHtml.value = response.html;
    previewSyncErrorMessage.value = "";
  } catch (error) {
    syncedPreviewEmailHtml.value = "";
    previewSyncErrorMessage.value = error instanceof Error ? error.message : "Unable to sync the live email preview.";
  } finally {
    isRefreshingComposerPreview.value = false;
  }
}

function queueComposerPreviewRefresh(): void {
  clearComposerPreviewDebounce();

  if (typeof window === "undefined") {
    return;
  }

  composerPreviewDebounceHandle = window.setTimeout(() => {
    composerPreviewDebounceHandle = null;
    void refreshComposerPreview();
  }, 260);
}

async function sendTestEmailPreview(): Promise<void> {
  if (!selectedBusinessId.value) {
    errorMessage.value = "Select a workspace before sending a test email.";
    return;
  }

  if (campaignTestSendBlockReason.value) {
    errorMessage.value = campaignTestSendBlockReason.value;
    return;
  }

  isSendingTestEmail.value = true;
  errorMessage.value = "";

  try {
    if (hasPendingDomainSetupChanges.value) {
      const persistedSettings = await persistDomainSetup({ showSuccessFeedback: false });

      if (!persistedSettings) {
        errorMessage.value = domainSaveErrorMessage.value || "Unable to save sender and footer defaults.";
        return;
      }
    }

    const response = await requestEmailCampaignTestSend(selectedBusinessId.value, {
      ...previewRequestPayload.value,
      recipientEmail: testRecipientEmail.value.trim(),
      saveRecipient: true,
    });

    testRecipientEmail.value = response.savedRecipientEmail || response.recipientEmail;
    feedbackMessage.value = `Test email sent to ${response.recipientEmail}.`;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Unable to send the test email.";
  } finally {
    isSendingTestEmail.value = false;
  }
}

watch(errorMessage, (nextMessage) => {
  if (!nextMessage) {
    return;
  }

  showEmailToast(nextMessage, "error");
  errorMessage.value = "";
});

watch(feedbackMessage, (nextMessage) => {
  if (!nextMessage) {
    return;
  }

  showEmailToast(nextMessage, "neutral");
  feedbackMessage.value = "";
});

watch(
  () => ({ ...domainForm.value }),
  () => {
    domainSaveErrorMessage.value = "";
  },
  { deep: true },
);

watch(() => productAccess.value?.activeBusinessId || activeBusinessId.value, (nextBusinessId, previousBusinessId) => {
  if (!nextBusinessId || nextBusinessId === previousBusinessId) {
    return;
  }

  selectedBusinessId.value = nextBusinessId;
  syncedPreviewEmailHtml.value = "";
  previewSyncErrorMessage.value = "";
  testRecipientEmail.value = "";
  contactImportFileName.value = "";
  contactSearch.value = "";
  contactStatusFilter.value = "all";
  contactStateFilter.value = "all";
  contactPlanFilter.value = "all";
  contactTagFilter.value = "all";
  resetContactImportPreview();
  campaignRouteSyncKey.value = "";

  void (async () => {
    await loadBusinesses();
    await loadEmailState({ syncDomainForm: true });
    syncCampaignComposerToRoute({ force: true });
  })();
});

watch(
  () => [
    route.name,
    route.params.campaignId,
    route.query.draftId,
    route.query.duplicateCampaignId,
    route.query.prefill,
    route.query.emailTitle,
    route.query.emailSubject,
    route.query.emailBody,
    route.query.emailCtaLabel,
    route.query.emailCtaUrl,
    route.query.emailHeaderImageUrl,
    selectedBusinessId.value,
  ],
  () => {
    loadActivationDraftLibrary();
    syncCampaignComposerToRoute({ force: true });
    void loadDraftMedia();
  },
);

watch(
  () => [selectedBusinessId.value, effectiveSourcePostId.value],
  () => {
    void loadDraftMedia();
  },
);

watch(
  () => campaignForm.value.bodyText,
  () => {
    syncCampaignBlocksFromBodyText();
  },
  { immediate: true },
);

watch(
  campaignBlocks,
  () => {
    syncCampaignBodyTextFromBlocks();
  },
  { deep: true },
);

watch(
  () => [
    selectedBusinessId.value,
    campaignForm.value.subject,
    campaignForm.value.bodyText,
    campaignForm.value.replyToEmail,
    campaignForm.value.headerImageUrl,
    campaignForm.value.inlineImageUrls.join("|"),
    campaignForm.value.includeSignature,
    normalizedDomainForm.value.fromName,
    normalizedDomainForm.value.fromEmail,
    normalizedDomainForm.value.replyToEmail,
    normalizedDomainForm.value.signatureText,
    JSON.stringify(effectiveFooterSettings.value),
    effectiveFooterLogoUrl.value,
    campaignComposerOpen.value,
    activeEmailTab.value,
    editingCampaignId.value,
    testRecipientEmail.value,
    emailMediaAssets.value.length,
  ],
  () => {
    void loadEmailMediaRecommendations();
    queueComposerPreviewRefresh();
  },
  { immediate: true },
);

watch(
  () => [selectedBusinessId.value, contactStatusFilter.value, contactStateFilter.value, contactPlanFilter.value],
  ([businessId], [, previousStatus, previousState, previousPlan]) => {
    if (!businessId || !emailFeatureEnabled.value) {
      return;
    }

    if (
      previousStatus === undefined &&
      previousState === undefined &&
      previousPlan === undefined
    ) {
      return;
    }

    void loadEmailContactsDirectory().catch((error) => {
      errorMessage.value = error instanceof Error ? error.message : "Unable to refresh contacts.";
    });
  },
);

watch(
  () => [contactTagOptions.value.join("|"), contactTagFilter.value],
  ([, selectedTag]) => {
    if (selectedTag !== "all" && !contactTagOptions.value.includes(selectedTag)) {
      contactTagFilter.value = "all";
    }
  },
);

watch(
  () => contactImport.value.csvText,
  (nextValue, previousValue) => {
    if (nextValue === previousValue) {
      return;
    }

    resetContactImportPreview();
  },
);

onMounted(() => {
  void initializePage();
});

onBeforeUnmount(() => {
  stopCampaignProgressPolling();
  stopImportJobPolling();
  clearEmailToastTimer();
  clearComposerPreviewDebounce();
});
</script>

<template>
  <main class="workspace-shell">
    <EmailSkeleton v-if="isLoading" />

    <template v-else>
      <section v-if="!selectedBusinessId" class="workspace-card empty-state">
        <h2>Email needs a workspace.</h2>
        <p>Create or select a workspace first, then send the first campaign from there.</p>
        <router-link class="primary-action" :to="appRoutes.onboardingWorkspace">Create workspace</router-link>
      </section>

      <section v-else-if="!emailFeatureEnabled" class="workspace-card empty-state">
        <h2>Email is not enabled for this workspace.</h2>
        <p>You can still generate content now, then enable email later when access is ready.</p>
      </section>

      <section v-else class="email-workspace-stack">
        <section class="workspace-card email-tabs-card">
          <div class="email-tabs-header">
            <div class="email-tabs-intro">
              <span class="workspace-chip email-workspace-chip">
                {{ currentBusinessMembership?.business.name || "Workspace" }}
              </span>
              <div>
                <p class="panel-meta">Email campaigns</p>
                <h1>Send something without the clutter</h1>
                <p class="panel-note">Campaigns, contacts, and sender settings stay separate so writing stays focused.</p>
              </div>
              <div class="email-hero-chip-row">
                <span class="workspace-chip">{{ emailLimitText || "Email workspace ready" }}</span>
                <span class="workspace-chip">{{ emailContactsTotal }} contacts</span>
                <span class="workspace-chip">{{ campaigns.length }} campaigns</span>
              </div>
            </div>

            <div class="email-header-actions">
              <button
                v-if="hasConfiguredDomain"
                type="button"
                class="primary-action"
                @click="openNewCampaign()"
              >
                New Email
              </button>
              <button
                v-else
                type="button"
                class="secondary-action hero-inline-action"
                @click="setEmailTab('settings')"
              >
                Finish sender setup
              </button>
            </div>
          </div>

          <div class="email-tab-row" role="tablist" aria-label="Email sections">
            <button
              v-for="tab in EMAIL_TABS"
              :key="tab.key"
              type="button"
              class="email-tab-button"
              :class="{ active: activeEmailTab === tab.key }"
              :aria-selected="activeEmailTab === tab.key"
              @click="setEmailTab(tab.key)"
            >
              {{ tab.label }}
            </button>
          </div>
        </section>

          <section v-if="false" class="email-overview-stack">
          <section class="email-overview-grid">
            <article
              v-for="card in overviewStats"
              :key="card.label"
              class="workspace-card email-stat-card"
              :data-tone="card.tone"
            >
              <span>{{ card.label }}</span>
              <strong>{{ card.value }}</strong>
            </article>
          </section>

          <section class="overview-quick-actions">
            <button
              type="button"
              class="primary-action overview-action-button"
              @click="setEmailTab(hasConfiguredDomain ? 'campaigns' : 'settings')"
            >
              {{ hasConfiguredDomain ? "Create campaign" : "Finish sender setup" }}
            </button>
            <button type="button" class="secondary-action overview-action-button" @click="setEmailTab('contacts')">
              Import contacts
            </button>
            <button type="button" class="secondary-action overview-action-button" @click="setEmailTab('settings')">
              Email settings
            </button>
          </section>

          <section class="overview-dashboard-grid">
            <article class="workspace-card overview-campaigns-card">
              <div class="panel-header">
                <div>
                  <p class="panel-meta">Recent campaigns</p>
                  <h2>Campaigns already in motion</h2>
                </div>
              </div>

              <div v-if="campaignDashboardCards.length > 0" class="campaign-list overview-campaign-list">
                <article v-for="campaign in campaignDashboardCards" :key="campaign.id" class="campaign-card overview-campaign-card">
                  <div class="overview-campaign-main">
                    <div class="overview-campaign-copy">
                      <strong>{{ campaign.name }}</strong>
                      <p class="overview-campaign-subject">{{ campaign.subject }}</p>
                      <p v-if="campaign.sourceTitle" class="overview-campaign-source">
                        From {{ campaign.sourceTitle }}
                      </p>
                      <p class="overview-campaign-preview">
                        {{ campaign.preview || "No campaign copy preview yet." }}
                      </p>
                    </div>
                    <div class="overview-campaign-metrics">
                      <span class="workspace-chip">{{ formatStatus(campaign.status) }}</span>
                      <span class="workspace-chip">{{ campaign.sentCount }} sent</span>
                      <span class="workspace-chip">{{ campaign.deliveredCount }} delivered</span>
                      <span class="workspace-chip" :class="{ warning: campaign.failedCount > 0 }">
                        {{ campaign.failedCount }} failed<span v-if="campaign.failedCount === 0"> ✓</span><span v-else> ⚠️</span>
                      </span>
                    </div>
                  </div>
                  <div class="campaign-card-actions">
                    <button type="button" class="secondary-action" @click="duplicateCampaign(campaign)">
                      Duplicate
                    </button>
                    <button type="button" class="secondary-action" @click="setEmailTab('campaigns')">
                      View
                    </button>
                  </div>
                </article>
              </div>
              <div v-else class="empty-note overview-empty-state">
                <span class="overview-empty-badge">No campaigns yet</span>
                <div class="overview-empty-copy">
                  <h3>Your first send starts here</h3>
                  <p>Start with one focused list, preview the message, and send a small test before scaling.</p>
                </div>
                <div class="overview-empty-actions">
                  <button type="button" class="primary-action overview-empty-button" @click="setEmailTab('campaigns')">
                    Create your first campaign
                  </button>
                  <button type="button" class="secondary-action overview-empty-button" @click="setEmailTab('contacts')">
                    Import contacts first
                  </button>
                </div>
              </div>
            </article>

            <article class="workspace-card overview-status-card">
              <div class="panel-header">
                <div>
                  <p class="panel-meta">System status</p>
                  <h2>Sender and deliverability</h2>
                </div>
              </div>

              <div class="status-summary-grid">
                <article class="status-summary-card">
                  <span>Sender</span>
                  <strong>{{ senderIdentitySummary }}</strong>
                </article>
                <article class="status-summary-card">
                  <span>Verification</span>
                  <strong>{{ verificationStatusSummary }}</strong>
                </article>
                <article class="status-summary-card">
                  <span>Domain health</span>
                  <strong>{{ domainHealthSummary }}</strong>
                </article>
              </div>

              <div class="overview-domain-status">
                <span class="workspace-chip">{{ domainStatusSummary }}</span>
                <p class="workspace-description compact">
                  {{
                    hasConfiguredDomain
                      ? `${domainSettings?.fromName || "Your brand"} sends from ${domainSettings?.fromEmail || domainSettings?.domainName}.`
                      : "Finish sender setup before you rely on campaigns."
                  }}
                </p>
              </div>

              <div v-if="systemWarnings.length > 0" class="status-warning-stack">
                <p class="panel-meta secondary-panel-meta">Warnings</p>
                <ul class="status-warning-list">
                  <li v-for="warning in systemWarnings" :key="warning">{{ warning }}</li>
                </ul>
              </div>
            </article>
          </section>
        </section>

        <section v-else-if="activeEmailTab === 'campaigns'" class="workspace-card">
          <div class="panel-header">
            <div>
              <p class="panel-meta">Campaigns</p>
              <h2>{{ campaignComposerOpen ? campaignComposerTitle : "Campaign dashboard" }}</h2>
              <p class="panel-note">
                {{
                  campaignComposerOpen
                    ? "Subject, body, audience. Advanced options stay hidden until you need them."
                    : "Search, filter, and act on campaigns from one dense list."
                }}
              </p>
            </div>
            <div class="workspace-actions">
              <button
                v-if="campaignComposerOpen"
                type="button"
                class="secondary-action"
                :disabled="isCreatingCampaign"
                @click="closeCampaignComposer"
              >
                Back to campaigns
              </button>
              <button
                v-else
                type="button"
                class="primary-action"
                :disabled="!hasConfiguredDomain"
                @click="openNewCampaign()"
              >
                New Email
              </button>
              <button
                v-if="!campaignComposerOpen"
                type="button"
                class="secondary-action"
                @click="setEmailTab('settings')"
              >
                Sender settings
              </button>
            </div>
          </div>

          <template v-if="campaignComposerOpen">
            <section class="email-composer-intent-panel">
              <div class="panel-header compact">
                <div>
                  <p class="panel-meta">What do you want to send?</p>
                  <strong>{{ campaignComposerIntentSelection.label }}</strong>
                  <p class="panel-note">{{ campaignComposerIntentSelection.description }}</p>
                </div>
              </div>
              <div class="campaign-source-mode-row">
                <button
                  v-for="option in CAMPAIGN_INTENT_OPTIONS"
                  :key="option.value"
                  type="button"
                  class="workspace-secondary-button compact"
                  :class="{ active: campaignIntent === option.value }"
                  @click="setCampaignIntent(option.value)"
                >
                  {{ option.label }}
                </button>
              </div>
            </section>

            <div class="email-composer-grid">
              <div class="email-composer-main">
                <select v-model="campaignForm.listId" class="workspace-select full-width">
                  <option value="" disabled>Select audience</option>
                  <option v-for="list in emailLists" :key="list.id" :value="list.id">
                    {{ list.name }}
                  </option>
                </select>

                <div class="campaign-audience-card">
                  <div class="campaign-audience-header">
                    <div>
                      <strong>{{ selectedCampaignList?.name || "Choose a list to target" }}</strong>
                      <p class="panel-note">{{ selectedCampaignAudienceSummary }}</p>
                    </div>
                    <span v-if="selectedCampaignList" class="workspace-chip">
                      {{ selectedCampaignAudienceCount.toLocaleString() }} contacts
                    </span>
                  </div>
                </div>

                <input v-model="campaignForm.subject" class="workspace-input" placeholder="Subject line" />

                <section class="email-block-composer">
                  <div class="email-block-composer-header">
                    <div>
                      <p class="panel-meta">Email blocks</p>
                      <h3>Compose the message without raw markup</h3>
                      <p class="panel-note">Add sections, edit the content, and let the system render the HTML email.</p>
                    </div>
                  </div>

                  <div class="email-block-library">
                    <button
                      v-for="entry in EMAIL_COMPOSER_BLOCK_LIBRARY"
                      :key="entry.type"
                      type="button"
                      class="workspace-secondary-button compact"
                      @click="appendCampaignBlock(entry.type)"
                    >
                      Add {{ entry.label }}
                    </button>
                  </div>

                  <p v-if="campaignBlocks.length === 0" class="panel-note">
                    Start with a hero or paragraph block. The email body is built from these sections automatically.
                  </p>

                  <div v-else class="email-block-stack">
                    <article v-for="(block, index) in campaignBlocks" :key="block.id" class="email-block-card">
                      <div class="email-block-card-header">
                        <div class="email-block-card-copy">
                          <p class="panel-meta">{{ formatEmailComposerBlockLabel(block.type) }}</p>
                          <strong>{{ summarizeEmailComposerBlock(block) }}</strong>
                        </div>

                        <div class="email-block-card-actions">
                          <button
                            type="button"
                            class="workspace-secondary-button compact"
                            :disabled="index === 0"
                            @click="moveCampaignBlock(block.id, 'up')"
                          >
                            Up
                          </button>
                          <button
                            type="button"
                            class="workspace-secondary-button compact"
                            :disabled="index === campaignBlocks.length - 1"
                            @click="moveCampaignBlock(block.id, 'down')"
                          >
                            Down
                          </button>
                          <button
                            type="button"
                            class="workspace-secondary-button compact"
                            @click="removeCampaignBlock(block.id)"
                          >
                            Remove
                          </button>
                        </div>
                      </div>

                      <template v-if="block.type === 'paragraph'">
                        <textarea
                          v-model="block.text"
                          class="workspace-textarea compact"
                          placeholder="Write the paragraph copy here."
                        />
                      </template>

                      <template v-else-if="block.type === 'cta_button'">
                        <div class="email-block-field-grid two-up">
                          <input v-model="block.label" class="workspace-input" placeholder="Button label" />
                          <input v-model="block.url" class="workspace-input" placeholder="https://your-link.com" />
                        </div>
                      </template>

                      <template v-else-if="block.type === 'feature_list'">
                        <div class="email-block-field-grid">
                          <input v-model="block.title" class="workspace-input" placeholder="Section title" />
                          <textarea
                            v-model="block.itemsText"
                            class="workspace-textarea compact"
                            placeholder="One feature or benefit per line."
                          />
                        </div>
                      </template>

                      <template v-else>
                        <div class="email-block-field-grid">
                          <input v-model="block.headline" class="workspace-input" placeholder="Headline" />
                          <textarea
                            v-model="block.body"
                            class="workspace-textarea compact"
                            placeholder="Supporting copy"
                          />
                          <div class="email-block-field-grid two-up">
                            <input v-model="block.buttonLabel" class="workspace-input" placeholder="Button label" />
                            <input v-model="block.buttonUrl" class="workspace-input" placeholder="https://your-link.com" />
                          </div>
                        </div>
                      </template>
                    </article>
                  </div>
                </section>

                <div class="workspace-actions">
                  <p v-if="campaignSendBlockReason" class="inline-form-message warning">
                    {{ campaignSendBlockReason }}
                  </p>
                  <button
                    type="button"
                    class="primary-action"
                    :disabled="isCreatingCampaign || Boolean(campaignSendBlockReason)"
                    :title="campaignSendBlockReason || undefined"
                    @click="void createCampaign(true)"
                  >
                    {{ campaignComposerPrimaryLabel }}
                  </button>
                  <button
                    type="button"
                    class="secondary-action"
                    :disabled="isCreatingCampaign"
                    @click="void createCampaign(false)"
                  >
                    {{ campaignComposerSecondaryLabel }}
                  </button>
                </div>

                <article class="workspace-card email-composer-advanced-toggle">
                  <div>
                    <p class="panel-meta">Advanced settings</p>
                    <p class="panel-note">Open raw markup, links, and optional media only when this draft needs more control.</p>
                  </div>
                  <button
                    type="button"
                    class="workspace-secondary-button compact"
                    @click="campaignAdvancedOpen = !campaignAdvancedOpen"
                  >
                    {{ campaignAdvancedOpen ? "Hide advanced settings" : "Show advanced settings" }}
                  </button>
                </article>
              </div>

              <aside class="email-composer-sidebar">
                <section class="workspace-card email-preview-sidebar-card">
                  <div class="email-preview-sidebar-header">
                    <div>
                      <p class="panel-meta">Preview</p>
                      <h3>{{ campaignForm.subject || "Add a subject line" }}</h3>
                      <p class="panel-note">Mobile preview stays visible while you write.</p>
                    </div>
                    <span class="workspace-chip">Mobile</span>
                  </div>

                  <div class="email-mobile-preview-shell">
                    <div class="email-mobile-preview-device">
                      <div class="email-mobile-preview-notch" aria-hidden="true"></div>

                      <div class="email-mobile-preview-screen">
                        <div class="email-mobile-preview-message-header">
                          <div class="email-mobile-preview-avatar" aria-hidden="true">
                            {{ (senderIdentitySummary || "E").slice(0, 1).toUpperCase() }}
                          </div>
                          <div class="email-mobile-preview-message-copy">
                            <span>From</span>
                            <strong>{{ senderIdentitySummary }}</strong>
                            <p>{{ hasConfiguredDomain ? domainStatusSummary : "Finish sender setup before sending." }}</p>
                          </div>
                        </div>

                        <div class="email-preview-frame email-preview-frame-mobile" v-html="previewEmailHtml"></div>
                      </div>
                    </div>
                  </div>
                </section>

                <section class="workspace-card email-footer-sidebar-card">
                  <div class="email-footer-sidebar-copy">
                    <p class="panel-meta">Footer and legal</p>
                    <h3>Change the sign-off, logo, and business address</h3>
                    <p class="panel-note">
                      Replace personal footer copy like “Jenny / Founder @ Daycare Spots” with the brand logo,
                      business address, website, and compliance details right from the editor.
                    </p>
                  </div>

                  <div class="email-footer-sidebar-actions">
                    <button
                      type="button"
                      class="workspace-secondary-button compact"
                      @click="toggleSignature"
                    >
                      {{ campaignForm.includeSignature ? "Hide footer on this email" : "Include footer on this email" }}
                    </button>
                    <button
                      type="button"
                      class="workspace-secondary-button compact"
                      :disabled="isSavingFooterLogo"
                      @click="isFooterLogoPickerOpen = true"
                    >
                      {{ effectiveFooterLogoUrl ? "Replace footer logo" : "Select footer logo" }}
                    </button>
                    <button
                      v-if="effectiveFooterLogoUrl"
                      type="button"
                      class="workspace-secondary-button compact"
                      :disabled="isSavingFooterLogo"
                      @click="void clearFooterLogo()"
                    >
                      {{ isSavingFooterLogo ? "Removing..." : "Remove logo" }}
                    </button>
                  </div>

                  <p class="panel-note email-footer-state-note">{{ footerDetailsStatusText }}</p>

                  <article v-if="footerPreviewHtml" class="signature-preview-card footer-preview-inline-card">
                    <div class="footer-preview-html" v-html="footerPreviewHtml"></div>
                  </article>

                  <div class="email-footer-form-grid">
                    <label class="domain-field email-footer-editor-field is-full">
                      <span>Sign-off</span>
                      <textarea
                        v-model="domainForm.footer.signoff"
                        class="workspace-textarea compact"
                        placeholder="Sincerely,
Daycare Spots"
                      />
                    </label>

                    <label class="domain-field email-footer-editor-field">
                      <span>Business name</span>
                      <input
                        v-model="domainForm.footer.businessName"
                        class="workspace-input"
                        placeholder="Daycare Spots"
                      />
                    </label>

                    <label class="domain-field email-footer-editor-field">
                      <span>Website</span>
                      <input
                        v-model="domainForm.footer.websiteUrl"
                        class="workspace-input"
                        placeholder="https://www.daycarespots.com"
                      />
                    </label>

                    <label class="domain-field email-footer-editor-field">
                      <span>Support email</span>
                      <input
                        v-model="domainForm.footer.supportEmail"
                        class="workspace-input"
                        placeholder="info@daycarespots.com"
                      />
                    </label>

                    <label class="domain-field email-footer-editor-field">
                      <span>Street address</span>
                      <input
                        v-model="domainForm.footer.streetAddress"
                        class="workspace-input"
                        placeholder="1312 17th Street Suite 860"
                      />
                    </label>

                    <label class="domain-field email-footer-editor-field">
                      <span>Address line 2</span>
                      <input
                        v-model="domainForm.footer.addressLine2"
                        class="workspace-input"
                        placeholder="Building, floor, or landmark"
                      />
                    </label>

                    <label class="domain-field email-footer-editor-field">
                      <span>City</span>
                      <input v-model="domainForm.footer.city" class="workspace-input" placeholder="Denver" />
                    </label>

                    <label class="domain-field email-footer-editor-field">
                      <span>State</span>
                      <input v-model="domainForm.footer.state" class="workspace-input" placeholder="CO" />
                    </label>

                    <label class="domain-field email-footer-editor-field">
                      <span>Postal code</span>
                      <input v-model="domainForm.footer.postalCode" class="workspace-input" placeholder="80202" />
                    </label>

                    <label class="domain-field email-footer-editor-field">
                      <span>Country</span>
                      <input v-model="domainForm.footer.country" class="workspace-input" placeholder="US" />
                    </label>

                    <div class="email-footer-social-grid is-full">
                      <label
                        v-for="platform in EMAIL_FOOTER_SOCIAL_PLATFORMS"
                        :key="`footer-social-${platform}`"
                        class="domain-field email-footer-editor-field"
                      >
                        <span>{{ EMAIL_FOOTER_SOCIAL_LABELS[platform] }}</span>
                        <input
                          v-model="domainForm.footer.socialLinks[platform]"
                          class="workspace-input"
                          :placeholder="`${EMAIL_FOOTER_SOCIAL_LABELS[platform]} handle or URL`"
                        />
                      </label>
                    </div>

                    <label class="domain-field footer-details-field email-footer-editor-field is-full">
                      <span>Additional footer note</span>
                      <textarea
                        v-model="domainForm.footer.additionalText"
                        class="workspace-textarea compact"
                        :placeholder="footerDetailsPlaceholderText"
                      />
                      <small>
                        Use this for compliance copy, legal notes, or anything you want to appear below the address and social links.
                      </small>
                    </label>
                  </div>

                  <p v-if="domainSaveErrorMessage" class="inline-form-message error">{{ domainSaveErrorMessage }}</p>

                  <div class="email-footer-sidebar-footer">
                    <button
                      type="button"
                      class="primary-action"
                      :disabled="!canSaveDomainSetup"
                      :title="domainValidationMessage || undefined"
                      @click="void saveFooterDefaults()"
                    >
                      {{
                        isSavingDomain
                          ? "Saving..."
                          : hasConfiguredDomain
                            ? "Save footer defaults"
                            : "Save sender + footer defaults"
                      }}
                    </button>
                    <span v-if="hasPendingDomainSetupChanges" class="workspace-chip">Unsaved footer changes</span>
                  </div>
                </section>
              </aside>
            </div>

            <section v-if="campaignAdvancedOpen" class="email-media-panel">
              <div class="panel-header">
                <div>
                  <p class="panel-meta">Advanced</p>
                  <h3>Raw markup, links, and optional media</h3>
                  <p class="panel-note">Keep this light. Use visuals only when they help the message.</p>
                </div>
              </div>

              <div class="email-editor-toolbar">
                <button type="button" class="workspace-secondary-button compact" @click="appendCampaignBlock('paragraph')">
                  Add paragraph
                </button>
                <button type="button" class="workspace-secondary-button compact" @click="insertLinkPlaceholder">
                  Insert link
                </button>
                <button type="button" class="workspace-secondary-button compact" @click="insertCtaButtonPlaceholder">
                  Insert CTA button
                </button>
                <button type="button" class="workspace-secondary-button compact" @click="insertHeroAnnouncementBlock">
                  Insert hero
                </button>
                <button type="button" class="workspace-secondary-button compact" @click="insertFeatureListBlock">
                  Insert feature list
                </button>
                <button type="button" class="workspace-secondary-button compact" @click="insertCtaSectionBlock">
                  Insert CTA section
                </button>
                <button
                  type="button"
                  class="workspace-secondary-button compact"
                  :class="{ active: campaignEditorMode === 'edit' }"
                  @click="campaignEditorMode = campaignEditorMode === 'edit' ? 'preview' : 'edit'"
                >
                  {{ campaignEditorMode === "edit" ? "Hide raw markup" : "Edit raw markup" }}
                </button>
              </div>

              <div v-if="campaignEditorMode === 'edit'" class="email-raw-editor">
                <div>
                  <p class="panel-meta">Raw body markup</p>
                  <p class="panel-note">Optional. Editing this text updates the block composer above.</p>
                </div>
                <textarea
                  v-model="campaignForm.bodyText"
                  class="workspace-textarea compact"
                  placeholder="Use raw email block syntax if you need direct control."
                />
              </div>

              <div class="email-media-input-row">
                <input
                  v-model="campaignForm.mediaUrlInput"
                  class="workspace-input toolbar-input"
                  placeholder="Paste an image URL"
                />
                <button type="button" class="secondary-action" @click="addManualMediaUrl('header')">
                  Use as header
                </button>
                <button type="button" class="secondary-action" @click="addManualMediaUrl('inline')">
                  Add inline
                </button>
                <button type="button" class="secondary-action" @click="isWorkspaceAssetPickerOpen = true">
                  Use workspace asset
                </button>
                <label class="workspace-secondary-button compact media-upload-trigger" :class="{ disabled: !activationSourcePostId || isUploadingDraftMedia }">
                  <input
                    class="media-upload-input"
                    type="file"
                    accept="image/png,image/jpeg,image/gif"
                    multiple
                    :disabled="!activationSourcePostId || isUploadingDraftMedia"
                    @change="handleEmailMediaSelection"
                  />
                  {{ isUploadingDraftMedia ? "Uploading..." : "Upload image" }}
                </label>
              </div>

              <div v-if="availableDraftImages.length > 0" class="draft-media-picker">
                <p class="panel-meta">From the source post</p>
                <div class="draft-media-grid">
                  <article v-for="image in availableDraftImages" :key="image.id" class="draft-media-card">
                    <img :src="image.url" :alt="image.label" class="draft-media-preview" />
                    <div class="draft-media-actions">
                      <button type="button" class="workspace-secondary-button compact" @click="useHeaderImage(image.url)">
                        Banner
                      </button>
                      <button
                        type="button"
                        class="workspace-secondary-button compact"
                        :class="{ active: campaignForm.inlineImageUrls.includes(image.url) }"
                        @click="toggleInlineImage(image.url)"
                      >
                        {{ campaignForm.inlineImageUrls.includes(image.url) ? "Inline added" : "Add inline" }}
                      </button>
                    </div>
                  </article>
                </div>
              </div>

              <p v-else-if="isLoadingDraftMedia" class="panel-note">Loading draft media...</p>
              <p v-else class="panel-note">No draft media loaded. This email can stay text-first.</p>

              <div v-if="campaignForm.headerImageUrl" class="selected-media-stack">
                <p class="panel-meta">Header image</p>
                <article class="selected-media-card">
                  <img :src="campaignForm.headerImageUrl" alt="Header image" class="selected-media-preview" />
                  <button type="button" class="workspace-secondary-button compact" @click="campaignForm.headerImageUrl = ''">
                    Remove
                  </button>
                </article>
              </div>

              <div v-if="selectedInlineImagePreviews.length > 0" class="selected-media-stack">
                <p class="panel-meta">Inline images</p>
                <div class="draft-media-grid">
                  <article v-for="image in selectedInlineImagePreviews" :key="image.id" class="selected-media-card">
                    <img :src="image.url" alt="Inline email image" class="selected-media-preview" />
                    <div class="selected-media-actions">
                      <button
                        type="button"
                        class="workspace-secondary-button compact"
                        @click="moveInlineImage(image.url, 'up')"
                      >
                        Move up
                      </button>
                      <button
                        type="button"
                        class="workspace-secondary-button compact"
                        @click="moveInlineImage(image.url, 'down')"
                      >
                        Move down
                      </button>
                      <button type="button" class="workspace-secondary-button compact" @click="toggleInlineImage(image.url)">
                        Remove
                      </button>
                    </div>
                  </article>
                </div>
              </div>

              <WorkspaceAssetPickerModal
                :open="isWorkspaceAssetPickerOpen"
                :business-id="selectedBusinessId"
                asset-type="image"
                multiple
                title="Use workspace assets in this email"
                @close="isWorkspaceAssetPickerOpen = false"
                @select="void attachWorkspaceAssetsToEmail($event)"
              />
            </section>
          </template>

          <template v-else>
            <div class="campaign-dashboard-toolbar">
              <input
                v-model="campaignSearch"
                class="workspace-input toolbar-input"
                placeholder="Search campaigns"
              />
              <select v-model="campaignStatusFilter" class="workspace-select toolbar-select">
                <option value="all">All statuses</option>
                <option value="draft">Draft</option>
                <option value="queued">Queued</option>
                <option value="sending">Sending</option>
                <option value="sent">Sent</option>
                <option value="failed">Failed</option>
              </select>
              <select v-model="campaignSort" class="workspace-select toolbar-select">
                <option value="updated_desc">Newest activity</option>
                <option value="last_send_desc">Last sent</option>
                <option value="name_asc">Name</option>
                <option value="status">Status</option>
              </select>
            </div>

            <div v-if="filteredCampaigns.length > 0" class="campaign-table-shell">
              <table class="campaign-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Status</th>
                    <th>Audience</th>
                    <th>Sent</th>
                    <th>Delivered</th>
                    <th>Failed</th>
                    <th>Last activity</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="campaign in filteredCampaigns" :key="campaign.id">
                    <td>
                      <div class="campaign-table-name">
                        <strong>{{ campaign.name }}</strong>
                        <span>{{ campaign.subject }}</span>
                      </div>
                    </td>
                    <td>
                      <span class="workspace-chip campaign-status-chip" :class="getCampaignStatusChipClass(campaign)">
                        {{ formatCampaignStatusChipLabel(campaign) }}
                      </span>
                    </td>
                    <td>{{ resolveCampaignAudienceSize(campaign).toLocaleString() }}</td>
                    <td>{{ campaign.sentCount.toLocaleString() }}</td>
                    <td>{{ campaign.deliveredCount.toLocaleString() }}</td>
                    <td>{{ campaign.failedCount.toLocaleString() }}</td>
                    <td>{{ formatCampaignLastSendSummary(campaign) || formatCampaignLifecycleLabel(campaign) }}</td>
                    <td>
                      <div class="campaign-table-actions">
                        <button
                          type="button"
                          class="secondary-action"
                          :disabled="!canEditCampaign(campaign)"
                          @click="editCampaign(campaign)"
                        >
                          Edit
                        </button>
                        <button type="button" class="secondary-action" @click="duplicateCampaign(campaign)">
                          Duplicate
                        </button>
                        <button
                          type="button"
                          class="secondary-action"
                          :disabled="!canDeleteCampaign(campaign) || deletingCampaignId === campaign.id"
                          @click="void deleteCampaign(campaign)"
                        >
                          {{ deletingCampaignId === campaign.id ? "Deleting..." : "Delete" }}
                        </button>
                        <button
                          type="button"
                          class="secondary-action"
                          :disabled="isSending || !hasConfiguredDomain || campaign.status === 'queued' || campaign.status === 'sending' || campaign.status === 'sent'"
                          :title="!hasConfiguredDomain ? 'Finish sender setup before sending.' : undefined"
                          @click="sendCampaign(campaign)"
                        >
                          {{ getCampaignActionLabel(campaign) }}
                        </button>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div v-else class="empty-note overview-empty-state">
              <span class="overview-empty-badge">No campaigns yet</span>
              <div class="overview-empty-copy">
                <h3>Start with one clean email</h3>
                <p>Create the draft, pick the audience, and send without configuring every detail each time.</p>
              </div>
              <div class="overview-empty-actions">
                <button type="button" class="primary-action overview-empty-button" @click="openNewCampaign()">
                  New Email
                </button>
                <button type="button" class="secondary-action overview-empty-button" @click="setEmailTab('contacts')">
                  Import contacts
                </button>
              </div>
            </div>

            <div v-if="latestStats" class="stats-strip">
              <span>Sent: {{ latestStats.sentCount }}</span>
              <span>Delivered: {{ latestStats.deliveredCount }}</span>
              <span>Failed: {{ latestStats.failedCount }}</span>
              <span>Unsubscribed: {{ latestStats.unsubscribedCount }}</span>
            </div>
          </template>
        </section>

        <section v-else-if="activeEmailTab === 'contacts'" class="workspace-card">
          <div class="panel-header">
            <div>
              <p class="panel-meta">Contacts</p>
              <h2>Import and manage your launch audience</h2>
                <p class="panel-note">
                  {{ currentBusinessMembership?.business.name || "No workspace selected" }}
                </p>
              </div>
          </div>

          <div class="contact-import-stack">
            <div class="contact-import-inputs">
              <input
                v-model="contactImport.listName"
                class="workspace-input"
                placeholder="Optional fallback list"
              />
              <p class="panel-note">
                If your CSV includes a <strong>Lists</strong> column, audience groups are created automatically.
              </p>

              <div class="contact-upload-row">
                <label class="secondary-action contact-upload-button">
                  <input
                    class="contact-upload-input"
                    type="file"
                    accept=".csv,text/csv"
                    @change="handleContactFileSelection"
                  />
                  Upload CSV
                </label>
                <span class="panel-note">
                  {{ contactImportFileName || "Or paste rows below. We will auto-detect columns." }}
                </span>
              </div>

              <textarea
                v-model="contactImport.csvText"
                class="workspace-textarea compact"
                placeholder="email,name,lists&#10;founder@yourbrand.com, Founder, Launch List; Premium Users"
              />
            </div>

            <div v-if="contactImportPreview" class="contact-preview-panel">
              <div class="contact-preview-summary">
                <article class="workspace-card contact-preview-stat">
                  <span>Total rows</span>
                  <strong>{{ contactImportPreview.summary.totalRows }}</strong>
                </article>
                <article class="workspace-card contact-preview-stat">
                  <span>Valid</span>
                  <strong>{{ contactImportPreview.summary.validRows }}</strong>
                </article>
                <article class="workspace-card contact-preview-stat">
                  <span>Invalid</span>
                  <strong>{{ contactImportPreview.summary.invalidRows }}</strong>
                </article>
                <article class="workspace-card contact-preview-stat">
                  <span>Existing</span>
                  <strong>{{ contactImportPreview.summary.existingContacts }}</strong>
                </article>
              </div>

              <div class="contact-mapping-grid">
                <label
                  v-for="field in CONTACT_IMPORT_FIELDS"
                  :key="field.field"
                  class="contact-mapping-field"
                >
                  <span>{{ field.label }}<small v-if="field.required">Required</small></span>
                  <select v-model="contactImportMapping[field.field]">
                    <option value="">Ignore</option>
                    <option
                      v-for="column in contactImportColumns"
                      :key="`${field.field}-${column}`"
                      :value="column"
                    >
                      {{ column }}
                    </option>
                  </select>
                </label>
              </div>

              <div class="contact-import-mode-row">
                <button
                  type="button"
                  class="workspace-secondary-button compact"
                  :class="{ active: contactImportDuplicateStrategy === 'upsert' }"
                  @click="contactImportDuplicateStrategy = 'upsert'"
                >
                  Update existing
                </button>
                <button
                  type="button"
                  class="workspace-secondary-button compact"
                  :class="{ active: contactImportDuplicateStrategy === 'skip' }"
                  @click="contactImportDuplicateStrategy = 'skip'"
                >
                  Skip duplicates
                </button>
              </div>

              <div class="contact-preview-table">
                <div class="contact-preview-row contact-preview-head">
                  <span>Email</span>
                  <span>Name</span>
                  <span>Lists</span>
                  <span>Attributes</span>
                  <span>Tags</span>
                  <span>Issues</span>
                </div>
                <div
                  v-for="(row, index) in contactImportPreview.previewRows"
                  :key="`preview-${index}`"
                  class="contact-preview-row"
                >
                  <span>{{ row.email || "—" }}</span>
                  <span>{{ row.name || [row.firstName, row.lastName].filter(Boolean).join(' ') || "—" }}</span>
                  <span>{{ row.lists.join(", ") || contactImport.listName || "—" }}</span>
                  <span>{{ buildContactAttributeSummary(row.attributes) || "—" }}</span>
                  <span>{{ row.tags.join(", ") || "—" }}</span>
                  <span>{{ row.issues.join(", ") || "Looks good" }}</span>
                </div>
              </div>
            </div>
          </div>

          <div class="workspace-actions">
            <button
              type="button"
              class="secondary-action"
              :disabled="isPreviewingContacts || !canPreviewContacts"
              @click="previewContactsImport"
            >
              {{ isPreviewingContacts ? "Previewing..." : contactImportPreview ? "Refresh preview" : "Preview import" }}
            </button>
            <button type="button" class="primary-action" :disabled="isImporting || !canImportContacts" @click="importContacts">
              {{ isImporting ? "Importing..." : "Import contacts" }}
            </button>
          </div>

          <article v-if="activeImportJob" class="workspace-card contact-job-card">
            <div class="panel-header">
              <div>
                <p class="panel-meta">Latest import</p>
                <h3>{{ activeImportJob.listName }}</h3>
                <p class="panel-note">
                  {{ formatStatus(activeImportJob.status) }}
                  <span v-if="activeImportJob.fileName"> · {{ activeImportJob.fileName }}</span>
                </p>
              </div>
              <span class="workspace-chip">{{ formatImportProgress(activeImportJob) }}</span>
            </div>

            <div class="campaign-progress import-progress">
              <span
                class="campaign-progress-fill"
                :style="{ width: `${getImportProgressPercent(activeImportJob)}%` }"
              ></span>
            </div>

            <div class="stats-strip">
              <span>Inserted: {{ activeImportJob.insertedCount }}</span>
              <span>Updated: {{ activeImportJob.updatedCount }}</span>
              <span>Skipped: {{ activeImportJob.skippedCount }}</span>
              <span>Errors: {{ activeImportJob.errorCount }}</span>
            </div>

            <ul v-if="activeImportJob.errorSummary.length > 0" class="import-error-summary">
              <li v-for="(entry, index) in activeImportJob.errorSummary" :key="`${activeImportJob.id}-${index}`">
                {{ entry.message }}<span v-if="entry.rowCount"> · {{ entry.rowCount }} rows</span>
              </li>
            </ul>
          </article>

          <ul v-if="emailLists.length > 0" class="list-summary">
            <li v-for="list in emailLists" :key="list.id">
              {{ list.name }} · {{ list.contactCount }} contacts
            </li>
          </ul>
          <div v-else class="empty-note">
            No lists yet. Import a CSV and we will create audience groups from your file automatically.
          </div>

          <section class="contact-directory">
            <div class="panel-header">
              <div>
                <p class="panel-meta">Contact directory</p>
                <h3>{{ emailContactsTotal }} matching contacts</h3>
                <p class="panel-note">
                  Active {{ contactCoverageSummary.active }} · Unsubscribed {{ contactCoverageSummary.unsubscribed }} ·
                  Suppressed {{ contactCoverageSummary.suppressed }}
                </p>
              </div>
            </div>

            <article v-if="editingContact" class="workspace-card contact-editor-card">
              <div class="panel-header compact">
                <div>
                  <p class="panel-meta">Edit contact</p>
                  <h3>{{ editingContact.email }}</h3>
                </div>
                <span class="workspace-chip">{{ formatStatus(editingContact.status) }}</span>
              </div>

              <div class="contact-editor-grid">
                <label class="contact-editor-field">
                  <span>Email</span>
                  <input v-model="contactForm.email" class="workspace-input" type="email" placeholder="founder@yourbrand.com" />
                </label>
                <label class="contact-editor-field">
                  <span>Status</span>
                  <select v-model="contactForm.status" class="workspace-select">
                    <option value="active">Active</option>
                    <option value="unsubscribed">Unsubscribed</option>
                    <option value="bounced">Bounced</option>
                    <option value="complained">Complained</option>
                    <option value="suppressed">Suppressed</option>
                  </select>
                </label>
                <label class="contact-editor-field">
                  <span>First name</span>
                  <input v-model="contactForm.firstName" class="workspace-input" placeholder="Abhishek" />
                </label>
                <label class="contact-editor-field">
                  <span>Last name</span>
                  <input v-model="contactForm.lastName" class="workspace-input" placeholder="Jha" />
                </label>
              </div>

              <div class="contact-editor-actions">
                <button
                  type="button"
                  class="primary-action"
                  :disabled="isSavingContact"
                  @click="saveContactEdits"
                >
                  {{ isSavingContact ? "Saving..." : "Save contact" }}
                </button>
                <button type="button" class="workspace-secondary-button" :disabled="isSavingContact" @click="cancelContactEdit">
                  Cancel
                </button>
              </div>
            </article>

            <div class="contact-directory-toolbar">
              <input
                v-model="contactSearch"
                class="workspace-input toolbar-input"
                placeholder="Search contacts"
              />
              <select v-model="contactStatusFilter" class="workspace-select toolbar-select">
                <option value="all">All statuses</option>
                <option value="active">Active</option>
                <option value="unsubscribed">Unsubscribed</option>
                <option value="bounced">Bounced</option>
                <option value="complained">Complained</option>
                <option value="suppressed">Suppressed</option>
              </select>
              <select v-model="contactStateFilter" class="workspace-select toolbar-select">
                <option value="all">All states</option>
                <option v-for="state in contactStateOptions" :key="`state-${state}`" :value="state">{{ state }}</option>
              </select>
              <select v-model="contactPlanFilter" class="workspace-select toolbar-select">
                <option value="all">All plans</option>
                <option v-for="plan in contactPlanOptions" :key="`plan-${plan}`" :value="plan">{{ plan }}</option>
              </select>
              <select v-model="contactTagFilter" class="workspace-select toolbar-select">
                <option value="all">All tags</option>
                <option v-for="tag in contactTagOptions" :key="`tag-${tag}`" :value="tag">{{ tag }}</option>
              </select>
            </div>

            <div v-if="filteredContacts.length > 0" class="contact-directory-table">
              <div class="contact-directory-row contact-directory-head">
                <span>Email</span>
                <span>Name</span>
                <span>Status</span>
                <span>State</span>
                <span>Plan</span>
                <span>Tags</span>
                <span>Updated</span>
                <span>Actions</span>
              </div>
              <div
                v-for="contact in filteredContacts"
                :key="contact.id"
                class="contact-directory-row"
              >
                <span>{{ contact.email }}</span>
                <span>{{ [contact.firstName, contact.lastName].filter(Boolean).join(" ") || "—" }}</span>
                <span>{{ formatStatus(contact.status) }}</span>
                <span>{{ contact.attributes.state || "—" }}</span>
                <span>{{ contact.attributes.plan || "—" }}</span>
                <span>{{ contact.tags.join(", ") || "—" }}</span>
                <span>{{ contact.updatedAt ? new Date(contact.updatedAt).toLocaleDateString() : "—" }}</span>
                <div class="contact-directory-actions">
                  <button type="button" class="workspace-secondary-button compact" @click="startEditContact(contact)">
                    Edit
                  </button>
                  <button
                    type="button"
                    class="workspace-secondary-button compact danger"
                    :disabled="deletingContactId === contact.id"
                    @click="deleteContact(contact)"
                  >
                    {{ deletingContactId === contact.id ? "Deleting..." : "Delete" }}
                  </button>
                </div>
              </div>
            </div>
            <p v-else class="empty-note">
              {{ emailContacts.length > 0 ? "No contacts match the current filter." : "No contacts yet. Queue an import to populate this workspace." }}
            </p>
          </section>
        </section>

        <section v-else class="workspace-card domain-card">
          <div class="panel-header">
            <div>
              <p class="panel-meta">Settings</p>
              <h2>{{ hasConfiguredDomain && !isEditingDomainSetup ? "Branded sender connected" : "Email sender setup" }}</h2>
            </div>
          </div>

          <div v-if="hasConfiguredDomain && !isEditingDomainSetup" class="domain-summary-card">
            <div class="workspace-chip-row">
              <span class="workspace-chip">{{ domainStatusSummary }}</span>
              <span class="workspace-chip">Domain: {{ formatStatus(domainSettings?.domainStatus) }}</span>
              <span class="workspace-chip">DKIM: {{ formatStatus(domainSettings?.dkimStatus) }}</span>
              <span class="workspace-chip">SPF: {{ spfReadinessSummary }}</span>
            </div>

            <div class="domain-summary-grid">
              <div>
                <span class="domain-summary-label">Domain</span>
                <strong>{{ domainSettings?.domainName }}</strong>
              </div>
              <div>
                <span class="domain-summary-label">From name</span>
                <strong>{{ domainSettings?.fromName || "Not set" }}</strong>
              </div>
              <div>
                <span class="domain-summary-label">From email</span>
                <strong>{{ domainSettings?.fromEmail || "Not set" }}</strong>
              </div>
              <div>
                <span class="domain-summary-label">Reply-to</span>
                <strong>{{ domainSettings?.replyToEmail || "Not set" }}</strong>
              </div>
              <div>
                <span class="domain-summary-label">Footer logo</span>
                <div v-if="effectiveFooterLogoUrl" class="domain-summary-logo-preview">
                  <img :src="effectiveFooterLogoUrl" :alt="effectiveFooterLogoAltText" />
                </div>
                <strong>{{ effectiveFooterLogoUrl ? "Saved for future emails" : "Not set" }}</strong>
              </div>
              <div>
                <span class="domain-summary-label">Footer details</span>
                <div v-if="footerPreviewHtml" class="domain-summary-footer-preview footer-preview-html" v-html="footerPreviewHtml"></div>
                <strong v-else>Uses sender identity</strong>
              </div>
            </div>

            <div class="workspace-actions">
              <button type="button" class="secondary-action" @click="isEditingDomainSetup = true">
                Edit domain setup
              </button>
            </div>
          </div>
          <template v-else>
            <p class="workspace-description compact">
              {{
                hasConfiguredDomain
                  ? "Update the saved sender setup. The current values are already persisted for this workspace."
                  : "Paste a website URL, a root domain, or a branded sender email. We will normalize the sending domain and save one reusable sender identity for this workspace."
              }}
            </p>

            <article class="sender-setup-assist-card">
              <div>
                <p class="panel-meta">Recommended for this workspace</p>
                <strong>{{ normalizedDomainForm.domainName || "Add a website, domain, or sender email" }}</strong>
                <p class="panel-note">
                  {{
                    workspaceSuggestedDomain
                      ? `We detected ${workspaceSuggestedDomain} from the workspace website and can prefill the sender identity for you.`
                      : "If the workspace website is missing, you can still paste a sender email like hello@yourbrand.com and we will extract the domain."
                  }}
                </p>
              </div>
              <button
                type="button"
                class="secondary-action"
                :disabled="!workspaceSuggestedDomain"
                @click="applyRecommendedDomainSetup"
              >
                Use workspace defaults
              </button>
            </article>

            <div class="domain-grid">
              <label class="domain-field">
                <span>Website or domain</span>
                <input
                  v-model="domainForm.domainName"
                  class="workspace-input"
                  placeholder="yourbrand.com or https://yourbrand.com"
                />
                <small v-if="domainValidationField === 'domainName'" class="field-validation error">
                  {{ domainValidationMessage }}
                </small>
              </label>
              <label class="domain-field">
                <span>From name</span>
                <input v-model="domainForm.fromName" class="workspace-input" placeholder="Founder Content" />
              </label>
              <label class="domain-field">
                <span>From email</span>
                <input v-model="domainForm.fromEmail" class="workspace-input" placeholder="hello@yourbrand.com" />
                <small v-if="domainValidationField === 'fromEmail'" class="field-validation error">
                  {{ domainValidationMessage }}
                </small>
              </label>
              <label class="domain-field">
                <span>Reply-to</span>
                <input v-model="domainForm.replyToEmail" class="workspace-input" placeholder="reply@yourbrand.com" />
              </label>
            </div>
            <p class="panel-note">
              Domain can be a website URL, the root domain, or the sender email. Saving this generates the DNS records you need next.
            </p>
            <p v-if="domainSaveErrorMessage" class="inline-form-message error">{{ domainSaveErrorMessage }}</p>

            <div class="sender-setup-preview-grid">
              <article class="sender-setup-preview-card">
                <span>Detected domain</span>
                <strong>{{ normalizedDomainForm.domainName || "Waiting for input" }}</strong>
              </article>
              <article class="sender-setup-preview-card">
                <span>Will send as</span>
                <strong>{{ normalizedDomainForm.fromEmail || "hello@yourbrand.com" }}</strong>
              </article>
              <article class="sender-setup-preview-card">
                <span>Reply-to</span>
                <strong>{{ normalizedDomainForm.replyToEmail || normalizedDomainForm.fromEmail || "reply@yourbrand.com" }}</strong>
              </article>
            </div>

            <ul v-if="domainSetupHints.length > 0" class="sender-setup-hint-list">
              <li v-for="hint in domainSetupHints" :key="hint">{{ hint }}</li>
            </ul>

            <article class="signature-preview-card">
              <div class="signature-preview-header">
                <div>
                  <p class="panel-meta">Footer preview</p>
                  <strong>{{ effectiveFooterLogoUrl ? "Logo and footer details will carry forward" : "Saved footer details for future emails" }}</strong>
                </div>
                <div class="signature-preview-actions">
                  <button
                    type="button"
                    class="workspace-secondary-button compact"
                    :disabled="isSavingFooterLogo"
                    @click="isFooterLogoPickerOpen = true"
                  >
                    {{ effectiveFooterLogoUrl ? "Replace footer logo" : "Select footer logo" }}
                  </button>
                  <button
                    v-if="effectiveFooterLogoUrl"
                    type="button"
                    class="workspace-secondary-button compact"
                    :disabled="isSavingFooterLogo"
                    @click="void clearFooterLogo()"
                  >
                    {{ isSavingFooterLogo ? "Removing..." : "Remove logo" }}
                  </button>
                </div>
              </div>
              <p class="panel-note">Choose the logo once here. New emails will reuse it automatically.</p>
              <div v-if="footerPreviewHtml" class="footer-preview-html" v-html="footerPreviewHtml"></div>
            </article>

            <div class="email-footer-form-grid">
              <label class="domain-field email-footer-editor-field is-full">
                <span>Sign-off</span>
                <textarea
                  v-model="domainForm.footer.signoff"
                  class="workspace-textarea compact"
                  placeholder="Sincerely,
Daycare Spots"
                />
              </label>

              <label class="domain-field email-footer-editor-field">
                <span>Business name</span>
                <input
                  v-model="domainForm.footer.businessName"
                  class="workspace-input"
                  placeholder="Daycare Spots"
                />
              </label>

              <label class="domain-field email-footer-editor-field">
                <span>Website</span>
                <input
                  v-model="domainForm.footer.websiteUrl"
                  class="workspace-input"
                  placeholder="https://www.daycarespots.com"
                />
              </label>

              <label class="domain-field email-footer-editor-field">
                <span>Support email</span>
                <input
                  v-model="domainForm.footer.supportEmail"
                  class="workspace-input"
                  placeholder="info@daycarespots.com"
                />
              </label>

              <label class="domain-field email-footer-editor-field">
                <span>Street address</span>
                <input
                  v-model="domainForm.footer.streetAddress"
                  class="workspace-input"
                  placeholder="1312 17th Street Suite 860"
                />
              </label>

              <label class="domain-field email-footer-editor-field">
                <span>Address line 2</span>
                <input
                  v-model="domainForm.footer.addressLine2"
                  class="workspace-input"
                  placeholder="Building, floor, or landmark"
                />
              </label>

              <label class="domain-field email-footer-editor-field">
                <span>City</span>
                <input v-model="domainForm.footer.city" class="workspace-input" placeholder="Denver" />
              </label>

              <label class="domain-field email-footer-editor-field">
                <span>State</span>
                <input v-model="domainForm.footer.state" class="workspace-input" placeholder="CO" />
              </label>

              <label class="domain-field email-footer-editor-field">
                <span>Postal code</span>
                <input v-model="domainForm.footer.postalCode" class="workspace-input" placeholder="80202" />
              </label>

              <label class="domain-field email-footer-editor-field">
                <span>Country</span>
                <input v-model="domainForm.footer.country" class="workspace-input" placeholder="US" />
              </label>

              <div class="email-footer-social-grid is-full">
                <label
                  v-for="platform in EMAIL_FOOTER_SOCIAL_PLATFORMS"
                  :key="`settings-footer-social-${platform}`"
                  class="domain-field email-footer-editor-field"
                >
                  <span>{{ EMAIL_FOOTER_SOCIAL_LABELS[platform] }}</span>
                  <input
                    v-model="domainForm.footer.socialLinks[platform]"
                    class="workspace-input"
                    :placeholder="`${EMAIL_FOOTER_SOCIAL_LABELS[platform]} handle or URL`"
                  />
                </label>
              </div>

              <label class="domain-field footer-details-field email-footer-editor-field is-full">
                <span>Additional footer note</span>
                <textarea
                  v-model="domainForm.footer.additionalText"
                  class="workspace-textarea compact"
                  :placeholder="footerDetailsPlaceholderText"
                />
                <small>Use this for compliance copy, legal notes, or anything you want to appear below the address and social links.</small>
              </label>
            </div>

            <div class="workspace-actions">
              <button
                type="button"
                class="primary-action"
                :disabled="!canSaveDomainSetup"
                :title="domainValidationMessage || undefined"
                @click="saveDomainUpgrade"
              >
                {{ isSavingDomain ? "Saving..." : hasConfiguredDomain ? "Update domain setup" : "Save domain setup" }}
              </button>
              <button
                v-if="hasConfiguredDomain"
                type="button"
                class="secondary-action"
                :disabled="isSavingDomain"
                @click="isEditingDomainSetup = false"
              >
                Cancel
              </button>
            </div>
          </template>
        </section>
      </section>
    </template>
    <WorkspaceAssetPickerModal
      :open="isFooterLogoPickerOpen"
      :business-id="selectedBusinessId"
      asset-type="all"
      :accepted-mime-prefixes="['image/']"
      title="Select a footer logo"
      @close="isFooterLogoPickerOpen = false"
      @select="void handleFooterLogoSelection($event)"
    />
    <transition name="email-toast">
      <div v-if="emailToast" class="email-toast" :class="`tone-${emailToast.tone}`" role="status" aria-live="polite">
        {{ emailToast.message }}
      </div>
    </transition>
  </main>
</template>

<style scoped>
.workspace-shell {
  width: 100%;
  max-width: none;
  margin: 0;
  padding: 12px 0 80px;
}

.workspace-eyebrow,
.panel-meta {
  margin: 0 0 10px;
  color: var(--fc-text-muted);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.workspace-description {
  margin: 16px 0 0;
  color: var(--fc-text-muted);
  line-height: 1.7;
}

.workspace-chip-row,
.workspace-actions,
.stats-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.workspace-chip {
  display: inline-flex;
  align-items: center;
  min-height: 36px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid var(--fc-border);
  background: var(--fc-surface-subtle);
  color: var(--fc-text-muted);
  font-size: 0.84rem;
  font-weight: 700;
}

.workspace-description.compact {
  margin-top: 10px;
}

.inline-form-message {
  flex-basis: 100%;
  margin: 0;
  font-size: 0.92rem;
  font-weight: 700;
}

.inline-form-message.warning {
  color: color-mix(in srgb, var(--fc-text) 72%, var(--fc-accent-strong) 28%);
}

.inline-form-message.error {
  color: var(--fc-danger-text, #a63d32);
}

.email-toast {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: 40;
  max-width: min(420px, calc(100vw - 32px));
  padding: 14px 16px;
  border-radius: 16px;
  border: 1px solid var(--fc-border);
  background: rgba(255, 251, 247, 0.98);
  box-shadow: 0 18px 44px rgba(44, 24, 14, 0.18);
  color: var(--fc-text);
  font-size: 0.94rem;
  font-weight: 700;
  line-height: 1.5;
}

.email-toast.tone-error {
  border-color: color-mix(in srgb, var(--fc-danger-text, #a63d32) 26%, var(--fc-border) 74%);
  color: var(--fc-danger-text, #a63d32);
}

.email-toast-enter-active,
.email-toast-leave-active {
  transition: opacity 180ms ease, transform 180ms ease;
}

.email-toast-enter-from,
.email-toast-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

.workspace-card {
  padding: clamp(22px, 3vw, 32px);
  border: 1px solid var(--fc-border);
  border-radius: 28px;
  background: linear-gradient(180deg, var(--fc-surface) 0%, var(--fc-surface-subtle) 100%);
  box-shadow: var(--fc-card-shadow);
}

.empty-state {
  text-align: center;
}

.panel-header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
}

.panel-header h2 {
  margin: 0;
}

.email-workspace-stack {
  display: grid;
  gap: 20px;
}

.email-tabs-card,
.email-overview-stack {
  display: grid;
  gap: 22px;
}

.email-tabs-card {
  position: relative;
  overflow: hidden;
}

.email-tabs-card::before {
  content: "";
  position: absolute;
  inset: -18% 48% auto -8%;
  height: 220px;
  border-radius: 999px;
  background: radial-gradient(circle, rgba(215, 102, 52, 0.14) 0%, rgba(215, 102, 52, 0) 72%);
  pointer-events: none;
}

.email-tabs-header {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 20px;
  align-items: start;
}

.email-tabs-intro {
  display: grid;
  gap: 16px;
  min-width: 0;
}

.email-tabs-header h1 {
  margin: 0;
  font-size: clamp(2rem, 3.2vw, 2.75rem);
  line-height: 1.04;
}

.email-workspace-chip {
  align-self: flex-start;
  width: fit-content;
  margin-top: 0;
}

.email-hero-chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.email-header-actions {
  display: flex;
  align-items: flex-start;
  justify-content: flex-end;
  gap: 12px;
}

.email-hero-aside {
  display: grid;
  align-content: start;
  gap: 12px;
  padding: 22px;
  border: 1px solid color-mix(in srgb, var(--fc-border) 78%, rgba(215, 102, 52, 0.16));
  border-radius: 24px;
  background:
    linear-gradient(180deg, rgba(255, 252, 248, 0.92) 0%, rgba(255, 247, 239, 0.82) 100%);
  box-shadow: 0 18px 34px rgba(60, 36, 21, 0.06);
}

.email-hero-aside strong {
  font-size: 1.06rem;
  line-height: 1.45;
}

.hero-inline-action {
  justify-self: start;
  min-height: 40px;
  padding: 0 14px;
}

.email-tab-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  padding-top: 4px;
  border-top: 1px solid color-mix(in srgb, var(--fc-border) 86%, transparent);
}

.email-tab-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 42px;
  padding: 0 16px;
  border-radius: 999px;
  border: 1px solid var(--fc-border);
  background: transparent;
  color: var(--fc-text);
  font: inherit;
  font-weight: 800;
  cursor: pointer;
}

.email-tab-button.active {
  background: linear-gradient(135deg, var(--fc-accent) 0%, var(--fc-accent-dark) 100%);
  border-color: transparent;
  box-shadow: var(--fc-accent-shadow);
  color: var(--fc-accent-contrast);
}

.email-composer-intent-panel {
  display: grid;
  gap: 16px;
  margin-bottom: 20px;
  padding: 18px;
  border: 1px solid color-mix(in srgb, var(--fc-border) 85%, transparent);
  border-radius: 24px;
  background: color-mix(in srgb, var(--fc-surface) 95%, white 5%);
}

.email-composer-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.45fr) minmax(320px, 0.88fr);
  gap: 18px;
  align-items: start;
}

.email-composer-main,
.email-composer-sidebar {
  display: grid;
  gap: 16px;
}

.email-composer-sidebar {
  position: sticky;
  top: 24px;
  align-self: start;
}

.email-block-composer,
.email-raw-editor {
  display: grid;
  gap: 16px;
  padding: 18px;
  border: 1px solid color-mix(in srgb, var(--fc-border) 86%, transparent);
  border-radius: 24px;
  background: color-mix(in srgb, var(--fc-surface) 96%, white 4%);
}

.email-block-composer-header {
  display: grid;
  gap: 6px;
}

.email-block-composer-header h3 {
  margin: 0;
  font-size: 1.1rem;
}

.email-block-library,
.email-block-card-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.email-block-stack {
  display: grid;
  gap: 14px;
}

.email-block-card {
  display: grid;
  gap: 14px;
  padding: 16px;
  border: 1px solid color-mix(in srgb, var(--fc-border) 88%, transparent);
  border-radius: 22px;
  background: linear-gradient(180deg, rgba(255, 253, 250, 0.96), rgba(255, 248, 241, 0.9));
  box-shadow: 0 14px 28px rgba(60, 36, 21, 0.05);
}

.email-block-card-header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.email-block-card-copy {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.email-block-card-copy strong {
  font-size: 1rem;
  line-height: 1.4;
}

.email-block-field-grid {
  display: grid;
  gap: 12px;
}

.email-block-field-grid.two-up {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.email-composer-advanced-toggle {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.email-composer-advanced-toggle > div {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.email-preview-sidebar-card {
  display: grid;
  gap: 18px;
}

.email-footer-sidebar-card {
  display: grid;
  gap: 16px;
}

.email-footer-sidebar-copy {
  display: grid;
  gap: 6px;
}

.email-footer-sidebar-copy h3 {
  margin: 0;
  font-size: 1.05rem;
  line-height: 1.4;
}

.email-footer-sidebar-actions,
.email-footer-sidebar-footer {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.email-footer-state-note {
  margin: 0;
}

.email-footer-editor-field {
  margin-top: 0;
}

.email-preview-sidebar-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.email-preview-sidebar-header h3 {
  margin: 0;
  font-size: 1.05rem;
  line-height: 1.4;
}

.email-mobile-preview-shell {
  display: flex;
  justify-content: center;
}

.email-mobile-preview-device {
  width: min(100%, 360px);
  padding: 14px 12px 16px;
  border-radius: 38px;
  border: 1px solid color-mix(in srgb, var(--fc-border) 84%, transparent);
  background:
    radial-gradient(circle at top, rgba(255, 255, 255, 0.95), rgba(255, 247, 239, 0.76)),
    linear-gradient(180deg, rgba(243, 229, 216, 0.72), rgba(255, 250, 245, 0.96));
  box-shadow:
    0 32px 60px rgba(60, 36, 21, 0.14),
    inset 0 1px 0 rgba(255, 255, 255, 0.72);
}

.email-mobile-preview-notch {
  width: 34%;
  min-width: 110px;
  height: 18px;
  margin: 0 auto 14px;
  border-radius: 999px;
  background: rgba(36, 24, 19, 0.14);
}

.email-mobile-preview-screen {
  display: grid;
  gap: 12px;
  padding: 14px;
  border-radius: 28px;
  border: 1px solid color-mix(in srgb, var(--fc-border) 86%, transparent);
  background: linear-gradient(180deg, rgba(255, 252, 248, 0.98), rgba(255, 247, 240, 0.96));
}

.email-mobile-preview-message-header {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 20px;
  border: 1px solid color-mix(in srgb, var(--fc-border) 88%, transparent);
  background: rgba(255, 255, 255, 0.78);
}

.email-mobile-preview-avatar {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 14px;
  background: linear-gradient(135deg, var(--fc-accent) 0%, var(--fc-accent-dark) 100%);
  color: var(--fc-accent-contrast);
  font-size: 0.95rem;
  font-weight: 800;
  flex: 0 0 auto;
}

.email-mobile-preview-message-copy {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.email-mobile-preview-message-copy span {
  color: var(--fc-text-muted);
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.email-mobile-preview-message-copy strong,
.email-mobile-preview-message-copy p {
  margin: 0;
}

.email-mobile-preview-message-copy strong {
  color: #241813;
  font-size: 0.95rem;
  line-height: 1.35;
  word-break: break-word;
}

.email-mobile-preview-message-copy p {
  color: var(--fc-text-muted);
  font-size: 0.82rem;
  line-height: 1.45;
}

.campaign-dashboard-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  margin-bottom: 18px;
}

.campaign-table-shell {
  overflow-x: auto;
  border: 1px solid color-mix(in srgb, var(--fc-border) 88%, transparent);
  border-radius: 22px;
  background: rgba(255, 255, 255, 0.7);
}

.campaign-table {
  width: 100%;
  min-width: 920px;
  border-collapse: collapse;
}

.campaign-table th,
.campaign-table td {
  padding: 16px 18px;
  border-bottom: 1px solid color-mix(in srgb, var(--fc-border) 86%, transparent);
  text-align: left;
  vertical-align: top;
}

.campaign-table th {
  color: var(--fc-text-muted);
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  background: color-mix(in srgb, var(--fc-surface-subtle) 94%, white 6%);
}

.campaign-table tbody tr:last-child td {
  border-bottom: none;
}

.campaign-table-name {
  display: grid;
  gap: 6px;
}

.campaign-table-name strong {
  font-size: 0.98rem;
}

.campaign-table-name span {
  color: var(--fc-text-muted);
  line-height: 1.5;
}

.campaign-table-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.campaign-flow-panel {
  display: grid;
  gap: 16px;
  margin: 18px 0 20px;
  padding: 18px;
  border: 1px solid color-mix(in srgb, var(--fc-border) 85%, transparent);
  border-radius: 24px;
  background: color-mix(in srgb, var(--fc-surface) 94%, white 6%);
}

.campaign-source-mode-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.campaign-flow-toolbar {
  display: grid;
  gap: 16px;
  margin-top: 18px;
}

.campaign-flow-group {
  display: grid;
  gap: 8px;
}

.campaign-source-grid {
  display: grid;
  gap: 14px;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
}

.campaign-source-card {
  display: grid;
  gap: 14px;
  align-content: space-between;
  padding: 18px;
  border: 1px solid var(--fc-border);
  border-radius: 22px;
  background: rgba(255, 255, 255, 0.7);
  box-shadow: 0 14px 28px rgba(60, 36, 21, 0.05);
}

.campaign-source-card.active {
  border-color: color-mix(in srgb, var(--fc-accent) 34%, var(--fc-border));
  background: color-mix(in srgb, var(--fc-accent) 8%, white 92%);
}

.campaign-source-copy {
  display: grid;
  gap: 8px;
}

.campaign-source-copy strong {
  font-size: 1.04rem;
}

.campaign-source-copy p,
.campaign-source-copy small {
  margin: 0;
  color: var(--fc-text-muted);
  line-height: 1.6;
}

.email-overview-grid {
  display: grid;
  gap: 16px;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
}

.email-stat-card {
  display: grid;
  gap: 8px;
  min-height: 132px;
  align-content: end;
  position: relative;
  overflow: hidden;
}

.email-stat-card::after {
  content: "";
  position: absolute;
  inset: 0 auto auto 0;
  width: 72px;
  height: 4px;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--fc-accent) 0%, var(--fc-accent-dark) 100%);
}

.email-stat-card span {
  color: var(--fc-text-muted);
  font-size: 0.86rem;
  font-weight: 700;
}

.email-stat-card strong {
  font-size: clamp(2rem, 4vw, 2.8rem);
  line-height: 0.92;
}

.email-stat-card[data-tone="success"] {
  border-color: color-mix(in srgb, var(--fc-success-text, #2c6b35) 18%, var(--fc-border));
}

.email-stat-card[data-tone="warning"] {
  border-color: color-mix(in srgb, #b46a00 20%, var(--fc-border));
}

.panel-note {
  margin: 6px 0 0;
  color: rgba(59, 46, 40, 0.72);
}

.workspace-select,
.workspace-input,
.workspace-textarea {
  width: 100%;
  margin-top: 14px;
  padding: 16px;
  border: 1px solid var(--fc-border);
  border-radius: 18px;
  background: var(--fc-surface);
  color: var(--fc-text);
  font: inherit;
}

.workspace-select {
  width: auto;
  min-width: 220px;
  margin-top: 0;
}

.workspace-select.full-width {
  width: 100%;
  min-width: 0;
  margin-top: 18px;
}

.workspace-textarea {
  min-height: 220px;
  line-height: 1.7;
  resize: vertical;
}

.workspace-textarea.compact {
  min-height: 160px;
}

.workspace-secondary-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: 0 16px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--fc-border) 76%, rgba(221, 128, 56, 0.24));
  background: rgba(255, 255, 255, 0.82);
  color: var(--fc-text);
  font: inherit;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 12px 28px rgba(74, 47, 28, 0.06);
  transition: transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease, background 160ms ease;
}

.workspace-secondary-button:hover {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--fc-accent) 28%, var(--fc-border));
  box-shadow: 0 18px 30px rgba(74, 47, 28, 0.1);
}

.workspace-secondary-button:disabled {
  cursor: not-allowed;
  opacity: 0.68;
  transform: none;
  box-shadow: none;
}

.workspace-secondary-button.compact {
  min-height: 38px;
  padding: 0 14px;
  font-size: 0.9rem;
}

.workspace-secondary-button.active,
.workspace-secondary-button[data-active="true"] {
  background: color-mix(in srgb, var(--fc-accent) 14%, white 86%);
  border-color: color-mix(in srgb, var(--fc-accent) 36%, var(--fc-border));
  color: var(--fc-accent-dark);
}

.email-editor-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 18px;
}

.email-media-panel,
.draft-media-picker,
.selected-media-stack {
  display: grid;
  gap: 16px;
}

.email-media-panel {
  margin-top: 22px;
  padding-top: 20px;
  border-top: 1px solid color-mix(in srgb, var(--fc-border) 85%, transparent);
}

.email-media-panel h3 {
  margin: 0;
}

.panel-header.compact {
  align-items: center;
}

.media-recommendation-panel {
  display: grid;
  gap: 12px;
  padding: 16px;
  border-radius: 20px;
  border: 1px solid color-mix(in srgb, var(--fc-border) 88%, transparent);
  background: color-mix(in srgb, var(--fc-surface-subtle) 92%, white 8%);
}

.media-recommendation-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
}

.media-recommendation-card {
  display: grid;
  gap: 12px;
  align-content: space-between;
  padding: 14px;
  border-radius: 18px;
  border: 1px solid var(--fc-border);
  background: rgba(255, 255, 255, 0.82);
}

.media-recommendation-card p,
.media-recommendation-card small {
  margin: 6px 0 0;
  color: var(--fc-text-muted);
}

.email-preview-shell {
  display: grid;
  gap: 14px;
  margin-top: 18px;
}

.email-preview-header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.email-preview-header h3 {
  margin: 0;
}

.email-preview-frame {
  width: min(100%, 640px);
  padding: 22px;
  border: 1px solid var(--fc-border);
  border-radius: 26px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.94), rgba(255, 250, 244, 0.92));
  box-shadow: 0 24px 50px rgba(60, 36, 21, 0.08);
}

.email-preview-frame-mobile {
  width: 100%;
  max-height: min(64vh, 720px);
  padding: 18px 16px;
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.74);
  overflow: auto;
}

.email-preview-frame :deep(.email-preview-frame-inner) {
  width: 100%;
  max-width: 600px;
  margin: 0 auto;
  color: #241813;
}

.email-preview-frame-mobile :deep(.email-preview-frame-inner) {
  max-width: none;
}

.email-preview-frame :deep(p) {
  margin: 0 0 18px;
  font-size: 16px;
  line-height: 1.82;
}

.email-preview-frame :deep(a) {
  color: var(--fc-accent-dark);
  text-decoration: underline;
}

.email-preview-frame :deep(.email-preview-cta-row) {
  margin: 24px 0;
}

.email-preview-frame :deep(.email-preview-cta-button) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 46px;
  padding: 0 20px;
  border-radius: 999px;
  background: linear-gradient(135deg, var(--fc-accent) 0%, var(--fc-accent-dark) 100%);
  color: var(--fc-accent-contrast);
  font-size: 15px;
  font-weight: 800;
  text-decoration: none;
  box-shadow: 0 18px 30px rgba(215, 102, 52, 0.18);
}

.email-preview-frame :deep(.email-preview-cta-button:hover) {
  color: var(--fc-accent-contrast);
  text-decoration: none;
}

.email-preview-frame :deep(.email-preview-hero),
.email-preview-frame :deep(.email-preview-cta-section),
.email-preview-frame :deep(.email-preview-feature-block) {
  margin: 24px 0;
  padding: 24px;
  border-radius: 24px;
  border: 1px solid color-mix(in srgb, var(--fc-border) 84%, transparent);
  background: linear-gradient(180deg, rgba(255, 251, 247, 0.98), rgba(255, 245, 236, 0.92));
}

.email-preview-frame :deep(.email-preview-hero) {
  text-align: center;
  background: linear-gradient(180deg, rgba(255, 244, 232, 0.96), rgba(255, 239, 226, 0.9));
}

.email-preview-frame :deep(.email-preview-cta-section) {
  background: linear-gradient(180deg, rgba(255, 247, 241, 0.98), rgba(255, 242, 232, 0.92));
}

.email-preview-frame :deep(.email-preview-section-title) {
  margin: 0 0 12px;
  color: #241813;
  font-size: clamp(1.5rem, 3vw, 2.1rem);
  line-height: 1.08;
  font-weight: 900;
}

.email-preview-frame :deep(.email-preview-section-body) {
  margin: 0 0 18px;
  color: #5a463a;
  font-size: 15px;
  line-height: 1.7;
}

.email-preview-frame :deep(.email-preview-feature-list) {
  display: grid;
  gap: 10px;
  margin: 0;
  padding-left: 20px;
}

.email-preview-frame :deep(.email-preview-feature-list li) {
  color: #3e3028;
  line-height: 1.65;
}

.email-preview-frame :deep(.email-preview-image) {
  margin: 20px 0;
}

.email-preview-frame :deep(.email-preview-image.is-header) {
  margin-top: 0;
  margin-bottom: 24px;
}

.email-preview-frame :deep(.email-preview-image img) {
  display: block;
  width: 100%;
  max-width: 600px;
  height: auto;
  border-radius: 20px;
  border: 1px solid color-mix(in srgb, var(--fc-border) 85%, transparent);
}

.email-preview-frame :deep(.email-preview-signature),
.footer-preview-html :deep(.email-preview-signature) {
  margin-top: 28px;
  padding-top: 18px;
  border-top: 1px solid #eaded2;
}

.email-preview-frame :deep(.email-preview-signature-logo),
.footer-preview-html :deep(.email-preview-signature-logo) {
  margin-bottom: 16px;
}

.email-preview-frame :deep(.email-preview-signature-logo img),
.footer-preview-html :deep(.email-preview-signature-logo img) {
  display: block;
  max-width: 180px;
  max-height: 72px;
  width: auto;
  height: auto;
  object-fit: contain;
}

.email-preview-frame :deep(.email-preview-signature p),
.footer-preview-html :deep(.email-preview-signature p) {
  margin-bottom: 10px;
  font-size: 14px;
  color: #6d5d53;
}

.email-preview-frame :deep(.email-preview-signature-rich),
.footer-preview-html :deep(.email-preview-signature-rich) {
  display: grid;
  gap: 0;
}

.email-preview-frame :deep(.email-preview-footer-signoff p),
.footer-preview-html :deep(.email-preview-footer-signoff p) {
  margin: 0 0 4px;
  color: #3b2d23;
  font-size: 15px;
  font-weight: 700;
  text-align: center;
}

.email-preview-frame :deep(.email-preview-footer-links),
.email-preview-frame :deep(.email-preview-footer-address),
.email-preview-frame :deep(.email-preview-footer-note),
.footer-preview-html :deep(.email-preview-footer-links),
.footer-preview-html :deep(.email-preview-footer-address),
.footer-preview-html :deep(.email-preview-footer-note) {
  margin: 12px 0 0;
  color: #6d5d53;
  font-size: 13px;
  line-height: 1.65;
  text-align: center;
}

.email-preview-frame :deep(.email-preview-footer-separator),
.footer-preview-html :deep(.email-preview-footer-separator) {
  display: inline-block;
  margin: 0 6px;
  color: #c6ad9c;
}

.email-preview-frame :deep(.email-preview-footer-social-row),
.footer-preview-html :deep(.email-preview-footer-social-row) {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  margin-top: 16px;
}

.email-preview-frame :deep(.email-preview-footer-social-button),
.footer-preview-html :deep(.email-preview-footer-social-button) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 999px;
  background: var(--footer-social-accent, #6d5d53);
  color: #fff;
  text-decoration: none;
  text-transform: uppercase;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.02em;
}

.email-preview-frame :deep(.email-preview-placeholder) {
  color: var(--fc-text-muted);
}

.email-preview-frame-mobile :deep(p) {
  margin: 0 0 16px;
  font-size: 14px;
  line-height: 1.72;
}

.email-preview-frame-mobile :deep(.email-preview-hero),
.email-preview-frame-mobile :deep(.email-preview-cta-section),
.email-preview-frame-mobile :deep(.email-preview-feature-block) {
  margin: 20px 0;
  padding: 18px;
  border-radius: 20px;
}

.email-preview-frame-mobile :deep(.email-preview-section-title) {
  font-size: clamp(1.2rem, 5vw, 1.55rem);
}

.email-preview-frame-mobile :deep(.email-preview-section-body) {
  font-size: 14px;
}

.email-preview-frame-mobile :deep(.email-preview-image img) {
  border-radius: 18px;
}

.email-preview-frame-mobile :deep(.email-preview-signature) {
  margin-top: 22px;
}

.email-media-input-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
}

.media-upload-trigger {
  position: relative;
  overflow: hidden;
}

.media-upload-trigger.disabled {
  opacity: 0.68;
  cursor: not-allowed;
}

.media-upload-input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

.draft-media-grid {
  display: grid;
  gap: 14px;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
}

.draft-media-card,
.selected-media-card {
  display: grid;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--fc-border);
  border-radius: 22px;
  background: color-mix(in srgb, var(--fc-surface) 94%, white 6%);
  box-shadow: 0 14px 30px rgba(60, 36, 21, 0.05);
}

.draft-media-preview,
.selected-media-preview {
  width: 100%;
  aspect-ratio: 16 / 10;
  object-fit: cover;
  border-radius: 16px;
  border: 1px solid color-mix(in srgb, var(--fc-border) 84%, transparent);
  background: color-mix(in srgb, var(--fc-surface-subtle) 84%, white 16%);
}

.draft-media-actions,
.selected-media-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.signature-preview-card {
  display: grid;
  gap: 8px;
  padding: 18px;
  border-radius: 22px;
  border: 1px solid var(--fc-border);
  background: linear-gradient(180deg, rgba(255, 250, 244, 0.96), rgba(255, 246, 238, 0.88));
}

.signature-preview-card strong {
  font-size: 1rem;
}

.signature-preview-card pre {
  margin: 0;
  padding: 14px 16px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.74);
  border: 1px solid color-mix(in srgb, var(--fc-border) 88%, transparent);
  color: var(--fc-text-muted);
  font: inherit;
  line-height: 1.65;
  white-space: pre-wrap;
  word-break: break-word;
}

.footer-preview-html {
  padding: 14px 16px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.78);
  border: 1px solid color-mix(in srgb, var(--fc-border) 88%, transparent);
}

.footer-preview-inline-card {
  padding: 14px;
}

.overview-domain-status {
  display: grid;
  gap: 8px;
  margin-top: 18px;
}

.overview-quick-actions {
  display: grid;
  gap: 14px;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
}

.overview-action-button {
  width: 100%;
  min-height: 48px;
}

.overview-dashboard-grid {
  display: grid;
  gap: 20px;
  grid-template-columns: minmax(0, 1.7fr) minmax(320px, 0.95fr);
  align-items: start;
}

.overview-campaigns-card,
.overview-status-card {
  display: grid;
  gap: 18px;
}

.overview-campaign-list {
  margin-top: 0;
}

.overview-campaign-card {
  align-items: flex-start;
}

.overview-campaign-main {
  display: grid;
  gap: 12px;
  flex: 1 1 420px;
}

.overview-campaign-copy {
  display: grid;
  gap: 6px;
}

.overview-campaign-subject {
  font-weight: 700;
  color: var(--fc-text);
}

.overview-campaign-source,
.campaign-source-note {
  font-size: 0.9rem;
  color: var(--fc-text-muted);
}

.overview-campaign-preview {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.overview-campaign-metrics {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.workspace-chip.warning {
  border-color: color-mix(in srgb, #b46a00 20%, var(--fc-border));
  color: #8a5200;
  background: color-mix(in srgb, #f8b84e 12%, white 88%);
}

.workspace-chip.success {
  border-color: color-mix(in srgb, #1f8f4d 18%, var(--fc-border));
  color: #1f7a43;
  background: color-mix(in srgb, #7fd39e 16%, white 84%);
}

.workspace-chip.info {
  border-color: color-mix(in srgb, #2563eb 16%, var(--fc-border));
  color: #1f4bb8;
  background: color-mix(in srgb, #7ba8ff 14%, white 86%);
}

.overview-empty-state {
  display: grid;
  gap: 18px;
  justify-items: start;
  align-content: center;
  min-height: 340px;
  padding: clamp(24px, 3vw, 36px);
  border: 1px dashed color-mix(in srgb, var(--fc-border) 82%, rgba(215, 102, 52, 0.28));
  border-radius: 26px;
  background:
    radial-gradient(circle at top left, rgba(215, 102, 52, 0.12) 0%, rgba(215, 102, 52, 0) 42%),
    linear-gradient(180deg, rgba(255, 250, 245, 0.88) 0%, rgba(255, 246, 237, 0.7) 100%);
  margin-top: 0;
}

.overview-empty-badge {
  display: inline-flex;
  align-items: center;
  min-height: 34px;
  padding: 0 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.78);
  border: 1px solid color-mix(in srgb, var(--fc-border) 84%, transparent);
  color: var(--fc-text-muted);
  font-size: 0.82rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.overview-empty-copy {
  display: grid;
  gap: 10px;
  max-width: 34rem;
}

.overview-empty-copy h3 {
  margin: 0;
  font-size: clamp(1.4rem, 2.3vw, 1.85rem);
  line-height: 1.1;
}

.overview-empty-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.overview-empty-button {
  min-height: 44px;
  padding: 0 18px;
}

.overview-empty-state p {
  margin: 0;
}

.status-summary-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
}

.status-summary-card {
  display: grid;
  gap: 6px;
  align-content: start;
  min-height: 104px;
  padding: 16px 18px;
  border-radius: 20px;
  border: 1px solid var(--fc-border);
  background: rgba(255, 255, 255, 0.72);
}

.status-summary-card span {
  color: var(--fc-text-muted);
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.status-summary-card strong {
  line-height: 1.4;
}

.secondary-panel-meta {
  margin-bottom: 0;
}

.status-warning-stack {
  display: grid;
  gap: 10px;
}

.status-warning-list {
  display: grid;
  gap: 10px;
  margin: 0;
  padding-left: 18px;
  color: var(--fc-text-muted);
  line-height: 1.55;
}

.contact-import-stack,
.contact-import-inputs,
.contact-preview-panel,
.contact-preview-summary,
.contact-mapping-grid,
.contact-preview-table {
  display: grid;
  gap: 14px;
}

.contact-import-stack {
  grid-template-columns: minmax(0, 0.95fr) minmax(0, 1.05fr);
  margin-top: 16px;
}

.contact-upload-row,
.contact-import-mode-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}

.contact-upload-button {
  position: relative;
  overflow: hidden;
}

.contact-upload-input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

.contact-preview-panel {
  padding: 18px;
  border: 1px solid var(--fc-border);
  border-radius: 22px;
  background: color-mix(in srgb, var(--fc-surface) 92%, white 8%);
}

.contact-preview-summary {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.contact-preview-stat {
  gap: 8px;
  padding: 18px;
  border-radius: 20px;
  box-shadow: none;
}

.contact-preview-stat span {
  color: var(--fc-text-muted);
  font-size: 0.8rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.contact-preview-stat strong {
  font-size: 1.8rem;
  line-height: 1;
}

.contact-mapping-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.contact-mapping-field {
  display: grid;
  gap: 8px;
}

.contact-mapping-field span {
  display: flex;
  gap: 8px;
  align-items: center;
  color: var(--fc-text-muted);
  font-size: 0.84rem;
  font-weight: 700;
}

.contact-mapping-field small {
  color: var(--fc-accent-dark);
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.contact-mapping-field select {
  width: 100%;
  min-width: 0;
  padding: 14px 16px;
  border: 1px solid var(--fc-border);
  border-radius: 16px;
  background: var(--fc-surface);
  color: var(--fc-text);
  font: inherit;
}

.contact-import-mode-row .workspace-secondary-button.active {
  border-color: transparent;
  background: linear-gradient(135deg, var(--fc-accent) 0%, var(--fc-accent-dark) 100%);
  color: var(--fc-accent-contrast);
  box-shadow: var(--fc-accent-shadow);
}

.contact-preview-row {
  display: grid;
  grid-template-columns:
    minmax(180px, 1.2fr)
    minmax(140px, 0.9fr)
    minmax(170px, 1fr)
    minmax(180px, 1.1fr)
    minmax(120px, 0.8fr)
    minmax(180px, 1.2fr);
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid var(--fc-border);
  border-radius: 16px;
  background: var(--fc-surface);
}

.contact-preview-row span {
  min-width: 0;
  color: var(--fc-text-muted);
  line-height: 1.5;
  word-break: break-word;
}

.contact-preview-head {
  background: transparent;
  border-style: dashed;
}

.contact-preview-head span {
  color: var(--fc-text);
  font-size: 0.8rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.contact-job-card,
.contact-directory {
  display: grid;
  gap: 16px;
  margin-top: 18px;
}

.import-progress {
  width: 100%;
  margin-top: 0;
}

.import-error-summary {
  display: grid;
  gap: 10px;
  margin: 0;
  padding-left: 18px;
  color: var(--fc-text-muted);
  line-height: 1.6;
}

.contact-directory-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.toolbar-input {
  flex: 1 1 280px;
  margin-top: 0;
}

.toolbar-select {
  margin-top: 0;
}

.contact-directory-table {
  display: grid;
  gap: 10px;
}

.contact-editor-card {
  margin-bottom: 18px;
}

.contact-editor-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.contact-editor-field {
  display: grid;
  gap: 8px;
}

.contact-editor-field span {
  color: var(--fc-text);
  font-size: 0.9rem;
  font-weight: 700;
}

.contact-editor-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 16px;
}

.contact-directory-row {
  display: grid;
  grid-template-columns:
    minmax(180px, 1.4fr)
    minmax(140px, 1fr)
    minmax(120px, 0.8fr)
    minmax(100px, 0.7fr)
    minmax(100px, 0.7fr)
    minmax(140px, 0.9fr)
    minmax(110px, 0.7fr)
    minmax(160px, 0.9fr);
  gap: 12px;
  padding: 14px 16px;
  border: 1px solid var(--fc-border);
  border-radius: 16px;
  background: var(--fc-surface);
}

.contact-directory-row > * {
  min-width: 0;
  color: var(--fc-text-muted);
  line-height: 1.5;
  word-break: break-word;
}

.contact-directory-head {
  background: transparent;
  border-style: dashed;
}

.contact-directory-head span {
  color: var(--fc-text);
  font-size: 0.8rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.contact-directory-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.workspace-secondary-button.danger {
  color: #a04a3a;
  border-color: color-mix(in srgb, #a04a3a 28%, var(--fc-border));
}

.workspace-secondary-button.danger:hover {
  border-color: color-mix(in srgb, #a04a3a 42%, var(--fc-border));
}

.primary-action,
.secondary-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: 0 16px;
  border-radius: 999px;
  text-decoration: none;
  font-weight: 800;
}

.primary-action {
  border: none;
  background: linear-gradient(135deg, var(--fc-accent) 0%, var(--fc-accent-dark) 100%);
  box-shadow: var(--fc-accent-shadow);
  color: var(--fc-accent-contrast);
  cursor: pointer;
}

.primary-action:disabled {
  cursor: wait;
  opacity: 0.7;
}

.secondary-action {
  border: 1px solid var(--fc-border);
  background: rgba(255, 255, 255, 0.72);
  box-shadow: 0 10px 20px rgba(60, 36, 21, 0.04);
  color: var(--fc-text);
  cursor: pointer;
}

.list-summary,
.campaign-list {
  display: grid;
  gap: 12px;
  margin: 18px 0 0;
  padding: 0;
  list-style: none;
}

.campaign-card {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  border: 1px solid var(--fc-border);
  border-radius: 18px;
  background: var(--fc-surface);
}

.campaign-card-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}

.campaign-card-heading {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
}

.campaign-status-chip.draft {
  background: color-mix(in srgb, var(--fc-surface-subtle) 92%, white 8%);
}

.campaign-card p,
.empty-note {
  margin: 4px 0 0;
  color: var(--fc-text-muted);
  line-height: 1.6;
}

.campaign-metrics {
  font-size: 0.88rem;
}

.campaign-last-send,
.campaign-send-summary {
  font-size: 0.82rem;
}

.campaign-progress {
  position: relative;
  width: min(320px, 100%);
  height: 8px;
  margin-top: 10px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--fc-surface-subtle);
  border: 1px solid var(--fc-border);
}

.campaign-progress-fill {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--fc-accent-strong), var(--fc-accent-soft));
}

.campaign-progress-copy {
  font-size: 0.8rem;
}

.campaign-audience-card {
  display: grid;
  gap: 10px;
  padding: 16px 18px;
  border: 1px solid var(--fc-border);
  border-radius: 20px;
  background: color-mix(in srgb, var(--fc-surface) 90%, white 10%);
}

.campaign-audience-header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
}

.campaign-audience-header strong {
  display: block;
  font-size: 1rem;
  color: var(--fc-text);
}

.campaign-audience-note {
  margin: 0;
}

.campaign-history-panel,
.campaign-history-list {
  display: grid;
  gap: 14px;
}

.campaign-history-panel {
  margin-top: 24px;
}

.campaign-history-card {
  display: grid;
  gap: 12px;
  padding: 16px 18px;
  border-radius: 18px;
  border: 1px solid var(--fc-border);
  background: color-mix(in srgb, var(--fc-surface) 92%, white 8%);
}

.campaign-history-card p {
  margin: 4px 0 0;
  color: var(--fc-text-muted);
}

.campaign-history-metrics {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.stats-strip {
  margin-top: 18px;
}

.stats-strip span {
  display: inline-flex;
  align-items: center;
  min-height: 36px;
  padding: 0 12px;
  border-radius: 999px;
  background: var(--fc-surface-subtle);
  border: 1px solid var(--fc-border);
  font-weight: 700;
}

.domain-card {
  margin-top: 20px;
}

.sender-setup-assist-card {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-top: 18px;
  padding: 18px;
  border: 1px solid color-mix(in srgb, var(--fc-border) 80%, rgba(215, 102, 52, 0.18));
  border-radius: 24px;
  background:
    radial-gradient(circle at top left, rgba(215, 102, 52, 0.08) 0%, rgba(215, 102, 52, 0) 42%),
    linear-gradient(180deg, rgba(255, 251, 246, 0.96) 0%, rgba(255, 246, 238, 0.88) 100%);
}

.sender-setup-assist-card strong {
  display: block;
  font-size: 1.02rem;
  line-height: 1.4;
}

.domain-summary-card {
  display: grid;
  gap: 16px;
}

.domain-summary-grid {
  display: grid;
  gap: 14px;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
}

.domain-summary-label {
  display: block;
  margin-bottom: 6px;
  color: var(--fc-text-muted);
  font-size: 0.82rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.domain-summary-grid strong {
  display: block;
  line-height: 1.45;
  word-break: break-word;
}

.domain-summary-logo-preview,
.signature-logo-preview {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 72px;
  padding: 12px 16px;
  border-radius: 18px;
  border: 1px solid color-mix(in srgb, var(--fc-border) 88%, transparent);
  background: rgba(255, 255, 255, 0.82);
}

.domain-summary-logo-preview {
  margin-bottom: 8px;
}

.domain-summary-logo-preview img,
.signature-logo-preview img {
  display: block;
  max-width: 180px;
  max-height: 64px;
  width: auto;
  height: auto;
  object-fit: contain;
}

.domain-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.domain-field {
  display: grid;
  gap: 8px;
}

.domain-field span {
  color: var(--fc-text-muted);
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.domain-field small {
  color: var(--fc-text-muted);
  line-height: 1.5;
}

.footer-details-field {
  margin-top: 18px;
}

.domain-summary-footer-preview {
  min-height: 120px;
}

.email-footer-form-grid,
.email-footer-social-grid {
  display: grid;
  gap: 12px;
}

.email-footer-form-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.email-footer-social-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.email-footer-editor-field.is-full,
.email-footer-social-grid.is-full {
  grid-column: 1 / -1;
}

.signature-preview-header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 12px;
}

.signature-preview-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: flex-start;
}

.field-validation {
  font-size: 0.84rem;
  font-weight: 700;
  line-height: 1.5;
}

.field-validation.error {
  color: var(--fc-danger-text, #a63d32);
}

.sender-setup-preview-grid {
  display: grid;
  gap: 12px;
  margin-top: 16px;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
}

.sender-setup-preview-card {
  display: grid;
  gap: 6px;
  padding: 16px 18px;
  border-radius: 20px;
  border: 1px solid var(--fc-border);
  background: rgba(255, 255, 255, 0.72);
}

.sender-setup-preview-card span {
  color: var(--fc-text-muted);
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.sender-setup-preview-card strong {
  line-height: 1.45;
  word-break: break-word;
}

.sender-setup-hint-list {
  display: grid;
  gap: 8px;
  margin: 16px 0 0;
  padding-left: 18px;
  color: var(--fc-text-muted);
  line-height: 1.6;
}

@media (max-width: 920px) {
  .email-tabs-header,
  .email-composer-grid,
  .email-overview-grid,
  .overview-quick-actions,
  .overview-dashboard-grid,
  .domain-grid,
  .email-footer-form-grid,
  .email-footer-social-grid,
  .contact-import-stack {
    grid-template-columns: 1fr;
  }

  .email-composer-sidebar {
    position: static;
  }

  .email-mobile-preview-device {
    width: min(100%, 420px);
  }

  .email-composer-advanced-toggle {
    align-items: stretch;
  }

  .contact-preview-summary,
  .contact-mapping-grid,
  .contact-editor-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .sender-setup-assist-card {
    flex-direction: column;
  }

  .email-header-actions {
    justify-content: flex-start;
  }

  .contact-preview-row,
  .contact-directory-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .workspace-shell {
    padding-top: 0;
  }

  .email-stat-card {
    min-height: auto;
  }

  .overview-empty-state {
    min-height: auto;
  }

  .overview-empty-actions,
  .overview-empty-button {
    width: 100%;
  }

  .email-composer-advanced-toggle,
  .email-composer-advanced-toggle .secondary-action,
  .email-header-actions,
  .campaign-dashboard-toolbar,
  .campaign-table-actions {
    width: 100%;
  }

  .contact-preview-summary,
  .contact-editor-grid,
  .contact-mapping-grid,
  .contact-preview-row,
  .contact-directory-row,
  .email-block-field-grid.two-up {
    grid-template-columns: 1fr;
  }
}
</style>
