function collapseInlineWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isBulletLike(value: string): boolean {
  return /^([-*•]|\d+[.)])\s+/.test(value);
}

function isHashtagLine(value: string): boolean {
  return /^(#\w+\s*)+$/.test(value.trim());
}

function splitParagraphIntoSentences(value: string): string[] {
  const normalized = collapseInlineWhitespace(value);

  if (!normalized) {
    return [];
  }

  return normalized
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => collapseInlineWhitespace(sentence))
    .filter(Boolean);
}

function findReadableBreakpoint(value: string): number {
  const normalized = collapseInlineWhitespace(value);

  if (!normalized) {
    return -1;
  }

  const preferredBreaks = [
    ": ",
    "; ",
    " - ",
    " — ",
    ", but ",
    ", and ",
    ", so ",
    ", because ",
    ", which ",
    ", that ",
    ", when ",
    ", while ",
  ];
  const minIndex = Math.floor(normalized.length * 0.32);
  const maxIndex = Math.ceil(normalized.length * 0.72);

  for (const breakpoint of preferredBreaks) {
    let index = normalized.indexOf(breakpoint);

    while (index >= 0) {
      if (index >= minIndex && index <= maxIndex) {
        return breakpoint.trim().length === 1
          ? index + breakpoint.length
          : index;
      }

      index = normalized.indexOf(breakpoint, index + breakpoint.length);
    }
  }

  return -1;
}

function splitLongSentence(value: string): string[] {
  const normalized = collapseInlineWhitespace(value);

  if (!normalized) {
    return [];
  }

  const result: string[] = [];
  const queue = [normalized];

  while (queue.length > 0 && result.length < 4) {
    const current = queue.shift() ?? "";
    const words = current.split(/\s+/).filter(Boolean);

    if (current.length <= 82 && words.length <= 15) {
      result.push(current);
      continue;
    }

    const readableBreakpoint = findReadableBreakpoint(current);

    if (readableBreakpoint > 0) {
      const left = collapseInlineWhitespace(current.slice(0, readableBreakpoint));
      const right = collapseInlineWhitespace(current.slice(readableBreakpoint));

      if (left && right && left !== current && right !== current) {
        queue.unshift(right);
        queue.unshift(left);
        continue;
      }
    }

    if (words.length <= 8) {
      result.push(current);
      continue;
    }

    const splitIndex = Math.min(12, Math.max(6, Math.ceil(words.length / 2)));
    const left = words.slice(0, splitIndex).join(" ");
    const right = words.slice(splitIndex).join(" ");

    if (!left || !right) {
      result.push(current);
      continue;
    }

    queue.unshift(right);
    queue.unshift(left);
  }

  return result.filter(Boolean);
}

export function formatLinkedInPostForReadability(value: string): string {
  const normalizedInput = value.replace(/\r\n/g, "\n").trim();

  if (!normalizedInput) {
    return "";
  }

  const paragraphs = normalizedInput
    .split(/\n{2,}/)
    .flatMap((rawParagraph) => {
      const lines = rawParagraph
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean);

      if (lines.length === 0) {
        return [];
      }

      if (lines.every((line) => isBulletLike(line) || isHashtagLine(line))) {
        return lines;
      }

      const mergedParagraph = collapseInlineWhitespace(lines.join(" "));
      const sentences = splitParagraphIntoSentences(mergedParagraph);

      if (sentences.length === 0) {
        return splitLongSentence(mergedParagraph);
      }

      return sentences.flatMap((sentence) => splitLongSentence(sentence));
    })
    .map((paragraph) => collapseInlineWhitespace(paragraph))
    .filter(Boolean);

  const dedupedParagraphs: string[] = [];

  for (const paragraph of paragraphs) {
    if (dedupedParagraphs[dedupedParagraphs.length - 1] === paragraph) {
      continue;
    }

    dedupedParagraphs.push(paragraph);
  }

  return dedupedParagraphs.join("\n\n");
}
