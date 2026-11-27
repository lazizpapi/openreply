// Instagram lets an app message a person only within 24 hours of that person's
// last message. Outside it Meta rejects the send with code 10, subcode 2534022.
const WINDOW_MS = 24 * 60 * 60 * 1000;
const WINDOW_CLOSED_SUBCODE = 2534022;

export const MESSAGING_WINDOW_CLOSED = "MESSAGING_WINDOW_CLOSED";

export function isWindowClosedError(error: { code?: number; subcode?: number }): boolean {
  return error.code === 10 && error.subcode === WINDOW_CLOSED_SUBCODE;
}

// True when the follower's latest message in this history is over 24 hours
// old, or they have none in it (Meta returns only the 20 most recent).
export function isMessagingWindowClosed(
  messages: { fromMe: boolean; createdTime: string | null }[],
  now: number = Date.now()
): boolean {
  let lastInbound = 0;
  for (const m of messages) {
    if (m.fromMe || !m.createdTime) continue;
    const time = Date.parse(m.createdTime);
    if (time > lastInbound) lastInbound = time;
  }
  return now - lastInbound > WINDOW_MS;
}
