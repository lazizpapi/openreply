# 04: Nudge, resending the pending button on a yes-word

**What to build:** OpenReply remembers which campaign button each follower has been sent but not tapped (the pending button). When that follower types a yes-word instead of tapping, OpenReply resends the owner's original message and button unchanged, at most once a minute. This works whether or not the AI assistant exists or is on. META accounts only.

See the spec, "Implementation Decisions → Bot-send tracking" and "→ Nudge".

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [x] **Tracking wrapper.** The send layer's DM-sending exports gain a thin wrapper. Callers keep the same names, and the untracked originals stay internal.
  - Private-reply callers pass the follower's ID.
  - After a successful send, the Meta message ID is recorded as bot-sent in Redis for 24 hours. If no ID comes back, a hash of follower, text and minute is recorded instead.
- [x] **Recording the pending button.** After a postback-button send (opening DM button, follow-gate button), the follower's pending button is stored in Redis for 24 hours: campaign, exact text, button title, payload, and whether it was a private reply or a DM.
- [x] **Clearing the pending button.** It is cleared when:
  - a link-button DM goes to that follower
  - a postback from that follower is processed (before the postback logic runs)
- [x] **No send impact.** Tracking never delays or fails a send, and is skipped silently without Redis.
- [x] **Message job order:** existing campaign keyword match first (unchanged), then the nudge, then nothing else yet. This is the hook point the AI assistant will use.
- [x] **Yes-words:** after trimming and lower-casing, `ha`, `xa`, `ҳа`, `да`, `yes`, `+`, `ok`, `👍` or `❤️`, including repeated letters (`haaa`, `daaa`, `++`). `haha`, and any message with other words, doesn't count.
- [x] **Resend.** A yes-word plus a pending button plus no nudge in the last 60 seconds (Redis NX) leads to the stored text and button being resent as a normal DM with a button, through the tracked send.
- [x] Worker tests cover:
  - the yes-word list and the `haha` exclusion
  - the throttle
  - the unchanged resend
  - no nudge without a pending button
  - clearing on postback and on link send
  - campaign keyword winning over the nudge
- [x] The yes-word matcher has its own leaf test.
- [x] `npm test`, `npm run typecheck`, `npm run lint` and a build with placeholder env pass.

## Comments

Implementation notes and deviations (agent, ticket 04):

- **Redis keys** (all in `lib/instagram/bot-sends.ts`, the contract ticket 06 reads):
  - `bot_sent:<metaMessageId>` = `1`, 24 h. Without a message ID: `bot_sent:h:<sha256 of [followerId, text, minute]>`.
  - `pending_button:<instagramAccountId>:<followerId>` = JSON `{campaignId, text, buttonTitle, payload, via: "private_reply" | "dm"}`, 24 h.
  - `nudge:<instagramAccountId>:<followerId>` = `1`, 60 s, set with NX.
- **Writes are fire-and-forget**, not awaited. ioredis here uses `maxRetriesPerRequest: null`, so an awaited write against an unreachable Redis would hang the caller forever. Commands on the one shared connection still run in order, so a postback's clear always lands before any pending button its own logic records.
- **Skipped without Redis** means skipped when `REDIS_URL` is unset (as in tests), plus a try/catch around every write.
- **Campaign ID** in the pending button is read from the payload (`reveal:<id>…` / `followcheck:<id>…`), so callers' signatures only gain `recipientId` on the three private-reply sends.
- **Link-button clearing** covers both link-button sends: the DM and the private reply. A private reply lands in the follower's DMs too, and user story 18 says no nudges after the lead magnet.
- **Read fallback does not clear.** The opening-DM read fallback is enqueued as a postback job (`fallback: true`) but is no tap. Clearing on it would drop the pending button of exactly the follower who read it and might type "ha" instead. Real taps and follow re-checks clear.
- **Latin `da`/`daaa` counts as a yes-word** as well as Cyrillic `да`, because the spec's own example `daaa` is Latin. Cyrillic `ха` and `ок` (typed on a Russian keyboard layout) count too, since commit caa8113.
- **Extra guard:** no nudge when the pending button's campaign is no longer live (or belongs to another account), since tapping that button would do nothing. This uses the stored campaign ID.
- **Nudge failures are silent:** a failed lookup or send is logged and the job ends normally (no BullMQ retry 5 minutes later). The nudge spends no workspace DM quota, like the follow-prompt resend after a tap.
- **Hook point:** `processMessage` ends with `if (campaignMatched) return; if (await sendNudge(job.data)) return;` followed by the AI-assistant hook comment. A yes-word with no pending button reaches the hook (a throttled one no longer does, see the review fix below).
- Not handled: a lead magnet delivered as plain text (campaign without tracked links, or the inline-link fallback after a template rejection) does not clear the pending button. A tap still clears it.

Review fix (agent, after ticket 07):

- **A throttled yes-word ends silently.** When the follower has a pending button but the 60-second `nudge:` claim fails, `sendNudge` now returns `true`, so the message never reaches the AI assistant. A yes-word with no pending button still goes to the AI. Tests: the "AI assistant" block in `__tests__/dm-worker.test.ts`.
