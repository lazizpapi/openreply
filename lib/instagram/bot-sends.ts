/**
 * Redis records of what the bot sent, shared by the nudge and human takeover,
 * plus the AI pause that human takeover sets.
 * All best-effort: skipped without REDIS_URL (tests), and a write never delays
 * or fails the send it goes with.
 */
import { createHash } from "node:crypto";
import type Redis from "ioredis";
import { getRedisConnection } from "@/lib/queue/client";

const DAY_SECONDS = 24 * 60 * 60;

// A campaign button the follower was sent but has not tapped yet.
export type PendingButton = {
  campaignId: string;
  text: string;
  buttonTitle: string;
  payload: string;
  via: "private_reply" | "dm";
};

const pendingKey = (instagramAccountId: string, followerId: string) =>
  `pending_button:${instagramAccountId}:${followerId}`;

function redis(): Redis | null {
  return process.env.REDIS_URL ? getRedisConnection() : null;
}

function warn(error: unknown) {
  console.warn("[Bot sends] Redis write failed:", error instanceof Error ? error.message : error);
}

// Callers don't await this, so an unreachable Redis (ioredis queues commands
// while offline) cannot hold them up. The promise never rejects.
function write(command: (client: Redis) => Promise<unknown>): Promise<void> {
  try {
    const client = redis();
    if (!client) return Promise.resolve();
    return command(client).then(() => undefined, warn);
  } catch (error) {
    warn(error);
    return Promise.resolve();
  }
}

// The text record is a safety net in case an echo's id differs from the send's message_id.
const textKey = (instagramAccountId: string, followerId: string, text: string) =>
  `bot_sent_text:${instagramAccountId}:${followerId}:${createHash("sha256")
    .update(text.trim().replace(/\s+/g, " "))
    .digest("hex")}`;

// Written before each send attempt: Meta sometimes errors on a send it still
// delivered, and that echo must not look like the owner replying.
export function recordBotText(instagramAccountId: string, recipientId: string, text: string) {
  write((client) => client.set(textKey(instagramAccountId, recipientId, text), "1", "EX", DAY_SECONDS));
}

// Marks a successful send's id as the bot's, so its echo is not mistaken for the
// owner replying. Without a Meta message id, a hash of follower, text and minute stands in.
export function recordBotSend(recipientId: string, text: string, messageId?: string) {
  const id =
    messageId ||
    `h:${createHash("sha256")
      .update(JSON.stringify([recipientId, text, Math.floor(Date.now() / 60_000)]))
      .digest("hex")}`;
  write((client) => client.set(`bot_sent:${id}`, "1", "EX", DAY_SECONDS));
}

export function recordPendingButton(
  instagramAccountId: string,
  followerId: string,
  button: PendingButton
) {
  write((client) =>
    client.set(pendingKey(instagramAccountId, followerId), JSON.stringify(button), "EX", DAY_SECONDS)
  );
}

export function clearPendingButton(instagramAccountId: string, followerId: string) {
  write((client) => client.del(pendingKey(instagramAccountId, followerId)));
}

export async function getPendingButton(
  instagramAccountId: string,
  followerId: string
): Promise<PendingButton | null> {
  const raw = await redis()?.get(pendingKey(instagramAccountId, followerId));
  return raw ? (JSON.parse(raw) as PendingButton) : null;
}

// An echo is the bot's own when its id, or its text to this follower, was recorded.
export async function isBotSend(
  instagramAccountId: string,
  followerId: string,
  messageId: string,
  text?: string
) {
  const client = redis();
  if (!client) return false;
  if (await client.get(`bot_sent:${messageId}`)) return true;
  return Boolean(text?.trim() && (await client.get(textKey(instagramAccountId, followerId, text))));
}

// Human takeover: the AI assistant stays silent in this chat for 12 hours.
const pauseKey = (instagramAccountId: string, followerId: string) =>
  `ai_pause:${instagramAccountId}:${followerId}`;

// Returns the write, for a web route's after() callback to return: a serverless
// function can be frozen before an unawaited write goes out.
export function pauseAi(instagramAccountId: string, followerId: string) {
  return write((client) => client.set(pauseKey(instagramAccountId, followerId), "1", "EX", 12 * 60 * 60));
}

export async function isAiPaused(instagramAccountId: string, followerId: string) {
  return Boolean(await redis()?.get(pauseKey(instagramAccountId, followerId)));
}

// True for the first nudge to this follower in 60 seconds.
export async function claimNudge(instagramAccountId: string, followerId: string) {
  const result = await redis()?.set(`nudge:${instagramAccountId}:${followerId}`, "1", "EX", 60, "NX");
  return result === "OK";
}
