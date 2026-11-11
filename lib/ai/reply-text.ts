/**
 * Pure text shaping for AI replies: Markdown stripping, the bot notice, and
 * splitting to Instagram's per-message limit.
 */

const MAX_BYTES = 1000;
const MAX_PARTS = 3;
const ELLIPSIS = "…";

/**
 * Removes Markdown markers Instagram would show literally. Underscores inside
 * words (usernames, links) and a lone "*" between spaces are left alone.
 */
export function stripMarkdown(text: string): string {
  return text
    .replace(/\[([^\]\n]+)\]\((\S+?)\)/g, "$1 $2")
    .replace(/^#{1,6}[ \t]+/gm, "")
    .replace(/^([ \t]*)[*+][ \t]+/gm, "$1- ")
    .replace(/^[ \t]*>[ \t]?/gm, "")
    .replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, "$1")
    .replace(/(?<!\w)__(?=\S)(.+?)(?<=\S)__(?!\w)/g, "$1")
    .replace(/(?<![\w*])\*(?=\S)([^*\n]+?)(?<=\S)\*(?![\w*])/g, "$1")
    .replace(/`+/g, "");
}

const byteLength = (text: string) => Buffer.byteLength(text, "utf8");

function segmentEnds(text: string, granularity: "sentence" | "word" | "grapheme"): number[] {
  return Array.from(
    new Intl.Segmenter(undefined, { granularity }).segment(text),
    ({ index, segment }) => index + segment.length
  );
}

const lineEnds = (text: string) => Array.from(text.matchAll(/\n/g), (match) => match.index + 1);
const sentenceEnds = (text: string) => segmentEnds(text, "sentence");
const wordEnds = (text: string) => segmentEnds(text, "word");
const graphemeEnds = (text: string) => segmentEnds(text, "grapheme");
const BREAKS = [lineEnds, sentenceEnds, wordEnds, graphemeEnds];

// The longest prefix of `text` within `limit` bytes that ends at the best kind
// of break: paragraph, then sentence, then word, then grapheme.
function cutAt(text: string, limit: number, breaks = BREAKS): number {
  for (const ends of breaks.map((find) => find(text))) {
    let cut = 0;
    for (const end of ends) {
      if (byteLength(text.slice(0, end)) > limit) break;
      cut = end;
    }
    if (cut > 0) return cut;
  }
  return 0;
}

/**
 * Splits a reply into at most 3 Instagram messages of at most 1000 UTF-8 bytes.
 * A third message that still does not fit is cut at a word and ends with "…".
 */
export function splitReply(text: string): string[] {
  const parts: string[] = [];
  let rest = text.trim();
  while (rest) {
    if (byteLength(rest) <= MAX_BYTES) {
      parts.push(rest);
      break;
    }
    if (parts.length === MAX_PARTS - 1) {
      const cut = cutAt(rest, MAX_BYTES - byteLength(ELLIPSIS), [wordEnds, graphemeEnds]);
      parts.push(`${rest.slice(0, cut).trimEnd()}${ELLIPSIS}`);
      break;
    }
    const cut = cutAt(rest, MAX_BYTES);
    parts.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  return parts;
}
