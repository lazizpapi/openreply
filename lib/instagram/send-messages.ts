import { createHash, randomUUID } from "node:crypto";
import * as meta from "@/lib/meta/client";
import {
  zernioRequest,
  ZernioApiError,
  ZernioDeliveryUnconfirmedError,
} from "@/lib/zernio/client";
import type { InstagramContext, ZernioContext } from "./context";
import {
  clearPendingButton,
  recordBotSend,
  recordBotText,
  recordPendingButton,
  type PendingButton,
} from "./bot-sends";

type Button =
  | { type: "url"; title: string; url: string }
  | { type: "postback"; title: string; payload: string };

async function sendZernioMessage({
  context,
  recipientId,
  commentId,
  postId,
  text,
  buttons,
}: {
  context: ZernioContext;
  recipientId?: string;
  commentId?: string;
  postId?: string;
  text: string;
  buttons?: Button[];
}) {
  const path = commentId
    ? `/inbox/comments/${encodeURIComponent(postId ?? commentId)}/${encodeURIComponent(commentId)}/private-reply`
    : `/inbox/conversations/${encodeURIComponent(recipientId!)}/messages`;
  const body = {
    accountId: context.accountId,
    message: buttons ? text.slice(0, 640) : text,
    ...(buttons ? { buttons } : {}),
  };
  const idempotencyKey = createHash("sha256")
    .update(
      JSON.stringify({
        operationId: context.operationId ?? randomUUID(),
        path,
        body,
      })
    )
    .digest("hex");
  const result = await zernioRequest<{
    messageId?: string;
    data?: { messageId: string };
  }>({
    apiKey: context.apiKey,
    path,
    method: "POST",
    body,
    ...(commentId ? {} : { idempotencyKey }),
  }).catch((error: unknown) => {
    // A send may have succeeded upstream before a network/5xx failure. The
    // service releases idempotency claims on non-2xx, so do not auto-resend.
    if (error instanceof ZernioApiError && error.code >= 500)
      throw new ZernioDeliveryUnconfirmedError();
    throw error;
  });
  const messageId = result?.messageId ?? result?.data?.messageId;
  if (!messageId) throw new ZernioDeliveryUnconfirmedError();
  return {
    message_id: messageId,
    ...(recipientId ? { recipient_id: recipientId } : {}),
  };
}

function linkButtons(buttons: meta.LinkButton[]): Button[] {
  return buttons
    .slice(0, 3)
    .map(({ title, url }) => ({ type: "url", title: title.slice(0, 20), url }));
}

async function sendPrivateReplyUntracked({
  context,
  instagramAccountId,
  commentId,
  message,
  postId,
}: {
  context: InstagramContext;
  instagramAccountId: string;
  commentId: string;
  message: string;
  postId?: string;
}) {
  if (context.provider === "META")
    return meta.sendPrivateReply(
      context.accessToken,
      instagramAccountId,
      commentId,
      message
    );
  return sendZernioMessage({ context, commentId, postId, text: message });
}

async function sendPrivateReplyWithButtonUntracked({
  context,
  instagramAccountId,
  commentId,
  text,
  buttonTitle,
  payload,
  postId,
}: {
  context: InstagramContext;
  instagramAccountId: string;
  commentId: string;
  text: string;
  buttonTitle: string;
  payload: string;
  postId?: string;
}) {
  if (context.provider === "META")
    return meta.sendPrivateReplyWithButton(
      context.accessToken,
      instagramAccountId,
      commentId,
      text,
      buttonTitle,
      payload
    );
  return sendZernioMessage({
    context,
    commentId,
    postId,
    text: text,
    buttons: [{ type: "postback", title: buttonTitle.slice(0, 20), payload }],
  });
}

async function sendDirectMessageWithButtonUntracked({
  context,
  instagramAccountId,
  userId,
  text,
  buttonTitle,
  payload,
}: {
  context: InstagramContext;
  instagramAccountId: string;
  userId: string;
  text: string;
  buttonTitle: string;
  payload: string;
}) {
  if (context.provider === "META")
    return meta.sendDirectMessageWithButton(
      context.accessToken,
      instagramAccountId,
      userId,
      text,
      buttonTitle,
      payload
    );
  return sendZernioMessage({
    context,
    recipientId: userId,
    text: text,
    buttons: [{ type: "postback", title: buttonTitle.slice(0, 20), payload }],
  });
}

async function sendPrivateReplyWithLinkButtonUntracked({
  context,
  instagramAccountId,
  commentId,
  text,
  buttons,
  postId,
}: {
  context: InstagramContext;
  instagramAccountId: string;
  commentId: string;
  text: string;
  buttons: meta.LinkButton[];
  postId?: string;
}) {
  if (context.provider === "META")
    return meta.sendPrivateReplyWithLinkButton(
      context.accessToken,
      instagramAccountId,
      commentId,
      text,
      buttons
    );
  return sendZernioMessage({
    context,
    commentId,
    postId,
    text: text,
    buttons: linkButtons(buttons),
  });
}

async function sendDirectMessageUntracked({
  context,
  instagramAccountId,
  userId,
  message,
}: {
  context: InstagramContext;
  instagramAccountId: string;
  userId: string;
  message: string;
}) {
  if (context.provider === "META")
    return meta.sendDirectMessage(
      context.accessToken,
      instagramAccountId,
      userId,
      message
    );
  return sendZernioMessage({ context, recipientId: userId, text: message });
}

async function sendDirectMessageWithLinkButtonUntracked({
  context,
  instagramAccountId,
  userId,
  text,
  buttons,
}: {
  context: InstagramContext;
  instagramAccountId: string;
  userId: string;
  text: string;
  buttons: meta.LinkButton[];
}) {
  if (context.provider === "META")
    return meta.sendDirectMessageWithLinkButton(
      context.accessToken,
      instagramAccountId,
      userId,
      text,
      buttons
    );
  return sendZernioMessage({
    context,
    recipientId: userId,
    text: text,
    buttons: linkButtons(buttons),
  });
}

export async function sendCommentReply({
  context,
  commentId,
  message,
  postId,
}: {
  context: InstagramContext;
  commentId: string;
  message: string;
  postId?: string;
}) {
  if (context.provider === "META")
    return meta.sendCommentReply(context.accessToken, commentId, message);
  const result = await zernioRequest<{ data: { commentId: string } }>({
    apiKey: context.apiKey,
    path: `/inbox/comments/${encodeURIComponent(postId ?? commentId)}`,
    method: "POST",
    body: { accountId: context.accountId, commentId, message },
  }).catch((error: unknown) => {
    if (error instanceof ZernioApiError && error.code >= 500) throw new ZernioDeliveryUnconfirmedError();
    throw error;
  });
  if (!result?.data?.commentId) throw new ZernioDeliveryUnconfirmedError();
  return { id: result.data.commentId };
}

// ─── Bot-send tracking ──────────────────────────────────────────────────────
// The exported DM sends wrap the untracked ones above. On META accounts every
// send attempt records its text as bot-sent and every successful send its id, a
// postback-button send records the follower's pending button, and a link-button
// send (the lead magnet) clears it.

type SendArgs<F extends (args: never) => unknown> = Parameters<F>[0];

async function track<R extends { message_id?: string }>(
  { context, instagramAccountId }: { context: InstagramContext; instagramAccountId: string },
  recipientId: string,
  text: string,
  send: () => Promise<R>,
  pending?: Omit<PendingButton, "campaignId" | "text"> | "clear"
): Promise<R> {
  const isMeta = context.provider === "META";
  if (isMeta) recordBotText(instagramAccountId, recipientId, text);
  const result = await send();
  if (!isMeta) return result;
  recordBotSend(recipientId, text, result.message_id);
  if (pending === "clear") clearPendingButton(instagramAccountId, recipientId);
  // Campaign payloads are `reveal:<id>[:open]` or `followcheck:<id>[:open]`.
  else if (pending)
    recordPendingButton(instagramAccountId, recipientId, {
      campaignId: pending.payload.split(":")[1] ?? "",
      text,
      ...pending,
    });
  return result;
}

export function sendPrivateReply(
  args: SendArgs<typeof sendPrivateReplyUntracked> & { recipientId: string }
) {
  return track(args, args.recipientId, args.message, () => sendPrivateReplyUntracked(args));
}

export function sendPrivateReplyWithButton(
  args: SendArgs<typeof sendPrivateReplyWithButtonUntracked> & { recipientId: string }
) {
  return track(args, args.recipientId, args.text, () => sendPrivateReplyWithButtonUntracked(args), {
    buttonTitle: args.buttonTitle,
    payload: args.payload,
    via: "private_reply",
  });
}

export function sendPrivateReplyWithLinkButton(
  args: SendArgs<typeof sendPrivateReplyWithLinkButtonUntracked> & { recipientId: string }
) {
  return track(
    args,
    args.recipientId,
    args.text,
    () => sendPrivateReplyWithLinkButtonUntracked(args),
    "clear"
  );
}

export function sendDirectMessage(args: SendArgs<typeof sendDirectMessageUntracked>) {
  return track(args, args.userId, args.message, () => sendDirectMessageUntracked(args));
}

export function sendDirectMessageWithButton(
  args: SendArgs<typeof sendDirectMessageWithButtonUntracked>
) {
  return track(args, args.userId, args.text, () => sendDirectMessageWithButtonUntracked(args), {
    buttonTitle: args.buttonTitle,
    payload: args.payload,
    via: "dm",
  });
}

export function sendDirectMessageWithLinkButton(
  args: SendArgs<typeof sendDirectMessageWithLinkButtonUntracked>
) {
  return track(args, args.userId, args.text, () => sendDirectMessageWithLinkButtonUntracked(args), "clear");
}
