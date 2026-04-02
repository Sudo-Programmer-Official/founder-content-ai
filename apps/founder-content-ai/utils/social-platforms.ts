import type { ScheduledPost, SocialAccount, SocialAccountIdentity } from "../../../packages/shared-types";

export type PublishableSocialPlatform = "linkedin" | "instagram" | "facebook";

export function resolveSocialPlatformLabel(platform: PublishableSocialPlatform): string {
  if (platform === "instagram") {
    return "Instagram";
  }

  if (platform === "facebook") {
    return "Facebook";
  }

  return "LinkedIn";
}

export function resolveSocialPlatformShortLabel(platform: PublishableSocialPlatform): string {
  if (platform === "instagram") {
    return "IG";
  }

  if (platform === "facebook") {
    return "FB";
  }

  return "LI";
}

export function findConnectedLinkedInAccount(accounts: SocialAccount[]): SocialAccount | null {
  return accounts.find((account) => account.platform === "linkedin" && account.status === "connected") ?? null;
}

export function findConnectedFacebookAccount(accounts: SocialAccount[]): SocialAccount | null {
  return accounts.find((account) => account.platform === "facebook" && account.status === "connected") ?? null;
}

export function findConnectedInstagramAccount(accounts: SocialAccount[]): SocialAccount | null {
  return (
    accounts.find(
      (account) =>
        account.platform === "facebook"
        && account.status === "connected"
        && account.availableIdentities.some((identity) => identity.platform === "instagram"),
    ) ?? null
  );
}

export function resolveInstagramIdentity(account: SocialAccount | null | undefined): SocialAccountIdentity | null {
  if (!account) {
    return null;
  }

  return account.availableIdentities.find((identity) => identity.platform === "instagram") ?? null;
}

export function resolvePublishingAccountLabel(
  platform: PublishableSocialPlatform,
  account: SocialAccount | null | undefined,
): string {
  if (!account) {
    return "";
  }

  if (platform === "instagram") {
    const instagramIdentity = resolveInstagramIdentity(account);
    const username =
      typeof instagramIdentity?.metadata?.username === "string"
        ? instagramIdentity.metadata.username.trim()
        : "";

    return (
      instagramIdentity?.displayName
      || username
      || (typeof account.metadata?.instagramDisplayName === "string" ? account.metadata.instagramDisplayName.trim() : "")
      || (typeof account.metadata?.instagramUsername === "string" ? account.metadata.instagramUsername.trim() : "")
      || account.platformUserId
    );
  }

  if (platform === "facebook") {
    if (account.selectedIdentity?.displayName) {
      return account.selectedIdentity.displayName;
    }

    const pageName =
      typeof account.metadata?.pageName === "string" ? account.metadata.pageName.trim() : "";

    return pageName || account.platformUserId;
  }

  if (account.selectedIdentity?.displayName) {
    return account.selectedIdentity.displayName;
  }

  const linkedInName =
    typeof account.metadata?.linkedInName === "string" ? account.metadata.linkedInName.trim() : "";

  return linkedInName || account.accountEmail || account.platformUserId;
}

export function resolvePublishingDescriptor(
  platform: PublishableSocialPlatform,
  account: SocialAccount | null | undefined,
): string {
  if (!account) {
    return `${resolveSocialPlatformLabel(platform)} not connected`;
  }

  if (platform === "instagram") {
    const instagramIdentity = resolveInstagramIdentity(account);
    const label = resolvePublishingAccountLabel(platform, account);

    return label ? `${label} · Business account` : "Instagram business account";
  }

  if (platform === "facebook") {
    const label = resolvePublishingAccountLabel(platform, account);
    return label ? `${label} · Page` : "Facebook Page";
  }

  const typeLabel =
    account.selectedIdentity?.type === "organization" ? "Company page" : "Personal profile";
  const label = resolvePublishingAccountLabel(platform, account);

  return label ? `${label} · ${typeLabel}` : typeLabel;
}

export function resolveScheduledIdentityTypeLabel(post: ScheduledPost): string {
  if (post.platform === "instagram") {
    return "Business account";
  }

  if (post.platform === "facebook") {
    return "Page";
  }

  if (post.selectedIdentityType === "organization") {
    return "Page";
  }

  if (post.selectedIdentityType === "person") {
    return "Personal";
  }

  return "LinkedIn";
}

export function resolveScheduledIdentityLabel(post: ScheduledPost): string {
  if (!post.selectedIdentityDisplayName) {
    return post.platform === "instagram" ? "Workspace Instagram account" : "Workspace LinkedIn identity";
  }

  return `${post.selectedIdentityDisplayName} · ${resolveScheduledIdentityTypeLabel(post)}`;
}

export function looksLikeSocialReconnectIssue(post: ScheduledPost): boolean {
  const message = post.errorMessage?.toLowerCase() || "";

  if (post.platform === "instagram") {
    return (
      message.includes("instagram")
      || message.includes("facebook page")
      || message.includes("meta")
      || message.includes("token")
      || message.includes("expired")
      || message.includes("permission")
      || message.includes("authorize")
      || message.includes("connect")
    );
  }

  if (post.platform === "facebook") {
    return (
      message.includes("facebook")
      || message.includes("page")
      || message.includes("meta")
      || message.includes("token")
      || message.includes("expired")
      || message.includes("permission")
      || message.includes("authorize")
      || message.includes("connect")
    );
  }

  return (
    message.includes("linkedin")
    || message.includes("token")
    || message.includes("expired")
    || message.includes("connect")
    || message.includes("permission")
    || message.includes("authorize")
  );
}

export function resolveExternalPostLabel(platform: PublishableSocialPlatform): string {
  if (platform === "instagram") {
    return "View on Instagram";
  }

  if (platform === "facebook") {
    return "View on Facebook";
  }

  return "View on LinkedIn";
}
