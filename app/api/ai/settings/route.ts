import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { countAiAnswersToday } from "@/lib/ai/assistant";
import { isAiConfigured } from "@/lib/ai/provider";
import { aiInstructionsSchema, findAiAccount, withAiManagement } from "@/lib/ai/route-handler";
import { AI_STARTER_TEMPLATE } from "@/lib/ai/starter-template";
import { ConnectionError, readBody } from "@/lib/zernio/route-handler";

const settingsBodySchema = z.object({
  instagramAccountId: z.string().min(1),
  enabled: z.boolean({ error: "Send enabled as true or false." }),
  instructions: aiInstructionsSchema,
  dailyLimit: z
    .number()
    .int("The daily AI limit must be a whole number.")
    .min(1, "The daily AI limit must be at least 1.")
    .max(10_000, "The daily AI limit can be at most 10000."),
});

export const GET = withAiManagement(async ({ workspaceId }, request) => {
  const account = await findAiAccount(workspaceId, new URL(request.url).searchParams.get("instagramAccountId"));
  return NextResponse.json({
    success: true,
    data: {
      settings: account.aiSettings ?? { enabled: false, instructions: AI_STARTER_TEMPLATE, dailyLimit: 100 },
      keyConfigured: isAiConfigured(),
      todayCount: await countAiAnswersToday(account.id),
    },
  });
});

export const PUT = withAiManagement(async ({ workspaceId }, request) => {
  const { instagramAccountId, ...fields } = await readBody(request, settingsBodySchema);
  const account = await findAiAccount(workspaceId, instagramAccountId);
  if (fields.enabled && !isAiConfigured())
    throw new ConnectionError("Add ANTHROPIC_API_KEY to the server environment before turning the AI assistant on.");
  const settings = await prisma.aiSettings.upsert({
    where: { instagramAccountId: account.id },
    create: { instagramAccountId: account.id, ...fields },
    update: fields,
    select: { enabled: true, instructions: true, dailyLimit: true },
  });
  return NextResponse.json({ success: true, data: { settings } });
});
