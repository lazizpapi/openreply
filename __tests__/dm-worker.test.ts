import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const {
  mockPrisma,
  mockSendPrivateReply,
  mockSendPrivateReplyWithLinkButton,
  mockSendPrivateReplyWithButton,
  mockGetUserFollowStatus,
  mockGetBusinessFollowsUser,
  mockSendDirectMessageWithButton,
  mockSendDirectMessage,
  mockSendDirectMessageWithLinkButton,
  mockDecryptToken,
  mockMatchKeywords,
  mockReserveDMSlot,
  mockReleaseDMSlot,
  mockQueueAdd,
  mockReserveWorkspaceDMSend,
  mockReleaseWorkspaceDMReservation,
  mockAskClaude,
  mockGetWorkspaceInstagramAccount,
  afterTasks,
} = vi.hoisted(() => ({
  mockPrisma: {
    // In-memory AiMessage table; see createAiMessageTable below.
    aiMessage: {
      createMany: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      deleteMany: vi.fn(),
    },
    zernioConnection: { findUnique: vi.fn() },
    postbackDelivery: { create: vi.fn(), delete: vi.fn() },
    automation: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    dmLog: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
    },
    instagramAccount: {
      findUnique: vi.fn(),
    },
    operationalEvent: {
      create: vi.fn(),
    },
  },
  mockSendPrivateReply: vi.fn(),
  mockSendPrivateReplyWithLinkButton: vi.fn(),
  mockSendPrivateReplyWithButton: vi.fn(),
  mockGetUserFollowStatus: vi.fn(),
  mockGetBusinessFollowsUser: vi.fn(),
  mockSendDirectMessageWithButton: vi.fn(),
  mockSendDirectMessage: vi.fn(),
  mockSendDirectMessageWithLinkButton: vi.fn(),
  mockDecryptToken: vi.fn(),
  mockMatchKeywords: vi.fn(),
  mockReserveDMSlot: vi.fn(),
  mockReleaseDMSlot: vi.fn(),
  mockQueueAdd: vi.fn(),
  mockReserveWorkspaceDMSend: vi.fn(),
  mockReleaseWorkspaceDMReservation: vi.fn(),
  mockAskClaude: vi.fn(),
  mockGetWorkspaceInstagramAccount: vi.fn(),
  afterTasks: [] as unknown[],
}));

// The Claude call is mocked at the AI provider boundary; the prompt builder is real.
vi.mock("@/lib/ai/provider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/provider")>()),
  askClaude: mockAskClaude,
}));

vi.mock("@/lib/db/client", () => ({
  prisma: mockPrisma,
}));

// For the inbox reply route, which the human takeover tests call.
vi.mock("@/lib/auth", () => ({ getCurrentWorkspaceId: async () => "workspace_123" }));
vi.mock("@/lib/instagram-accounts", () => ({
  getWorkspaceInstagramAccount: mockGetWorkspaceInstagramAccount,
}));
// The real after() needs a request scope; collect its tasks to run once the response is out.
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (task: unknown) => afterTasks.push(typeof task === "function" ? task() : task),
}));

vi.mock("@/lib/meta/client", () => ({
  sendPrivateReply: mockSendPrivateReply,
  sendPrivateReplyWithLinkButton: mockSendPrivateReplyWithLinkButton,
  sendPrivateReplyWithButton: mockSendPrivateReplyWithButton,
  getUserFollowStatus: mockGetUserFollowStatus,
  getBusinessFollowsUser: mockGetBusinessFollowsUser,
  sendDirectMessageWithButton: mockSendDirectMessageWithButton,
  sendDirectMessage: mockSendDirectMessage,
  sendDirectMessageWithLinkButton: mockSendDirectMessageWithLinkButton,
  sendCommentReply: vi.fn(),
  MetaApiError: class MetaApiError extends Error {
    code: number;
    constructor(
      code: number,
      _subcode: number | undefined,
      _fbTraceId: string | undefined,
      message: string
    ) {
      super(message);
      this.code = code;
      this.name = "MetaApiError";
    }
  },
  TokenExpiredError: class TokenExpiredError extends Error {
    name = "TokenExpiredError";
  },
  RateLimitError: class RateLimitError extends Error {
    name = "RateLimitError";
  },
}));

vi.mock("@/lib/meta/oauth", () => ({
  decryptToken: mockDecryptToken,
}));

vi.mock("@/lib/utils/keyword-matcher", () => ({
  matchKeywords: mockMatchKeywords,
}));

vi.mock("@/lib/utils/rate-limiter", () => ({
  reserveDMSlot: mockReserveDMSlot,
  releaseDMSlot: mockReleaseDMSlot,
}));

vi.mock("@/lib/billing/usage", () => ({
  reserveWorkspaceDMSend: mockReserveWorkspaceDMSend,
  releaseWorkspaceDMReservation: mockReleaseWorkspaceDMReservation,
}));

vi.mock("@/lib/ops/worker-health", () => ({
  recordWorkerAlert: vi.fn(),
}));

vi.mock("@/lib/queue/client", () => ({
  getDMQueue: () => ({
    add: mockQueueAdd,
  }),
  getRedisConnection: vi.fn(),
  POSTBACK_JOB_NAME: "process-postback",
  FOLLOWUP_JOB_NAME: "process-followup",
  MESSAGE_JOB_NAME: "process-message",
  AI_REPLY_JOB_NAME: "ai-reply",
  AI_ECHO_JOB_NAME: "ai-echo",
}));

vi.mock("bullmq", () => {
  function MockWorker(_name: string, processor: unknown) {
    (global as Record<string, unknown>).__dmWorkerProcessor = processor;
    return {
      on: vi.fn(),
      close: vi.fn(),
    };
  }
  return {
    Worker: MockWorker,
    UnrecoverableError: class UnrecoverableError extends Error {
      name = "UnrecoverableError";
    },
  };
});

import { MetaApiError, RateLimitError } from "@/lib/meta/client";
import { createDMWorker } from "../lib/queue/dm-worker";
import { deleteExpiredAiMessages } from "@/lib/ai/assistant";
import { POST as inboxReply } from "@/app/api/instagram/conversations/route";
import { getRedisConnection } from "@/lib/queue/client";
import { hashRecipientId } from "@/lib/tracking/server";

const usagePeriodStart = new Date("2026-05-01T00:00:00.000Z");

const mockAutomation = {
  id: "auto_789",
  workspaceId: "workspace_123",
  instagramAccountId: "ig_account_row_1",
  postId: "media_101",
  keywords: ["LINK", "PRICE"],
  dmMessage: "Hey {username}! Here is the link: https://example.com",
  isActive: true,
  wholeWordMatch: true,
  matchAnyPost: false,
  matchAnyWord: false,
  openingDmEnabled: false,
  openingDmMessage: null,
  openingDmButtonLabel: null,
  linkButtonLabel: null,
  publicReplyEnabled: false,
  publicReplyMessage: null,
  publicReplyMessages: [],
  instagramAccount: {
    id: "ig_account_row_1",
    instagramId: "ig_456",
    accessToken: "encrypted_token_abc",
  },
  workspace: {
    id: "workspace_123",
  },
  trackedLinks: [],
};

const mockJobData = {
  instagramAccountId: "ig_456",
  commentId: "comment_555",
  commentText: "I want the LINK!",
  commenterId: "commenter_999",
  commenterName: "commenter_user",
  mediaId: "media_101",
};

function getProcessor(): (job: {
  name?: string;
  data: typeof mockJobData | Record<string, unknown>;
  id: string;
  attemptsMade: number;
}) => Promise<void> {
  createDMWorker();
  return (global as Record<string, unknown>).__dmWorkerProcessor as (job: {
    name?: string;
    data: typeof mockJobData | Record<string, unknown>;
    id: string;
    attemptsMade: number;
  }) => Promise<void>;
}

function createMockJob(data: Record<string, unknown> = mockJobData) {
  return {
    name: "process-comment",
    data,
    id: "job_001",
    attemptsMade: 0,
  };
}

function createMockPostbackJob(
  data: Record<string, unknown> = {
    instagramAccountId: "ig_456",
    userId: "commenter_999",
    payload: "reveal:auto_789",
  }
) {
  return {
    name: "process-postback",
    data,
    id: "postback_job_001",
    attemptsMade: 0,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.postbackDelivery.create.mockReset().mockResolvedValue({});
  mockPrisma.postbackDelivery.delete.mockReset().mockResolvedValue({});

  mockPrisma.automation.findMany.mockResolvedValue([mockAutomation]);
  mockPrisma.automation.findFirst.mockResolvedValue(null);
  mockPrisma.dmLog.findUnique.mockResolvedValue(null);
  mockPrisma.dmLog.create.mockResolvedValue({});
  // Two different lookups share findFirst: the cross-campaign private-reply
  // check (keyed on status SENT) and the postback's name lookup. Only the
  // latter should resolve by default, or every comment would look like a
  // duplicate of an already-answered one.
  mockPrisma.dmLog.findFirst.mockImplementation(
    async (args: { where?: { status?: string } } = {}) =>
      args.where?.status === "SENT" ? null : { commenterName: "commenter_user" }
  );
  mockPrisma.dmLog.upsert.mockResolvedValue({});
  mockPrisma.dmLog.update.mockReset().mockResolvedValue({});
  mockPrisma.dmLog.updateMany.mockReset().mockResolvedValue({ count: 1 });
  mockPrisma.instagramAccount.findUnique.mockResolvedValue({
    workspaceId: "workspace_123",
  });
  mockPrisma.operationalEvent.create.mockResolvedValue({});
  mockDecryptToken.mockReturnValue("decrypted_token");
  mockMatchKeywords.mockReturnValue({ matched: true, matchedKeyword: "LINK" });
  mockReserveWorkspaceDMSend.mockResolvedValue({
    allowed: true,
    reserved: true,
    remaining: 100,
    limit: 2000,
    periodStart: usagePeriodStart,
  });
  mockReserveDMSlot.mockResolvedValue({
    allowed: true,
    currentCount: 11,
    remainingDMs: 179,
    shouldRequeue: false,
    requeueDelayMs: 0,
    shouldSkip: false,
    reserved: true,
  });
  mockReleaseDMSlot.mockResolvedValue(0);
  mockReleaseWorkspaceDMReservation.mockResolvedValue({ count: 1 });
  mockSendPrivateReply.mockResolvedValue({
    recipient_id: "commenter_999",
    message_id: "msg_001",
  });
  mockSendPrivateReplyWithLinkButton.mockResolvedValue({
    recipient_id: "commenter_999",
    message_id: "msg_002",
  });
  mockSendPrivateReplyWithButton.mockResolvedValue({
    recipient_id: "commenter_999",
    message_id: "msg_003",
  });
  mockSendDirectMessageWithButton.mockResolvedValue({
    recipient_id: "commenter_999",
    message_id: "msg_004",
  });
  mockSendDirectMessage.mockResolvedValue({
    recipient_id: "commenter_999",
    message_id: "msg_005",
  });
  mockSendDirectMessageWithLinkButton.mockResolvedValue({
    recipient_id: "commenter_999",
    message_id: "msg_006",
  });
  mockGetUserFollowStatus.mockResolvedValue(true);
  mockGetBusinessFollowsUser.mockResolvedValue(false);
});

describe("DM Worker — comments left on an ad", () => {
  it("also matches the organic post the ad was created from", async () => {
    const processor = getProcessor();

    // A boosted post: the comment carries the ad's media id, while the
    // campaign is bound to the post the ad was made from. Without the second
    // id in the query the comment matches nothing and is dropped silently.
    await processor(
      createMockJob({
        ...mockJobData,
        mediaId: "ad_media_999",
        originalMediaId: "media_101",
      })
    );

    expect(mockPrisma.automation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { postId: "ad_media_999" },
            { postId: "media_101" },
            { matchAnyPost: true },
          ],
        }),
      })
    );
    expect(mockSendPrivateReply).toHaveBeenCalled();
  });
});

describe("DM Worker — Full Pipeline", () => {
  it("should send a private reply for a matching comment", async () => {
    const processor = getProcessor();

    await processor(createMockJob());

    expect(mockPrisma.automation.findMany).toHaveBeenCalledWith({
      where: {
        OR: [{ postId: "media_101" }, { matchAnyPost: true }],
        isActive: true,
        instagramAccount: { instagramId: "ig_456" },
      },
      include: {
        instagramAccount: true,
        workspace: true,
        trackedLinks: {
          select: {
            slug: true,
            label: true,
            destinationUrl: true,
          },
          // Button order: position first, with createdAt and id only as
          // tie breakers, so tied rows can never come back swapped.
          orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        },
      },
      orderBy: { createdAt: "asc" },
    });
    expect(mockMatchKeywords).toHaveBeenCalledWith(
      "I want the LINK!",
      ["LINK", "PRICE"],
      true
    );
    expect(mockReserveWorkspaceDMSend).toHaveBeenCalledWith("workspace_123");
    expect(mockReserveDMSlot).toHaveBeenCalledWith("ig_456", 0);
    // A successful send keeps its slot; the release path is failure-only.
    expect(mockReleaseDMSlot).not.toHaveBeenCalled();
    expect(mockDecryptToken).toHaveBeenCalledWith("encrypted_token_abc");
    expect(mockSendPrivateReply).toHaveBeenCalledWith(
      "decrypted_token",
      "ig_456",
      "comment_555",
      "Hey commenter_user! Here is the link: https://example.com"
    );
    expect(mockReleaseWorkspaceDMReservation).not.toHaveBeenCalled();
    expect(mockPrisma.dmLog.update).toHaveBeenCalledWith({
      where: {
        automationId_commentId: {
          automationId: "auto_789",
          commentId: "comment_555",
        },
      },
      data: expect.objectContaining({ status: "SENT" }),
    });
  });

  it("should skip when no automations match the media", async () => {
    mockPrisma.automation.findMany.mockResolvedValue([]);
    const processor = getProcessor();

    await processor(createMockJob());

    expect(mockSendPrivateReply).not.toHaveBeenCalled();
    expect(mockPrisma.dmLog.upsert).not.toHaveBeenCalled();
  });

  it("should skip when keywords do not match", async () => {
    mockMatchKeywords.mockReturnValue({ matched: false, matchedKeyword: null });
    const processor = getProcessor();

    await processor(createMockJob());

    expect(mockSendPrivateReply).not.toHaveBeenCalled();
    expect(mockReserveWorkspaceDMSend).not.toHaveBeenCalled();
  });

  it("should skip duplicate comments already sent", async () => {
    mockPrisma.dmLog.findUnique.mockResolvedValue({
      id: "existing_log",
      status: "SENT",
    });
    const processor = getProcessor();

    await processor(createMockJob());

    expect(mockSendPrivateReply).not.toHaveBeenCalled();
    expect(mockReserveWorkspaceDMSend).not.toHaveBeenCalled();
  });

  it("should skip when monthly plan limit is reached", async () => {
    mockReserveWorkspaceDMSend.mockResolvedValue({
      allowed: false,
      reserved: false,
      remaining: 0,
      limit: 100,
      periodStart: usagePeriodStart,
    });

    const processor = getProcessor();
    await processor(createMockJob());

    expect(mockReserveDMSlot).not.toHaveBeenCalled();
    expect(mockSendPrivateReply).not.toHaveBeenCalled();
    expect(mockPrisma.dmLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "SKIPPED_PLAN_LIMIT" }),
      })
    );
  });

  it("should requeue and release monthly usage when rate limited", async () => {
    mockReserveDMSlot.mockResolvedValue({
      allowed: false,
      currentCount: 190,
      remainingDMs: 0,
      shouldRequeue: true,
      requeueDelayMs: 1800000,
      shouldSkip: false,
      reserved: false,
    });

    const processor = getProcessor();
    await processor(createMockJob());

    expect(mockReleaseWorkspaceDMReservation).toHaveBeenCalledWith(
      "workspace_123",
      usagePeriodStart
    );
    expect(mockSendPrivateReply).not.toHaveBeenCalled();
    expect(mockQueueAdd).toHaveBeenCalledWith(
      "process-comment",
      expect.objectContaining({
        commentId: "comment_555",
        requeueAttempt: 1,
      }),
      expect.objectContaining({
        delay: 1800000,
        jobId: "comment_ig_456_comment_555_retry_1",
      })
    );
  });

  it("should skip with SKIPPED_RATE_LIMIT after max requeue attempts", async () => {
    mockReserveDMSlot.mockResolvedValue({
      allowed: false,
      currentCount: 190,
      remainingDMs: 0,
      shouldRequeue: false,
      requeueDelayMs: 0,
      shouldSkip: true,
      reserved: false,
    });

    const processor = getProcessor();
    await processor(createMockJob());

    expect(mockReleaseWorkspaceDMReservation).toHaveBeenCalledWith(
      "workspace_123",
      usagePeriodStart
    );
    expect(mockPrisma.dmLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "SKIPPED_RATE_LIMIT" }),
      })
    );
    expect(mockSendPrivateReply).not.toHaveBeenCalled();
  });

  it("should log FAILED, release usage, and re-throw when private reply sending fails", async () => {
    const error = new RateLimitError("API Error");
    mockSendPrivateReply.mockRejectedValue(error);

    const processor = getProcessor();

    await expect(processor(createMockJob())).rejects.toThrow("API Error");
    expect(mockReleaseWorkspaceDMReservation).toHaveBeenCalledWith(
      "workspace_123",
      usagePeriodStart
    );
    expect(mockPrisma.dmLog.update).toHaveBeenCalledWith({
      where: {
        automationId_commentId: {
          automationId: "auto_789",
          commentId: "comment_555",
        },
      },
      data: expect.objectContaining({
        status: "FAILED",
        errorMessage: "API Error",
      }),
    });
  });

  it("should handle missing access token", async () => {
    mockPrisma.automation.findMany.mockResolvedValue([
      {
        ...mockAutomation,
        instagramAccount: {
          ...mockAutomation.instagramAccount,
          accessToken: null,
        },
      },
    ]);

    const processor = getProcessor();
    await processor(createMockJob());

    expect(mockPrisma.dmLog.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          status: "FAILED",
          errorMessage: "No Instagram access token available",
        }),
      })
    );
    expect(mockReserveWorkspaceDMSend).not.toHaveBeenCalled();
    expect(mockSendPrivateReply).not.toHaveBeenCalled();
  });

  it("should use 'there' when commenter name is not available", async () => {
    const processor = getProcessor();
    const jobDataWithoutName = {
      instagramAccountId: mockJobData.instagramAccountId,
      commentId: mockJobData.commentId,
      commentText: mockJobData.commentText,
      commenterId: mockJobData.commenterId,
      mediaId: mockJobData.mediaId,
    };

    await processor(createMockJob(jobDataWithoutName as typeof mockJobData));

    expect(mockSendPrivateReply).toHaveBeenCalledWith(
      "decrypted_token",
      "ig_456",
      "comment_555",
      "Hey there! Here is the link: https://example.com"
    );
  });

  it("should deliver tracked links as web_url buttons (one or two)", async () => {
    mockPrisma.automation.findMany.mockResolvedValue([
      {
        ...mockAutomation,
        dmMessage: "Hey {username}! Here is the offer: {link}",
        linkButtonLabel: "Get offer",
        trackedLinks: [
          {
            slug: "abc123",
            label: "Primary campaign link",
            destinationUrl: "https://example.com",
          },
          {
            slug: "def456",
            label: "Book a call",
            destinationUrl: "https://example.com/book",
          },
        ],
      },
    ]);

    const processor = getProcessor();
    await processor(createMockJob());

    // Primary button title comes from linkButtonLabel; the second from its
    // own stored label. Both point at their tracked /r/<slug> URLs, tagged
    // with the commenter's recipient token.
    const token = hashRecipientId(mockJobData.commenterId);
    expect(mockSendPrivateReplyWithLinkButton).toHaveBeenCalledWith(
      "decrypted_token",
      "ig_456",
      "comment_555",
      "Hey commenter_user! Here is the offer:",
      [
        { title: "Get offer", url: `http://localhost:3000/r/abc123?r=${token}` },
        { title: "Book a call", url: `http://localhost:3000/r/def456?r=${token}` },
      ]
    );
  });

  it("should send a follow-gate prompt when a non-follower comments", async () => {
    mockGetUserFollowStatus.mockResolvedValue(false); // not following yet
    mockPrisma.automation.findMany.mockResolvedValue([
      {
        ...mockAutomation,
        requireFollow: true,
        followPromptMessage: "Follow me first {username}, then tap 👇",
        followPromptButtonLabel: "I'm following ✅",
        trackedLinks: [
          {
            slug: "abc123",
            label: "Primary campaign link",
            destinationUrl: "https://example.com",
          },
        ],
      },
    ]);

    const processor = getProcessor();
    await processor(createMockJob());

    // The follow prompt goes out with a `followcheck:` postback button; the
    // link is NOT delivered yet.
    expect(mockSendPrivateReplyWithButton).toHaveBeenCalledWith(
      "decrypted_token",
      "ig_456",
      "comment_555",
      "Follow me first commenter_user, then tap 👇",
      "I'm following ✅",
      "followcheck:auto_789"
    );
    expect(mockSendPrivateReplyWithLinkButton).not.toHaveBeenCalled();
    expect(mockSendPrivateReply).not.toHaveBeenCalled();
  });

  it("should skip the prompt and send the link when the commenter already follows", async () => {
    mockGetUserFollowStatus.mockResolvedValue(true); // already following
    mockPrisma.automation.findMany.mockResolvedValue([
      {
        ...mockAutomation,
        requireFollow: true,
        followPromptMessage: "Follow me first, then tap 👇",
        followPromptButtonLabel: "I'm following ✅",
        dmMessage: "Hey {username}! Here is the offer: {link}",
        linkButtonLabel: "Get offer",
        trackedLinks: [
          {
            slug: "abc123",
            label: "Primary campaign link",
            destinationUrl: "https://example.com",
          },
        ],
      },
    ]);

    const processor = getProcessor();
    await processor(createMockJob());

    // Confirmed follower: no prompt, link delivered right away.
    expect(mockSendPrivateReplyWithButton).not.toHaveBeenCalled();
    expect(mockSendPrivateReplyWithLinkButton).toHaveBeenCalledWith(
      "decrypted_token",
      "ig_456",
      "comment_555",
      "Hey commenter_user! Here is the offer:",
      [
        {
          title: "Get offer",
          url: `http://localhost:3000/r/abc123?r=${hashRecipientId(mockJobData.commenterId)}`,
        },
      ]
    );
  });

  it("should send the opening DM first (routing to the follow check) when both opening DM and follow-gate are on", async () => {
    mockPrisma.automation.findMany.mockResolvedValue([
      {
        ...mockAutomation,
        openingDmEnabled: true,
        openingDmMessage: "Hey {username}, welcome!",
        openingDmButtonLabel: "Get the link",
        requireFollow: true,
        followPromptButtonLabel: "I'm following ✅",
        trackedLinks: [
          {
            slug: "abc123",
            label: "Primary campaign link",
            destinationUrl: "https://example.com",
          },
        ],
      },
    ]);

    const processor = getProcessor();
    await processor(createMockJob());

    // Opening DM goes out first; its button routes into the follow check.
    expect(mockSendPrivateReplyWithButton).toHaveBeenCalledWith(
      "decrypted_token",
      "ig_456",
      "comment_555",
      "Hey commenter_user, welcome!",
      "Get the link",
      "followcheck:auto_789:open"
    );
    // Follow status is verified on the tap, not at comment time.
    expect(mockGetUserFollowStatus).not.toHaveBeenCalled();
    expect(mockSendPrivateReplyWithLinkButton).not.toHaveBeenCalled();
  });

  it("should deliver the next DM from a read fallback when no button tap has sent it yet", async () => {
    mockPrisma.automation.findMany.mockResolvedValue([]);
    mockPrisma.automation.findFirst.mockResolvedValue({
      ...mockAutomation,
      trackedLinks: [],
    });

    const processor = getProcessor();
    await processor(
      createMockPostbackJob({
        instagramAccountId: "ig_456",
        userId: "commenter_999",
        payload: "reveal:auto_789",
        fallback: true,
      })
    );

    expect(mockPrisma.dmLog.findUnique).toHaveBeenCalledWith({
      where: {
        automationId_commentId: {
          automationId: "auto_789",
          commentId: "reveal:commenter_999",
        },
      },
    });
    expect(mockSendDirectMessage).toHaveBeenCalledWith(
      "decrypted_token",
      "ig_456",
      "commenter_999",
      "Hey commenter_user! Here is the link: https://example.com"
    );
  });

  it("should not deliver a read fallback when the button tap already sent the reveal", async () => {
    mockPrisma.automation.findMany.mockResolvedValue([]);
    mockPrisma.automation.findFirst.mockResolvedValue({
      ...mockAutomation,
      trackedLinks: [],
    });
    mockPrisma.dmLog.findUnique.mockResolvedValue({
      id: "existing_reveal",
      status: "SENT",
    });

    const processor = getProcessor();
    await processor(
      createMockPostbackJob({
        instagramAccountId: "ig_456",
        userId: "commenter_999",
        payload: "reveal:auto_789",
        fallback: true,
      })
    );

    expect(mockSendDirectMessage).not.toHaveBeenCalled();
    expect(mockReserveWorkspaceDMSend).not.toHaveBeenCalled();
  });

  it("should not let a read fallback bypass the follow gate", async () => {
    mockPrisma.automation.findMany.mockResolvedValue([]);
    mockPrisma.automation.findFirst.mockResolvedValue({
      ...mockAutomation,
      requireFollow: true,
      trackedLinks: [],
    });
    mockGetUserFollowStatus.mockResolvedValue(false); // still not following

    const processor = getProcessor();
    await processor(
      createMockPostbackJob({
        instagramAccountId: "ig_456",
        userId: "commenter_999",
        payload: "reveal:auto_789",
        fallback: true,
      })
    );

    // Non-follower on a read fallback: no link, and no re-prompt spam either.
    expect(mockSendDirectMessage).not.toHaveBeenCalled();
    expect(mockSendDirectMessageWithButton).not.toHaveBeenCalled();
    expect(mockReserveWorkspaceDMSend).not.toHaveBeenCalled();
  });

  it("should not let a read fallback through when follow status is unverifiable", async () => {
    mockPrisma.automation.findMany.mockResolvedValue([]);
    mockPrisma.automation.findFirst.mockResolvedValue({
      ...mockAutomation,
      requireFollow: true,
      trackedLinks: [],
    });
    // Instagram answers "User consent is required" until the person taps a
    // button, which is exactly the case of someone who only read the DM.
    mockGetUserFollowStatus.mockResolvedValue(null);

    const processor = getProcessor();
    await processor(
      createMockPostbackJob({
        instagramAccountId: "ig_456",
        userId: "commenter_999",
        payload: "reveal:auto_789",
        fallback: true,
      })
    );

    expect(mockSendDirectMessage).not.toHaveBeenCalled();
    expect(mockSendDirectMessageWithButton).not.toHaveBeenCalled();
  });

  it("should deliver a follow-gated read fallback once the user follows", async () => {
    mockPrisma.automation.findMany.mockResolvedValue([]);
    mockPrisma.automation.findFirst.mockResolvedValue({
      ...mockAutomation,
      requireFollow: true,
      trackedLinks: [],
    });
    mockGetUserFollowStatus.mockResolvedValue(true);

    const processor = getProcessor();
    await processor(
      createMockPostbackJob({
        instagramAccountId: "ig_456",
        userId: "commenter_999",
        payload: "reveal:auto_789",
        fallback: true,
      })
    );

    expect(mockSendDirectMessage).toHaveBeenCalledWith(
      "decrypted_token",
      "ig_456",
      "commenter_999",
      "Hey commenter_user! Here is the link: https://example.com"
    );
  });

  it("should not log a failure when a read fallback hits a closed messaging window", async () => {
    mockPrisma.automation.findMany.mockResolvedValue([]);
    mockPrisma.automation.findFirst.mockResolvedValue({
      ...mockAutomation,
      trackedLinks: [],
    });
    mockSendDirectMessage.mockRejectedValue(
      new MetaApiError(10, undefined, undefined, "This message is sent outside of allowed window.")
    );

    const processor = getProcessor();
    // The window cannot reopen on its own, so this must not throw (no retries)
    // and must not leave a FAILED row the user can do nothing about.
    await expect(
      processor(
        createMockPostbackJob({
          instagramAccountId: "ig_456",
          userId: "commenter_999",
          payload: "reveal:auto_789",
          fallback: true,
        })
      )
    ).resolves.toBeUndefined();

    expect(mockPrisma.dmLog.upsert).not.toHaveBeenCalled();
    expect(mockReleaseWorkspaceDMReservation).toHaveBeenCalled();
  });

  it("should still log a failure for a real button tap that fails", async () => {
    mockPrisma.automation.findMany.mockResolvedValue([]);
    mockPrisma.automation.findFirst.mockResolvedValue({
      ...mockAutomation,
      trackedLinks: [],
    });
    mockSendDirectMessage.mockRejectedValue(new Error("boom"));

    const processor = getProcessor();
    await expect(
      processor(
        createMockPostbackJob({
          instagramAccountId: "ig_456",
          userId: "commenter_999",
          payload: "reveal:auto_789",
        })
      )
    ).rejects.toThrow("boom");

    expect(mockPrisma.dmLog.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ status: "FAILED" }),
      })
    );
  });
});

describe("DM Worker — one private reply per comment", () => {
  it("should skip a campaign when another already used the comment's private reply", async () => {
    mockPrisma.dmLog.findFirst.mockImplementation(
      async (args: { where?: { status?: string } } = {}) =>
        args.where?.status === "SENT"
          ? { automation: { name: "openreply 1" } }
          : { commenterName: "commenter_user" }
    );

    const processor = getProcessor();
    await processor(createMockJob());

    expect(mockSendPrivateReply).not.toHaveBeenCalled();
    expect(mockReserveWorkspaceDMSend).not.toHaveBeenCalled();
    expect(mockPrisma.dmLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "SKIPPED_DEDUP",
          errorMessage: expect.stringContaining("openreply 1"),
        }),
      })
    );
  });

  it("should not fall back to a plain-text private reply when the window is the problem", async () => {
    mockPrisma.automation.findMany.mockResolvedValue([
      {
        ...mockAutomation,
        trackedLinks: [
          {
            slug: "abc123",
            label: null,
            destinationUrl: "https://example.com",
          },
        ],
      },
    ]);
    mockSendPrivateReplyWithLinkButton.mockRejectedValue(
      new MetaApiError(100, undefined, undefined, "The comment is invalid for a private reply")
    );

    const processor = getProcessor();
    await expect(processor(createMockJob())).rejects.toThrow(
      "The comment is invalid for a private reply"
    );

    // The reserved rate slot must be handed back when the send fails, so a
    // comment that never delivered a DM does not burn slots on each retry.
    expect(mockReleaseDMSlot).toHaveBeenCalledWith("ig_456");

    // A text retry on the same comment would fail identically and overwrite the
    // real reason, so it must not be attempted.
    expect(mockSendPrivateReply).not.toHaveBeenCalled();
    expect(mockPrisma.dmLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "FAILED",
          errorMessage: expect.stringContaining("The comment is invalid for a private reply"),
        }),
      })
    );
  });

  it("should still fall back to plain text when the button template itself is rejected", async () => {
    mockPrisma.automation.findMany.mockResolvedValue([
      {
        ...mockAutomation,
        trackedLinks: [
          {
            slug: "abc123",
            label: null,
            destinationUrl: "https://example.com",
          },
        ],
      },
    ]);
    mockSendPrivateReplyWithLinkButton.mockRejectedValue(
      new MetaApiError(100, undefined, undefined, "Unsupported message template")
    );

    const processor = getProcessor();
    await processor(createMockJob());

    expect(mockSendPrivateReply).toHaveBeenCalled();
    expect(mockPrisma.dmLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "SENT" }),
      })
    );
  });
});

describe("DM Worker — DM keyword trigger", () => {
  const dmTriggerAutomation = {
    ...mockAutomation,
    dmTriggerEnabled: true,
    requireFollow: false,
    followPromptMessage: null,
    followPromptButtonLabel: null,
  };

  function createMockMessageJob(data: Record<string, unknown> = {}) {
    return {
      name: "process-message",
      data: {
        instagramAccountId: "ig_456",
        messageId: "mid_abc",
        messageText: "can I get the LINK?",
        senderId: "commenter_999",
        ...data,
      },
      id: "message_job_001",
      attemptsMade: 0,
    };
  }

  beforeEach(() => {
    mockPrisma.automation.findMany.mockResolvedValue([dmTriggerAutomation]);
  });

  it("should reply to a DM whose text matches the campaign keywords", async () => {
    const processor = getProcessor();
    await processor(createMockMessageJob());

    expect(mockPrisma.automation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          dmTriggerEnabled: true,
          isActive: true,
        }),
      })
    );
    expect(mockSendDirectMessage).toHaveBeenCalledWith(
      "decrypted_token",
      "ig_456",
      "commenter_999",
      "Hey commenter_user! Here is the link: https://example.com"
    );
    // Never a private reply — there is no comment to reply to.
    expect(mockSendPrivateReply).not.toHaveBeenCalled();
  });

  it("should not reply when the DM text matches no keyword", async () => {
    mockMatchKeywords.mockReturnValue({ matched: false, matchedKeyword: null });

    const processor = getProcessor();
    await processor(createMockMessageJob({ messageText: "hello there" }));

    expect(mockSendDirectMessage).not.toHaveBeenCalled();
    expect(mockSendDirectMessageWithLinkButton).not.toHaveBeenCalled();
  });

  it("should log the reply against the inbound message id for dedup", async () => {
    const processor = getProcessor();
    await processor(createMockMessageJob());

    expect(mockPrisma.dmLog.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          automationId_commentId: {
            automationId: "auto_789",
            commentId: "dm:mid_abc",
          },
        },
        create: expect.objectContaining({
          commenterId: "commenter_999",
          commentText: "can I get the LINK?",
          matchedKeyword: "LINK",
          status: "SENT",
        }),
      })
    );
  });

  it("should not re-send when this message was already answered", async () => {
    mockPrisma.dmLog.findUnique.mockResolvedValue({ status: "SENT" });

    const processor = getProcessor();
    await processor(createMockMessageJob());

    expect(mockSendDirectMessage).not.toHaveBeenCalled();
    expect(mockReserveWorkspaceDMSend).not.toHaveBeenCalled();
  });

  it("should send the link as buttons when the campaign has tracked links", async () => {
    mockPrisma.automation.findMany.mockResolvedValue([
      {
        ...dmTriggerAutomation,
        linkButtonLabel: "Get it",
        trackedLinks: [
          {
            slug: "abc123",
            label: "Get it",
            destinationUrl: "https://example.com/offer",
          },
        ],
      },
    ]);

    const processor = getProcessor();
    await processor(createMockMessageJob());

    expect(mockSendDirectMessageWithLinkButton).toHaveBeenCalled();
    expect(mockSendDirectMessage).not.toHaveBeenCalled();
  });

  it("should send the follow prompt instead of the link to a non-follower", async () => {
    mockPrisma.automation.findMany.mockResolvedValue([
      { ...dmTriggerAutomation, requireFollow: true },
    ]);
    mockGetUserFollowStatus.mockResolvedValue(false);

    const processor = getProcessor();
    await processor(createMockMessageJob());

    expect(mockSendDirectMessageWithButton).toHaveBeenCalledWith(
      "decrypted_token",
      "ig_456",
      "commenter_999",
      expect.any(String),
      "I'm following ✅",
      "followcheck:auto_789"
    );
    expect(mockSendDirectMessage).not.toHaveBeenCalled();
  });

  // First contact, so the gate is fail-closed like processComment: an
  // unverifiable status must not hand out the link.
  it("should send the follow prompt when follow status cannot be verified", async () => {
    mockPrisma.automation.findMany.mockResolvedValue([
      { ...dmTriggerAutomation, requireFollow: true },
    ]);
    mockGetUserFollowStatus.mockResolvedValue(null);

    const processor = getProcessor();
    await processor(createMockMessageJob());

    expect(mockSendDirectMessageWithButton).toHaveBeenCalled();
    expect(mockSendDirectMessage).not.toHaveBeenCalled();
  });

  it("should skip and log when the workspace is over its monthly limit", async () => {
    mockReserveWorkspaceDMSend.mockResolvedValue({
      allowed: false,
      reserved: false,
      remaining: 0,
      limit: 2000,
      periodStart: usagePeriodStart,
    });

    const processor = getProcessor();
    await processor(createMockMessageJob());

    expect(mockSendDirectMessage).not.toHaveBeenCalled();
    expect(mockPrisma.dmLog.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ status: "SKIPPED_PLAN_LIMIT" }),
      })
    );
  });

  it("should release the usage reservation and rethrow when the send fails", async () => {
    mockSendDirectMessage.mockRejectedValue(new Error("Meta is down"));

    const processor = getProcessor();
    await expect(processor(createMockMessageJob())).rejects.toThrow(
      "Meta is down"
    );

    expect(mockReleaseWorkspaceDMReservation).toHaveBeenCalledWith(
      "workspace_123",
      usagePeriodStart
    );
    expect(mockPrisma.dmLog.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ status: "FAILED" }),
      })
    );
  });
});

describe("Zernio worker routing", () => {
  it("fails open on unknown follow status and sends once through the selected provider", async () => {
    mockPrisma.zernioConnection.findUnique.mockResolvedValue({
      apiKey: "encrypted_key",
    });
    mockPrisma.automation.findMany.mockResolvedValue([
      {
        ...mockAutomation,
        requireFollow: true,
        instagramAccount: {
          ...mockAutomation.instagramAccount,
          provider: "ZERNIO",
          workspaceId: "workspace_123",
          zernioAccountId: "zernio_selected",
          accessToken: "",
        },
      },
    ]);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            isFollower: null,
            unavailableReason: "consent_required",
          })
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ messageId: "sent" }))
      );
    vi.stubGlobal("fetch", fetchMock);
    try {
      await getProcessor()(createMockJob());
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[1][0]).toContain(
        "/inbox/comments/media_101/comment_555/private-reply"
      );
      expect(JSON.parse(fetchMock.mock.calls[1][1].body).accountId).toBe(
        "zernio_selected"
      );
      expect(mockSendPrivateReply).not.toHaveBeenCalled();
      expect(mockSendPrivateReplyWithButton).not.toHaveBeenCalled();
      expect(mockPrisma.dmLog.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "SENT" }),
        })
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

it("stops BullMQ retries after an ambiguous Zernio direct-message outcome", async () => {
  mockPrisma.zernioConnection.findUnique.mockResolvedValue({
    apiKey: "encrypted",
  });
  mockPrisma.automation.findFirst.mockResolvedValue({
    ...mockAutomation,
    instagramAccount: {
      ...mockAutomation.instagramAccount,
      provider: "ZERNIO",
      workspaceId: "workspace_123",
      zernioAccountId: "remote",
      accessToken: "",
    },
  });
  const fetchMock = vi.fn().mockRejectedValue(new Error("connection reset"));
  vi.stubGlobal("fetch", fetchMock);
  try {
    await expect(getProcessor()(createMockPostbackJob())).rejects.toMatchObject(
      {
        name: "UnrecoverableError",
        message: expect.stringContaining("Inspect the Instagram inbox"),
      }
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  } finally {
    vi.unstubAllGlobals();
  }
});

it('binds queued comments to the local connection that received them', async () => {
  mockPrisma.automation.findMany.mockResolvedValue([]);
  const job = createMockJob();
  Object.assign(job.data, { accountConnectionId: 'original-connection' });
  await getProcessor()(job);
  expect(mockPrisma.automation.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ instagramAccountId: 'original-connection' }) }));
});

it('never automatically resends a private reply with an unconfirmed delivery', async () => {
  mockPrisma.dmLog.findUnique.mockResolvedValue({ status: 'FAILED', dmDeliveryUnconfirmed: true, publicReplySentAt: null });
  await getProcessor()(createMockJob());
  expect(mockSendPrivateReply).not.toHaveBeenCalled();
  expect(mockSendPrivateReplyWithButton).not.toHaveBeenCalled();
  expect(mockPrisma.dmLog.update).not.toHaveBeenCalled();
});

it('keeps an unconfirmed public reply untouched after the DM was delivered', async () => {
  mockPrisma.automation.findMany.mockResolvedValue([{ ...mockAutomation, publicReplyEnabled: true, publicReplyMessage: 'Thanks!', publicReplyMessages: [] }]);
  mockPrisma.dmLog.findUnique.mockResolvedValue({ status: 'SENT', publicReplyDeliveryUnconfirmed: true, publicReplySentAt: null });
  await getProcessor()(createMockJob());
  expect(mockPrisma.dmLog.update).not.toHaveBeenCalled();
});

describe("durable Zernio postback delivery", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    const claims = new Set<string>();
    mockPrisma.postbackDelivery.create.mockImplementation(
      async ({ data }: { data: { id: string } }) => {
        if (claims.has(data.id)) throw { code: "P2002" };
        claims.add(data.id);
        return data;
      },
    );
    mockPrisma.postbackDelivery.delete.mockImplementation(
      async ({ where }: { where: { id: string } }) => {
        claims.delete(where.id);
      },
    );
    mockPrisma.zernioConnection.findUnique.mockResolvedValue({
      apiKey: "encrypted",
    });
    mockPrisma.automation.findFirst.mockResolvedValue({
      ...mockAutomation,
      instagramAccount: {
        ...mockAutomation.instagramAccount,
        provider: "ZERNIO",
        workspaceId: "workspace_123",
        zernioAccountId: "remote",
        accessToken: "",
      },
    });
    fetchMock = vi.fn();
  });

  function tap(mid: string) {
    return createMockPostbackJob({
      instagramAccountId: "ig_456",
      userId: "commenter_999",
      payload: "reveal:auto_789",
      mid,
    });
  }

  it("retains an uncertain tap across a newer successful tap and queue eviction", async () => {
    fetchMock
      .mockImplementation(
        async () =>
          new Response(JSON.stringify({ data: { messageId: "new-tap" } })),
      )
      .mockRejectedValueOnce(new Error("connection reset"));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const process = getProcessor();
      await expect(process(tap("old"))).rejects.toMatchObject({
        name: "UnrecoverableError",
      });
      await process(tap("new"));
      await process({ ...tap("old"), id: "redelivery-job" });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(mockPrisma.postbackDelivery.delete).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("deduplicates successful old taps while permitting each distinct new mid", async () => {
    fetchMock.mockImplementation(
      async () => new Response(JSON.stringify({ data: { messageId: "sent" } })),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const process = getProcessor();
      await process(tap("first"));
      await process(tap("second"));
      await process({ ...tap("first"), id: "after-retention" });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(mockReleaseWorkspaceDMReservation).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("releases a claim on a confirmed rejection so the same tap can retry", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("{}", { status: 429 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { messageId: "sent" } })),
      );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const process = getProcessor();
      await expect(process(tap("retry"))).rejects.toThrow();
      await process(tap("retry"));
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(mockPrisma.postbackDelivery.delete).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("claims concurrent deliveries of the same tap before either can send twice", async () => {
    fetchMock.mockImplementation(
      async () => new Response(JSON.stringify({ data: { messageId: "sent" } })),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const process = getProcessor();
      await Promise.all([
        process(tap("concurrent")),
        process({ ...tap("concurrent"), id: "other-job" }),
      ]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("deduplicates follow-gate prompts as well as reveal messages", async () => {
    mockPrisma.automation.findFirst.mockResolvedValue({
      ...mockAutomation,
      requireFollow: true,
      instagramAccount: {
        ...mockAutomation.instagramAccount,
        provider: "ZERNIO",
        workspaceId: "workspace_123",
        zernioAccountId: "remote",
        accessToken: "",
      },
    });
    fetchMock.mockImplementation(
      async (_url: string, init: { method: string }) =>
        new Response(
          JSON.stringify(
            init.method === "GET"
              ? { isFollower: false }
              : { data: { messageId: "prompt" } },
          ),
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const process = getProcessor();
      const followTap = tap("follow");
      // The prompt goes out on the last delayed re-check — an earlier false
      // only queues the next one — so exercise that pass: that is where the
      // prompt is sent, and where a redelivery must not send it a second time.
      followTap.data = {
        ...followTap.data,
        payload: "followcheck:auto_789",
        followRecheck: true,
        followRecheckAttempt: 2,
      };
      await process(followTap);
      await process({ ...followTap, id: "redelivery" });
      expect(
        fetchMock.mock.calls.filter(([, init]) => init.method === "POST"),
      ).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("DM Worker — follow-gate re-check", () => {
  const gated = { ...mockAutomation, requireFollow: true, trackedLinks: [] };

  it("re-checks a first false follow later instead of rejecting the tap", async () => {
    mockPrisma.automation.findFirst.mockResolvedValue(gated);
    mockGetUserFollowStatus.mockResolvedValue(false);

    await getProcessor()(
      createMockPostbackJob({
        instagramAccountId: "ig_456",
        userId: "commenter_999",
        payload: "followcheck:auto_789",
      })
    );

    // Nothing is sent yet: a brand-new follow may simply not have registered.
    expect(mockSendDirectMessageWithButton).not.toHaveBeenCalled();
    expect(mockSendDirectMessage).not.toHaveBeenCalled();
    expect(mockQueueAdd).toHaveBeenCalledWith(
      "process-postback",
      expect.objectContaining({ followRecheck: true, userId: "commenter_999" }),
      expect.objectContaining({ delay: expect.any(Number) })
    );
  });

  it("prompts and records the rejection when the last re-check still finds no follow", async () => {
    mockPrisma.automation.findFirst.mockResolvedValue(gated);
    mockGetUserFollowStatus.mockResolvedValue(false);

    await getProcessor()(
      createMockPostbackJob({
        instagramAccountId: "ig_456",
        userId: "commenter_999",
        payload: "followcheck:auto_789",
        followRecheck: true,
        followRecheckAttempt: 2,
      })
    );

    expect(mockSendDirectMessageWithButton).toHaveBeenCalledTimes(1);
    expect(mockPrisma.operationalEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          message: "Follow gate rejected a button tap",
        }),
      })
    );
    // A re-check never queues another re-check.
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it("buckets the re-check id by time so a later tap is not blocked by an old job", async () => {
    mockPrisma.automation.findFirst.mockResolvedValue(gated);
    mockGetUserFollowStatus.mockResolvedValue(false);

    await getProcessor()(
      createMockPostbackJob({
        instagramAccountId: "ig_456",
        userId: "commenter_999",
        payload: "followcheck:auto_789",
      })
    );

    const [, , opts] = mockQueueAdd.mock.calls[0];
    // A fixed per-user id would collide with the retained completed job of an
    // earlier re-check and be dropped silently by BullMQ.
    expect(opts.jobId).toMatch(/^postback_recheck_auto_789_commenter_999_1_\d+$/);
  });

  it("checks twice: soon after the tap, then again before giving up", async () => {
    mockPrisma.automation.findFirst.mockResolvedValue(gated);
    mockGetUserFollowStatus.mockResolvedValue(false);
    const tap = {
      instagramAccountId: "ig_456",
      userId: "commenter_999",
      payload: "followcheck:auto_789",
    };

    await getProcessor()(createMockPostbackJob(tap));
    expect(mockQueueAdd).toHaveBeenLastCalledWith(
      "process-postback",
      expect.objectContaining({ followRecheckAttempt: 1 }),
      expect.objectContaining({ delay: 20_000 })
    );

    await getProcessor()(
      createMockPostbackJob({ ...tap, followRecheck: true, followRecheckAttempt: 1 })
    );
    expect(mockQueueAdd).toHaveBeenLastCalledWith(
      "process-postback",
      expect.objectContaining({ followRecheckAttempt: 2 }),
      expect.objectContaining({ delay: 40_000 })
    );
    // Neither pass has given up yet, so neither re-sends the prompt.
    expect(mockSendDirectMessageWithButton).not.toHaveBeenCalled();
  });

  it("treats a re-check queued before counting existed as the first one done", async () => {
    mockPrisma.automation.findFirst.mockResolvedValue(gated);
    mockGetUserFollowStatus.mockResolvedValue(false);

    await getProcessor()(
      createMockPostbackJob({
        instagramAccountId: "ig_456",
        userId: "commenter_999",
        payload: "followcheck:auto_789",
        followRecheck: true,
      })
    );

    expect(mockQueueAdd).toHaveBeenCalledWith(
      "process-postback",
      expect.objectContaining({ followRecheckAttempt: 2 }),
      expect.anything()
    );
    expect(mockSendDirectMessageWithButton).not.toHaveBeenCalled();
  });

  it("prompts a non-follower right away when the tap came from the opening DM", async () => {
    mockPrisma.automation.findFirst.mockResolvedValue(gated);
    mockGetUserFollowStatus.mockResolvedValue(false);

    await getProcessor()(
      createMockPostbackJob({
        instagramAccountId: "ig_456",
        userId: "commenter_999",
        payload: "followcheck:auto_789:open",
      })
    );

    // Tapping the opening DM is not a claim to follow, so there is nothing to
    // wait for: the follow prompt goes out now, not after the re-check delay.
    expect(mockSendDirectMessageWithButton).toHaveBeenCalledWith(
      "decrypted_token",
      "ig_456",
      "commenter_999",
      expect.any(String),
      expect.any(String),
      "followcheck:auto_789"
    );
    expect(mockQueueAdd).not.toHaveBeenCalled();
    // Nor is it a rejection: they were never told to follow before this.
    expect(mockPrisma.operationalEvent.create).not.toHaveBeenCalled();
  });
});

describe("DM Worker — follow re-check acknowledgement", () => {
  const gated = { ...mockAutomation, requireFollow: true, trackedLinks: [] };
  const tap = {
    instagramAccountId: "ig_456",
    userId: "commenter_999",
    payload: "followcheck:auto_789",
  };
  const mockRedisSet = vi.fn();

  beforeEach(() => {
    process.env.FOLLOW_RECHECK_ACK_MESSAGE = "Dame unos segundos que lo verifico";
    mockRedisSet.mockReset().mockResolvedValue("OK");
    vi.mocked(getRedisConnection).mockReturnValue({ set: mockRedisSet } as never);
    mockPrisma.automation.findFirst.mockResolvedValue(gated);
    mockGetUserFollowStatus.mockResolvedValue(false);
  });

  afterEach(() => {
    delete process.env.FOLLOW_RECHECK_ACK_MESSAGE;
  });

  it("answers a not-yet-visible follow right away instead of leaving the chat silent", async () => {
    await getProcessor()(createMockPostbackJob(tap));

    expect(mockSendDirectMessage).toHaveBeenCalledWith(
      "decrypted_token",
      "ig_456",
      "commenter_999",
      "Dame unos segundos que lo verifico"
    );
    // The re-check is still what decides; the acknowledgement only fills the wait.
    expect(mockQueueAdd).toHaveBeenCalledWith(
      "process-postback",
      expect.objectContaining({ followRecheckAttempt: 1 }),
      expect.anything()
    );
  });

  it("acknowledges a burst of taps only once", async () => {
    mockRedisSet.mockResolvedValueOnce("OK").mockResolvedValueOnce(null);

    await getProcessor()(createMockPostbackJob(tap));
    await getProcessor()(createMockPostbackJob(tap));

    expect(mockSendDirectMessage).toHaveBeenCalledTimes(1);
  });

  it("does not acknowledge again on the re-check passes", async () => {
    await getProcessor()(
      createMockPostbackJob({ ...tap, followRecheck: true, followRecheckAttempt: 1 })
    );

    expect(mockSendDirectMessage).not.toHaveBeenCalled();
  });

  it("still re-checks when the acknowledgement cannot be sent", async () => {
    mockSendDirectMessage.mockRejectedValueOnce(new Error("boom"));

    await expect(getProcessor()(createMockPostbackJob(tap))).resolves.toBeUndefined();
    expect(mockQueueAdd).toHaveBeenCalledWith(
      "process-postback",
      expect.objectContaining({ followRecheckAttempt: 1 }),
      expect.anything()
    );
  });

  it("sends nothing extra when no acknowledgement message is configured", async () => {
    delete process.env.FOLLOW_RECHECK_ACK_MESSAGE;

    await getProcessor()(createMockPostbackJob(tap));

    expect(mockSendDirectMessage).not.toHaveBeenCalled();
    expect(mockRedisSet).not.toHaveBeenCalled();
  });
});

describe("ambiguous Meta sends and durable comment claims", () => {
  const withLinks = { ...mockAutomation, trackedLinks: [{ slug: "resource", label: null, destinationUrl: "https://example.com" }] };

  it("never falls back or retries Meta code 1, even though Meta may have sent the message", async () => {
    mockPrisma.automation.findMany.mockResolvedValue([withLinks]);
    mockSendPrivateReplyWithLinkButton.mockRejectedValue(new MetaApiError(1, undefined, undefined, "An unknown error has occurred."));
    await expect(getProcessor()(createMockJob())).rejects.toMatchObject({ name: "UnrecoverableError" });
    expect(mockSendPrivateReplyWithLinkButton).toHaveBeenCalledTimes(1);
    expect(mockSendPrivateReply).not.toHaveBeenCalled();
    expect(mockPrisma.dmLog.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "FAILED", dmDeliveryUnconfirmed: true }) }));
    expect(mockReleaseDMSlot).not.toHaveBeenCalled();
    expect(mockReleaseWorkspaceDMReservation).not.toHaveBeenCalled();
  });

  it("retains the fallback's uncertain outcome instead of replacing it with the first rejection", async () => {
    mockPrisma.automation.findMany.mockResolvedValue([withLinks]);
    mockSendPrivateReplyWithLinkButton.mockRejectedValue(new MetaApiError(100, undefined, undefined, "Unsupported message template"));
    mockSendPrivateReply.mockRejectedValue(new Error("Connection reset after send"));
    await expect(getProcessor()(createMockJob())).rejects.toMatchObject({ name: "UnrecoverableError", message: expect.stringContaining("Connection reset after send") });
    expect(mockSendPrivateReply).toHaveBeenCalledTimes(1);
    expect(mockPrisma.dmLog.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ dmDeliveryUnconfirmed: true }) }));
  });

  it("blocks the historical code 1 failures before any further network send", async () => {
    mockPrisma.dmLog.findUnique.mockResolvedValue({ status: "FAILED", attempts: 1, errorMessage: "MetaApiError 1: An unknown error has occurred.", dmDeliveryUnconfirmed: false });
    await getProcessor()(createMockJob());
    expect(mockSendPrivateReply).not.toHaveBeenCalled();
    expect(mockPrisma.dmLog.update).toHaveBeenCalledWith(expect.objectContaining({ data: { dmDeliveryUnconfirmed: true } }));
  });

  it("cannot reset the lifetime attempt limit by enqueueing a new job", async () => {
    mockPrisma.dmLog.findUnique.mockResolvedValue({ status: "FAILED", attempts: 3, dmDeliveryUnconfirmed: false });
    await getProcessor()({ ...createMockJob(), id: "new-poll-job", attemptsMade: 0 });
    expect(mockSendPrivateReply).not.toHaveBeenCalled();
    expect(mockPrisma.dmLog.updateMany).not.toHaveBeenCalled();
  });

  it("allows only the claim winner to send when webhook and polling overlap", async () => {
    let claimed = false;
    mockPrisma.dmLog.updateMany.mockImplementation(async () => {
      if (claimed) return { count: 0 };
      claimed = true;
      return { count: 1 };
    });
    const process = getProcessor();
    await Promise.all([process(createMockJob()), process({ ...createMockJob(), id: "poll-job" })]);
    expect(mockSendPrivateReply).toHaveBeenCalledTimes(1);
  });

  it("keeps the pre-send claim when both success and failure log writes fail", async () => {
    mockPrisma.dmLog.update.mockRejectedValue(new Error("Database unavailable"));
    const process = getProcessor();
    await expect(process(createMockJob())).rejects.toThrow("Database unavailable");
    expect(mockPrisma.dmLog.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ dmDeliveryUnconfirmed: true }) }));
    mockPrisma.dmLog.findUnique.mockResolvedValue({ status: "PENDING", attempts: 1, dmDeliveryUnconfirmed: true });
    await process({ ...createMockJob(), id: "retry-after-db-recovers" });
    expect(mockSendPrivateReply).toHaveBeenCalledTimes(1);
    expect(mockReleaseWorkspaceDMReservation).not.toHaveBeenCalled();
  });

  it("does not send at all when storing the claim fails", async () => {
    mockPrisma.dmLog.updateMany.mockRejectedValue(new Error("Database unavailable"));
    await expect(getProcessor()(createMockJob())).rejects.toThrow("Database unavailable");
    expect(mockSendPrivateReply).not.toHaveBeenCalled();
  });
});

it("deduplicates a redelivered Meta button tap after queue retention expires", async () => {
  const claims = new Set<string>();
  mockPrisma.postbackDelivery.create.mockImplementation(async ({ data }: { data: { id: string } }) => {
    if (claims.has(data.id)) throw { code: "P2002" };
    claims.add(data.id);
    return data;
  });
  mockPrisma.automation.findFirst.mockResolvedValue(mockAutomation);
  const data = { instagramAccountId: "ig_456", userId: "commenter_999", payload: "reveal:auto_789", mid: "same-meta-tap" };
  const process = getProcessor();
  await process(createMockPostbackJob(data));
  await process({ ...createMockPostbackJob(data), id: "redelivered-after-eviction" });
  expect(mockSendDirectMessage).toHaveBeenCalledTimes(1);
});

// In-memory stand-in for the Redis commands the worker uses, with real TTLs
// measured against Date.now().
function createFakeRedis() {
  const store = new Map<string, { value: string; expiresAt: number }>();
  const live = (key: string) => {
    const entry = store.get(key);
    if (entry && entry.expiresAt <= Date.now()) store.delete(key);
    return store.get(key);
  };
  return {
    store,
    get: vi.fn(async (key: string) => live(key)?.value ?? null),
    set: vi.fn(
      async (key: string, value: string, _ex: "EX", seconds: number, nx?: "NX") => {
        if (nx && live(key)) return null;
        store.set(key, { value, expiresAt: Date.now() + seconds * 1000 });
        return "OK";
      }
    ),
    del: vi.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
  };
}

describe("DM Worker — nudge", () => {
  const opening = {
    ...mockAutomation,
    requireFollow: false,
    openingDmEnabled: true,
    openingDmMessage: "Tap below {username}",
    openingDmButtonLabel: "Send it",
  };
  let redis: ReturnType<typeof createFakeRedis>;

  function dm(text: string, mid = `mid_${text}`) {
    return {
      name: "process-message",
      data: {
        instagramAccountId: "ig_456",
        messageId: mid,
        messageText: text,
        senderId: "commenter_999",
      },
      id: `message_job_${mid}`,
      attemptsMade: 0,
    };
  }

  beforeEach(() => {
    redis = createFakeRedis();
    vi.stubEnv("REDIS_URL", "redis://fake");
    vi.mocked(getRedisConnection).mockReturnValue(redis as never);
    mockPrisma.automation.findMany.mockResolvedValue([opening]);
    mockPrisma.automation.findFirst.mockResolvedValue(opening);
    mockMatchKeywords.mockImplementation((text: string) =>
      text.includes("LINK")
        ? { matched: true, matchedKeyword: "LINK" }
        : { matched: false, matchedKeyword: null }
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("resends the opening DM's own message and button when the follower types a yes-word", async () => {
    await getProcessor()(createMockJob());
    await getProcessor()(dm("ha"));

    expect(mockSendDirectMessageWithButton).toHaveBeenCalledTimes(1);
    expect(mockSendDirectMessageWithButton).toHaveBeenCalledWith(
      "decrypted_token",
      "ig_456",
      "commenter_999",
      "Tap below commenter_user",
      "Send it",
      "reveal:auto_789:open"
    );
  });

  it.each(["ha", "xa", "ҳа", "да", "yes", "+", "ok", "👍", "❤️", "haaa", "daaa", "++", "  HA "])(
    "counts %j as a yes-word",
    async (text) => {
      await getProcessor()(createMockJob());
      await getProcessor()(dm(text));

      expect(mockSendDirectMessageWithButton).toHaveBeenCalledTimes(1);
    }
  );

  it.each(["haha", "ha ok", "yes please", "hello"])(
    "does not count %j as a yes-word",
    async (text) => {
      await getProcessor()(createMockJob());
      await getProcessor()(dm(text));

      expect(mockSendDirectMessageWithButton).not.toHaveBeenCalled();
    }
  );

  it("stops nudging once the follower has tapped the button", async () => {
    await getProcessor()(createMockJob());
    await getProcessor()(
      createMockPostbackJob({
        instagramAccountId: "ig_456",
        userId: "commenter_999",
        payload: "reveal:auto_789:open",
      })
    );
    expect(mockSendDirectMessage).toHaveBeenCalledTimes(1); // the reveal

    await getProcessor()(dm("ok"));

    expect(mockSendDirectMessageWithButton).not.toHaveBeenCalled();
  });

  const link = { slug: "abc123", label: "Get it", destinationUrl: "https://example.com/offer" };

  it("stops nudging once the link has been sent by DM", async () => {
    mockPrisma.automation.findMany.mockResolvedValue([{ ...opening, trackedLinks: [link] }]);
    await getProcessor()(createMockJob());
    await getProcessor()(dm("LINK please"));
    expect(mockSendDirectMessageWithLinkButton).toHaveBeenCalledTimes(1);

    await getProcessor()(dm("ha"));

    expect(mockSendDirectMessageWithButton).not.toHaveBeenCalled();
  });

  it("stops nudging once the link has been sent as a private reply", async () => {
    await getProcessor()(createMockJob());
    mockPrisma.automation.findMany.mockResolvedValue([
      { ...mockAutomation, id: "auto_790", trackedLinks: [link] },
    ]);
    await getProcessor()(createMockJob({ ...mockJobData, commentId: "comment_556" }));
    expect(mockSendPrivateReplyWithLinkButton).toHaveBeenCalledTimes(1);

    await getProcessor()(dm("ha"));

    expect(mockSendDirectMessageWithButton).not.toHaveBeenCalled();
  });

  it("keeps the pending button when only a read receipt, not a tap, came in", async () => {
    mockPrisma.automation.findFirst.mockResolvedValue({ ...opening, requireFollow: true });
    mockGetUserFollowStatus.mockResolvedValue(false);
    await getProcessor()(createMockJob());
    await getProcessor()(
      createMockPostbackJob({
        instagramAccountId: "ig_456",
        userId: "commenter_999",
        payload: "reveal:auto_789",
        fallback: true,
      })
    );

    await getProcessor()(dm("ha"));

    expect(mockSendDirectMessageWithButton).toHaveBeenCalledTimes(1);
  });

  it("lets a campaign whose keyword matches answer instead of the nudge", async () => {
    await getProcessor()(createMockJob());
    mockMatchKeywords.mockReturnValue({ matched: true, matchedKeyword: "ok" });

    await getProcessor()(dm("ok"));

    expect(mockSendDirectMessage).toHaveBeenCalledWith(
      "decrypted_token",
      "ig_456",
      "commenter_999",
      "Hey commenter_user! Here is the link: https://example.com"
    );
    expect(mockSendDirectMessageWithButton).not.toHaveBeenCalled();
  });

  it("lets a match-any-word DM campaign keep answering every DM", async () => {
    await getProcessor()(createMockJob());
    mockPrisma.automation.findMany.mockResolvedValue([{ ...opening, matchAnyWord: true }]);

    await getProcessor()(dm("ha"));

    expect(mockSendDirectMessage).toHaveBeenCalledTimes(1);
    expect(mockSendDirectMessageWithButton).not.toHaveBeenCalled();
  });

  it("records every successful send's Meta message id as bot-sent for 24 hours", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(5_000_000);
    try {
      await getProcessor()(createMockJob()); // opening DM, msg_003
      await getProcessor()(dm("ha")); // nudge, msg_004

      for (const id of ["msg_003", "msg_004"]) {
        expect(redis.store.get(`bot_sent:${id}`)?.expiresAt).toBe(5_000_000 + 86_400_000);
      }
      expect(redis.store.get("pending_button:ig_456:commenter_999")?.expiresAt).toBe(
        5_000_000 + 86_400_000
      );
    } finally {
      now.mockRestore();
    }
  });

  it("records a hash of follower, text and minute when Meta returns no message id", async () => {
    mockSendPrivateReplyWithButton.mockResolvedValue({ recipient_id: "commenter_999" });

    await getProcessor()(createMockJob());

    const botSent = [...redis.store.keys()].filter((key) => key.startsWith("bot_sent:"));
    expect(botSent).toHaveLength(1);
    expect(botSent[0]).toMatch(/^bot_sent:h:[0-9a-f]{64}$/);
  });

  it("still delivers and finishes the job when Redis rejects every write", async () => {
    redis.set.mockRejectedValue(new Error("READONLY"));
    redis.del.mockRejectedValue(new Error("READONLY"));

    await expect(getProcessor()(createMockJob())).resolves.toBeUndefined();

    expect(mockSendPrivateReplyWithButton).toHaveBeenCalledTimes(1);
    expect(mockPrisma.dmLog.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "SENT" }) })
    );
  });

  it("leaves Zernio accounts untracked and never nudges them", async () => {
    const zernio = {
      ...opening,
      instagramAccount: {
        ...opening.instagramAccount,
        provider: "ZERNIO",
        workspaceId: "workspace_123",
        zernioAccountId: "zernio_selected",
        accessToken: "",
      },
    };
    mockPrisma.zernioConnection.findUnique.mockResolvedValue({ apiKey: "encrypted_key" });
    mockPrisma.automation.findMany.mockResolvedValue([zernio]);
    mockPrisma.automation.findFirst.mockResolvedValue(zernio);
    const fetchMock = vi
      .fn()
      .mockImplementation(async () => new Response(JSON.stringify({ messageId: "sent" })));
    vi.stubGlobal("fetch", fetchMock);
    try {
      await getProcessor()(createMockJob());
      await getProcessor()(dm("ha"));

      expect(fetchMock).toHaveBeenCalledTimes(1); // the opening DM only
      expect(redis.store.size).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("does not resend a button whose campaign has since been switched off", async () => {
    await getProcessor()(createMockJob());
    mockPrisma.automation.findFirst.mockResolvedValue(null);

    await getProcessor()(dm("ha"));

    expect(mockSendDirectMessageWithButton).not.toHaveBeenCalled();
  });

  it("sends nothing to a follower with no pending button", async () => {
    await getProcessor()(dm("ha"));

    expect(mockSendDirectMessageWithButton).not.toHaveBeenCalled();
    expect(mockSendDirectMessage).not.toHaveBeenCalled();
  });

  it("nudges a follower at most once a minute", async () => {
    const now = vi.spyOn(Date, "now");
    try {
      now.mockReturnValue(1_000_000);
      await getProcessor()(createMockJob());
      await getProcessor()(dm("+", "mid_1"));
      await getProcessor()(dm("+", "mid_2"));
      expect(mockSendDirectMessageWithButton).toHaveBeenCalledTimes(1);

      now.mockReturnValue(1_000_000 + 61_000);
      await getProcessor()(dm("+", "mid_3"));
      expect(mockSendDirectMessageWithButton).toHaveBeenCalledTimes(2);
    } finally {
      now.mockRestore();
    }
  });
});

it("retains the public reply claim if sending succeeded but its log write failed", async () => {
  const { sendCommentReply } = await import("@/lib/meta/client");
  vi.mocked(sendCommentReply).mockResolvedValue({ id: "public-reply" });
  mockPrisma.automation.findMany.mockResolvedValue([{ ...mockAutomation, publicReplyEnabled: true, publicReplyMessages: ["Sent!"] }]);
  mockPrisma.dmLog.update.mockRejectedValueOnce(new Error("Lost database connection after public send"));
  const process = getProcessor();
  await process(createMockJob());
  expect(mockPrisma.dmLog.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ publicReplyDeliveryUnconfirmed: true }) }));
  mockPrisma.dmLog.findUnique.mockResolvedValue({ status: "SENT", publicReplyDeliveryUnconfirmed: true });
  await process({ ...createMockJob(), id: "next-poll" });
  expect(sendCommentReply).toHaveBeenCalledTimes(1);
  expect(mockSendPrivateReply).toHaveBeenCalledTimes(1);
});

type AiRow = {
  id: string;
  instagramAccountId: string;
  followerId: string;
  role: "USER" | "ASSISTANT";
  text: string;
  messageId: string | null;
  createdAt: Date;
};
type AiWhere = Partial<Pick<AiRow, "instagramAccountId" | "followerId" | "role">> & {
  createdAt?: { gte?: Date; lt?: Date };
};

// A tiny in-memory AiMessage table behind the mocked Prisma delegate.
function useAiMessageTable() {
  const rows: AiRow[] = [];
  const matches = (row: AiRow, where: AiWhere = {}) =>
    (where.instagramAccountId === undefined || row.instagramAccountId === where.instagramAccountId) &&
    (where.followerId === undefined || row.followerId === where.followerId) &&
    (where.role === undefined || row.role === where.role) &&
    (!where.createdAt?.gte || row.createdAt >= where.createdAt.gte) &&
    (!where.createdAt?.lt || row.createdAt < where.createdAt.lt);
  const insert = (data: Partial<AiRow>) => {
    const row = { id: `ai_${rows.length + 1}`, messageId: null, createdAt: new Date(), ...data } as AiRow;
    rows.push(row);
    return row;
  };
  const table = mockPrisma.aiMessage;
  table.createMany.mockImplementation(async ({ data }: { data: Partial<AiRow>[] }) => ({
    count: data
      .filter((row) => !rows.some((existing) => row.messageId && existing.messageId === row.messageId))
      .map(insert).length,
  }));
  table.create.mockImplementation(async ({ data }: { data: Partial<AiRow> }) => insert(data));
  table.findMany.mockImplementation(async ({ where, take }: { where: AiWhere; take?: number }) =>
    rows
      .filter((row) => matches(row, where))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || rows.indexOf(b) - rows.indexOf(a))
      .slice(0, take)
  );
  table.count.mockImplementation(
    async ({ where }: { where: AiWhere }) => rows.filter((row) => matches(row, where)).length
  );
  table.deleteMany.mockImplementation(async ({ where }: { where: AiWhere }) => {
    const gone = rows.filter((row) => matches(row, where));
    for (const row of gone) rows.splice(rows.indexOf(row), 1);
    return { count: gone.length };
  });
  return rows;
}

describe("DM Worker — AI assistant", () => {
  const instructions = "Men Lazizbek, AI haqida kontent qilaman. Telegram: https://t.me/lazizpapi";
  const account = {
    id: "ig_account_row_1",
    instagramId: "ig_456",
    provider: "META",
    workspaceId: "workspace_123",
    zernioAccountId: null,
    accessToken: "encrypted_token_abc",
    aiSettings: { enabled: true, instructions, dailyLimit: 100 },
  };
  const campaign = {
    ...mockAutomation,
    name: "AI qo'llanma",
    dmTriggerEnabled: true,
    requireFollow: false,
  };
  const answer = (reply: string, language = "uz-latn", handover = false) => ({
    reply,
    handover,
    language,
  });
  let aiRows: AiRow[];

  function dm(text: string, mid: string, senderId = "follower_1") {
    return {
      name: "process-message",
      data: { instagramAccountId: "ig_456", messageId: mid, messageText: text, senderId },
      id: `message_job_${mid}`,
      attemptsMade: 0,
    };
  }

  // Runs the ai-reply jobs queued so far, after their 10-second delay.
  async function runAiReplies() {
    const jobs = mockQueueAdd.mock.calls.filter(([name]) => name === "ai-reply");
    mockQueueAdd.mockClear();
    vi.setSystemTime(Date.now() + 10_000);
    for (const [name, data, options] of jobs) {
      await getProcessor()({ name, data, id: options.jobId, attemptsMade: 0 });
    }
  }

  const sentTexts = () => mockSendDirectMessage.mock.calls.map((call) => call[3]);

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-11T10:00:00Z"));
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    aiRows = useAiMessageTable();
    mockPrisma.instagramAccount.findUnique.mockResolvedValue(account);
    mockPrisma.automation.findMany.mockResolvedValue([campaign]);
    mockMatchKeywords.mockReturnValue({ matched: false, matchedKeyword: null });
    mockAskClaude.mockResolvedValue(answer("Qo'llanma uchun LINK deb yozing."));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("answers a DM that matched no campaign 10 seconds later, from the AI instructions and live campaigns", async () => {
    await getProcessor()(dm("qo'llanma qayerda?", "mid_1"));

    expect(mockQueueAdd).toHaveBeenCalledWith(
      "ai-reply",
      expect.anything(),
      expect.objectContaining({
        delay: 10_000,
        attempts: 1,
        jobId: expect.stringContaining(Buffer.from("mid_1").toString("base64url")),
      })
    );
    expect(mockSendDirectMessage).not.toHaveBeenCalled();

    await runAiReplies();

    expect(mockSendDirectMessage).toHaveBeenCalledWith(
      "decrypted_token",
      "ig_456",
      "follower_1",
      "🤖 Bu avtomatik yordamchi.\nQo'llanma uchun LINK deb yozing."
    );
    const [system, messages] = mockAskClaude.mock.calls[0];
    expect(system).toContain(instructions);
    expect(system).toContain("AI qo'llanma: type LINK or PRICE here to get it.");
    expect(system).toContain("approved an exception");
    expect(messages).toEqual([{ role: "user", content: "qo'llanma qayerda?" }]);
  });

  it("lets a matching campaign answer instead of the AI", async () => {
    mockMatchKeywords.mockReturnValue({ matched: true, matchedKeyword: "LINK" });

    await getProcessor()(dm("LINK", "mid_1"));
    await runAiReplies();

    expect(mockSendDirectMessage).toHaveBeenCalledTimes(1);
    expect(sentTexts()[0]).toContain("Here is the link");
    expect(mockAskClaude).not.toHaveBeenCalled();
    expect(aiRows).toHaveLength(0);
  });

  it("lets a nudge answer a yes-word instead of the AI", async () => {
    const redis = createFakeRedis();
    vi.stubEnv("REDIS_URL", "redis://fake");
    vi.mocked(getRedisConnection).mockReturnValue(redis as never);
    redis.store.set("pending_button:ig_456:follower_1", {
      value: JSON.stringify({
        campaignId: "auto_789",
        text: "Tap below",
        buttonTitle: "Send it",
        payload: "reveal:auto_789:open",
        via: "dm",
      }),
      expiresAt: Date.now() + 60_000,
    });
    mockPrisma.automation.findFirst.mockResolvedValue(campaign);

    await getProcessor()(dm("ha", "mid_1"));
    await runAiReplies();

    expect(mockSendDirectMessageWithButton).toHaveBeenCalledTimes(1);
    expect(mockAskClaude).not.toHaveBeenCalled();
    expect(mockSendDirectMessage).not.toHaveBeenCalled();
  });

  it("answers a yes-word when there is no pending button", async () => {
    await getProcessor()(dm("ha", "mid_1"));
    await runAiReplies();

    expect(mockAskClaude).toHaveBeenCalledTimes(1);
    expect(mockSendDirectMessage).toHaveBeenCalledTimes(1);
  });

  it("does nothing AI-related without ANTHROPIC_API_KEY", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");

    await getProcessor()(dm("salom", "mid_1"));
    await getProcessor()({
      name: "ai-reply",
      data: { instagramAccountId: "ig_456", followerId: "follower_1", messageId: "mid_1" },
      id: "ai_reply_job",
      attemptsMade: 0,
    });

    expect(mockPrisma.aiMessage.createMany).not.toHaveBeenCalled();
    expect(mockQueueAdd).not.toHaveBeenCalled();
    expect(mockAskClaude).not.toHaveBeenCalled();
    expect(mockSendDirectMessage).not.toHaveBeenCalled();
  });

  it.each([
    ["the AI settings are off", { ...account, aiSettings: { ...account.aiSettings, enabled: false } }],
    ["the account has no AI settings", { ...account, aiSettings: null }],
    ["the account is a Zernio account", { ...account, provider: "ZERNIO" }],
  ])("stays out of the chat when %s", async (_case, setup) => {
    mockPrisma.instagramAccount.findUnique.mockResolvedValue(setup);

    await getProcessor()(dm("salom", "mid_1"));
    await runAiReplies();

    expect(aiRows).toHaveLength(0);
    expect(mockAskClaude).not.toHaveBeenCalled();
    expect(mockSendDirectMessage).not.toHaveBeenCalled();
  });

  it("answers only the last of several messages, with all of them", async () => {
    await getProcessor()(dm("salom", "mid_1"));
    vi.setSystemTime(Date.now() + 3_000);
    await getProcessor()(dm("savolim bor", "mid_2"));
    vi.setSystemTime(Date.now() + 3_000);
    await getProcessor()(dm("qo'llanma qayerda?", "mid_3"));

    await runAiReplies();

    expect(mockAskClaude).toHaveBeenCalledTimes(1);
    expect(mockAskClaude.mock.calls[0][1]).toEqual([
      { role: "user", content: "salom" },
      { role: "user", content: "savolim bor" },
      { role: "user", content: "qo'llanma qayerda?" },
    ]);
    expect(mockSendDirectMessage).toHaveBeenCalledTimes(1);
  });

  it("treats a duplicate webhook for the same message as a no-op", async () => {
    await getProcessor()(dm("salom", "mid_1"));
    await getProcessor()(dm("salom", "mid_1"));

    expect(aiRows).toHaveLength(1);
    expect(mockQueueAdd).toHaveBeenCalledTimes(1);
  });

  it("answers a message once even when its job runs twice", async () => {
    await getProcessor()(dm("salom", "mid_1"));
    const [[name, data, options]] = mockQueueAdd.mock.calls;
    vi.setSystemTime(Date.now() + 10_000);
    const job = { name, data, id: options.jobId, attemptsMade: 0 };

    await getProcessor()(job);
    await getProcessor()(job);

    expect(mockAskClaude).toHaveBeenCalledTimes(1);
    expect(mockSendDirectMessage).toHaveBeenCalledTimes(1);
  });

  it("answers a DM that arrives while Claude is answering the previous one", async () => {
    await getProcessor()(dm("salom", "mid_1"));
    mockAskClaude.mockImplementationOnce(async () => {
      vi.setSystemTime(Date.now() + 2_000);
      await getProcessor()(dm("narxi qancha?", "mid_2"));
      return answer("Salom!");
    });

    await runAiReplies(); // answers mid_1, queues mid_2
    await runAiReplies(); // answers mid_2

    expect(mockAskClaude).toHaveBeenCalledTimes(2);
    expect(mockSendDirectMessage).toHaveBeenCalledTimes(2);
  });

  it("stays silent once the messaging window has closed", async () => {
    await getProcessor()(dm("salom", "mid_1"));
    vi.setSystemTime(Date.now() + 24 * 60 * 60 * 1000); // the worker was down for a day

    await runAiReplies();

    expect(mockAskClaude).not.toHaveBeenCalled();
    expect(mockSendDirectMessage).not.toHaveBeenCalled();
  });

  it("stays silent at the daily AI limit, counting one answer once however many parts it had", async () => {
    mockPrisma.instagramAccount.findUnique.mockResolvedValue({
      ...account,
      aiSettings: { ...account.aiSettings, dailyLimit: 2 },
    });
    mockAskClaude.mockResolvedValue(answer(Array(150).fill("Bu javob.").join(" "))); // 2 parts

    for (const follower of ["follower_1", "follower_2", "follower_3"]) {
      await getProcessor()(dm("salom", `mid_${follower}`, follower));
      await runAiReplies();
    }

    expect(mockSendDirectMessage.mock.calls.map((call) => call[2])).toEqual([
      "follower_1",
      "follower_1",
      "follower_2",
      "follower_2",
    ]);
  });

  it("starts the daily AI limit's day at 00:00 Tashkent time", async () => {
    mockPrisma.instagramAccount.findUnique.mockResolvedValue({
      ...account,
      aiSettings: { ...account.aiSettings, dailyLimit: 1 },
    });
    const answerAt = async (utc: string, follower: string) => {
      vi.setSystemTime(new Date(utc));
      await getProcessor()(dm("salom", `mid_${follower}`, follower));
      await runAiReplies();
    };

    await answerAt("2026-11-11T18:58:00Z", "follower_1"); // 23:58 in Tashkent
    await answerAt("2026-11-11T18:59:00Z", "follower_2"); // 23:59, same day: limit reached
    await answerAt("2026-11-11T19:00:00Z", "follower_3"); // 00:00:10 the next day

    expect(mockSendDirectMessage.mock.calls.map((call) => call[2])).toEqual([
      "follower_1",
      "follower_3",
    ]);
  });

  it("starts the first answer in 30 days with the bot notice in the follower's language", async () => {
    mockAskClaude.mockResolvedValue(answer("Здравствуйте!", "ru"));
    const reply = async (text: string, mid: string) => {
      await getProcessor()(dm(text, mid));
      await runAiReplies();
    };

    await reply("привет", "mid_1");
    vi.setSystemTime(Date.now() + 60_000);
    await reply("как дела?", "mid_2");
    vi.setSystemTime(Date.now() + 31 * 24 * 60 * 60 * 1000);
    await deleteExpiredAiMessages(); // the worker's periodic loop
    await reply("снова привет", "mid_3");

    expect(sentTexts()).toEqual([
      "🤖 Это автоматический ассистент.\nЗдравствуйте!",
      "Здравствуйте!",
      "🤖 Это автоматический ассистент.\nЗдравствуйте!",
    ]);
  });

  it.each([
    ["uz-cyrl", "🤖 Бу автоматик ёрдамчи."],
    ["en", "🤖 This is an automated assistant."],
    ["other", "🤖 Bu avtomatik yordamchi."],
  ])("writes the bot notice for %s as %j", async (language, notice) => {
    mockAskClaude.mockResolvedValue(answer("OK", language));

    await getProcessor()(dm("hi", "mid_1"));
    await runAiReplies();

    expect(sentTexts()).toEqual([`${notice}\nOK`]);
  });

  it("strips Markdown and sends a long answer as up to 3 messages, in order", async () => {
    const paragraph = (word: string) => Array(100).fill(`${word} gap.`).join(" ");
    mockAskClaude.mockResolvedValue(
      answer(`**${paragraph("Bir")}**\n\n${paragraph("Ikki")}\n\n${paragraph("Uch")}`)
    );

    await getProcessor()(dm("salom", "mid_1"));
    await runAiReplies();

    expect(sentTexts()).toEqual([
      `🤖 Bu avtomatik yordamchi.\n${paragraph("Bir")}`,
      paragraph("Ikki"),
      paragraph("Uch"),
    ]);
  });

  it("stops at the first failed part and still counts the answer", async () => {
    const paragraph = (word: string) => Array(100).fill(`${word} gap.`).join(" ");
    mockAskClaude.mockResolvedValueOnce(
      answer(`${paragraph("Bir")}\n\n${paragraph("Ikki")}\n\n${paragraph("Uch")}`)
    );
    mockSendDirectMessage
      .mockResolvedValueOnce({ recipient_id: "follower_1", message_id: "msg_1" })
      .mockRejectedValueOnce(new Error("Meta send failed"));

    await getProcessor()(dm("salom", "mid_1"));
    await runAiReplies();
    expect(mockSendDirectMessage).toHaveBeenCalledTimes(2);

    await getProcessor()(dm("rahmat", "mid_2"));
    await runAiReplies();
    expect(sentTexts()[2]).toBe("Qo'llanma uchun LINK deb yozing."); // no second bot notice
  });

  it.each([
    ["Claude fails, refuses or returns nothing usable", null],
    ["Claude hands over (ticket 07 adds the handover text)", answer("Egasi javob beradi.", "uz-latn", true)],
    ["the reply is empty", answer(" \n ")],
  ])("stays silent when %s", async (_case, result) => {
    mockAskClaude.mockResolvedValue(result);

    await getProcessor()(dm("salom", "mid_1"));
    await runAiReplies();

    expect(mockSendDirectMessage).not.toHaveBeenCalled();
  });

  it("never fails the message job when the AI step fails", async () => {
    mockPrisma.aiMessage.createMany.mockRejectedValue(new Error("relation does not exist"));

    await expect(getProcessor()(dm("salom", "mid_1"))).resolves.toBeUndefined();
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it("sends Claude the last 10 AI messages, oldest first, starting with the follower's", async () => {
    for (let n = 1; n <= 6; n++) {
      mockAskClaude.mockResolvedValueOnce(answer(`javob ${n}`));
      await getProcessor()(dm(`savol ${n}`, `mid_${n}`));
      await runAiReplies();
      vi.setSystemTime(Date.now() + 60_000);
    }
    await getProcessor()(dm("savol 7", "mid_7"));
    await runAiReplies();

    expect(mockAskClaude.mock.calls[6][1]).toEqual([
      { role: "user", content: "savol 3" },
      { role: "assistant", content: "javob 3" },
      { role: "user", content: "savol 4" },
      { role: "assistant", content: "javob 4" },
      { role: "user", content: "savol 5" },
      { role: "assistant", content: "javob 5" },
      { role: "user", content: "savol 6" },
      { role: "assistant", content: "javob 6" },
      { role: "user", content: "savol 7" },
    ]);
  });

  it("never hands a job with an unknown name to the comment handler", async () => {
    await getProcessor()({ name: "ai-unknown", data: mockJobData, id: "unknown_job", attemptsMade: 0 });

    expect(mockPrisma.automation.findMany).not.toHaveBeenCalled();
    expect(mockSendPrivateReply).not.toHaveBeenCalled();
  });

  describe("human takeover", () => {
    const HOUR_MS = 60 * 60 * 1000;

    // The echo of a message the account sent, 15 seconds after it was sent.
    function echo(messageId: string, isTemplate = false, text?: string) {
      return {
        name: "ai-echo",
        data: { instagramAccountId: "ig_456", followerId: "follower_1", messageId, isTemplate, text },
        id: `ai_echo_${messageId}`,
        attemptsMade: 0,
      };
    }

    async function followerWrites(text: string, mid: string) {
      await getProcessor()(dm(text, mid));
      await runAiReplies();
    }

    beforeEach(() => {
      vi.stubEnv("REDIS_URL", "redis://fake");
      vi.mocked(getRedisConnection).mockReturnValue(createFakeRedis() as never);
    });

    it("stays silent in the chat for 12 hours after the owner replies from the Instagram app", async () => {
      await getProcessor()(echo("mid_owner"));

      await followerWrites("salom", "mid_1");
      vi.setSystemTime(Date.now() + 11 * HOUR_MS);
      await followerWrites("javob bering", "mid_2");
      expect(mockAskClaude).not.toHaveBeenCalled();
      expect(mockSendDirectMessage).not.toHaveBeenCalled();

      vi.setSystemTime(Date.now() + HOUR_MS);
      await followerWrites("hali ham kutyapman", "mid_3");
      expect(mockSendDirectMessage).toHaveBeenCalledTimes(1);
    });

    it("does not count its own answers as the owner replying", async () => {
      mockSendDirectMessage.mockResolvedValue({ recipient_id: "follower_1", message_id: "mid_ai" });

      await followerWrites("salom", "mid_1");
      await getProcessor()(echo("mid_ai"));
      await followerWrites("rahmat", "mid_2");

      expect(mockSendDirectMessage).toHaveBeenCalledTimes(2);
    });

    it("does not count a campaign message as the owner replying", async () => {
      mockMatchKeywords.mockReturnValueOnce({ matched: true, matchedKeyword: "LINK" });
      mockSendDirectMessage.mockResolvedValueOnce({ recipient_id: "follower_1", message_id: "mid_campaign" });

      await followerWrites("LINK", "mid_1");
      await getProcessor()(echo("mid_campaign"));
      await followerWrites("rahmat", "mid_2");

      expect(mockAskClaude).toHaveBeenCalledTimes(1);
      expect(mockSendDirectMessage).toHaveBeenCalledTimes(2);
    });

    // Safety net in case Meta's echo id ever differs from the send's message_id.
    it("recognises its own answer by text when the echo's id is unknown", async () => {
      await followerWrites("salom", "mid_1");
      const [sent] = sentTexts();
      await getProcessor()(echo("mid_unknown", false, `  ${sent.replace(" ", "   ")}\n`));
      await followerWrites("rahmat", "mid_2");

      expect(mockSendDirectMessage).toHaveBeenCalledTimes(2);
    });

    it("recognises every part of a split answer by text", async () => {
      const paragraph = (word: string) => Array(100).fill(`${word} gap.`).join(" ");
      mockAskClaude.mockResolvedValueOnce(
        answer(`${paragraph("Bir")}\n\n${paragraph("Ikki")}\n\n${paragraph("Uch")}`)
      );

      await followerWrites("salom", "mid_1");
      const parts = sentTexts();
      expect(parts).toHaveLength(3);
      for (const [n, text] of parts.entries()) {
        await getProcessor()(echo(`mid_unknown_${n}`, false, text));
      }
      await followerWrites("rahmat", "mid_2");

      expect(mockSendDirectMessage).toHaveBeenCalledTimes(4);
    });

    it("counts an echo with an unknown id and new text as the owner replying", async () => {
      await followerWrites("salom", "mid_1");
      await getProcessor()(echo("mid_unknown", false, "Salom! Men o'zim javob beraman."));
      await followerWrites("rahmat", "mid_2");

      expect(mockSendDirectMessage).toHaveBeenCalledTimes(1);
    });

    it("does not count a template or button message as the owner replying", async () => {
      await getProcessor()(echo("mid_template_unrecorded", true));
      await followerWrites("salom", "mid_1");

      expect(mockSendDirectMessage).toHaveBeenCalledTimes(1);
    });

    async function replyFromInbox(text: string) {
      const response = await inboxReply(
        new Request("http://localhost/api/instagram/conversations", {
          method: "POST",
          body: JSON.stringify({ instagramAccountId: account.id, recipientId: "follower_1", text }),
        }) as never
      );
      await Promise.all(afterTasks.splice(0));
      return response;
    }

    it("stays silent in the chat for 12 hours after the owner replies from OpenReply's inbox", async () => {
      mockGetWorkspaceInstagramAccount.mockResolvedValue(account);

      expect((await replyFromInbox("Salom, men Lazizbek")).status).toBe(200);
      await followerWrites("salom", "mid_1");
      expect(sentTexts()).toEqual(["Salom, men Lazizbek"]);

      vi.setSystemTime(Date.now() + 12 * HOUR_MS);
      await followerWrites("yana savol", "mid_2");
      expect(mockSendDirectMessage).toHaveBeenCalledTimes(2);
    });

    it("keeps answering when the inbox reply fails to send", async () => {
      mockGetWorkspaceInstagramAccount.mockResolvedValue(account);
      mockSendDirectMessage.mockRejectedValueOnce(new Error("Meta send failed"));

      expect((await replyFromInbox("Salom")).status).toBe(502);
      await followerWrites("salom", "mid_1");
      expect(mockSendDirectMessage).toHaveBeenCalledTimes(2);
    });
  });

  it("never answers a follower the owner follows", async () => {
    mockGetBusinessFollowsUser.mockImplementation(
      async (_token: string, followerId: string) => followerId === "follower_1"
    );

    await getProcessor()(dm("salom", "mid_1", "follower_1"));
    await getProcessor()(dm("salom", "mid_2", "follower_2"));
    await runAiReplies();

    expect(mockSendDirectMessage.mock.calls.map((call) => call[2])).toEqual(["follower_2"]);
  });

  it.each([false, null])("answers when Meta reports the owner's follow as %s", async (follows) => {
    mockGetBusinessFollowsUser.mockResolvedValue(follows);

    await getProcessor()(dm("salom", "mid_1"));
    await runAiReplies();

    expect(mockSendDirectMessage).toHaveBeenCalledTimes(1);
  });
});
