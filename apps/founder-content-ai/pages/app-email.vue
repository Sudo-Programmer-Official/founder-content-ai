<script setup lang="ts">
import type {
  BusinessEmailSettings,
  BusinessMembership,
  EmailContact,
  EmailCampaignContent,
  EmailContactImportDuplicateStrategy,
  EmailContactImportField,
  EmailContactImportJob,
  EmailContactImportMapping,
  EmailContactStatus,
  ImportEmailContactsPreviewResponse,
  EmailCampaign,
  EmailCampaignStats,
  EmailList,
  ImportEmailContactsRequest,
  MediaRecommendationSuggestion,
  PostAsset,
  WorkspaceAsset,
} from "../../../packages/shared-types";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useProductAccessContext } from "../access/product-access-context";
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
  requestEmailCampaignSend,
  requestEmailCampaignStats,
  requestEmailCampaigns,
  requestEmailContactImportJobs,
  requestEmailContacts,
  requestEmailContactsImportJobCreate,
  requestEmailContactsImportPreview,
  requestEmailDomainCreate,
  requestEmailDomainSettings,
  requestEmailLists,
} from "../services/email-service";
import { requestVisualGeneration } from "../services/generation-service";
import { requestMediaRecommendations } from "../services/media-intelligence-service";
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

const route = useRoute();
const router = useRouter();
const {
  bootstrap: productAccess,
  activeBusinessId,
  setActiveBusinessId,
  refreshProductAccess,
  isFeatureEnabled,
} = useProductAccessContext();

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
const isSavingDomain = ref(false);
const isEditingDomainSetup = ref(false);
const isLoadingDraftMedia = ref(false);
const isUploadingDraftMedia = ref(false);
const isWorkspaceAssetPickerOpen = ref(false);
const isLoadingMediaRecommendations = ref(false);
const isGeneratingMediaRecommendationId = ref("");
const errorMessage = ref("");
const feedbackMessage = ref("");
const latestStatsCampaignId = ref("");
const emailMediaAssets = ref<PostAsset[]>([]);
const mediaRecommendations = ref<MediaRecommendationSuggestion[]>([]);
let campaignProgressPollHandle: number | null = null;
let importJobPollHandle: number | null = null;

type EmailTabKey = "overview" | "campaigns" | "contacts" | "settings";
type CampaignSourceMode = "current" | "draft-library" | "fresh";
type CampaignToneMode = "direct" | "story" | "educational";
type CampaignEditorMode = "edit" | "preview";

const EMAIL_TABS: Array<{ key: EmailTabKey; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "campaigns", label: "Campaigns" },
  { key: "contacts", label: "Contacts" },
  { key: "settings", label: "Settings" },
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
  { field: "tags", label: "Tags", required: false },
];

const contactImport = ref<ImportEmailContactsRequest>({
  listName: "Launch List",
  csvText: "",
});
const contactImportPreview = ref<ImportEmailContactsPreviewResponse | null>(null);
const contactImportMapping = ref<EmailContactImportMapping>({});
const contactImportDuplicateStrategy = ref<EmailContactImportDuplicateStrategy>("upsert");
const contactImportFileName = ref("");
const isPreviewingContacts = ref(false);
const contactSearch = ref("");
const contactStatusFilter = ref<EmailContactStatus | "all">("all");
const latestImportJobId = ref("");
const activationDraftLibrary = ref<ActivationDraftRecord[]>([]);
const campaignSourceMode = ref<CampaignSourceMode>("fresh");
const campaignTone = ref<CampaignToneMode>("direct");
const campaignEditorMode = ref<CampaignEditorMode>("edit");
const selectedLibraryDraftId = ref("");

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

const domainForm = ref({
  domainName: "",
  fromName: "",
  fromEmail: "",
  replyToEmail: "",
  signatureText: "",
});

const emailFeatureEnabled = computed(
  () =>
    !selectedBusinessId.value ||
    !productAccess.value?.activeBusinessId ||
    isFeatureEnabled("email_campaigns"),
);
const emailLimitText = computed(() => {
  const limits = productAccess.value?.limits;
  return limits ? `Emails left today: ${limits.emailsRemaining}` : "";
});
const hasConfiguredDomain = computed(() => Boolean(domainSettings.value?.domainName));
const domainStatusSummary = computed(() => {
  const settings = domainSettings.value;

  if (!settings?.domainName) {
    return "Not configured";
  }

  if (settings.domainStatus === "verified" && settings.dkimStatus === "verified" && settings.spfStatus === "verified") {
    return "Ready to send";
  }

  return "Verification in progress";
});
const activeEmailTab = computed<EmailTabKey>(() => {
  const requestedTab = typeof route.query.tab === "string" ? route.query.tab : "";

  if (EMAIL_TABS.some((tab) => tab.key === requestedTab)) {
    return requestedTab as EmailTabKey;
  }

  if (activationSeed.value) {
    return "campaigns";
  }

  return "overview";
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
const contactImportColumns = computed(() => contactImportPreview.value?.columns ?? []);
const canPreviewContacts = computed(() => contactImport.value.csvText.trim().length > 0);
const canImportContacts = computed(
  () =>
    Boolean(selectedBusinessId.value) &&
    contactImport.value.listName.trim().length > 0 &&
    contactImport.value.csvText.trim().length > 0 &&
    Boolean(contactImportMapping.value.email || contactImportPreview.value?.suggestedMapping.email),
);
const filteredContacts = computed(() => {
  const searchValue = contactSearch.value.trim().toLowerCase();

  return emailContacts.value.filter((contact) => {
    if (contactStatusFilter.value !== "all" && contact.status !== contactStatusFilter.value) {
      return false;
    }

    if (!searchValue) {
      return true;
    }

    const fullName = [contact.firstName, contact.lastName].filter(Boolean).join(" ").toLowerCase();
    return (
      contact.email.toLowerCase().includes(searchValue) ||
      fullName.includes(searchValue) ||
      contact.tags.some((tag) => tag.toLowerCase().includes(searchValue))
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

  if (draftId) {
    return getActivationDraft(draftId)?.result.post ?? prefillText;
  }

  return prefillText;
});
const activationDraft = computed(() => {
  const draftId = typeof route.query.draftId === "string" ? route.query.draftId : "";
  return draftId ? getActivationDraft(draftId) : null;
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
  const paragraphs = bodyText
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== "");

  const htmlParts: string[] = ['<div class="email-preview-frame-inner">'];

  if (campaignForm.value.headerImageUrl) {
    htmlParts.push(
      `<div class="email-preview-image is-header"><img src="${escapeHtml(campaignForm.value.headerImageUrl)}" alt="${escapeHtml(campaignForm.value.subject || "Email header image")}" /></div>`,
    );
  }

  paragraphs.forEach((paragraph, index) => {
    htmlParts.push(`<p>${linkifyHtmlText(paragraph)}</p>`);

    if (index === 0) {
      for (const imageUrl of campaignForm.value.inlineImageUrls) {
        htmlParts.push(
          `<div class="email-preview-image"><img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(campaignForm.value.subject || "Email image")}" /></div>`,
        );
      }
    }
  });

  if (paragraphs.length === 0) {
    htmlParts.push('<p class="email-preview-placeholder">Write the email body here to see the preview.</p>');
  }

  if (signatureText) {
    const signatureParagraphs = signatureText
      .split(/\n{2,}/)
      .map((paragraph) => paragraph.trim())
      .filter((paragraph) => paragraph !== "");

    htmlParts.push('<div class="email-preview-signature">');

    for (const paragraph of signatureParagraphs) {
      htmlParts.push(`<p>${linkifyHtmlText(paragraph)}</p>`);
    }

    htmlParts.push("</div>");
  }

  htmlParts.push("</div>");
  return htmlParts.join("");
});
const availableDraftImages = computed(() =>
  emailMediaAssets.value.map((asset) => ({
    id: asset.id,
    url: asset.previewUrl || asset.storageUrl,
    label: `Image ${asset.orderIndex + 1}`,
  })),
);
const effectiveSignatureText = computed(() => {
  const explicit = (domainForm.value.signatureText || domainSettings.value?.signatureText || "").trim();

  if (explicit) {
    return explicit;
  }

  return [domainForm.value.fromName || domainSettings.value?.fromName, domainForm.value.fromEmail || domainSettings.value?.fromEmail]
    .map((value) => value?.trim() || "")
    .filter((value) => value !== "")
    .join("\n");
});
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
  if (!domainSettings.value?.domainName) {
    return "Not configured";
  }

  if (
    domainSettings.value.domainStatus === "verified" &&
    domainSettings.value.dkimStatus === "verified" &&
    domainSettings.value.spfStatus === "verified"
  ) {
    return "Fully verified";
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

  if (settings.spfStatus !== "verified") {
    warnings.push("SPF is not verified yet.");
  }

  if (settings.dkimStatus !== "verified") {
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
  campaignEditorMode.value = "edit";
}

function applyActivationSeed(): void {
  if (!activationSeed.value || campaignSourceMode.value !== "current") {
    return;
  }

  applySourceToCampaign(activationSeed.value, activationDraft.value?.result.idea.title);
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
  campaignSourceMode.value = "fresh";
  campaignForm.value.subject = "";
  campaignForm.value.bodyText = "";
  resetSelectedMedia();
  campaignEditorMode.value = "edit";
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

function insertLinkPlaceholder(): void {
  const nextValue = campaignForm.value.bodyText.trimEnd();
  campaignForm.value.bodyText = nextValue ? `${nextValue}\n\nhttps://` : "https://";
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

async function loadEmailMediaRecommendations(): Promise<void> {
  if (!selectedBusinessId.value || !campaignForm.value.bodyText.trim()) {
    mediaRecommendations.value = [];
    return;
  }

  isLoadingMediaRecommendations.value = true;

  try {
    const response = await requestMediaRecommendations({
      businessId: selectedBusinessId.value,
      contentText: `${campaignForm.value.subject}\n\n${campaignForm.value.bodyText}`.trim(),
      contentType: "email",
      goal: "conversion",
      sourceAssetIds: emailMediaAssets.value.map((asset) => asset.id),
    });

    mediaRecommendations.value = response.suggestions;
  } catch (error) {
    mediaRecommendations.value = [];
    errorMessage.value =
      error instanceof Error ? error.message : "Unable to load media recommendations.";
  } finally {
    isLoadingMediaRecommendations.value = false;
  }
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

    feedbackMessage.value = `${suggestion.title} added to this email.`;
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

  if (!options.syncForm) {
    return;
  }

  domainForm.value = {
    domainName: settings?.domainName ?? "",
    fromName: settings?.fromName ?? "",
    fromEmail: settings?.fromEmail ?? "",
    replyToEmail: settings?.replyToEmail ?? "",
    signatureText: settings?.signatureText ?? "",
  };
}

function setEmailTab(tab: EmailTabKey): void {
  const nextQuery = {
    ...route.query,
    tab: tab === "overview" ? undefined : tab,
  };

  void router.replace({ query: nextQuery });
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
    applyDomainSettings(null, { syncForm: options.syncDomainForm });
    return;
  }

  const [listsResponse, campaignsResponse, domainResponse, contactsResponse, importJobsResponse] = await Promise.all([
    requestEmailLists(selectedBusinessId.value),
    requestEmailCampaigns(selectedBusinessId.value),
    requestEmailDomainSettings(selectedBusinessId.value),
    requestEmailContacts(selectedBusinessId.value, { limit: 200 }),
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
        recipientCount: matchingCampaign.recipientCount,
        pendingCount: matchingCampaign.pendingCount,
        sentCount: matchingCampaign.sentCount,
        deliveredCount: matchingCampaign.deliveredCount,
        failedCount: matchingCampaign.failedCount,
        unsubscribedCount: matchingCampaign.unsubscribedCount,
      };
    }
  }

  startCampaignProgressPolling();
  startImportJobPolling();

  if (!campaignForm.value.listId && emailLists.value[0]) {
    campaignForm.value.listId = emailLists.value[0].id;
  }

  await loadDraftMedia();
}

async function initializePage(): Promise<void> {
  isLoading.value = true;
  errorMessage.value = "";

  try {
    loadActivationDraftLibrary();

    if (activationSeed.value) {
      campaignSourceMode.value = "current";
    }

    await loadBusinesses();
    await loadEmailState({ syncDomainForm: true });
    applyActivationSeed();
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
    const response = await requestEmailContactsImportJobCreate(selectedBusinessId.value, {
      ...contactImport.value,
      fileName: contactImportFileName.value || undefined,
      mapping: Object.keys(contactImportMapping.value).length > 0 ? contactImportMapping.value : undefined,
      duplicateStrategy: contactImportDuplicateStrategy.value,
    });
    latestImportJobId.value = response.importJob.id;
    feedbackMessage.value = `Import queued for ${response.importJob.listName}. ${response.importJob.totalRows} rows are being processed in the background.`;
    contactImport.value.csvText = "";
    contactImportFileName.value = "";
    resetContactImportPreview();
    await loadEmailState();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Unable to import contacts.";
  } finally {
    isImporting.value = false;
  }
}

async function createCampaign(): Promise<void> {
  if (!selectedBusinessId.value || !campaignForm.value.listId) {
    errorMessage.value = "Import contacts first so a list exists for this campaign.";
    return;
  }

  isCreatingCampaign.value = true;
  errorMessage.value = "";

  try {
    const response = await requestEmailCampaignCreate(selectedBusinessId.value, {
      listId: campaignForm.value.listId,
      name: campaignForm.value.name,
      subject: campaignForm.value.subject,
      bodyText: campaignForm.value.bodyText,
      replyToEmail: campaignForm.value.replyToEmail || undefined,
      sourceAssetId: effectiveSourcePostId.value || undefined,
      sourceIdeaId: effectiveSourceIdeaId.value || undefined,
      sourceTitle: effectiveSourceTitle.value || undefined,
      content: campaignContentPayload.value,
    });
    feedbackMessage.value = `Campaign created: ${response.campaign.name}.`;
    await loadEmailState();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Unable to create campaign.";
  } finally {
    isCreatingCampaign.value = false;
  }
}

async function sendCampaign(campaignId: string): Promise<void> {
  if (!selectedBusinessId.value) {
    return;
  }

  isSending.value = true;
  errorMessage.value = "";

  try {
    const response = await requestEmailCampaignSend(selectedBusinessId.value, campaignId);
    latestStatsCampaignId.value = campaignId;
    latestStats.value = response.stats;
    feedbackMessage.value = `Campaign queued. Processing ${response.stats.recipientCount} recipients in the background.`;
    await Promise.all([
      loadEmailState(),
      refreshProductAccess(selectedBusinessId.value),
      requestEmailCampaignStats(selectedBusinessId.value, campaignId).then((statsResponse) => {
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

async function saveDomainUpgrade(): Promise<void> {
  if (!selectedBusinessId.value || !domainForm.value.domainName.trim()) {
    errorMessage.value = "Add a domain name before saving the brand sender setup.";
    return;
  }

  isSavingDomain.value = true;
  errorMessage.value = "";

  try {
    const response = await requestEmailDomainCreate(selectedBusinessId.value, domainForm.value);
    applyDomainSettings(response.settings, { syncForm: true });
    isEditingDomainSetup.value = false;
    feedbackMessage.value = `Domain setup saved for ${response.settings.domainName}.`;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Unable to save domain settings.";
  } finally {
    isSavingDomain.value = false;
  }
}

watch(() => productAccess.value?.activeBusinessId || activeBusinessId.value, (nextBusinessId, previousBusinessId) => {
  if (!nextBusinessId || nextBusinessId === previousBusinessId) {
    return;
  }

  selectedBusinessId.value = nextBusinessId;
  contactImportFileName.value = "";
  resetContactImportPreview();

  void (async () => {
    await loadBusinesses();
    await loadEmailState({ syncDomainForm: true });
  })();
});

watch(
  () => [route.query.draftId, selectedBusinessId.value],
  () => {
    loadActivationDraftLibrary();

    if (activationSeed.value) {
      campaignSourceMode.value = "current";
    }

    applyActivationSeed();
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
  () => [
    selectedBusinessId.value,
    campaignForm.value.subject,
    campaignForm.value.bodyText,
    emailMediaAssets.value.length,
  ],
  () => {
    void loadEmailMediaRecommendations();
  },
  { immediate: true },
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
});
</script>

<template>
  <main class="workspace-shell">
    <p v-if="errorMessage" class="workspace-feedback error">{{ errorMessage }}</p>
    <p v-else-if="feedbackMessage" class="workspace-feedback">{{ feedbackMessage }}</p>

    <EmailSkeleton v-if="isLoading" />

    <template v-else>
      <section v-if="!selectedBusinessId" class="workspace-card empty-state">
        <h2>Email needs a workspace.</h2>
        <p>Create or select a workspace first, then send the first campaign from there.</p>
        <router-link class="primary-action" :to="appRoutes.onboarding">Set up workspace</router-link>
      </section>

      <section v-else-if="!emailFeatureEnabled" class="workspace-card empty-state">
        <h2>Email is not enabled for this workspace.</h2>
        <p>You can still generate content now, then enable email later when access is ready.</p>
      </section>

      <section v-else class="email-workspace-stack">
        <section class="workspace-card email-tabs-card">
          <div class="email-tabs-header">
            <div>
              <p class="panel-meta">Email campaigns</p>
              <h1>Manage lists, campaigns, and delivery</h1>
              <p class="panel-note">Operate email from one workspace without leaving the product flow.</p>
            </div>
            <span class="workspace-chip email-workspace-chip">
              {{ businesses.find((membership) => membership.businessId === selectedBusinessId)?.business.name || "Workspace" }}
            </span>
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

        <section v-if="activeEmailTab === 'overview'" class="email-overview-stack">
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
            <button type="button" class="primary-action overview-action-button" @click="setEmailTab('campaigns')">
              Create campaign
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
                  <button type="button" class="secondary-action" @click="setEmailTab('campaigns')">
                    View
                  </button>
                </article>
              </div>
              <div v-else class="empty-note overview-empty-state">
                <p>No campaigns yet.</p>
                <button type="button" class="primary-action" @click="setEmailTab('campaigns')">
                  Create your first campaign
                </button>
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
              <h2>Write once, then send a clean email</h2>
              <p class="panel-note">Text first. Media supports the message instead of becoming the message.</p>
            </div>
          </div>

          <section class="campaign-flow-panel">
            <div class="panel-header">
              <div>
                <p class="panel-meta">Step 1 · Source</p>
                <h3>Start from something that already exists</h3>
                <p class="panel-note">Use a seeded draft, pull from your draft library, or start fresh. No blank-builder dead end.</p>
              </div>
            </div>

            <div class="campaign-source-mode-row">
              <button
                v-if="currentSourceSummary"
                type="button"
                class="workspace-secondary-button compact"
                :class="{ active: campaignSourceMode === 'current' }"
                @click="useCurrentSource"
              >
                Current source
              </button>
              <button
                type="button"
                class="workspace-secondary-button compact"
                :class="{ active: campaignSourceMode === 'draft-library' }"
                @click="campaignSourceMode = 'draft-library'"
              >
                Draft library
              </button>
              <button
                type="button"
                class="workspace-secondary-button compact"
                :class="{ active: campaignSourceMode === 'fresh' }"
                @click="startFreshCampaign"
              >
                Start fresh
              </button>
            </div>

            <article v-if="campaignSourceMode === 'current' && currentSourceSummary" class="campaign-source-card active">
              <div class="campaign-source-copy">
                <span class="workspace-chip">{{ currentSourceSummary.typeLabel }}</span>
                <strong>{{ currentSourceSummary.title }}</strong>
                <p>{{ currentSourceSummary.preview }}</p>
              </div>
              <button type="button" class="secondary-action" @click="useCurrentSource">
                Use source
              </button>
            </article>

            <div v-else-if="campaignSourceMode === 'draft-library'" class="campaign-source-grid">
              <article
                v-for="draft in libraryDraftCards"
                :key="draft.id"
                class="campaign-source-card"
                :class="{ active: selectedLibraryDraftId === draft.id }"
              >
                <div class="campaign-source-copy">
                  <span class="workspace-chip">{{ draft.modeLabel }}</span>
                  <strong>{{ draft.title }}</strong>
                  <p>{{ draft.preview }}</p>
                  <small>{{ draft.createdAtLabel }}</small>
                </div>
                <button type="button" class="secondary-action" @click="useLibraryDraft(draft.id)">
                  Use draft
                </button>
              </article>
              <p v-if="libraryDraftCards.length === 0" class="panel-note">
                No saved drafts yet. Generate one from the dashboard or result screen first.
              </p>
            </div>

            <p v-else class="panel-note">
              Starting fresh keeps the editor empty. Use this when the campaign should not inherit a post or draft.
            </p>
          </section>

          <div class="campaign-flow-toolbar">
            <div class="campaign-flow-group">
              <span class="panel-meta">Step 2 · Transform</span>
              <div class="campaign-source-mode-row">
                <button
                  type="button"
                  class="workspace-secondary-button compact"
                  :class="{ active: campaignTone === 'direct' }"
                  @click="setCampaignTone('direct')"
                >
                  Direct
                </button>
                <button
                  type="button"
                  class="workspace-secondary-button compact"
                  :class="{ active: campaignTone === 'story' }"
                  @click="setCampaignTone('story')"
                >
                  Story
                </button>
                <button
                  type="button"
                  class="workspace-secondary-button compact"
                  :class="{ active: campaignTone === 'educational' }"
                  @click="setCampaignTone('educational')"
                >
                  Educational
                </button>
              </div>
            </div>

            <div class="campaign-flow-group">
              <span class="panel-meta">Step 3 · Edit or preview</span>
              <div class="campaign-source-mode-row">
                <button
                  type="button"
                  class="workspace-secondary-button compact"
                  :class="{ active: campaignEditorMode === 'edit' }"
                  @click="campaignEditorMode = 'edit'"
                >
                  Edit
                </button>
                <button
                  type="button"
                  class="workspace-secondary-button compact"
                  :class="{ active: campaignEditorMode === 'preview' }"
                  @click="campaignEditorMode = 'preview'"
                >
                  Preview
                </button>
              </div>
            </div>
          </div>

          <p class="panel-meta">Step 4 · Audience</p>
          <select v-model="campaignForm.listId" class="workspace-select full-width">
            <option value="" disabled>Select list</option>
            <option v-for="list in emailLists" :key="list.id" :value="list.id">
              {{ list.name }}
            </option>
          </select>
          <input v-model="campaignForm.name" class="workspace-input" placeholder="Campaign name" />
          <input v-model="campaignForm.subject" class="workspace-input" placeholder="Subject line" />
          <input
            v-model="campaignForm.replyToEmail"
            class="workspace-input"
            placeholder="Reply-to email (optional)"
          />
          <div class="email-editor-toolbar">
            <button type="button" class="workspace-secondary-button compact" @click="insertLinkPlaceholder">
              Insert link
            </button>
            <button
              type="button"
              class="workspace-secondary-button compact"
              :class="{ active: campaignForm.includeSignature }"
              @click="toggleSignature"
            >
              {{ campaignForm.includeSignature ? "Signature on" : "Signature off" }}
            </button>
          </div>

          <textarea
            v-if="campaignEditorMode === 'edit'"
            v-model="campaignForm.bodyText"
            class="workspace-textarea"
            placeholder="Write the email body here. Links stay clickable and the signature is appended automatically."
          />

          <section v-else class="email-preview-shell">
            <div class="email-preview-header">
              <div>
                <p class="panel-meta">Preview</p>
                <h3>{{ campaignForm.subject || "Add a subject line" }}</h3>
              </div>
              <span class="workspace-chip">{{ campaignTone }}</span>
            </div>
            <div class="email-preview-frame" v-html="previewEmailHtml"></div>
          </section>

          <section v-if="campaignEditorMode === 'edit'" class="email-media-panel">
            <div class="panel-header">
              <div>
                <p class="panel-meta">Media</p>
                <h3>Optional images and signature</h3>
                <p class="panel-note">Use one banner or a few inline images. Keep the email easy to read on mobile.</p>
              </div>
            </div>

            <div v-if="visibleMediaRecommendations.length > 0 || isLoadingMediaRecommendations" class="media-recommendation-panel">
              <div class="panel-header compact">
                <div>
                  <p class="panel-meta">Recommended next move</p>
                  <strong>Choose the fastest safe visual path for this email</strong>
                </div>
                <span class="workspace-chip">{{ campaignForm.headerImageUrl || campaignForm.inlineImageUrls.length > 0 ? "Media attached" : "Text-first" }}</span>
              </div>

              <p v-if="isLoadingMediaRecommendations" class="panel-note">Loading media recommendations...</p>

              <div v-else class="media-recommendation-grid">
                <article
                  v-for="suggestion in visibleMediaRecommendations"
                  :key="suggestion.id"
                  class="media-recommendation-card"
                >
                  <div>
                    <p class="panel-meta">{{ suggestion.actionType.replace(/_/g, " ") }}</p>
                    <strong>{{ suggestion.title }}</strong>
                    <p>{{ suggestion.description }}</p>
                    <small>{{ suggestion.reason }}</small>
                  </div>
                  <button
                    type="button"
                    class="workspace-secondary-button compact"
                    :disabled="isGeneratingMediaRecommendationId === suggestion.id || isUploadingDraftMedia"
                    @click="void applyEmailMediaRecommendation(suggestion)"
                  >
                    {{
                      suggestion.actionType === "generate_visual"
                        ? isGeneratingMediaRecommendationId === suggestion.id
                          ? "Generating..."
                          : "Generate visual"
                        : suggestion.actionType === "use_existing_asset"
                          ? "Use existing"
                          : "Skip media"
                    }}
                  </button>
                </article>
              </div>
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
            <p v-else class="panel-note">No source media found. You can still paste image URLs if this email needs visual support.</p>

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

            <div class="signature-preview-card">
              <p class="panel-meta">Signature</p>
              <strong>{{ campaignForm.includeSignature ? "Will be included" : "Not included" }}</strong>
              <pre>{{ effectiveSignatureText || "Set a sender signature in Email settings." }}</pre>
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

          <p class="panel-meta">Step 5 · Create draft</p>
          <div class="workspace-actions">
            <button type="button" class="primary-action" :disabled="isCreatingCampaign" @click="createCampaign">
              {{ isCreatingCampaign ? "Creating..." : "Create campaign" }}
            </button>
            <router-link class="secondary-action" :to="appRoutes.appGenerate">
              Generate another post
            </router-link>
          </div>

          <div class="campaign-list">
            <article v-for="campaign in campaigns" :key="campaign.id" class="campaign-card">
              <div>
                <strong>{{ campaign.name }}</strong>
                <p>{{ campaign.subject }}</p>
                <p v-if="campaign.sourceTitle" class="campaign-source-note">From {{ campaign.sourceTitle }}</p>
                <p class="campaign-metrics">
                  {{ formatStatus(campaign.status) }} · {{ formatCampaignProgress(campaign) }} · {{ campaign.deliveredCount }} delivered ·
                  {{ campaign.failedCount }} failed
                </p>
                <div v-if="campaign.recipientCount > 0" class="campaign-progress">
                  <span class="campaign-progress-fill" :style="{ width: `${getCampaignProgressPercent(campaign)}%` }"></span>
                </div>
                <p v-if="campaign.recipientCount > 0" class="campaign-progress-copy">
                  {{ getCampaignProgressPercent(campaign) }}% complete
                </p>
              </div>
              <button
                type="button"
                class="secondary-action"
                :disabled="isSending || campaign.status === 'queued' || campaign.status === 'sending' || campaign.status === 'sent'"
                @click="sendCampaign(campaign.id)"
              >
                {{ getCampaignActionLabel(campaign) }}
              </button>
            </article>
          </div>

          <div v-if="latestStats" class="stats-strip">
            <span>Sent: {{ latestStats.sentCount }}</span>
            <span>Delivered: {{ latestStats.deliveredCount }}</span>
            <span>Failed: {{ latestStats.failedCount }}</span>
            <span>Unsubscribed: {{ latestStats.unsubscribedCount }}</span>
          </div>
        </section>

        <section v-else-if="activeEmailTab === 'contacts'" class="workspace-card">
          <div class="panel-header">
            <div>
              <p class="panel-meta">Contacts</p>
              <h2>Import and manage your launch audience</h2>
              <p class="panel-note">
                {{ businesses.find((membership) => membership.businessId === selectedBusinessId)?.business.name || "No workspace selected" }}
              </p>
            </div>
          </div>

          <div class="contact-import-stack">
            <div class="contact-import-inputs">
              <input v-model="contactImport.listName" class="workspace-input" placeholder="List name" />

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
                placeholder="email,name&#10;founder@yourbrand.com, Founder"
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
          <div v-else class="empty-note">No lists yet. Import a CSV and the first list is created automatically.</div>

          <section class="contact-directory">
            <div class="panel-header">
              <div>
                <p class="panel-meta">Contact directory</p>
                <h3>{{ emailContactsTotal }} contacts in this workspace</h3>
                <p class="panel-note">
                  Active {{ contactCoverageSummary.active }} · Unsubscribed {{ contactCoverageSummary.unsubscribed }} ·
                  Suppressed {{ contactCoverageSummary.suppressed }}
                </p>
              </div>
            </div>

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
            </div>

            <div v-if="filteredContacts.length > 0" class="contact-directory-table">
              <div class="contact-directory-row contact-directory-head">
                <span>Email</span>
                <span>Name</span>
                <span>Status</span>
                <span>Tags</span>
                <span>Updated</span>
              </div>
              <div
                v-for="contact in filteredContacts"
                :key="contact.id"
                class="contact-directory-row"
              >
                <span>{{ contact.email }}</span>
                <span>{{ [contact.firstName, contact.lastName].filter(Boolean).join(" ") || "—" }}</span>
                <span>{{ formatStatus(contact.status) }}</span>
                <span>{{ contact.tags.join(", ") || "—" }}</span>
                <span>{{ contact.updatedAt ? new Date(contact.updatedAt).toLocaleDateString() : "—" }}</span>
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
              <span class="workspace-chip">SPF: {{ formatStatus(domainSettings?.spfStatus) }}</span>
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
                <span class="domain-summary-label">Signature</span>
                <strong>{{ domainSettings?.signatureText || "Uses sender identity" }}</strong>
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
                  : "Save a sender identity once, then reuse it every time this workspace comes back to email."
              }}
            </p>

            <div class="domain-grid">
              <input v-model="domainForm.domainName" class="workspace-input" placeholder="yourbrand.com" />
              <input v-model="domainForm.fromName" class="workspace-input" placeholder="From name" />
              <input v-model="domainForm.fromEmail" class="workspace-input" placeholder="marketing@yourbrand.com" />
              <input v-model="domainForm.replyToEmail" class="workspace-input" placeholder="reply-to email" />
            </div>
            <textarea
              v-model="domainForm.signatureText"
              class="workspace-textarea compact"
              placeholder="Abhishek&#10;Founder, PlanCraft AI&#10;https://linkedin.com/in/abhishek"
            />

            <div class="workspace-actions">
              <button type="button" class="primary-action" :disabled="isSavingDomain" @click="saveDomainUpgrade">
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
  </main>
</template>

<style scoped>
.workspace-shell {
  width: min(100%, 1120px);
  margin: 0 auto;
  padding: 32px 20px 80px;
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

.workspace-feedback {
  margin: 0 0 18px;
  font-weight: 700;
}

.workspace-feedback.error {
  color: var(--fc-danger-text, #a63d32);
}

.workspace-description.compact {
  margin-top: 10px;
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
  gap: 18px;
}

.email-tabs-header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
}

.email-tabs-header h1 {
  margin: 0;
  font-size: clamp(2rem, 3.2vw, 2.75rem);
  line-height: 1.04;
}

.email-workspace-chip {
  align-self: flex-start;
  margin-top: 0.1rem;
}

.email-tab-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
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
  grid-template-columns: repeat(5, minmax(0, 1fr));
}

.email-stat-card {
  display: grid;
  gap: 8px;
  min-height: 132px;
  align-content: end;
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

.email-preview-frame :deep(.email-preview-frame-inner) {
  width: 100%;
  max-width: 600px;
  margin: 0 auto;
  color: #241813;
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

.email-preview-frame :deep(.email-preview-signature) {
  margin-top: 28px;
  padding-top: 18px;
  border-top: 1px solid #eaded2;
}

.email-preview-frame :deep(.email-preview-signature p) {
  margin-bottom: 10px;
  font-size: 14px;
  color: #6d5d53;
}

.email-preview-frame :deep(.email-preview-placeholder) {
  color: var(--fc-text-muted);
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

.overview-domain-status {
  display: grid;
  gap: 8px;
  margin-top: 18px;
}

.overview-quick-actions {
  display: grid;
  gap: 14px;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.overview-action-button {
  width: 100%;
  min-height: 54px;
}

.overview-dashboard-grid {
  display: grid;
  gap: 20px;
  grid-template-columns: minmax(0, 1.4fr) minmax(280px, 0.6fr);
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

.overview-empty-state {
  display: grid;
  gap: 14px;
  justify-items: start;
  margin-top: 0;
}

.overview-empty-state p {
  margin: 0;
}

.status-summary-grid {
  display: grid;
  gap: 12px;
}

.status-summary-card {
  display: grid;
  gap: 6px;
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
  grid-template-columns: minmax(180px, 1.2fr) minmax(140px, 0.9fr) minmax(120px, 0.8fr) minmax(180px, 1.2fr);
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

.contact-directory-row {
  display: grid;
  grid-template-columns: minmax(180px, 1.4fr) minmax(140px, 1fr) minmax(120px, 0.8fr) minmax(120px, 0.9fr) minmax(110px, 0.7fr);
  gap: 12px;
  padding: 14px 16px;
  border: 1px solid var(--fc-border);
  border-radius: 16px;
  background: var(--fc-surface);
}

.contact-directory-row span {
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

.primary-action,
.secondary-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 48px;
  padding: 0 18px;
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
  background: transparent;
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

.campaign-card p,
.empty-note {
  margin: 4px 0 0;
  color: var(--fc-text-muted);
  line-height: 1.6;
}

.campaign-metrics {
  font-size: 0.88rem;
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

.domain-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

@media (max-width: 920px) {
  .email-overview-grid,
  .overview-quick-actions,
  .overview-dashboard-grid,
  .domain-grid,
  .contact-import-stack {
    grid-template-columns: 1fr;
  }

  .email-tabs-header {
    align-items: stretch;
  }

  .contact-preview-summary,
  .contact-mapping-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .contact-preview-row,
  .contact-directory-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .email-stat-card {
    min-height: auto;
  }

  .contact-preview-summary,
  .contact-mapping-grid,
  .contact-preview-row,
  .contact-directory-row {
    grid-template-columns: 1fr;
  }
}
</style>
