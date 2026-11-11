import { describe, expect, it } from "vitest";
import { isYesWord } from "@/lib/utils/yes-word";

describe("isYesWord", () => {
  it.each([
    "ha", "xa", "ҳа", "да", "yes", "+", "ok", "👍", "❤️",
    "Ha", "OK", "ҲА", "Да", "YES",
    "haaa", "hhaa", "xaaa", "ха", "хааа", "ок", "ОК", "daaa", "дааа", "yesss", "okkk", "++", "+++", "👍👍", "❤❤", "❤",
    " ha ", "\nok\n",
  ])("accepts %j", (text) => {
    expect(isYesWord(text)).toBe(true);
  });

  it.each([
    "haha", "hahaha", "ah", "h", "a", "ha!", "ha ok", "yes please", "ok thanks",
    "+1", "okay", "ye", "", "   ", "salom", "👍 ok", "хаха",
  ])("rejects %j", (text) => {
    expect(isYesWord(text)).toBe(false);
  });
});
