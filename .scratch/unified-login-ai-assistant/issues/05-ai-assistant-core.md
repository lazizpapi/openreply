# 05: AI assistant answers DMs that match no campaign

**What to build:** When the AI assistant is enabled for an account and `ANTHROPIC_API_KEY` is set, a follower's text DM or text story reply that matched no campaign and triggered no nudge gets an answer.

The answer:
- comes about 10 seconds after their last message
- is written by Claude Haiku 5.5 from the owner's AI instructions and the live campaigns' keywords
- is in the follower's language, with the bot notice on first contact
- is split to Instagram's 1000-byte limit

It respects the daily AI limit and the messaging window, and it is silent on any failure. Until ticket 08 adds the panel, it is switched on with an AI settings row. META accounts only.

See the spec, "Implementation Decisions → AI assistant" and "→ Data model". **Load the `claude-api` skill before writing the provider code.**

**Blocked by:** 04 (Nudge). The AI runs after campaigns and the nudge in the message job, and sends through the tracked send.

**Status:** ready-for-agent

- [ ] **Schema.** `AiSettings` (one per account: enabled default false, instructions, dailyLimit default 100) and `AiMessage` (account, follower, role `AiMessageRole` USER/ASSISTANT, text, unique nullable message ID, created) are appended to the schema. Both cascade on account delete, with indexes on (account, follower, created) and created.
- [ ] **Migration.** It is generated with `prisma migrate diff` into a new timestamped migration folder.
- [ ] **Inbound step:** after the nudge, when the AI is enabled and the key is present, the message is stored as USER (duplicates are no-ops) and an `ai-reply` job is enqueued with a 10-second delay, a job ID from the message ID, and a single attempt.
- [ ] **Job routing.** The worker dispatcher routes `ai-reply` explicitly. Unknown job names must not reach the comment handler.
- [ ] **The reply job skips silently when:**
  - a newer USER message from this follower exists
  - an ASSISTANT message already follows this USER message
  - the last USER message is older than 24 hours
  - today's ASSISTANT count (from 00:00 Asia/Tashkent) has reached the account's daily limit
- [ ] **Claude call,** through `@anthropic-ai/sdk`:
  - model `claude-haiku-5-5`, `output_config.effort: "low"`, adaptive thinking left at default
  - no `temperature`, `top_p` or `top_k`, no prefill, no `fallbacks`
  - `max_tokens` about 1024, timeout about 20 seconds, `maxRetries` 1
  - content blocks read by type
- [ ] **System prompt:**
  - the fixed rules from the spec, including the rules-hold line
  - then the AI instructions
  - then, for each active campaign with the DM trigger on, its name and keywords
- [ ] **Messages:** the last 10 AI messages, oldest first, starting with USER.
- [ ] **Structured output:** `{ reply, handover, language }` with language `uz-latn | uz-cyrl | ru | en | other`.
- [ ] **Silence.** A refusal or max-tokens stop, an SDK error, or unparseable output means nothing is sent and the failure is logged. `handover: true` also means silence for now; ticket 07 handles it.
- [ ] **Reply shaping:**
  - Markdown markers are stripped.
  - The bot notice in the follower's language is prefixed when no ASSISTANT message to this follower exists. Texts are in the spec, and "other" uses uz-latn.
  - The text is split into parts of at most 1000 UTF-8 bytes, at most 3 parts, breaking at paragraph, then sentence, then word, never inside a grapheme. An over-long third part ends with "…".
  - Parts are sent in order through the tracked DM send, stopping on the first failure.
  - One ASSISTANT message is stored with the full text.
- [ ] **Retention.** The worker's periodic loop deletes AI messages older than 30 days.
- [ ] **No key, no AI.** Without `ANTHROPIC_API_KEY`, nothing AI-related runs and nothing crashes. `.env.example` documents the key.
- [ ] Worker tests (with the provider mocked) cover:
  - campaign and nudge winning over the AI
  - "only the last of several messages"
  - the already-answered guard
  - window, daily limit and Tashkent day start
  - the bot notice once per 30 days
  - silence on error and refusal
- [ ] One provider test pins the request shape.
- [ ] Leaf tests cover the splitter (Cyrillic and ʻ bytes, emoji, 3-part cap) and the Markdown stripper.
- [ ] `npm test`, `npm run typecheck`, `npm run lint` and a build with placeholder env pass. The worker entry loads under `tsx`.

## Comments
