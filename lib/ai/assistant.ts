/**
 * AI assistant: answers a follower's text DM or story reply that matched no
 * campaign and triggered no nudge. META accounts only, and only while
 * ANTHROPIC_API_KEY is set and the account's AI settings are enabled. Nothing
 * here throws: every failure is logged and ends in silence.
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { AiMessage } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { isAiPaused, isBotSend, pauseAi } from "@/lib/instagram/bot-sends";
import {
  createInstagramContext,
  getBusinessFollowsUser,
  sendDirectMessage,
  type InstagramContext,
} from "@/lib/instagram/provider";
import {
  AI_REPLY_JOB_NAME,
  getDMQueue,
  type AiEchoJob,
  type AiReplyJob,
  type ProcessMessageJob,
} from "@/lib/queue/client";
import { askClaude, buildSystemPrompt, isAiConfigured } from "./provider";
import { botNotice, splitReply, stripMarkdown } from "./reply-text";

const REPLY_DELAY_MS = 10_000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const RETENTION_MS = 30 * DAY_MS;
const HISTORY_SIZE = 10;
// Asia/Tashkent is UTC+5 all year (no daylight saving).
const TASHKENT_OFFSET_MS = 5 * HOUR_MS;

function log(message: string, error?: unknown) {
  console.log(`[AI] ${message}`, error instanceof Error ? error.message : (error ?? ""));
}

function loadAccount(instagramId: string) {
  return prisma.instagramAccount.findUnique({
    where: { instagramId },
    include: { aiSettings: true },
  });
}

/** 00:00 of the current day in Asia/Tashkent. */
export function tashkentDayStart(now: Date): Date {
  const local = now.getTime() + TASHKENT_OFFSET_MS;
  return new Date(local - (local % DAY_MS) - TASHKENT_OFFSET_MS);
}

/** AI answers sent today (Tashkent day) for an account; the daily AI limit counts these. */
export function countAiAnswersToday(instagramAccountId: string, now = new Date()) {
  return prisma.aiMessage.count({
    where: { instagramAccountId, role: "ASSISTANT", createdAt: { gte: tashkentDayStart(now) } },
  });
}

/** The campaigns the system prompt lists: live, with the DM trigger on. */
export function liveDmCampaigns(instagramAccountId: string) {
  return prisma.automation.findMany({
    where: { instagramAccountId, isActive: true, dmTriggerEnabled: true },
    select: { name: true, keywords: true },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Entry point, called by the message job when no campaign matched and no nudge
 * was sent. Stores the DM and queues the answer for 10 seconds later.
 */
export async function handleAiMessage(job: ProcessMessageJob, receivedAt: Date): Promise<void> {
  if (!isAiConfigured()) return;
  try {
    const account = await loadAccount(job.instagramAccountId);
    if (account?.provider !== "META" || !account.aiSettings?.enabled) return;

    const { count } = await prisma.aiMessage.createMany({
      data: [
        {
          instagramAccountId: account.id,
          followerId: job.senderId,
          role: "USER",
          text: job.messageText,
          messageId: job.messageId,
          createdAt: receivedAt,
        },
      ],
      skipDuplicates: true,
    });
    if (count === 0) return; // a duplicate webhook

    const reply: AiReplyJob = {
      accountConnectionId: account.id,
      instagramAccountId: job.instagramAccountId,
      followerId: job.senderId,
      messageId: job.messageId,
    };
    await getDMQueue().add(AI_REPLY_JOB_NAME, reply, {
      delay: REPLY_DELAY_MS,
      // base64url keeps any message id inside BullMQ's job-id alphabet.
      jobId: `ai_reply_${Buffer.from(job.messageId).toString("base64url")}`,
      // The queue default retries after 5, 15 and 45 minutes: too late for a chat.
      attempts: 1,
    });
  } catch (error) {
    log(`Message ${job.messageId} not queued:`, error);
  }
}

/**
 * Why the reply job stays silent, or null to answer. `chat` is the follower's
 * latest AI messages, newest first.
 */
async function skipReason(
  job: AiReplyJob,
  instagramAccountId: string,
  dailyLimit: number,
  chat: AiMessage[],
  context: InstagramContext,
  now: Date
): Promise<string | null> {
  const latest = chat[0];
  if (latest?.role === "ASSISTANT") return "already answered";
  if (latest?.messageId !== job.messageId) return "a newer message gets the answer";
  if (await isAiPaused(job.instagramAccountId, job.followerId)) return "paused: the owner replied";
  // Unknown (null) means not followed.
  if ((await getBusinessFollowsUser({ context, recipientId: job.followerId })) === true)
    return "the owner follows this follower";
  if (now.getTime() - latest.createdAt.getTime() > DAY_MS) return "messaging window closed";
  if ((await countAiAnswersToday(instagramAccountId, now)) >= dailyLimit)
    return "daily AI limit reached";
  return null;
}

// Oldest first, starting with a USER turn.
function toClaudeMessages(chat: AiMessage[]): Anthropic.MessageParam[] {
  const turns = [...chat].reverse();
  return turns
    .slice(turns.findIndex((turn) => turn.role === "USER"))
    .map((turn) => ({ role: turn.role === "USER" ? "user" : "assistant", content: turn.text }));
}

/** The `ai-reply` job: answers the follower's latest messages in one reply. */
export async function processAiReply(job: AiReplyJob): Promise<void> {
  if (!isAiConfigured()) return;
  const now = new Date();
  try {
    const account = await loadAccount(job.instagramAccountId);
    const settings = account?.aiSettings;
    if (account?.provider !== "META" || !settings?.enabled) return;

    const chat = await prisma.aiMessage.findMany({
      where: { instagramAccountId: account.id, followerId: job.followerId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: HISTORY_SIZE,
    });
    const context = await createInstagramContext(account);
    const skip = await skipReason(job, account.id, settings.dailyLimit, chat, context, now);
    if (skip) {
      log(`No answer to ${job.messageId}: ${skip}`);
      return;
    }

    const answer = await askClaude(
      buildSystemPrompt(settings.instructions, await liveDmCampaigns(account.id)),
      toClaudeMessages(chat)
    );
    if (!answer) return;
    // Ticket 07: a handover sends the handover text, pauses the chat and emails the owner.
    if (answer.handover) {
      log(`Handover on ${job.messageId}: staying silent`);
      return;
    }
    const reply = stripMarkdown(answer.reply).trim();
    if (!reply) {
      log(`No answer to ${job.messageId}: empty reply`);
      return;
    }

    const answeredBefore = await prisma.aiMessage.count({
      where: { instagramAccountId: account.id, followerId: job.followerId, role: "ASSISTANT" },
    });
    const parts = splitReply(answeredBefore ? reply : `${botNotice(answer.language)}\n${reply}`);
    let sent = 0;
    for (const message of parts) {
      try {
        await sendDirectMessage({
          context,
          instagramAccountId: account.instagramId,
          userId: job.followerId,
          message,
        });
        sent++;
      } catch (error) {
        log(`Answer to ${job.messageId} stopped after ${sent} of ${parts.length} parts:`, error);
        break;
      }
    }
    if (sent === 0) return;

    await prisma.aiMessage.create({
      data: {
        instagramAccountId: account.id,
        followerId: job.followerId,
        role: "ASSISTANT",
        text: reply,
        // Dated at the job's start, so a DM that arrives while Claude is
        // answering stays newer than this answer and gets its own.
        createdAt: now,
      },
    });
  } catch (error) {
    log(`Answer to ${job.messageId} failed:`, error);
  }
}

/**
 * The `ai-echo` job: the echo of a DM the account sent, run 15 seconds later so
 * the bot-send record exists. Anything the bot did not send is the owner
 * replying from the Instagram app, which pauses the AI for that follower.
 */
export async function processAiEcho(job: AiEchoJob): Promise<void> {
  try {
    if (job.isTemplate || (await isBotSend(job.messageId))) return;
    pauseAi(job.instagramAccountId, job.followerId);
    log(`Owner replied to ${job.followerId}: paused for 12 hours`);
  } catch (error) {
    log(`Echo ${job.messageId} not handled:`, error);
  }
}

/** Retention: AI messages are kept for 30 days. Run from the worker's periodic loop. */
export async function deleteExpiredAiMessages(now = new Date()): Promise<void> {
  try {
    const { count } = await prisma.aiMessage.deleteMany({
      where: { createdAt: { lt: new Date(now.getTime() - RETENTION_MS) } },
    });
    if (count) log(`Deleted ${count} AI messages older than 30 days`);
  } catch (error) {
    log("Retention cleanup failed:", error);
  }
}
