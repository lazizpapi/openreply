import { describe, expect, it } from "vitest";
import {
  isMessagingWindowClosed,
  isWindowClosedError,
} from "../lib/instagram/messaging-window";
import { MetaApiError } from "../lib/meta/client";

const now = Date.parse("2026-11-27T12:00:00Z");
const hoursAgo = (h: number) => new Date(now - h * 3_600_000).toISOString();

describe("Inbox messaging window", () => {
  it("is open when the follower wrote within the last 24 hours", () => {
    const messages = [
      { fromMe: false, createdTime: hoursAgo(23) },
      { fromMe: true, createdTime: hoursAgo(1) },
    ];
    expect(isMessagingWindowClosed(messages, now)).toBe(false);
  });

  it("is closed when the follower's last message is over 24 hours old, however recent our own are", () => {
    const messages = [
      { fromMe: true, createdTime: hoursAgo(1) },
      { fromMe: false, createdTime: hoursAgo(25) },
    ];
    expect(isMessagingWindowClosed(messages, now)).toBe(true);
  });

  it("is closed when the follower never wrote, e.g. only the campaign DM is there", () => {
    expect(isMessagingWindowClosed([{ fromMe: true, createdTime: hoursAgo(2) }], now)).toBe(true);
  });

  it("recognises Meta's window-closed rejection and nothing else", () => {
    const closed = new MetaApiError(10, 2534022, "t", "This message is sent outside of allowed window.");
    expect(isWindowClosedError(closed)).toBe(true);
    expect(isWindowClosedError(new MetaApiError(10, 2534025, "t", "other"))).toBe(false);
    expect(isWindowClosedError(new MetaApiError(4, undefined, "t", "rate limit"))).toBe(false);
  });
});
