import { createHmac } from "crypto";
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    workspaceMember: { findFirst: vi.fn() },
    instagramAccount: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
    },
    operationalEvent: { create: vi.fn() },
    workspace: { updateMany: vi.fn() },
  },
}));
vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/auth", () => ({
  auth: async () => ({ user: { id: "user_1" } }),
}));

import {
  createOAuthState,
  decryptToken,
  encryptToken,
  getAuthorizationUrl,
  verifyOAuthState,
} from "../lib/meta/oauth";
import { GET as instagramCallback } from "../app/api/instagram/callback/route";
import { GET as refreshTokens } from "../app/api/cron/refresh-tokens/route";

beforeEach(() => {
  vi.stubEnv("NEXTAUTH_SECRET", "test-secret-with-enough-length");
  vi.stubEnv(
    "ENCRYPTION_KEY",
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("OAuth state and token encryption", () => {
  it("round-trips encrypted tokens", () => {
    const encrypted = encryptToken("long-lived-token");
    expect(encrypted).not.toBe("long-lived-token");
    expect(decryptToken(encrypted)).toBe("long-lived-token");
  });

  it("signs and verifies Instagram OAuth state", () => {
    const state = createOAuthState("workspace_123");
    expect(verifyOAuthState(state)?.workspaceId).toBe("workspace_123");
  });

  it("rejects tampered OAuth state", () => {
    const state = createOAuthState("workspace_123");
    expect(verifyOAuthState(`${state}tampered`)).toBeNull();
  });

  // Builds a state whose signature is valid but whose payload has an
  // unusual shape, so verifyOAuthState is exercised on its own validation
  // rather than on the signature check.
  const signedState = (payload: Record<string, unknown>) => {
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const signature = createHmac("sha256", process.env.NEXTAUTH_SECRET!)
      .update(encoded)
      .digest("base64url");
    return `${encoded}.${signature}`;
  };

  it("rejects a state with no timestamp", () => {
    expect(verifyOAuthState(signedState({ workspaceId: "workspace_123" }))).toBeNull();
  });

  it("rejects a non-numeric timestamp", () => {
    expect(
      verifyOAuthState(
        signedState({ workspaceId: "workspace_123", ts: "not-a-number" })
      )
    ).toBeNull();
  });

  it("rejects a timestamp in the future", () => {
    expect(
      verifyOAuthState(
        signedState({
          workspaceId: "workspace_123",
          ts: Date.now() + 60 * 60 * 1000,
        })
      )
    ).toBeNull();
  });

  it("rejects an expired timestamp", () => {
    expect(
      verifyOAuthState(
        signedState({
          workspaceId: "workspace_123",
          ts: Date.now() - 11 * 60 * 1000,
        })
      )
    ).toBeNull();
  });

  it("rejects a state whose workspaceId is not a string", () => {
    expect(
      verifyOAuthState(
        signedState({ workspaceId: 123, ts: Date.now() })
      )
    ).toBeNull();
  });
});

describe("authorization URL", () => {
  it("is the unchanged Instagram login URL without a login configuration", () => {
    vi.stubEnv("INSTAGRAM_APP_ID", "123");
    vi.stubEnv("META_LOGIN_CONFIG_ID", "");
    const url = new URL(getAuthorizationUrl("https://app.test/cb", "signed"));
    expect(url.origin + url.pathname).toBe(
      "https://www.instagram.com/oauth/authorize"
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "123",
      redirect_uri: "https://app.test/cb",
      scope:
        "instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments,instagram_business_manage_insights",
      response_type: "code",
      state: "signed",
    });
  });

  it("is a Facebook Login for Business URL under Unified login", () => {
    vi.stubEnv("INSTAGRAM_APP_ID", "123");
    vi.stubEnv("META_LOGIN_CONFIG_ID", "456");
    const url = new URL(getAuthorizationUrl("https://app.test/cb", "signed"));
    expect(url.hostname).toBe("www.facebook.com");
    expect(url.pathname).toMatch(/\/dialog\/oauth$/);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "123",
      config_id: "456",
      redirect_uri: "https://app.test/cb",
      state: "signed",
      response_type: "code",
      override_default_response_type: "true",
    });
  });
});

describe("Instagram callback under Unified login", () => {
  const IG_ID = "17841400000000001";
  const fetchMock = vi.fn();

  // Answers Graph requests by path suffix; anything unrouted is a Graph error.
  function graph(routes: Record<string, unknown>) {
    fetchMock.mockImplementation(async (input: string) => {
      const { hostname, pathname } = new URL(input);
      const path = Object.keys(routes).find((p) =>
        `${hostname}${pathname}`.endsWith(p)
      );
      return path
        ? new Response(JSON.stringify(routes[path]))
        : new Response(
            JSON.stringify({ error: { message: "unrouted", code: 100 } }),
            { status: 400 }
          );
    });
  }

  function callbackRequest() {
    const state = createOAuthState("workspace_1");
    return new NextRequest(
      `https://app.test/api/instagram/callback?code=abc&state=${encodeURIComponent(state)}`
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("NEXTAUTH_URL", "https://app.test");
    vi.stubEnv("INSTAGRAM_APP_ID", "app");
    vi.stubEnv("INSTAGRAM_APP_SECRET", "app-secret");
    vi.stubEnv("META_LOGIN_CONFIG_ID", "cfg");
    mockPrisma.workspaceMember.findFirst.mockResolvedValue({ role: "OWNER" });
    mockPrisma.instagramAccount.findUnique.mockResolvedValue(null);
    mockPrisma.operationalEvent.create.mockResolvedValue({});
  });

  it("exchanges the code on graph.facebook.com and stores a token that never expires", async () => {
    graph({
      "/oauth/access_token": { access_token: "system-token" },
      "/me/assigned_instagram_accounts": {
        data: [{ id: IG_ID, username: "owner" }],
      },
      [`/${IG_ID}`]: { id: IG_ID, username: "owner", name: "Owner" },
      [`/${IG_ID}/subscribed_apps`]: { success: true },
    });

    const response = await instagramCallback(callbackRequest());

    expect(response.headers.get("location")).toBe(
      "https://app.test/dashboard?connected=true"
    );
    const exchange = new URL(fetchMock.mock.calls[0][0]);
    expect(exchange.origin + exchange.pathname).toMatch(
      /^https:\/\/graph\.facebook\.com\/v[\d.]+\/oauth\/access_token$/
    );
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).includes("graph.instagram.com")
      )
    ).toBe(false);
    expect(mockPrisma.instagramAccount.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        instagramId: IG_ID,
        username: "owner",
        provider: "META",
        tokenExpiresAt: null,
        webhookSubscribed: true,
      }),
    });
    const { accessToken } =
      mockPrisma.instagramAccount.create.mock.calls[0][0].data;
    expect(decryptToken(accessToken)).toBe("system-token");
  });

  it("sends the owner to Settings with an error naming META_INSTAGRAM_ACCOUNT_IDS when no account is found", async () => {
    graph({
      "/oauth/access_token": { access_token: "system-token" },
      "/me/assigned_instagram_accounts": { data: [] },
    });

    const location = new URL(
      (await instagramCallback(callbackRequest())).headers.get("location")!
    );

    expect(location.pathname).toBe("/settings");
    expect(location.searchParams.get("instagram")).toBe("failed");
    expect(location.searchParams.get("reason")).toContain(
      "META_INSTAGRAM_ACCOUNT_IDS"
    );
    expect(mockPrisma.instagramAccount.create).not.toHaveBeenCalled();
  });

  it("connects every account one login returns, through the usual connect checks", async () => {
    const SECOND = "17841400000000002";
    const TAKEN = "17841400000000003";
    graph({
      "/oauth/access_token": { access_token: "system-token" },
      "/me/assigned_instagram_accounts": {
        data: [{ id: IG_ID }, { id: SECOND }, { id: TAKEN }],
      },
      [`/${IG_ID}`]: { id: IG_ID, username: "one" },
      [`/${SECOND}`]: { id: SECOND, username: "two" },
      [`/${TAKEN}`]: { id: TAKEN, username: "taken" },
      "/subscribed_apps": { success: true },
    });
    mockPrisma.instagramAccount.findUnique.mockImplementation(
      async ({ where }: { where: { instagramId: string } }) =>
        where.instagramId === TAKEN
          ? { id: "elsewhere", workspaceId: "workspace_2", provider: "META" }
          : null
    );

    const response = await instagramCallback(callbackRequest());

    expect(response.headers.get("location")).toBe(
      "https://app.test/dashboard?connected=true"
    );
    expect(
      mockPrisma.instagramAccount.create.mock.calls.map(
        ([{ data }]) => data.instagramId
      )
    ).toEqual([IG_ID, SECOND]);
  });

  it("subscribes the account to comments, messages, postbacks and seen events", async () => {
    graph({
      "/oauth/access_token": { access_token: "system-token" },
      "/me/assigned_instagram_accounts": { data: [{ id: IG_ID }] },
      [`/${IG_ID}`]: { id: IG_ID, username: "owner" },
      [`/${IG_ID}/subscribed_apps`]: { success: true },
    });

    await instagramCallback(callbackRequest());

    const subscription = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith(`/${IG_ID}/subscribed_apps`)
    )!;
    expect(new URL(subscription[0]).hostname).toBe("graph.facebook.com");
    expect(JSON.parse(subscription[1].body).subscribed_fields).toEqual([
      "comments",
      "messages",
      "messaging_postbacks",
      "messaging_seen",
    ]);
  });

  it("still connects when the webhook subscription fails", async () => {
    graph({
      "/oauth/access_token": { access_token: "system-token" },
      "/me/assigned_instagram_accounts": { data: [{ id: IG_ID }] },
      [`/${IG_ID}`]: { id: IG_ID, username: "owner" },
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const response = await instagramCallback(callbackRequest());

    expect(response.headers.get("location")).toBe(
      "https://app.test/dashboard?connected=true"
    );
    expect(mockPrisma.instagramAccount.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ webhookSubscribed: false }),
    });
  });
});

describe("refresh-tokens cron", () => {
  const fetchMock = vi.fn();
  const cronRequest = () =>
    new NextRequest("https://app.test/api/cron/refresh-tokens", {
      headers: { authorization: "Bearer cron-secret" },
    });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("CRON_SECRET", "cron-secret");
    mockPrisma.workspace.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.instagramAccount.findMany.mockResolvedValue([]);
  });

  it("never selects an account with no token expiry, so Unified-login accounts are skipped", async () => {
    await refreshTokens(cronRequest());
    expect(mockPrisma.instagramAccount.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tokenExpiresAt: expect.objectContaining({ not: null }),
        }),
      })
    );
  });

  it("refreshes Instagram-login tokens on graph.instagram.com even with Unified login configured", async () => {
    vi.stubEnv("META_LOGIN_CONFIG_ID", "cfg");
    mockPrisma.instagramAccount.findMany.mockResolvedValue([
      {
        id: "account_1",
        workspaceId: "workspace_1",
        username: "owner",
        accessToken: encryptToken("ig-token"),
      },
    ]);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ access_token: "ig-token-2", expires_in: 60 }))
    );

    const body = await (await refreshTokens(cronRequest())).json();

    expect(body.data.results[0].status).toBe("refreshed");
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.origin + url.pathname).toMatch(
      /^https:\/\/graph\.instagram\.com\/v[\d.]+\/refresh_access_token$/
    );
    const { data } = mockPrisma.instagramAccount.update.mock.calls[0][0];
    expect(decryptToken(data.accessToken)).toBe("ig-token-2");
  });
});
