import { describe, expect, it } from "vitest";
import { hasOnlyKnownLinks, splitReply, stripMarkdown } from "@/lib/ai/reply-text";

const bytes = (text: string) => Buffer.byteLength(text, "utf8");

describe("splitReply", () => {
  it("keeps a short reply as one message", () => {
    expect(splitReply("Salom! Qo'llanma havolasi uchun LINK deb yozing.")).toEqual([
      "Salom! Qo'llanma havolasi uchun LINK deb yozing.",
    ]);
  });

  it("counts bytes, not characters, so Cyrillic splits at a word under 1000 bytes", () => {
    // 600 characters but 1100 bytes: each Cyrillic letter is 2 bytes.
    const text = Array(100).fill("салом").join(" ");
    expect(text.length).toBeLessThan(1000);

    const parts = splitReply(text);

    expect(parts).toHaveLength(2);
    for (const part of parts) {
      expect(bytes(part)).toBeLessThanOrEqual(1000);
      expect(part.split(" ").every((word) => word === "салом")).toBe(true);
    }
    expect(parts.join(" ")).toBe(text);
  });

  it("counts the Uzbek ʻ as 2 bytes", () => {
    // 960 characters, 1040 bytes.
    const text = Array(80).fill("Oʻzbekiston").join(" ");

    const parts = splitReply(text);

    expect(parts).toHaveLength(2);
    expect(parts.every((part) => bytes(part) <= 1000)).toBe(true);
    expect(parts.join(" ")).toBe(text);
  });

  it("never breaks inside an emoji", () => {
    const family = "👨‍👩‍👧‍👦"; // one grapheme, 25 bytes
    const text = family.repeat(50);

    const parts = splitReply(text);

    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(bytes(part)).toBeLessThanOrEqual(1000);
      expect(part.replaceAll(family, "")).toBe("");
    }
    expect(parts.join("")).toBe(text);
  });

  it("breaks at a paragraph before a sentence", () => {
    const first = "Qo'llanma tayyor. ".repeat(20).trim(); // 359 bytes
    const second = "Kanalga obuna bo'ling. ".repeat(30).trim(); // 689 bytes
    expect(splitReply(`${first}\n\n${second}`)).toEqual([first, second]);
  });

  it("breaks at a sentence before a word", () => {
    const sentence = "Bu savolga men javob bera olmayman, lekin egasi yozadi."; // 55 bytes
    const text = Array(25).fill(sentence).join(" ");

    const parts = splitReply(text);

    expect(parts).toHaveLength(2);
    expect(parts.every((part) => part.endsWith("yozadi."))).toBe(true);
    expect(bytes(parts[0])).toBeLessThanOrEqual(1000);
  });

  it("treats a single line break as a sentence break, so the bot notice line is not sent alone", () => {
    const text = `🤖 Bu avtomatik yordamchi.\n${Array(150).fill("Bu javob.").join(" ")}`;

    const parts = splitReply(text);

    expect(parts).toHaveLength(2);
    expect(parts[0]).toMatch(/^🤖 Bu avtomatik yordamchi\.\nBu javob\. Bu javob\./);
  });

  it("sends at most 3 messages and ends a cut third one with …", () => {
    const text = Array(1000).fill("ёрдамчи").join(" "); // about 14 KB

    const parts = splitReply(text);

    expect(parts).toHaveLength(3);
    expect(parts.every((part) => bytes(part) <= 1000)).toBe(true);
    expect(parts[2]).toMatch(/ёрдамчи…$/);
  });
});

describe("stripMarkdown", () => {
  it.each([
    ["**Narxi** so'ralmagan", "Narxi so'ralmagan"],
    ["__Muhim__: LINK deb yozing", "Muhim: LINK deb yozing"],
    ["Bu *juda* oson", "Bu juda oson"],
    ["## Qo'llanma\nLINK deb yozing", "Qo'llanma\nLINK deb yozing"],
    ["`LINK` deb yozing", "LINK deb yozing"],
    ["[Telegram kanal](https://t.me/lazizpapi)", "Telegram kanal https://t.me/lazizpapi"],
    ["* birinchi\n* ikkinchi", "- birinchi\n- ikkinchi"],
    ["> iqtibos", "iqtibos"],
  ])("strips the markers in %j", (input, expected) => {
    expect(stripMarkdown(input)).toBe(expected);
  });

  it.each([
    "Instagram: @lazizbek_papi_uz",
    "https://t.me/my_channel_name",
    "5 * 3 = 15",
    "Salom 👋 Qo'llanma tayyor!",
  ])("leaves plain text %j alone", (text) => {
    expect(stripMarkdown(text)).toBe(text);
  });
});

describe("hasOnlyKnownLinks", () => {
  const instructions =
    "Telegram kanalim: https://t.me/lazizpapi\nSayt: lazizpapi.uz/kurs\nEmail: info@lazizpapi.uz";

  it.each([
    "Salom! Qoʻllanma uchun LINK deb yozing.",
    "Telegram kanalim: https://t.me/lazizpapi",
    "Kanalga qoʻshiling: https://t.me/lazizpapi.",
    "(https://t.me/lazizpapi) orqali yozing!",
    "Batafsil: lazizpapi.uz/kurs",
    "Yozing: info@lazizpapi.uz",
    "Narxi 200.000 soʻm, 3.5 soat.",
    "Instagram: @lazizbek_papi_uz",
  ])("passes %j", (reply) => {
    expect(hasOnlyKnownLinks(reply, instructions)).toBe(true);
  });

  it.each([
    "Qoʻllanma: https://drive.google.com/file/d/abc",
    "Kanal: https://t.me/lazizpapi_bot",
    "Kanal: http://t.me/lazizpapi",
    "Kurs: www.lazizpapi.uz/pro",
    "Kurs: lazizpapi.uz/pro",
    "Botga yozing: t.me/lazizpapi_bot",
    "Yozing: sales@lazizpapi.uz",
    "Saytimiz: openreply.app",
  ])("refuses %j", (reply) => {
    expect(hasOnlyKnownLinks(reply, instructions)).toBe(false);
  });

  it("refuses any link when the AI instructions have none", () => {
    expect(hasOnlyKnownLinks("Mana: https://t.me/lazizpapi", "")).toBe(false);
  });
});
