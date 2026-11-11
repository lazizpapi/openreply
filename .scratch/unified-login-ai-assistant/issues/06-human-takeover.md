# 06: Human takeover silences the AI for 12 hours

**What to build:** When the owner replies to a follower personally, from the Instagram app or from OpenReply's inbox, the AI assistant stays silent in that chat for 12 hours. Campaign messages and the AI's own messages never count as the owner replying. The AI also never answers followers the owner follows. META accounts only.

See the spec, "Implementation Decisions → Human takeover" and the owner-follows skip under "→ AI assistant".

**Blocked by:** 01 (Unified login: this ticket also edits the Meta client and webhook code it reshapes), 05 (AI assistant core)

**Status:** ready-for-agent

- [ ] **Echo intake.** For META accounts, webhook intake handles echo messages instead of dropping them. Each one enqueues an `ai-echo` job delayed 15 seconds, carrying the account, follower (the echo's recipient), message ID and whether it is a template. Zernio behaviour is unchanged.
- [ ] **The `ai-echo` job:**
  - a message ID recorded as bot-sent: ignored
  - a template or button echo: ignored
  - anything else: a 12-hour AI pause for that follower (Redis key with a TTL)
- [ ] **Job routing.** The dispatcher routes `ai-echo` explicitly.
- [ ] **Inbox reply.** The OpenReply inbox reply route sets the same 12-hour pause after a successful send.
- [ ] **Pause check.** The reply job skips silently while the pause is active.
- [ ] **Follower profile.** The follower-profile read also returns `is_business_follow_user`, and the follow gate's existing behaviour is unchanged. The reply job skips when the owner follows the follower. Unknown means "not followed".
- [ ] **Tests:**
  - webhook tests: echoes yield delayed `ai-echo` jobs for META only
  - worker tests: bot ID ignored, template ignored, human echo pauses, paused chat skipped, inbox reply pauses, owner-follows skip, unknown follow status still answered
- [ ] `npm test`, `npm run typecheck`, `npm run lint` and a build with placeholder env pass.

## Comments
