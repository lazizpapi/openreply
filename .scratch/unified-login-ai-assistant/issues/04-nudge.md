# 04: Nudge, resending the pending button on a yes-word

**What to build:** OpenReply remembers which campaign button each follower has been sent but not tapped (the pending button). When that follower types a yes-word instead of tapping, OpenReply resends the owner's original message and button unchanged, at most once a minute. This works whether or not the AI assistant exists or is on. META accounts only.

See the spec, "Implementation Decisions → Bot-send tracking" and "→ Nudge".

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] **Tracking wrapper.** The send layer's DM-sending exports gain a thin wrapper. Callers keep the same names, and the untracked originals stay internal.
  - Private-reply callers pass the follower's ID.
  - After a successful send, the Meta message ID is recorded as bot-sent in Redis for 24 hours. If no ID comes back, a hash of follower, text and minute is recorded instead.
- [ ] **Recording the pending button.** After a postback-button send (opening DM button, follow-gate button), the follower's pending button is stored in Redis for 24 hours: campaign, exact text, button title, payload, and whether it was a private reply or a DM.
- [ ] **Clearing the pending button.** It is cleared when:
  - a link-button DM goes to that follower
  - a postback from that follower is processed (before the postback logic runs)
- [ ] **No send impact.** Tracking never delays or fails a send, and is skipped silently without Redis.
- [ ] **Message job order:** existing campaign keyword match first (unchanged), then the nudge, then nothing else yet. This is the hook point the AI assistant will use.
- [ ] **Yes-words:** after trimming and lower-casing, `ha`, `xa`, `ҳа`, `да`, `yes`, `+`, `ok`, `👍` or `❤️`, including repeated letters (`haaa`, `daaa`, `++`). `haha`, and any message with other words, doesn't count.
- [ ] **Resend.** A yes-word plus a pending button plus no nudge in the last 60 seconds (Redis NX) leads to the stored text and button being resent as a normal DM with a button, through the tracked send.
- [ ] Worker tests cover:
  - the yes-word list and the `haha` exclusion
  - the throttle
  - the unchanged resend
  - no nudge without a pending button
  - clearing on postback and on link send
  - campaign keyword winning over the nudge
- [ ] The yes-word matcher has its own leaf test.
- [ ] `npm test`, `npm run typecheck`, `npm run lint` and a build with placeholder env pass.

## Comments
