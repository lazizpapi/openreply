import { beforeEach, describe, expect, it, vi } from "vitest";

const KEY = "sk-ant-test-secret-key";
const ORIGIN = "https://app.example.com";

type Account = { id: string; workspaceId: string; provider: "META" | "ZERNIO"; aiSettings: unknown };

const { mockPrisma, mockContext, mockAskClaude, mockSend, mockQueueAdd, accounts } = vi.hoisted(() => {
  const accounts: Account[] = [];
  const mockPrisma = {
    instagramAccount: {
      findFirst: vi.fn(
        async ({ where }: { where: Partial<Account> }) =>
          accounts.find(
            (account) =>
              account.id === where.id &&
              account.workspaceId === where.workspaceId &&
              (!where.provider || account.provider === where.provider)
          ) ?? null
      ),
    },
    aiSettings: { upsert: vi.fn() },
    aiMessage: { count: vi.fn(), create: vi.fn(), createMany: vi.fn() },
    automation: { findMany: vi.fn() },
  };
  return {
    mockPrisma,
    accounts,
    mockContext: vi.fn(),
    mockAskClaude: vi.fn(),
    mockSend: vi.fn(),
    mockQueueAdd: vi.fn(),
  };
});

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/workspace-access", () => ({
  getCurrentWorkspaceContext: mockContext,
  canManageWorkspace: (role: string) => role === "OWNER" || role === "ADMIN",
}));
vi.mock("@/lib/ai/provider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/provider")>()),
  askClaude: mockAskClaude,
}));
vi.mock("@/lib/instagram/provider", () => ({
  createInstagramContext: vi.fn(),
  sendDirectMessage: mockSend,
}));
vi.mock("@/lib/queue/client", () => ({
  AI_REPLY_JOB_NAME: "ai-reply",
  getDMQueue: () => ({ add: mockQueueAdd }),
}));

import { GET, PUT } from "@/app/api/ai/settings/route";
import { POST as TRY } from "@/app/api/ai/try/route";
import { AI_STARTER_TEMPLATE } from "@/lib/ai/starter-template";

const get = (instagramAccountId = "acc_1") =>
  GET(new Request(`${ORIGIN}/api/ai/settings?instagramAccountId=${instagramAccountId}`));
const write = (handler: (request: Request) => Promise<Response>, path: string, body: unknown, origin = ORIGIN) =>
  handler(
    new Request(`${ORIGIN}${path}`, {
      method: path.endsWith("try") ? "POST" : "PUT",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify(body),
    })
  );
const put = (body: unknown, origin?: string) => write(PUT, "/api/ai/settings", body, origin);
const tryIt = (body: unknown) => write(TRY, "/api/ai/try", body);

// Every response is read through here, so every test also checks the key never leaks.
async function read(response: Response) {
  const text = await response.text();
  expect(text).not.toContain(KEY);
  return { status: response.status, body: JSON.parse(text) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("ANTHROPIC_API_KEY", KEY);
  vi.stubEnv("NEXTAUTH_URL", "");
  accounts.length = 0;
  accounts.push(
    { id: "acc_1", workspaceId: "ws_1", provider: "META", aiSettings: null },
    { id: "acc_other", workspaceId: "ws_2", provider: "META", aiSettings: null }
  );
  mockContext.mockResolvedValue({ userId: "user_1", workspaceId: "ws_1", role: "OWNER" });
  mockPrisma.aiMessage.count.mockResolvedValue(7);
  mockPrisma.automation.findMany.mockResolvedValue([]);
  mockPrisma.aiSettings.upsert.mockImplementation(async ({ update }) => update);
});

describe("GET /api/ai/settings", () => {
  it("returns the defaults with the Uzbek starter template, whether a key is configured, and today's count", async () => {
    const { status, body } = await read(await get());

    expect(status).toBe(200);
    expect(body).toEqual({
      success: true,
      data: {
        settings: { enabled: false, instructions: AI_STARTER_TEMPLATE, dailyLimit: 100 },
        keyConfigured: true,
        todayCount: 7,
      },
    });
  });

  it("returns the saved settings, and reports when no key is configured", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    accounts[0].aiSettings = { enabled: true, instructions: "Men Laziz.", dailyLimit: 30 };

    const { body } = await read(await get());

    expect(body.data).toMatchObject({
      settings: { enabled: true, instructions: "Men Laziz.", dailyLimit: 30 },
      keyConfigured: false,
    });
  });

  it("refuses an account from another workspace", async () => {
    const { status, body } = await read(await get("acc_other"));

    expect(status).toBe(404);
    expect(body).toEqual({ success: false, error: "Instagram account not found." });
    expect(mockPrisma.aiMessage.count).not.toHaveBeenCalled();
  });

  it("refuses a Zernio account, which the AI assistant does not serve", async () => {
    accounts.push({ id: "acc_zernio", workspaceId: "ws_1", provider: "ZERNIO", aiSettings: null });

    expect((await read(await get("acc_zernio"))).status).toBe(404);
  });
});

describe("role enforcement", () => {
  const calls = {
    "GET settings": () => get(),
    "PUT settings": () => put({ instagramAccountId: "acc_1", enabled: false, instructions: "x", dailyLimit: 10 }),
    "POST try": () => tryIt({ instagramAccountId: "acc_1", instructions: "x", message: "salom" }),
  };

  it.each(Object.entries(calls))("%s refuses a workspace member", async (_name, call) => {
    mockContext.mockResolvedValue({ userId: "user_2", workspaceId: "ws_1", role: "MEMBER" });

    const { status, body } = await read(await call());

    expect(status).toBe(403);
    expect(body.success).toBe(false);
    expect(mockPrisma.aiSettings.upsert).not.toHaveBeenCalled();
    expect(mockAskClaude).not.toHaveBeenCalled();
  });

  it.each(Object.entries(calls))("%s refuses a signed-out visitor", async (_name, call) => {
    mockContext.mockResolvedValue(null);

    expect((await read(await call())).status).toBe(401);
  });

  it("lets an admin read the settings", async () => {
    mockContext.mockResolvedValue({ userId: "user_3", workspaceId: "ws_1", role: "ADMIN" });

    expect((await read(await get())).status).toBe(200);
  });
});

describe("PUT /api/ai/settings", () => {
  const body = { instagramAccountId: "acc_1", enabled: true, instructions: "Men Laziz. Telegram: https://t.me/laziz", dailyLimit: 50 };

  it("saves the switch, the AI instructions and the daily AI limit for the account", async () => {
    const { status, body: result } = await read(await put(body));

    expect(status).toBe(200);
    expect(result).toEqual({
      success: true,
      data: { settings: { enabled: true, instructions: body.instructions, dailyLimit: 50 } },
    });
    expect(mockPrisma.aiSettings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { instagramAccountId: "acc_1" },
        create: { instagramAccountId: "acc_1", enabled: true, instructions: body.instructions, dailyLimit: 50 },
        update: { enabled: true, instructions: body.instructions, dailyLimit: 50 },
      })
    );
  });

  it("refuses to switch the assistant on without a Claude API key", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");

    const { status, body: result } = await read(await put(body));

    expect(status).toBe(400);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/ANTHROPIC_API_KEY/);
    expect(mockPrisma.aiSettings.upsert).not.toHaveBeenCalled();
  });

  it("still saves the instructions with the switch off when no key is configured", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");

    expect((await read(await put({ ...body, enabled: false }))).status).toBe(200);
    expect(mockPrisma.aiSettings.upsert).toHaveBeenCalledOnce();
  });

  it("refuses an account from another workspace", async () => {
    const { status } = await read(await put({ ...body, instagramAccountId: "acc_other" }));

    expect(status).toBe(404);
    expect(mockPrisma.aiSettings.upsert).not.toHaveBeenCalled();
  });

  it.each([
    ["a daily limit below 1", { dailyLimit: 0 }],
    ["a fractional daily limit", { dailyLimit: 2.5 }],
    ["a missing switch", { enabled: undefined }],
    ["instructions over 10,000 characters", { instructions: "a".repeat(10_001) }],
  ])("rejects %s", async (_name, change) => {
    const { status } = await read(await put({ ...body, ...change }));

    expect(status).toBe(400);
    expect(mockPrisma.aiSettings.upsert).not.toHaveBeenCalled();
  });

  it("refuses a write from another site", async () => {
    const { status, body: result } = await read(await put(body, "https://evil.example.com"));

    expect(status).toBe(403);
    expect(result).toEqual({ success: false, error: "Invalid request origin." });
    expect(mockPrisma.aiSettings.upsert).not.toHaveBeenCalled();
  });
});

describe("POST /api/ai/try", () => {
  const body = { instagramAccountId: "acc_1", instructions: "Men Laziz. Kurs narxi 200 ming soʻm.", message: "narxi qancha?" };

  beforeEach(() => {
    mockPrisma.automation.findMany.mockImplementation(async ({ where }) =>
      where.instagramAccountId === "acc_1" ? [{ name: "Qoʻllanma", keywords: ["GUIDE"] }] : []
    );
  });

  function expectNothingSentOrStored() {
    expect(mockSend).not.toHaveBeenCalled();
    expect(mockQueueAdd).not.toHaveBeenCalled();
    expect(mockPrisma.aiMessage.create).not.toHaveBeenCalled();
    expect(mockPrisma.aiMessage.createMany).not.toHaveBeenCalled();
    expect(mockPrisma.aiSettings.upsert).not.toHaveBeenCalled();
  }

  it("answers one typed message from the typed AI instructions and the live campaigns, without sending or storing anything", async () => {
    mockAskClaude.mockResolvedValue({ reply: "Kurs narxi **200 ming soʻm**.", handover: false, language: "uz-latn" });

    const { status, body: result } = await read(await tryIt(body));

    expect(status).toBe(200);
    expect(result).toEqual({ success: true, data: { reply: "Kurs narxi 200 ming soʻm.", handover: false } });
    expect(mockAskClaude).toHaveBeenCalledWith(
      expect.stringContaining("Men Laziz. Kurs narxi 200 ming soʻm."),
      [{ role: "user", content: "narxi qancha?" }]
    );
    expect(mockAskClaude.mock.calls[0][0]).toContain("- Qoʻllanma: type GUIDE here to get it.");
    expectNothingSentOrStored();
  });

  it("shows a handover as the fixed handover text the follower would get", async () => {
    mockAskClaude.mockResolvedValue({ reply: "Bilmayman.", handover: true, language: "ru" });

    const { body: result } = await read(await tryIt(body));

    expect(result).toEqual({ success: true, data: { reply: "Скоро отвечу на это лично.", handover: true } });
    expectNothingSentOrStored();
  });

  it("hands over on a link that is not in the typed AI instructions", async () => {
    const typed = { ...body, instructions: `${body.instructions}\nTelegram: https://t.me/lazizpapi` };
    const tryReply = async (reply: string) => {
      mockAskClaude.mockResolvedValueOnce({ reply, handover: false, language: "uz-latn" });
      return (await read(await tryIt(typed))).body.data;
    };

    expect(await tryReply("Kanal: https://t.me/lazizpapi")).toEqual({
      reply: "Kanal: https://t.me/lazizpapi",
      handover: false,
    });
    expect(await tryReply("Kanal: https://t.me/boshqa_kanal")).toEqual({
      reply: "Bunga tez orada oʻzim javob beraman.",
      handover: true,
    });
  });

  it("says clearly when Claude gives no answer", async () => {
    mockAskClaude.mockResolvedValue(null);

    const { status, body: result } = await read(await tryIt(body));

    expect(status).toBe(502);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/no answer/i);
    expectNothingSentOrStored();
  });

  it("refuses without a Claude API key and does not call Claude", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");

    const { status, body: result } = await read(await tryIt(body));

    expect(status).toBe(400);
    expect(result.error).toMatch(/ANTHROPIC_API_KEY/);
    expect(mockAskClaude).not.toHaveBeenCalled();
  });

  it("refuses an account from another workspace", async () => {
    const { status } = await read(await tryIt({ ...body, instagramAccountId: "acc_other" }));

    expect(status).toBe(404);
    expect(mockAskClaude).not.toHaveBeenCalled();
  });

  it("rejects an empty message", async () => {
    expect((await read(await tryIt({ ...body, message: "   " }))).status).toBe(400);
    expect(mockAskClaude).not.toHaveBeenCalled();
  });
});
