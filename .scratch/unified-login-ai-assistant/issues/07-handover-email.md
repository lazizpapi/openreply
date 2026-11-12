# 07: Handover with an email to the owner

**What to build:** When the AI assistant isn't sure, or its draft contains a link that isn't written in the AI instructions, it hands over:
1. The follower gets a fixed "I'll answer this myself soon" text in their language.
2. The AI goes silent in that chat for 12 hours.
3. The workspace owner gets one email from the owner's domain with the follower's username and their last message.

See the spec, "Implementation Decisions → AI assistant (guards)" and "→ Email".

**Blocked by:** 06 (Human takeover; handover reuses its 12-hour pause)

**Status:** ready-for-agent

- [x] **Link guard.** Every URL in the model's reply must appear verbatim in the AI instructions. Otherwise the reply becomes a handover.
- [x] **Triggers.** `handover: true` from the model, or a link-guard failure, sends the fixed handover text. The text exists in uz-latn, uz-cyrl, ru and en, and "other" uses uz-latn. It goes through the tracked DM send and is stored as an ASSISTANT message.
- [x] **After the text:** the 12-hour pause is set and the owner email is sent. Because a handover only happens while no pause is active, the owner gets at most one email per follower per 12 hours.
- [x] **Owner-email helper:**
  - With `EMAIL_SERVER` set, it uses Nodemailer.
  - Otherwise it uses Resend's REST API through `fetch` with `RESEND_API_KEY` and `EMAIL_FROM`. No new dependency.
  - The recipient is the workspace owner's user email.
  - Failures are logged, never thrown.
  - With no email configuration, the handover still happens without the email.
- [x] **Email content:** the follower username, resolved the way campaigns resolve it today, and the last USER message text.
- [x] Worker tests cover:
  - a model handover leads to the fixed text, the pause and one email
  - an unknown link leads to a handover, and a link from the instructions is sent normally
  - a second unsure message inside 12 hours: no reply, no email
  - email failure doesn't break the handover
- [x] The URL guard has its own leaf test.
- [x] `npm test`, `npm run typecheck`, `npm run lint` and a build with placeholder env pass.

## Comments

Implementation notes and deviations (agent, ticket 07):

**Where things live**

- `lib/ai/reply-text.ts`:
  - `hasOnlyKnownLinks(reply, instructions)`: the link guard.
  - `shapeAnswer(answer, instructions)` returns `{ reply, handover }`. A model handover or a failed link guard gives the fixed handover text with `handover: true`. The worker's `processAiReply` and the "Try it" route both call it.
- `lib/email/owner-email.ts`: `sendOwnerEmail(to, subject, text)`.
- `lib/ai/assistant.ts`: `processAiReply` sends the handover text the way it sends any answer, then calls `handOver(...)`, which sets the pause and emails the owner.

**The four handover texts**

- uz-latn (and "other"): `Bunga tez orada oʻzim javob beraman.`
- uz-cyrl: `Бунга тез орада ўзим жавоб бераман.`
- ru: `Скоро отвечу на это лично.`
- en: `I'll answer this myself soon.`

Why: each is the spec's "I'll answer this myself soon". They are written in the owner's own voice, because the DM comes from the owner's account. The Russian says "лично" rather than "сам", so it works for an owner of either gender. The Uzbek Latin uses ʻ (U+02BB), as the starter template does.

**Deviations and choices**

- **The bot notice comes first on a handover too**, under the same rule as a normal reply (no ASSISTANT message to this follower in 30 days). The follower then knows the message is automatic: "🤖 Bu avtomatik yordamchi.\nBunga tez orada oʻzim javob beraman."
- **The link guard checks the reply after Markdown stripping**, not before as ticket 05's note suggested. That way it checks the text the follower gets. A Markdown link `[x](url)` becomes `x url` first, so its URL is checked either way.
- **What counts as a link:**
  - an email address
  - anything starting with `http://`, `https://` or `www.`
  - a bare domain with a path, such as `t.me/x`
  - a bare domain ending in a common TLD, such as `site.uz` (uz, com, ru, me, ai, io, org, net, app, dev, co, link, ly, gg, tv, info, site, online, store, shop, xyz, pro, ua, kz)

  Trailing punctuation is trimmed first. "Verbatim" means a case-sensitive substring of the AI instructions, so `t.me/lazizpapi` passes when the instructions contain `https://t.me/lazizpapi`. Since the review fix below, other words joined by a dot (`Node.js`, `Rahmat.Keyingi`) no longer count as domains.
- **Order:**
  1. the handover text goes out through the tracked DM send (split like any answer)
  2. it is stored as the ASSISTANT message
  3. the pause is set
  4. the email is sent

  The stored handover counts toward the daily AI limit, and Claude sees it in the history once the pause ends. If the handover text fails to send, nothing else happens: no row, no pause, no email. This matches a normal answer whose first part fails, and the follower's next message tries again.
- **The email:**
  - It goes to `Workspace.owner.email`. If the owner has no email, none is sent.
  - The username comes from `resolveRecipientName` (a stored DmLog name, else a live Graph read), as campaigns resolve it. Without one, it says `follower <IGSID>`.
  - Subject: `@name is waiting for your reply on Instagram`.
  - The body names the account (`@username`), the follower and their last USER message (the newest one, which the job is answering), and says the AI stays silent in that chat for 12 hours.
  - Plain text, in English.
- **Helper config:**
  - With `EMAIL_SERVER` set: `nodemailer.createTransport(EMAIL_SERVER)`.
  - Otherwise: Resend's REST API, and only when `RESEND_API_KEY` is set. The call times out after 10 seconds.
  - `from` is `EMAIL_FROM`, with the same default as `lib/auth.ts`.
  - SMTP keeps Nodemailer's default timeouts.
  - Failures are logged as `[Email] Owner email not sent:` and never thrown. The owner lookup and the name lookup are caught inside `handOver`, so the pause still holds.
- **"Try it" now shows the fixed handover text**, in the language Claude reported, instead of the model's own wording. It applies the link guard against the instructions as typed in the panel.
- **`.env.example`:** a comment notes that the worker uses the same email settings.

**Tests**

- Leaf: `hasOnlyKnownLinks` in `__tests__/ai-reply-text.test.ts`.
- Worker seam: the "handover" block in `__tests__/dm-worker.test.ts`, with `fetch` stubbed and `nodemailer` mocked. It covers:
  - the fixed text and one email with username, account and message
  - the four language texts
  - an unknown link hands over, and a link from the instructions is sent normally
  - a second message inside 12 hours gets no reply and no email, and after 12 hours the stored handover is in Claude's history with no second bot notice
  - Resend unreachable, Resend refusing, and the owner lookup failing all still hand over and pause
  - no email config: a handover without an email
  - `EMAIL_SERVER` sends through SMTP and not Resend
- Routes: "Try it" returns the fixed handover text, and runs the link guard against the typed instructions.

**Not verified live**

- a real Resend or SMTP send, and how the email looks in an inbox
- the worker entry itself (its modules were loaded under `tsx` with a placeholder `DATABASE_URL`)

Review fixes (agent, after ticket 07):

- **Link guard: dotted words pass.** Any bare `word.word` used to count as a domain, so "Next.js" or "Rahmat.Keyingi" caused a handover. Now a bare domain counts only with a `/` or a TLD from the list above. Emails and `http://`, `https://`, `www.` links count as before. Cost: a bare domain on a TLD outside the list (`site.de`) passes the guard. Tests: the `hasOnlyKnownLinks` cases in `__tests__/ai-reply-text.test.ts`.
- **Emoji-only DMs get no AI answer.** `handleAiMessage` skips a message with no letter or digit (`/[\p{L}\p{N}]/u`), such as "🔥", "❤️❤️" or "👍🏽": nothing is stored and no `ai-reply` job is queued. "salom 🔥" is answered as usual. Tests: the "AI assistant" block in `__tests__/dm-worker.test.ts`.
