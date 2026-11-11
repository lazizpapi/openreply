# 06: Human takeover silences the AI for 12 hours

**What to build:** When the owner replies to a follower personally, from the Instagram app or from OpenReply's inbox, the AI assistant stays silent in that chat for 12 hours. Campaign messages and the AI's own messages never count as the owner replying. The AI also never answers followers the owner follows. META accounts only.

See the spec, "Implementation Decisions → Human takeover" and the owner-follows skip under "→ AI assistant".

**Blocked by:** 01 (Unified login: this ticket also edits the Meta client and webhook code it reshapes), 05 (AI assistant core)

**Status:** ready-for-agent

- [x] **Echo intake.** For META accounts, webhook intake handles echo messages instead of dropping them. Each one enqueues an `ai-echo` job delayed 15 seconds, carrying the account, follower (the echo's recipient), message ID and whether it is a template. Zernio behaviour is unchanged.
- [x] **The `ai-echo` job:**
  - a message ID recorded as bot-sent: ignored
  - a template or button echo: ignored
  - anything else: a 12-hour AI pause for that follower (Redis key with a TTL)
- [x] **Job routing.** The dispatcher routes `ai-echo` explicitly.
- [x] **Inbox reply.** The OpenReply inbox reply route sets the same 12-hour pause after a successful send.
- [x] **Pause check.** The reply job skips silently while the pause is active.
- [x] **Follower profile.** The follower-profile read also returns `is_business_follow_user`, and the follow gate's existing behaviour is unchanged. The reply job skips when the owner follows the follower. Unknown means "not followed".
- [x] **Tests:**
  - webhook tests: echoes yield delayed `ai-echo` jobs for META only
  - worker tests: bot ID ignored, template ignored, human echo pauses, paused chat skipped, inbox reply pauses, owner-follows skip, unknown follow status still answered
- [x] `npm test`, `npm run typecheck`, `npm run lint` and a build with placeholder env pass.

## Comments

Implementation notes and deviations (agent, ticket 06):

**For ticket 07** (all in `lib/instagram/bot-sends.ts`)

- Set the pause: `pauseAi(instagramAccountId, followerId)`. It returns the Redis write's promise, which never rejects. In the worker, `await` it. In a web route, wrap it in `after()` (see "Inbox reply" below).
- Is it paused: `isAiPaused(instagramAccountId, followerId)` resolves to a boolean. It is `false` without `REDIS_URL`.
- `instagramAccountId` is the Instagram ID (`job.instagramAccountId`, `account.instagramId`), not the account row ID. That matches `pending_button`.
- The reply job checks the pause in `skipReason` before it calls Claude. So a handover that sets the pause stops later jobs for that follower, and "one email per 12 hours" needs no extra state.

**Redis keys added**

- `ai_pause:<instagramId>:<followerId>` = `1`, 12 h TTL. Set by the `ai-echo` job and by the inbox reply route.
- Read only: `bot_sent:<metaMessageId>` (ticket 04's key), checked by `isBotSend(messageId)`.

**Where things live**

- `lib/meta/webhook.ts`: `parseEchoEvents`. The follower is the echo's recipient. `isTemplate` is true when an attachment has `type: "template"`. Deleted echoes are skipped. `parseMessageEvents` still drops echoes, so the keyword path is unchanged.
- `lib/queue/process-webhook.ts`: META intake only. It queues `ai-echo` (`AI_ECHO_JOB_NAME`, `AiEchoJob` in `lib/queue/client.ts`) with a 15 s delay, `attempts: 1`, and job ID `ai_echo_<instagramId>_<base64url(mid)>`.
- `lib/ai/assistant.ts`: `processAiEcho(job)`. It returns early on `isTemplate` or a bot-sent ID; otherwise it sets the pause. In `skipReason`, after the newer/answered check: the pause, then owner follows, then the window and the limit. `createInstagramContext` now runs before `skipReason`, because the follow read needs the token.
- `lib/meta/client.ts`: `getBusinessFollowsUser(token, igsid)` reads `is_business_follow_user`. It shares a reader with `getUserFollowStatus`, which still asks only for `is_user_follow_business`. Same host and path as before (`instagramGraphBase()`, `/{igsid}`). The provider wrapper `getBusinessFollowsUser({ context, recipientId })` in `lib/instagram/read-analytics.ts` returns null for Zernio. The reply job skips only on `true`, so `false`, `null` and errors all get an answer.

**Deviations and choices**

- **A separate read, not one extended call.** The follow gate's request stays byte-for-byte the same, so a field Meta might reject can't change the gate. Cost: one more Graph call per AI answer. A test pins both requests' `fields` under both login modes.
- **The bot-sent hash fallback is not checked.** The job carries only the message ID, as the spec says, so a bot send that Meta returned without a `message_id` (stored as `bot_sent:h:<hash>`) would pause the AI. Meta returns `message_id` on successful sends, and the bot's sends are tracked with it. Upgrade if an unexpected pause ever shows up: carry the echo's text and timestamp, then check the hash for that minute and the next.
- **Inbox reply uses `after()`.** `pauseAi` is a Redis write that isn't awaited. On Vercel, a write still pending when the response goes out can be lost when the function freezes. `after(pauseAi(...))` keeps the function alive until the write lands, without delaying the response or hanging it if Redis is unreachable. The inbox send already goes through the tracked `sendDirectMessage`, so its echo counts as bot-sent, and the route's own pause is what covers the inbox. META accounts only.
- **`write()` in bot-sends now returns its promise** (it never rejects). The existing recorders still don't return or await it, so the nudge and tracking behave as before.
- **The unknown-job-name test** used `ai-echo` as its "unknown" name. It now uses `ai-unknown`.
- **Tests.** The worker seam (`__tests__/dm-worker.test.ts`, "human takeover" block) covers: a human echo pauses for 12 h and expires; the AI's own answer and a campaign DM are not counted (both recorded through the real tracked send); a template echo is not counted; an inbox reply through the real route handler pauses; a failed inbox send does not pause; the owner follows → skipped; `false` or `null` → answered. The webhook seam covers META intake queuing delayed `ai-echo` jobs (text and template echoes), and Zernio intake queuing none.
- **Not verified live:** what an Instagram echo of a button or generic template looks like (assumed to be `attachments[].type === "template"`; the bot-sent ID check covers these sends anyway), whether the echo `mid` equals the send API's `message_id`, and `is_business_follow_user` under a Unified-login SYSTEM_USER token.
