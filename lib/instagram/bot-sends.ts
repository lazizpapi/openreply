/**
 * Redis records of what the bot sent, shared by the nudge and human takeover,
 * plus the AI pause that human takeover sets.
 * All best-effort: skipped without REDIS_URL (tests), and a write never delays
 * or fails the send it follows.
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

// Fire-and-forget, so an unreachable Redis (ioredis queues commands while
// offline) cannot hold up the caller.
function write(command: (client: Redis) => Promise<unknown>) {
  try {
    const client = redis();
    if (!client) return;
    command(client).catch((error: unknown) =>
      console.warn("[Bot sends] Redis write failed:", error instanceof Error ? error.message : error)
    );
  } catch (error) {
    console.warn("[Bot sends] Redis write failed:", error instanceof Error ? error.message : error);
  }
}

// Marks a message as sent by the bot, so its echo is not mistaken for the owner
// replying. Without a Meta message id, a hash of follower, text and minute stands in.
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

export async function isBotSend(messageId: string) {
  return Boolean(await redis()?.get(`bot_sent:${messageId}`));
}

// Human takeover: the AI assistant stays silent in this chat for 12 hours.
const pauseKey = (instagramAccountId: string, followerId: string) =>
  `ai_pause:${instagramAccountId}:${followerId}`;

export function pauseAi(instagramAccountId: string, followerId: string) {
  write((client) => client.set(pauseKey(instagramAccountId, followerId), "1", "EX", 12 * 60 * 60));
}

export async function isAiPaused(instagramAccountId: string, followerId: string) {
  return Boolean(await redis()?.get(pauseKey(instagramAccountId, followerId)));
}

// True for the first nudge to this follower in 60 seconds.
export async function claimNudge(instagramAccountId: string, followerId: string) {
  const result = await redis()?.set(`nudge:${instagramAccountId}:${followerId}`, "1", "EX", 60, "NX");
  return result === "OK";
}
