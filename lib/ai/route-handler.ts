import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { canManageWorkspace, getCurrentWorkspaceContext, type WorkspaceContext } from "@/lib/workspace-access";
import { assertSameOrigin, ConnectionError } from "@/lib/zernio/route-handler";

/**
 * Owner or admin only, Origin-checked writes, `{ success, data | error }`
 * responses. Same rules as the Zernio settings routes, with AI wording.
 */
export function withAiManagement(handler: (context: WorkspaceContext, request: Request) => Promise<Response>) {
  return async (request: Request) => {
    try {
      const context = await getCurrentWorkspaceContext();
      if (!context) throw new ConnectionError("Sign in to manage the AI assistant.", 401);
      if (!canManageWorkspace(context.role))
        throw new ConnectionError("Only workspace owners and admins can manage the AI assistant.", 403);
      if (request.method !== "GET") assertSameOrigin(request);
      return await handler(context, request);
    } catch (error) {
      if (error instanceof ConnectionError)
        return NextResponse.json({ success: false, error: error.message }, { status: error.status });
      console.error("[AI] Settings request failed:", error instanceof Error ? error.message : error);
      return NextResponse.json({ success: false, error: "Could not update the AI assistant. Please retry." }, { status: 500 });
    }
  };
}

export const aiInstructionsSchema = z.string().max(10_000, "Keep the AI instructions under 10000 characters.");

/** A META account of this workspace, with its AI settings. Anything else is a 404. */
export async function findAiAccount(workspaceId: string, instagramAccountId: string | null) {
  const account = instagramAccountId
    ? await prisma.instagramAccount.findFirst({
        where: { id: instagramAccountId, workspaceId, provider: "META" },
        select: { id: true, aiSettings: { select: { enabled: true, instructions: true, dailyLimit: true } } },
      })
    : null;
  if (!account) throw new ConnectionError("Instagram account not found.", 404);
  return account;
}
