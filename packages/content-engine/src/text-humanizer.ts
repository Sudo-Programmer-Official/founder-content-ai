type HumanizedParagraphKind = "text" | "bullet" | "hashtag";

interface HumanizedParagraph {
  text: string;
  kind: HumanizedParagraphKind;
  hadLeadingPunctuation: boolean;
}

function collapseInlineWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isBulletLike(value: string): boolean {
  return /^([-*•]|\d+[.)])\s+/.test(value);
}

function isHashtagLine(value: string): boolean {
  return /^(#\w+\s*)+$/.test(value.trim());
}

function wordCount(value: string): number {
  return collapseInlineWhitespace(value).split(/\s+/).filter(Boolean).length;
}

function hasTerminalPunctuation(value: string): boolean {
  return /[.!?]$/.test(value.trim());
}

function ensureSentenceEnding(value: string): string {
  const normalized = collapseInlineWhitespace(value).replace(/[;:–—-]+$/, "").trim();

  if (!normalized) {
    return "";
  }

  return hasTerminalPunctuation(normalized) ? normalized : `${normalized}.`;
}

function startsWithStandaloneConnector(value: string): boolean {
  return /^(And|But|So|Because|Yet|Still|Instead|Then|Plus|Or|Now)\b/.test(value);
}

function cleanParagraph(rawParagraph: string): HumanizedParagraph | null {
  const normalized = collapseInlineWhitespace(rawParagraph);

  if (!normalized) {
    return null;
  }

  if (isBulletLike(normalized)) {
    return {
      text: normalized,
      kind: "bullet",
      hadLeadingPunctuation: false,
    };
  }

  if (isHashtagLine(normalized)) {
    return {
      text: normalized,
      kind: "hashtag",
      hadLeadingPunctuation: false,
    };
  }

  const hadLeadingPunctuation = /^[,;:.\-–—]+/.test(normalized);
  let text = normalized
    .replace(/^[,;:.\-–—]+/, "")
    .replace(/\s*;\s*/g, ". ")
    .replace(/\s*:\s*$/g, ".")
    .replace(/\s*[–—-]\s*$/g, ".")
    .replace(/\.{4,}/g, "...")
    .trim();

  if (!text) {
    return null;
  }

  if (/^[a-z]/.test(text)) {
    text = `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
  }

  return {
    text,
    kind: "text",
    hadLeadingPunctuation,
  };
}

function shouldMergeBrokenLine(previous: HumanizedParagraph | undefined, current: HumanizedParagraph): boolean {
  if (!previous || previous.kind !== "text" || current.kind !== "text") {
    return false;
  }

  if (startsWithStandaloneConnector(current.text) || current.hadLeadingPunctuation) {
    return false;
  }

  return !hasTerminalPunctuation(previous.text) && current.text.length <= 88;
}

function shouldMergeForCadence(
  current: HumanizedParagraph,
  next: HumanizedParagraph | undefined,
  textParagraphCount: number,
): boolean {
  if (!next || current.kind !== "text" || next.kind !== "text") {
    return false;
  }

  if (textParagraphCount <= 9) {
    return false;
  }

  if (/[!?]$/.test(current.text)) {
    return false;
  }

  if (startsWithStandaloneConnector(next.text)) {
    return false;
  }

  const currentWords = wordCount(current.text);
  const nextWords = wordCount(next.text);

  if (currentWords <= 3 || nextWords <= 3) {
    return false;
  }

  if (currentWords > 12 || nextWords > 16) {
    return false;
  }

  return current.text.length + next.text.length <= 150;
}

function dedupeParagraphs(paragraphs: HumanizedParagraph[]): HumanizedParagraph[] {
  const result: HumanizedParagraph[] = [];

  for (const paragraph of paragraphs) {
    if (result[result.length - 1]?.text === paragraph.text) {
      continue;
    }

    result.push(paragraph);
  }

  return result;
}

function rebalanceParagraphCadence(paragraphs: HumanizedParagraph[]): HumanizedParagraph[] {
  let working = [...paragraphs];

  while (working.filter((paragraph) => paragraph.kind === "text").length > 9) {
    const nextPass: HumanizedParagraph[] = [];
    let merged = false;
    const textParagraphCount = working.filter((paragraph) => paragraph.kind === "text").length;

    for (let index = 0; index < working.length; index += 1) {
      const current = working[index];
      const next = working[index + 1];

      if (shouldMergeForCadence(current, next, textParagraphCount)) {
        nextPass.push({
          text: `${ensureSentenceEnding(current.text)} ${next.text}`,
          kind: "text",
          hadLeadingPunctuation: false,
        });
        index += 1;
        merged = true;
        continue;
      }

      nextPass.push(current);
    }

    working = dedupeParagraphs(nextPass);

    if (!merged) {
      break;
    }
  }

  return working;
}

export function humanizeLines(input: string): string {
  const normalizedInput = input.replace(/\r\n/g, "\n").trim();

  if (!normalizedInput) {
    return "";
  }

  const cleanedParagraphs = normalizedInput
    .split(/\n{2,}/)
    .map((paragraph) => cleanParagraph(paragraph))
    .filter((paragraph): paragraph is HumanizedParagraph => Boolean(paragraph));

  const rebuilt: HumanizedParagraph[] = [];

  for (const current of cleanedParagraphs) {
    const previous = rebuilt[rebuilt.length - 1];

    if (current.kind !== "text") {
      rebuilt.push(current);
      continue;
    }

    if (previous?.kind === "text" && (current.hadLeadingPunctuation || startsWithStandaloneConnector(current.text))) {
      previous.text = ensureSentenceEnding(previous.text);
    }

    if (shouldMergeBrokenLine(previous, current)) {
      previous.text = `${previous.text} ${current.text}`;
      continue;
    }

    rebuilt.push(current);
  }

  return rebalanceParagraphCadence(dedupeParagraphs(rebuilt))
    .map((paragraph) => paragraph.text)
    .join("\n\n");
}
