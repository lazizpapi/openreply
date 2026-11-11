// A short typed "yes": ha, xa, ха, ҳа, да (also Latin "da", as in the spec's
// "daaa"), yes, +, ok, ок, 👍 or ❤️, each letter allowed to repeat ("haaa", "++").
// "haha" and anything with other words is not one.
const YES_WORD = /^(?:h+a+|x+a+|х+а+|ҳ+а+|д+а+|d+a+|y+e+s+|\++|o+k+|о+к+|👍+|(?:❤\u{FE0F}?)+)$/u;

export function isYesWord(text: string): boolean {
  return YES_WORD.test(text.trim().toLowerCase());
}
