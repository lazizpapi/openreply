import { NextResponse } from "next/server";
import { z } from "zod";
import { liveDmCampaigns } from "@/lib/ai/assistant";
import { askClaude, buildSystemPrompt, isAiConfigured } from "@/lib/ai/provider";
import { shapeAnswer } from "@/lib/ai/reply-text";
import { aiInstructionsSchema, findAiAccount, withAiManagement } from "@/lib/ai/route-handler";
import { ConnectionError, readBody } from "@/lib/zernio/route-handler";

const tryBodySchema = z.object({
  instagramAccountId: z.string().min(1),
  // The instructions as typed in the panel, saved or not, so the owner can tune them first.
  instructions: aiInstructionsSchema,
  message: z.string().trim().min(1, "Type a message to try.").max(1000, "Keep the message under 1000 characters."),
});

/** One typed message through the real prompt and Claude call. No history, no send, no storage, no counting. */
export const POST = withAiManagement(async ({ workspaceId }, request) => {
  const { instagramAccountId, instructions, message } = await readBody(request, tryBodySchema);
  const account = await findAiAccount(workspaceId, instagramAccountId);
  if (!isAiConfigured())
    throw new ConnectionError("Add ANTHROPIC_API_KEY to the server environment to try the AI assistant.");
  const answer = await askClaude(buildSystemPrompt(instructions, await liveDmCampaigns(account.id)), [
    { role: "user", content: message },
  ]);
  const shaped = answer && shapeAnswer(answer, instructions);
  if (!shaped?.reply)
    return NextResponse.json(
      {
        success: false,
        error: "Claude gave no answer (the request failed or was declined). In a real chat the assistant would stay silent.",
      },
      { status: 502 }
    );
  return NextResponse.json({ success: true, data: shaped });
});
