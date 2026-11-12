/**
 * Pure text shaping for AI replies: Markdown stripping, the bot notice, and
 * splitting to Instagram's per-message limit.
 */
import type { AiAnswer, AiLanguage } from "./provider";

const BOT_NOTICES: Record<AiLanguage, string> = {
  "uz-latn": "🤖 Bu avtomatik yordamchi.",
  "uz-cyrl": "🤖 Бу автоматик ёрдамчи.",
  ru: "🤖 Это автоматический ассистент.",
  en: "🤖 This is an automated assistant.",
  other: "🤖 Bu avtomatik yordamchi.",
};

/** The bot notice in the follower's language; Uzbek Latin when unknown. */
export function botNotice(language: AiLanguage | undefined): string {
  return BOT_NOTICES[language ?? "other"] ?? BOT_NOTICES["uz-latn"];
}

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

// Anything Instagram may show as a link: an email, a URL with a scheme or
// "www.", a bare domain with a path ("t.me/x"), or a bare domain ending in a
// common TLD ("site.uz"). Other dotted words ("Next.js", "Rahmat.Keyingi") pass.
const TLDS =
  "uz|com|ru|me|ai|io|org|net|app|dev|co|link|ly|gg|tv|info|site|online|store|shop|xyz|pro|ua|kz";
const DOMAIN = String.raw`\b[a-z0-9-]+(?:\.[a-z0-9-]+)*`;
const LINK = new RegExp(
  String.raw`[\w.+-]+@[\w-]+(?:\.[\w-]+)+|\b(?:https?:\/\/|www\.)\S+|` +
    String.raw`${DOMAIN}\.[a-z]{2,}\/\S*|${DOMAIN}\.(?:${TLDS})\b`,
  "gi"
);
const TRAILING_PUNCTUATION = /[.,:;!?)\]}"'»…]+$/;

/** The link guard: every link in a reply must appear verbatim in the AI instructions. */
export function hasOnlyKnownLinks(reply: string, instructions: string): boolean {
  return Array.from(reply.matchAll(LINK), ([link]) => link.replace(TRAILING_PUNCTUATION, "")).every(
    (link) => instructions.includes(link)
  );
}

const HANDOVER_TEXTS: Record<AiLanguage, string> = {
  "uz-latn": "Bunga tez orada oʻzim javob beraman.",
  "uz-cyrl": "Бунга тез орада ўзим жавоб бераман.",
  ru: "Скоро отвечу на это лично.",
  en: "I'll answer this myself soon.",
  other: "Bunga tez orada oʻzim javob beraman.",
};

/**
 * The text Claude's answer turns into, before the bot notice and splitting.
 * Shared by the worker and the Settings "Try it" box. A handover from the
 * model, or a link not written in the AI instructions, becomes the fixed
 * handover text in the follower's language.
 */
export function shapeAnswer(
  answer: AiAnswer,
  instructions: string
): { reply: string; handover: boolean } {
  const reply = stripMarkdown(answer.reply).trim();
  if (answer.handover || !hasOnlyKnownLinks(reply, instructions))
    return { reply: HANDOVER_TEXTS[answer.language] ?? HANDOVER_TEXTS["uz-latn"], handover: true };
  return { reply, handover: false };
}

const byteLength = (text: string) => Buffer.byteLength(text, "utf8");

function segmentEnds(text: string, granularity: "sentence" | "word" | "grapheme"): number[] {
  return Array.from(
    new Intl.Segmenter(undefined, { granularity }).segment(text),
    ({ index, segment }) => index + segment.length
  );
}

// A paragraph ends at a blank line; a single line break is a sentence break.
const paragraphEnds = (text: string) =>
  Array.from(text.matchAll(/\n[ \t]*\n/g), (match) => match.index + match[0].length);
const sentenceEnds = (text: string) => segmentEnds(text, "sentence");
const wordEnds = (text: string) => segmentEnds(text, "word");
const graphemeEnds = (text: string) => segmentEnds(text, "grapheme");
const BREAKS = [paragraphEnds, sentenceEnds, wordEnds, graphemeEnds];

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
