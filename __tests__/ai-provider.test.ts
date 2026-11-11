import { beforeEach, describe, expect, it, vi } from "vitest";

// Stubbed before the first call: the provider builds its client lazily and the
// SDK keeps the global fetch it finds then.
const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

import { askClaude } from "@/lib/ai/provider";

const answer = { reply: "Salom! LINK deb yozing.", handover: false, language: "uz-latn" };

function claudeResponse(overrides: Record<string, unknown> = {}, status = 200, headers = {}) {
  return new Response(
    JSON.stringify({
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: "claude-haiku-5-5",
      content: [
        { type: "thinking", thinking: "", signature: "sig" },
        { type: "text", text: JSON.stringify(answer) },
      ],
      stop_reason: "end_turn",
      stop_details: null,
      usage: { input_tokens: 10, output_tokens: 20 },
      ...overrides,
    }),
    { status, headers: { "content-type": "application/json", ...headers } }
  );
}

const history = [
  { role: "user" as const, content: "salom" },
  { role: "assistant" as const, content: "Salom!" },
  { role: "user" as const, content: "qo'llanma qayerda?" },
];

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
});

describe("askClaude", () => {
  it("asks Claude Haiku 5.5 at low effort for the structured answer", async () => {
    fetchMock.mockResolvedValue(claudeResponse());

    await expect(askClaude("SYSTEM", history)).resolves.toEqual(answer);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.anthropic.com/v1/messages");
    expect(new Headers(init.headers).get("x-stainless-timeout")).toBe("20");
    const body = JSON.parse(init.body);
    expect(body).toEqual({
      model: "claude-haiku-5-5",
      max_tokens: 1024,
      system: "SYSTEM",
      messages: history,
      output_config: {
        effort: "low",
        format: {
          type: "json_schema",
          schema: expect.objectContaining({
            type: "object",
            properties: {
              reply: { type: "string" },
              handover: { type: "boolean" },
              language: { enum: ["uz-latn", "uz-cyrl", "ru", "en", "other"] },
            },
            required: ["reply", "handover", "language"],
            additionalProperties: false,
          }),
        },
      },
    });
  });

  it.each([
    ["a refusal", { stop_reason: "refusal", stop_details: { type: "refusal", category: null } }],
    ["a max-tokens stop", { stop_reason: "max_tokens" }],
    ["unparseable output", { content: [{ type: "text", text: "Salom!" }] }],
    ["output off the schema", { content: [{ type: "text", text: '{"reply":"Salom!"}' }] }],
    ["no text block", { content: [{ type: "thinking", thinking: "", signature: "sig" }] }],
  ])("returns no answer on %s", async (_case, overrides) => {
    fetchMock.mockResolvedValue(claudeResponse(overrides));

    await expect(askClaude("SYSTEM", history)).resolves.toBeNull();
  });

  it("returns no answer on an SDK error, after one retry", async () => {
    fetchMock.mockImplementation(async () =>
      claudeResponse(
        { type: "error", error: { type: "overloaded_error", message: "Overloaded" } },
        529,
        { "retry-after-ms": "0" }
      )
    );

    await expect(askClaude("SYSTEM", history)).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
