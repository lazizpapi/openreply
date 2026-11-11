import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db/client", () => ({
  prisma: { zernioConnection: { findUnique: vi.fn() } },
}));
vi.mock("@/lib/meta/oauth", () => ({
  decryptToken: (value: string) => `decrypted:${value}`,
}));
import {
  createInstagramContext,
  sendPrivateReplyWithButton,
  sendDirectMessageWithLinkButton,
  getRecentMediaComments,
  getUserFollowStatus,
  getUserMedia,
} from "@/lib/instagram/provider";
import { zernioRequest } from "@/lib/zernio/client";
import { RateLimitError, TokenExpiredError } from "@/lib/meta/client";
import { findInstagramAccounts } from "@/lib/meta/unified-login";
import { prisma } from "@/lib/db/client";
const context = {
  provider: "ZERNIO" as const,
  apiKey: "secret",
  accountId: "selected",
  instagramId: "ig",
};
const fetchMock = vi.fn();
function respond(body: unknown, status = 200) {
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify(body), { status })
  );
}
describe("Instagram provider boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
  });
  it("resolves only the selected account workspace credentials", async () => {
    vi.mocked(prisma.zernioConnection.findUnique).mockResolvedValue({
      apiKey: "encrypted",
    } as Awaited<ReturnType<typeof prisma.zernioConnection.findUnique>>);
    expect(
      await createInstagramContext({
        provider: "ZERNIO",
        workspaceId: "workspace",
        zernioAccountId: "selected",
        instagramId: "ig",
        accessToken: "",
      })
    ).toEqual({ ...context, apiKey: "decrypted:encrypted" });
    expect(prisma.zernioConnection.findUnique).toHaveBeenCalledWith({
      where: { workspaceId: "workspace" },
      select: { apiKey: true },
    });
  });
  it("sends postback private replies using Zernio button contracts", async () => {
    respond({ messageId: "mid" });
    await sendPrivateReplyWithButton({
      context,
      instagramAccountId: "ig",
      commentId: "comment",
      postId: "post",
      text: "hello",
      buttonTitle: "Reveal",
      payload: "reveal:campaign",
    });
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://zernio.com/api/v1/inbox/comments/post/comment/private-reply"
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      accountId: "selected",
      message: "hello",
      buttons: [
        { type: "postback", title: "Reveal", payload: "reveal:campaign" },
      ],
    });
  });
  it("sends URL buttons to the recipient IGSID without another send", async () => {
    respond({ data: { messageId: "mid" } });
    await sendDirectMessageWithLinkButton({
      context,
      instagramAccountId: "ig",
      userId: "recipient",
      text: "link",
      buttons: [{ title: "Open", url: "https://example.com" }],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain(
      "/conversations/recipient/messages"
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).buttons[0].type).toBe(
      "url"
    );
  });
  it("follows comment cursors and preserves owner replies", async () => {
    respond({
      comments: [
        {
          id: "c",
          message: "yes",
          createdTime: "2026-09-01",
          from: { id: "person" },
          replies: [{ id: "r", from: { id: "ig" } }],
        },
      ],
      pagination: { hasMore: true, cursor: "next" },
    });
    respond({ comments: [], pagination: { hasMore: false } });
    const result = await getRecentMediaComments({
      context,
      mediaId: "post",
      sinceMs: 0,
    });
    expect(result[0].replies?.data?.[0].from?.id).toBe("ig");
    expect(fetchMock.mock.calls[1][0]).toContain("cursor=next");
  });
  it("keeps unavailable follower status unknown", async () => {
    respond({ isFollower: null, unavailableReason: "consent_required" });
    expect(
      await getUserFollowStatus({ context, recipientId: "person" })
    ).toBeNull();
  });
  it("preserves direct Meta requests", async () => {
    respond({ data: [{ id: "media" }] });
    expect(
      await getUserMedia({
        context: { provider: "META", accessToken: "meta" },
        limit: 3,
      })
    ).toEqual([{ id: "media" }]);
    expect(fetchMock.mock.calls[0][0]).toContain("graph.instagram.com");
  });
  it.each([
    [429, RateLimitError],
    [401, TokenExpiredError],
  ])(
    "classifies HTTP %i without leaking response secrets",
    async (status, ErrorType) => {
      respond({ error: "secret token" }, status);
      await expect(
        zernioRequest({ apiKey: "secret", path: "/accounts" })
      ).rejects.toBeInstanceOf(ErrorType);
      expect(fetchMock.mock.calls[0][1].cache).toBe("no-store");
    }
  );
});

it("uses only selected-account synced insights and never default zeros", async () => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  const { getMediaInsights } = await import("@/lib/instagram/provider");
  respond({
    platformAnalytics: [
      {
        platformPostId: "post",
        accountId: "other",
        analytics: { views: 900, lastUpdated: "2026-09-08" },
      },
      {
        platformPostId: "post",
        accountId: "selected",
        analytics: { views: 5, saves: 2, lastUpdated: "2026-09-08" },
      },
    ],
  });
  expect(
    await getMediaInsights({
      context,
      mediaId: "post",
      metrics: ["views", "saved"],
    })
  ).toEqual({ views: 5, saved: 2 });
  respond({
    platformAnalytics: [
      {
        platformPostId: "post",
        accountId: "selected",
        analytics: { views: 0, lastUpdated: null },
      },
    ],
  });
  await expect(
    getMediaInsights({ context, mediaId: "post", metrics: ["views"] })
  ).rejects.toThrow();
});
it("uses dated follower snapshots without manufacturing missing days", async () => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  const { getZernioFollowerSnapshots } = await import(
    "@/lib/instagram/provider"
  );
  respond({
    accountId: "selected",
    metrics: { follower_count: { total: 0, values: [] } },
  });
  expect(await getZernioFollowerSnapshots(context)).toEqual([]);
  respond({
    accountId: "selected",
    metrics: {
      follower_count: {
        values: [
          { date: "2026-09-06", value: 25 },
          { date: "2026-09-08", value: 29 },
        ],
      },
    },
  });
  expect(await getZernioFollowerSnapshots(context)).toEqual([
    { date: "2026-09-06", followers: 25 },
    { date: "2026-09-08", followers: 29 },
  ]);
});

it("recognizes Reels only from an explicit Instagram Reel permalink", async () => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  respond({
    posts: [
      {
        id: "reel",
        message: "caption",
        createdTime: "2026-09-08T12:00:00.000Z",
        mediaType: "video",
        permalink: "https://www.instagram.com/reel/abc/",
        picture: "https://example.com/picture.jpg",
        likeCount: 7,
        commentCount: 3,
      },
      {
        id: "video",
        message: "caption",
        createdTime: "2026-09-08T12:00:00.000Z",
        mediaType: "video",
        permalink: "https://www.instagram.com/p/def/",
      },
    ],
  });
  const media = await getUserMedia({ context });
  expect(media[0]).toMatchObject({
    id: "reel",
    media_product_type: "REELS",
    media_type: "VIDEO",
    like_count: 7,
    comments_count: 3,
  });
  expect(media[1].media_product_type).toBeUndefined();
});

it("adds a repeatable idempotency key and stops on an unconfirmed direct send", async () => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  const { ZernioDeliveryUnconfirmedError } = await import(
    "@/lib/zernio/client"
  );
  const input = {
    context: { ...context, operationId: "job:campaign" },
    instagramAccountId: "ig",
    userId: "recipient",
    text: "link",
    buttons: [{ title: "Open", url: "https://example.com" }],
  };
  respond({ data: { messageId: "sent" } });
  await sendDirectMessageWithLinkButton(input);
  respond({ data: { messageId: "sent" } });
  await sendDirectMessageWithLinkButton(input);
  expect(fetchMock.mock.calls[0][1].headers["Idempotency-Key"]).toBeTruthy();
  expect(fetchMock.mock.calls[1][1].headers["Idempotency-Key"]).toBe(
    fetchMock.mock.calls[0][1].headers["Idempotency-Key"]
  );
  fetchMock.mockRejectedValueOnce(new Error("connection reset"));
  await expect(sendDirectMessageWithLinkButton(input)).rejects.toBeInstanceOf(
    ZernioDeliveryUnconfirmedError
  );
});

describe("Unified login account lookup", () => {
  const TOKEN = "system-user-token";
  const IDS = {
    assigned: "17841400000000001",
    debug: "17841400000000002",
    business: "17841400000000003",
    page: "17841400000000004",
    configured: "17841400000000005",
  };

  // Answers Graph requests by path suffix; anything unrouted is a Graph error.
  function graph(routes: Record<string, unknown>) {
    fetchMock.mockImplementation(async (input: string) => {
      const { pathname } = new URL(input);
      const path = Object.keys(routes).find((p) => pathname.endsWith(p));
      return path
        ? new Response(JSON.stringify(routes[path]))
        : new Response(
            JSON.stringify({ error: { message: "unrouted", code: 100 } }),
            { status: 400 }
          );
    });
  }

  // Strategies before `first` find nothing; `first` and later ones find their own account.
  function routesFrom(first: number) {
    const has = (step: number) => step >= first;
    return {
      "/me/assigned_instagram_accounts": {
        data: has(1) ? [{ id: IDS.assigned, username: "assigned" }] : [],
      },
      "/debug_token": {
        data: {
          granular_scopes: [
            { scope: "pages_show_list", target_ids: ["page-asset"] },
            ...(has(2)
              ? [{ scope: "instagram_basic", target_ids: [IDS.debug] }]
              : []),
          ],
        },
      },
      "/me/businesses": {
        data: [
          {
            id: "business",
            instagram_accounts: {
              data: has(3) ? [{ id: IDS.business, username: "business" }] : [],
            },
          },
        ],
      },
      "/me/accounts": {
        data: [
          has(4)
            ? {
                id: "page",
                instagram_business_account: { id: IDS.page, username: "page" },
              }
            : { id: "page" },
        ],
      },
      [`/${IDS.configured}`]: { id: IDS.configured, username: "configured" },
    };
  }

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("INSTAGRAM_APP_ID", "app");
    vi.stubEnv("INSTAGRAM_APP_SECRET", "app-secret");
    vi.stubEnv("META_INSTAGRAM_ACCOUNT_IDS", IDS.configured);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    [1, [{ id: IDS.assigned, username: "assigned" }]],
    [2, [{ id: IDS.debug }]],
    [3, [{ id: IDS.business, username: "business" }]],
    [4, [{ id: IDS.page, username: "page" }]],
    [5, [{ id: IDS.configured, username: "configured" }]],
  ])("stops at strategy %i, the first that finds accounts", async (first, expected) => {
    graph(routesFrom(first));
    expect(await findInstagramAccounts(TOKEN)).toEqual(expected);
  });

  it("connects only configured IDs the token can actually read", async () => {
    vi.stubEnv("META_INSTAGRAM_ACCOUNT_IDS", ` ${IDS.configured} , 1784typo,`);
    graph(routesFrom(6));
    expect(await findInstagramAccounts(TOKEN)).toEqual([
      { id: IDS.configured, username: "configured" },
    ]);
    const verified = fetchMock.mock.calls
      .map(([url]) => new URL(url))
      .find((url) => url.pathname.endsWith(`/${IDS.configured}`));
    expect(verified?.searchParams.get("fields")).toBe("id,username");
  });

  it("finds nothing when no strategy and no configured ID yields an account", async () => {
    vi.stubEnv("META_INSTAGRAM_ACCOUNT_IDS", "");
    graph(routesFrom(6));
    expect(await findInstagramAccounts(TOKEN)).toEqual([]);
  });

  it("prefers IG User IDs over 15-digit asset IDs", async () => {
    graph({
      ...routesFrom(6),
      "/me/businesses": {
        data: [
          {
            id: "business",
            instagram_accounts: {
              data: [
                { id: "123456789012345", username: "business" },
                { id: IDS.business, username: "business" },
              ],
            },
          },
        ],
      },
    });
    expect(await findInstagramAccounts(TOKEN)).toEqual([
      { id: IDS.business, username: "business" },
    ]);
  });

  it("logs each attempt's count, IDs and usernames but never a token", async () => {
    vi.stubEnv("META_INSTAGRAM_ACCOUNT_IDS", `1784typo,${IDS.configured}`);
    // Failures echo the full request URL, query included, like a real fetch.
    fetchMock.mockImplementation(async (input: string) => {
      const ok = new URL(input).pathname.endsWith(`/${IDS.configured}`);
      const response = new Response(
        JSON.stringify(
          ok
            ? { id: IDS.configured, username: "configured" }
            : { error: { message: "denied", code: 10 } }
        ),
        { status: ok ? 200 : 403 }
      );
      Object.defineProperty(response, "url", { value: input });
      return response;
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await findInstagramAccounts(TOKEN);

    const logged = JSON.stringify([...log.mock.calls, ...warn.mock.calls]);
    expect(logged).not.toContain(TOKEN);
    expect(logged).not.toContain("app-secret");
    expect(log).toHaveBeenLastCalledWith("[Unified login] Account lookup", {
      strategy: "META_INSTAGRAM_ACCOUNT_IDS",
      count: 1,
      accounts: [{ id: IDS.configured, username: "configured" }],
    });
    expect(log).toHaveBeenCalledTimes(5);
    log.mockRestore();
    warn.mockRestore();
  });
});

it('treats a lost public-reply response as unconfirmed instead of safe to repeat', async () => {
  fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock);
  const { sendCommentReply } = await import('@/lib/instagram/provider');
  fetchMock.mockRejectedValueOnce(new Error('connection reset'));
  await expect(sendCommentReply({ context, commentId: 'comment', postId: 'post', message: 'Thanks' })).rejects.toMatchObject({ name: 'ZernioDeliveryUnconfirmedError' });
  respond({ data: {} });
  await expect(sendCommentReply({ context, commentId: 'comment', postId: 'post', message: 'Thanks' })).rejects.toMatchObject({ name: 'ZernioDeliveryUnconfirmedError' });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
