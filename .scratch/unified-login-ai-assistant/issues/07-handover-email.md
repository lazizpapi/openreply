# 07: Handover with an email to the owner

**What to build:** When the AI assistant isn't sure, or its draft contains a link that isn't written in the AI instructions, it hands over:
1. The follower gets a fixed "I'll answer this myself soon" text in their language.
2. The AI goes silent in that chat for 12 hours.
3. The workspace owner gets one email from the owner's domain with the follower's username and their last message.

See the spec, "Implementation Decisions → AI assistant (guards)" and "→ Email".

**Blocked by:** 06 (Human takeover; handover reuses its 12-hour pause)

**Status:** ready-for-agent

- [ ] **Link guard.** Every URL in the model's reply must appear verbatim in the AI instructions. Otherwise the reply becomes a handover.
- [ ] **Triggers.** `handover: true` from the model, or a link-guard failure, sends the fixed handover text. The text exists in uz-latn, uz-cyrl, ru and en, and "other" uses uz-latn. It goes through the tracked DM send and is stored as an ASSISTANT message.
- [ ] **After the text:** the 12-hour pause is set and the owner email is sent. Because a handover only happens while no pause is active, the owner gets at most one email per follower per 12 hours.
- [ ] **Owner-email helper:**
  - With `EMAIL_SERVER` set, it uses Nodemailer.
  - Otherwise it uses Resend's REST API through `fetch` with `RESEND_API_KEY` and `EMAIL_FROM`. No new dependency.
  - The recipient is the workspace owner's user email.
  - Failures are logged, never thrown.
  - With no email configuration, the handover still happens without the email.
- [ ] **Email content:** the follower username, resolved the way campaigns resolve it today, and the last USER message text.
- [ ] Worker tests cover:
  - a model handover leads to the fixed text, the pause and one email
  - an unknown link leads to a handover, and a link from the instructions is sent normally
  - a second unsure message inside 12 hours: no reply, no email
  - email failure doesn't break the handover
- [ ] The URL guard has its own leaf test.
- [ ] `npm test`, `npm run typecheck`, `npm run lint` and a build with placeholder env pass.

## Comments
