import type { VisualWatermarkMode } from "../../../../packages/shared-types/index.ts";
import type { AuthenticatedPrincipal } from "../middleware/auth.ts";

export interface BrandingPolicyInput {
  principal?: AuthenticatedPrincipal;
  businessId?: string;
  watermarkMode?: VisualWatermarkMode;
}

export interface BrandingPolicy {
  planTier: "free";
  watermarkApplied: boolean;
  watermarkText: string;
  captionFooterCredit: string;
}

const DEFAULT_WATERMARK_TEXT = "FounderContent AI";
const DEFAULT_CAPTION_FOOTER_CREDIT = "Optimized with FounderContent AI";

export function resolveBrandingPolicy(input: BrandingPolicyInput = {}): BrandingPolicy {
  const requestedMode = input.watermarkMode ?? "auto";
  const isFreeTier = true;
  const watermarkApplied = requestedMode === "on" || (requestedMode !== "off" && isFreeTier) || isFreeTier;

  return {
    planTier: "free",
    watermarkApplied,
    watermarkText: DEFAULT_WATERMARK_TEXT,
    captionFooterCredit: DEFAULT_CAPTION_FOOTER_CREDIT,
  };
}

export function appendCaptionFooterCredit(baseCaption: string, creditLine: string): string {
  const normalizedCaption = baseCaption.trim();
  const normalizedCreditLine = creditLine.trim();

  if (!normalizedCreditLine) {
    return normalizedCaption;
  }

  if (!normalizedCaption) {
    return normalizedCreditLine;
  }

  if (normalizedCaption.includes(normalizedCreditLine)) {
    return normalizedCaption;
  }

  return `${normalizedCaption}\n\n${normalizedCreditLine}`;
}
