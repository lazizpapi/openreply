import { prisma } from "@/lib/db/client";
import { claimNudge, getPendingButton } from "@/lib/instagram/bot-sends";
import {
  createInstagramContext,
  hasInstagramCredentials,
  sendDirectMessageWithButton,
} from "@/lib/instagram/provider";
import { isYesWord } from "@/lib/utils/yes-word";
import type { ProcessMessageJob } from "./client";

/**
 * Nudge: a follower who types a yes-word instead of tapping gets their pending
 * button again, the owner's message and button unchanged. META accounts only.
 * Never throws; returns whether the message was handled: a nudge was sent, or
 * one was held back by the once-a-minute limit.
 */
export async function sendNudge(job: ProcessMessageJob): Promise<boolean> {
  const { instagramAccountId, senderId, messageText, accountConnectionId } = job;
  if (!isYesWord(messageText)) return false;
  try {
    const pending = await getPendingButton(instagramAccountId, senderId);
    if (!pending) return false;

    // A tap on a switched-off campaign's button does nothing, so don't resend it.
    const campaign = await prisma.automation.findFirst({
      where: {
        id: pending.campaignId,
        isActive: true,
        ...(accountConnectionId ? { instagramAccountId: accountConnectionId } : {}),
      },
      include: { instagramAccount: true },
    });
    if (
      !campaign ||
      campaign.instagramAccount.instagramId !== instagramAccountId ||
      !hasInstagramCredentials(campaign.instagramAccount)
    )
      return false;

    const context = await createInstagramContext(campaign.instagramAccount);
    if (context.provider !== "META") return false;
    // A repeated "ha" while a button is pending is not a question for the AI.
    if (!(await claimNudge(instagramAccountId, senderId))) return true;

    // The follower just wrote, so the messaging window is open.
    await sendDirectMessageWithButton({
      context,
      instagramAccountId,
      userId: senderId,
      text: pending.text,
      buttonTitle: pending.buttonTitle,
      payload: pending.payload,
    });
    return true;
  } catch (error) {
    console.log("[DM Worker] Nudge not sent:", error instanceof Error ? error.message : error);
    return false;
  }
}
