export function toFriendlySocialAuthMessage(
  message: string | null | undefined,
  platform?: "linkedin" | "facebook" | "instagram",
): string {
  const normalized = message?.trim() || "";

  if (!normalized) {
    return platform === "linkedin"
      ? "LinkedIn connection failed."
      : "Meta connection failed.";
  }

  switch (normalized) {
    case "no_pages_found":
      return "Meta connected, but no Facebook Pages were returned. Log into Facebook with an account that manages at least one Page, then try again.";
    case "connect_failed":
      return platform === "linkedin"
        ? "LinkedIn connection did not complete. Try again."
        : "Meta connection did not complete. Try again.";
    case "invalid_meta_session":
      return "The Meta page-selection session expired. Start the connection again.";
    case "meta_page_not_found":
      return "The selected Facebook Page is no longer available for this connection. Start Meta connect again.";
    case "facebook_not_connected":
      return "Connect a Facebook Page before publishing.";
    case "instagram_not_connected":
      return "Connect a Facebook Page with a linked Instagram business account before publishing.";
    default:
      return normalized;
  }
}
