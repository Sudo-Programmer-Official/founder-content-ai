export type EmailBodyBlock =
  | {
      type: "paragraph";
      text: string;
    }
  | {
      type: "cta_button";
      label: string;
      url: string;
    }
  | {
      type: "hero";
      headline?: string;
      body?: string;
      buttonLabel?: string;
      buttonUrl?: string;
    }
  | {
      type: "cta_section";
      headline?: string;
      body?: string;
      buttonLabel?: string;
      buttonUrl?: string;
    }
  | {
      type: "feature_list";
      title?: string;
      items: string[];
    };

type StructuredEmailBlockKind = "hero" | "cta_section" | "feature_list";

const EMAIL_CTA_BLOCK_PATTERN = /^\[(?:button|cta):\s*(.+?)\]\((https?:\/\/[^\s)]+)\)$/i;
const EMAIL_BLOCK_OPEN_PATTERN = /^\[(.+)\]$/;
const EMAIL_BLOCK_CLOSE_PATTERN = /^\[\/(.+)\]$/;

function parseEmailCtaBlock(value: string): { label: string; url: string } | null {
  const normalized = value.trim();
  const match = normalized.match(EMAIL_CTA_BLOCK_PATTERN);

  if (!match) {
    return null;
  }

  const [, rawLabel = "", rawUrl = ""] = match;
  const label = rawLabel.trim();
  const url = rawUrl.trim();

  if (!label || !url) {
    return null;
  }

  return { label, url };
}

function normalizeBlockTagName(value: string): StructuredEmailBlockKind | null {
  const normalized = value.trim().toLowerCase();

  if (normalized === "hero" || normalized === "hero announcement" || normalized === "announcement") {
    return "hero";
  }

  if (normalized === "cta" || normalized === "cta section" || normalized === "action") {
    return "cta_section";
  }

  if (
    normalized === "feature list"
    || normalized === "features"
    || normalized === "benefits"
    || normalized === "benefit list"
  ) {
    return "feature_list";
  }

  return null;
}

function parseBlockMetadataLines(lines: string[]): {
  headline?: string;
  body?: string;
  buttonLabel?: string;
  buttonUrl?: string;
} {
  let headline = "";
  let body = "";
  let buttonLabel = "";
  let buttonUrl = "";
  const bodyLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      continue;
    }

    if (/^headline:/i.test(trimmed) || /^title:/i.test(trimmed)) {
      headline = trimmed.replace(/^(headline|title):/i, "").trim();
      continue;
    }

    if (/^(subheadline|body|message):/i.test(trimmed)) {
      bodyLines.push(trimmed.replace(/^(subheadline|body|message):/i, "").trim());
      continue;
    }

    if (/^button:/i.test(trimmed)) {
      buttonLabel = trimmed.replace(/^button:/i, "").trim();
      continue;
    }

    if (/^(link|url):/i.test(trimmed)) {
      buttonUrl = trimmed.replace(/^(link|url):/i, "").trim();
      continue;
    }

    bodyLines.push(trimmed);
  }

  body = bodyLines.join("\n").trim();

  return {
    headline: headline || undefined,
    body: body || undefined,
    buttonLabel: buttonLabel || undefined,
    buttonUrl: buttonUrl || undefined,
  };
}

function parseStructuredEmailBlock(kind: StructuredEmailBlockKind, lines: string[]): EmailBodyBlock | null {
  if (kind === "feature_list") {
    let title = "";
    const items: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();

      if (!trimmed) {
        continue;
      }

      if (/^title:/i.test(trimmed)) {
        title = trimmed.replace(/^title:/i, "").trim();
        continue;
      }

      const normalizedItem = trimmed.replace(/^[-*•]\s+/, "").replace(/^\d+\.\s+/, "").trim();

      if (normalizedItem) {
        items.push(normalizedItem);
      }
    }

    if (!title && items.length === 0) {
      return null;
    }

    return {
      type: "feature_list",
      title: title || undefined,
      items,
    };
  }

  const parsed = parseBlockMetadataLines(lines);

  if (!parsed.headline && !parsed.body && !parsed.buttonLabel && !parsed.buttonUrl) {
    return null;
  }

  return {
    type: kind,
    ...parsed,
  };
}

function paragraphBlockFromText(value: string): EmailBodyBlock | null {
  const normalized = value.trim();

  if (!normalized) {
    return null;
  }

  const cta = parseEmailCtaBlock(normalized);

  if (cta) {
    return {
      type: "cta_button",
      label: cta.label,
      url: cta.url,
    };
  }

  return {
    type: "paragraph",
    text: normalized,
  };
}

export function parseEmailBodyBlocks(bodyText: string): EmailBodyBlock[] {
  const normalizedBody = bodyText.replace(/\r\n/g, "\n");
  const lines = normalizedBody.split("\n");
  const blocks: EmailBodyBlock[] = [];
  let paragraphLines: string[] = [];
  let activeBlock:
    | {
        kind: StructuredEmailBlockKind;
        lines: string[];
      }
    | null = null;

  const flushParagraph = (): void => {
    const block = paragraphBlockFromText(paragraphLines.join("\n"));

    if (block) {
      blocks.push(block);
    }

    paragraphLines = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (activeBlock) {
      const closeMatch = trimmed.match(EMAIL_BLOCK_CLOSE_PATTERN);
      const closeKind = closeMatch ? normalizeBlockTagName(closeMatch[1] ?? "") : null;

      if (closeKind && closeKind === activeBlock.kind) {
        const parsedBlock = parseStructuredEmailBlock(activeBlock.kind, activeBlock.lines);

        if (parsedBlock) {
          blocks.push(parsedBlock);
        }

        activeBlock = null;
        continue;
      }

      activeBlock.lines.push(line);
      continue;
    }

    const openMatch = trimmed.match(EMAIL_BLOCK_OPEN_PATTERN);
    const nextBlockKind = openMatch ? normalizeBlockTagName(openMatch[1] ?? "") : null;

    if (nextBlockKind) {
      flushParagraph();
      activeBlock = {
        kind: nextBlockKind,
        lines: [],
      };
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      continue;
    }

    paragraphLines.push(line);
  }

  if (activeBlock) {
    const fallbackBlock = paragraphBlockFromText(activeBlock.lines.join("\n"));

    if (fallbackBlock) {
      blocks.push(fallbackBlock);
    }
  }

  flushParagraph();

  return blocks;
}
