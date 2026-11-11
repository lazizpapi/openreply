# Spec: Unified login, nudge, and AI DM assistant

Status: ready-for-agent

Vocabulary follows `GLOSSARY.md` (owner, follower, campaign, live campaign, keyword, lead magnet, opening DM, follow gate, pending button, nudge, yes-word, AI assistant, AI instructions, bot notice, human takeover, handover, daily AI limit, Unified login, Instagram login, messaging window).

## Problem Statement

The owner makes Instagram content and promises a lead magnet to anyone who comments a keyword. They want comment-to-DM automation they host and control, for about $10 a month, without a registered business.

Three things stand in the way:

1. **The owner can't connect Instagram at all.** Meta stopped offering Instagram login to apps created from October 2026 onward. New apps get only Unified login. OpenReply supports only Instagram login, so a new Meta app can't connect.
2. **Followers type instead of tapping.** Many followers answer the opening DM by typing "ha", "да" or "+" instead of tapping its button. Nothing happens, and the follower never gets the lead magnet.
3. **Other DMs go unanswered.** Followers also DM questions that match no campaign ("salom", "qo'llanma qayerda?", "narxi qancha?"). The owner can't answer all of them quickly, but doesn't want a bot speaking for them in public comments or inventing facts.

## Solution

1. **Unified login.** OpenReply can connect an Instagram account through Unified login when the owner configures a Meta login configuration. The account is found automatically where Meta allows. Where Meta hides it, the owner can name the account by its Instagram account ID. Instagram login keeps working unchanged for anyone who doesn't configure Unified login.
2. **Nudge.** When a follower who has a pending button types a yes-word, OpenReply resends the owner's original message and button. This works whether or not the AI assistant is on.
3. **AI assistant, for DMs only.** When a follower's text DM or text story reply matches no campaign, the AI assistant can answer it.
   - It answers in the follower's language.
   - It says only what the owner wrote in the AI instructions, plus which keywords the owner's live campaigns respond to.
   - It never writes comments.
   - It never sends lead magnet links, so nobody can skip a follow gate.
   - It hands a chat over to the owner when it isn't sure.
   - It goes silent when the owner replies personally.
   - It stops at the daily AI limit.

   The owner turns it on, writes the AI instructions, and tests answers in an "AI assistant" panel in Settings. It stays off until a Claude API key is configured.

## User Stories

### Connecting Instagram (Unified login)

1. As the owner, I want to connect my Instagram account through Meta's Unified login, so that I can use a Meta app created after October 2026.
2. As the owner, I want the connect button to open Meta's Facebook Login for Business dialog for my login configuration, so that I grant exactly the permissions the configuration lists.
3. As the owner, I want OpenReply to find my Instagram account automatically after login, so that I don't need to look up IDs.
4. As the owner, I want to name my Instagram account ID in the configuration when Meta hides the account from the login, so that connecting still works without Business Verification.
5. As the owner, I want OpenReply to check that the account ID I named is actually reachable with the granted access, so that a typo fails loudly instead of connecting the wrong account.
6. As the owner, I want a clear message when no Instagram account could be found, so that I know to set the account ID.
7. As the owner, I want my connection to never need a token refresh, so that the automation doesn't die if a daily refresh job fails.
8. As the owner, I want comments, DMs, replies, the follow gate and the comment poller to work the same through Unified login as through Instagram login, so that nothing else changes for me.
9. As someone running OpenReply with Instagram login, I want nothing to change unless I configure Unified login, so that my working setup isn't broken.
10. As the owner, I want account-lookup attempts logged with IDs and usernames only, never tokens, so that I can debug a failed connection safely.

### Nudge

11. As a follower who typed "ha" instead of tapping the button, I want to get the button again, so that I can still receive the lead magnet.
12. As a follower, I want "ha", "xa", "ҳа", "да", "yes", "+", "ok", 👍 and ❤️ to count, including stretched forms like "haaa", so that my natural answer works.
13. As a follower who wrote "haha", I want it not to count as yes, so that I don't get a confusing resend.
14. As the owner, I want the nudge to resend my own original message and button unchanged, so that the wording and language stay mine.
15. As the owner, I want at most one nudge per follower per minute, so that a follower typing "+" repeatedly doesn't get spammed.
16. As the owner, I want the nudge to work with the AI assistant off, so that campaigns improve even without an AI key.
17. As a follower who tapped the button, I want the pending button to clear, so that a later "ok" doesn't resend it.
18. As a follower who already received the lead magnet link, I want no further nudges, so that the chat stays clean.

### AI assistant: when it answers

19. As a follower, I want my text DM that matches no campaign to get an answer, so that I'm not ignored.
20. As a follower, I want my text reply to the owner's story to get an answer when it matches no campaign, so that story conversations work too.
21. As the owner, I want a campaign keyword to always win over the AI assistant, so that lead magnets are delivered by the campaign and never by the AI.
22. As the owner, I want a nudge to take priority over the AI assistant, so that a yes-word resends the button instead of starting an AI chat.
23. As the owner, I want the AI assistant to stay silent on voice notes, photos, videos, stickers, shared posts, story mentions and story emoji reactions, so that it never guesses at content it can't read.
24. As the owner, I want the AI assistant never to reply to accounts I follow, so that friends and brand partners get only me.
25. As the owner, I want the AI assistant to reply normally when Instagram doesn't report whether I follow someone, so that one missing field doesn't silence it.
26. As a follower who sends "salom", then "savolim bor", then my question, I want one answer to all three, so that I don't get three half-answers.
27. As the owner, I want the AI assistant to wait 10 seconds after the follower's last message before answering, so that it sees the whole thought.
28. As the owner, I want the AI assistant to answer each incoming message at most once, so that duplicate webhooks never cause duplicate replies.
29. As the owner, I want the AI assistant to answer only inside the messaging window, so that OpenReply never breaks Meta's 24-hour rule.
30. As the owner, I want the AI assistant to never comment on posts or reels, so that nothing public is ever said in my name by a bot.

### AI assistant: what it says

31. As a follower, I want answers in my language (Uzbek Latin, Uzbek Cyrillic, Russian or English), so that I understand them.
32. As a follower writing in another language, I want an answer in Uzbek Latin, so that I still get a reply.
33. As the owner, I want the AI assistant to state only facts from my AI instructions, so that it never invents prices, links, dates or promises.
34. As the owner, I want the AI assistant to know my live campaigns' names and keywords automatically, so that it can tell followers which keyword to type without me updating the AI instructions for each reel.
35. As the owner, I want the AI assistant to mention only keywords of live campaigns with the DM trigger on, so that the keyword it suggests actually works in DMs.
36. As the owner, I want the AI assistant never to send lead magnet links, so that nobody skips a follow gate.
37. As the owner, I want links in the AI instructions (such as my Telegram channel) to be shareable as written, so that the AI assistant can point people to my other channels.
38. As a follower, I want the first AI reply to start with "🤖 Bu avtomatik yordamchi." (or "🤖 Это автоматический ассистент." in Russian), so that I know I'm talking to an assistant.
39. As the owner, I want the bot notice repeated only if the AI assistant hasn't written to that follower in 30 days, so that regulars aren't told every time.
40. As a follower, I want answers without Markdown symbols, so that they read cleanly in Instagram.
41. As a follower, I want a long answer split into at most 3 messages at natural breaks (paragraph, then sentence, then word), so that nothing is cut off mid-word, emoji or letter.
42. As the owner, I want every message to fit Instagram's 1000-byte limit even in Cyrillic, so that no send fails.
43. As the owner, I want the AI assistant to keep to its rules when a follower argues, pleads or claims I approved an exception, so that it can't be talked into breaking them.

### AI assistant: when it stops

44. As the owner, I want the AI assistant to hand over when it isn't sure: tell the follower I'll reply personally, then stay silent in that chat for 12 hours, so that I can step in.
45. As the owner, I want an email from my own domain when the AI assistant hands over, with the follower's username and their message, so that I don't miss it.
46. As the owner, I want at most one handover email per follower every 12 hours, so that my inbox isn't flooded.
47. As the owner, I want the AI assistant to stay silent in a chat for 12 hours after I reply from the Instagram app, so that we never talk over each other.
48. As the owner, I want the same 12-hour silence after I reply from OpenReply's inbox, so that both ways of replying count.
49. As the owner, I want campaign messages and AI replies not to count as me replying, so that the bot doesn't silence itself.
50. As the owner, I want a daily AI limit (100 by default, changeable), so that a spam wave can't run up costs.
51. As the owner, I want one AI answer to count once toward the limit even if it's split into several messages, so that the limit means answers.
52. As the owner, I want the daily count to reset at midnight Tashkent time, so that "today" matches my day.
53. As the owner, I want the AI assistant to stay silent when the limit is reached, so that followers aren't told about internal limits.
54. As the owner, I want the AI assistant to stay silent if the AI provider fails or declines a request, so that a provider problem never breaks campaigns or sends a broken message.

### Settings panel

55. As the owner, I want an "AI assistant" panel in Settings for each connected Instagram account, so that I control the assistant in one place.
56. As the owner, I want an on/off switch, so that I can stop the assistant instantly.
57. As the owner, I want an AI instructions box pre-filled with an Uzbek template with blanks (who I am, what I make, how to reach me), so that I know what to write.
58. As the owner, I want to set the daily AI limit, so that I control cost.
59. As the owner, I want to see how many AI answers were sent today, so that I know whether the limit is close.
60. As the owner, I want a "Try it" box where I type a message and see the AI answer without anything going to Instagram, so that I can tune my AI instructions safely.
61. As the owner, I want the panel to say clearly when no Claude API key is configured, so that I know why the assistant can't be turned on.
62. As a workspace member without owner or admin rights, I want to be unable to change AI settings, so that only the owner's team controls them.

### Data and privacy

63. As the owner, I want DM texts the AI assistant uses kept for 30 days and then deleted automatically, so that I don't hoard followers' messages.
64. As the owner, I want only the last 10 messages of a chat sent to the AI provider, so that as little data as possible leaves my system.
65. As a follower, I want the privacy page to say that DMs may be processed by an AI provider, so that I'm informed.
66. As the owner, I want the Claude API key kept in server configuration only, never in the database or the browser, so that it can't leak through the app.

## Implementation Decisions

### General

- New code lives in its own modules (a Unified-login module beside the Meta client, and an AI module). Upstream files get only small hooks, so pulling upstream stays easy. If upstream ships Unified login, ours is dropped in favour of theirs.
- **Nudge and AI assistant apply to META-provider accounts only.** The Zernio path is untouched.
- New UI text is English and doesn't go through `t()`. This is a shortcut: every new `t()` key must be added to three catalogs. Upgrade if the panel is ever upstreamed.
- New environment variables, all optional, all documented in `.env.example`:
  - `META_LOGIN_CONFIG_ID`: turns on Unified login.
  - `META_INSTAGRAM_ACCOUNT_IDS`: comma-separated Instagram account IDs for the lookup fallback.
  - `ANTHROPIC_API_KEY`: turns the AI assistant on. It's needed on the worker, and on the web app for the "Try it" box.
- No new variable becomes part of the core env validation. A missing variable turns its feature off; it never crashes the app.
- The worker now also needs `RESEND_API_KEY` and `EMAIL_FROM` (or `EMAIL_SERVER`) to send handover emails.

### Unified login

Ported from henacosta1/openreply `6f7a02a`, reviewed rather than copied blindly.

- **Switch.** When `META_LOGIN_CONFIG_ID` is set, the connect flow builds a Facebook Login for Business authorization URL on facebook.com: `client_id` = Meta App ID (still read from `INSTAGRAM_APP_ID`), `config_id`, `redirect_uri`, `state`, `response_type=code`, `override_default_response_type=true`, and no `scope`. The existing signed-state helpers are reused unchanged.
- **Code exchange.** The code is exchanged on graph.facebook.com for a SYSTEM_USER token. There is no long-lived exchange. The account is stored with a null token expiry, so the existing refresh cron skips it with no change to the cron.
- **Graph calls.** For Unified-login accounts, every Graph call (reads, sends, private replies, follow status, webhook subscription) goes to graph.facebook.com, with the Instagram account ID in the path instead of `/me`.
  - The META variant of the Instagram context gains the account ID and which login mode the account uses.
  - The base-URL choice lives in one place in the Meta client.
  - Instagram-login accounts keep today's hosts and paths exactly.
- **Account lookup.** After the code exchange, the account is found by trying these in order:
  1. assigned Instagram accounts of the token user
  2. the token's granular-scope target IDs (via `debug_token`)
  3. the user's businesses and their Instagram accounts
  4. the user's pages and their linked Instagram business accounts
  5. the IDs in `META_INSTAGRAM_ACCOUNT_IDS`, each verified with a `/{id}?fields=id,username` read using the token

  The first strategy that returns accounts wins. Each attempt logs counts, IDs and usernames, never tokens. IG User IDs (`1784…`) are preferred over 15-digit asset IDs.
- **Several accounts.** One login can return several accounts. Each is upserted through the existing connect checks.
- **No account found.** If nothing is found, the callback redirects to Settings with a "no Instagram account assigned" error that names `META_INSTAGRAM_ACCOUNT_IDS`.
- **Webhook subscription.** It stays non-fatal, as today. For Unified-login accounts it requests `comments`, `messages`, `messaging_postbacks` and `messaging_seen`. The Meta dashboard subscription (done by the owner in the wizard) remains the source of truth.
- The commit's `connect-assigned-accounts` script isn't ported.

### Bot-send tracking (shared by nudge and human takeover)

- The send layer's DM-sending exports get a thin tracking wrapper. Callers keep the same function names; the untracked originals stay internal.
- Callers supply the follower's ID where the recipient is a comment, which means private replies.
- **After every successful send**, the wrapper records the Meta message ID in Redis for 24 hours as "sent by the bot". If Meta returns no message ID, it falls back to a hash of the follower, the text and the minute.
- **After a postback-button send** (opening DM button, follow-gate button), the wrapper stores that follower's **pending button** in Redis for 24 hours: campaign ID, the exact message text, button title and payload, and whether it was sent as a private reply or a DM.
- **The pending button is cleared** when:
  - a link-button DM (the lead magnet) is sent to that follower
  - any postback from that follower is processed (cleared before the postback job runs its logic)
- Recording never delays or fails a send. Writes are best-effort, and are skipped silently when Redis isn't configured (tests).

### Nudge

- In the DM worker's message job, the order is:
  1. existing campaign keyword matching (unchanged; a match ends the job)
  2. nudge
  3. AI assistant

  A campaign with "match any word" and the DM trigger on keeps swallowing every DM, as today.
- **Yes-words.** A message is a yes-word when, trimmed and lower-cased, it is one of `ha`, `xa`, `ҳа`, `да`, `yes`, `+`, `ok`, `👍` or `❤️`, allowing repeated letters (`haaa`, `daaa`, `++`). `haha` and anything with other words doesn't count.
- **Nudge.** If the follower has a pending button and no nudge was sent to them in the last 60 seconds (Redis NX key), the stored message and button are resent unchanged as a normal DM with a button. The follower just wrote, so the messaging window is open. The resend goes through the tracked send, so the pending button stays recorded.
- A yes-word with no pending button falls through to the AI assistant.

### Human takeover

- **Webhook intake** (META only) starts handling echo messages instead of dropping them. Each echo enqueues an `ai-echo` job, delayed 15 seconds so the bot-send record exists by then. The job carries the account, the follower (the echo's recipient), the message ID and whether the echo is a template.
- **The `ai-echo` job:**
  - A message ID recorded as bot-sent is ignored.
  - A template or button echo is ignored, as bot-sent.
  - Anything else is the owner replying from the Instagram app: it sets a 12-hour AI pause for that follower (Redis key with a TTL).
- **Inbox replies.** The OpenReply inbox reply route sets the same 12-hour pause after a successful send.
- **Job routing.** The worker's job dispatcher gets explicit routes for every new job name. Unknown names currently fall through to the comment handler, so this is required.

### AI assistant

**Entry point.** One function, called by the message job when no campaign matched and no nudge was sent. It takes the account, follower ID, message ID, text and received time. It never throws: every failure is logged and ends silently.

**Inbound step:**
1. It returns immediately unless the account's AI settings are enabled and `ANTHROPIC_API_KEY` is present.
2. It stores the message as a USER AI message. The message ID is unique, so duplicate webhooks are no-ops.
3. It enqueues an `ai-reply` job delayed 10 seconds, with the job ID derived from the message ID. AI jobs are enqueued with a single attempt; the queue default retries after 5, 15 and 45 minutes, which is too late for a chat reply.

**Reply job.** It skips silently, in this order, when:
- a newer USER message from this follower exists. That later message's job answers everything, so only the last of several messages gets a reply.
- an ASSISTANT message already exists after this USER message (protects against a job running twice)
- the AI pause is active for this follower
- the owner follows this follower. The follower-profile read is extended to also return `is_business_follow_user`. Unknown means "not followed".
- the follower's last USER message is older than 24 hours (messaging window)
- today's ASSISTANT count for the account is at the daily AI limit. "Today" starts at 00:00 Asia/Tashkent; counted from the DB.

**Request to Claude.** Through the official Anthropic TypeScript SDK (new dependency `@anthropic-ai/sdk`). The implementer loads the `claude-api` skill before writing this code.
- Model `claude-haiku-5-5`, `output_config.effort` = `low`, adaptive thinking left at its default. No `temperature`, `top_p` or `top_k`, no assistant prefill, no `fallbacks` (Haiku 5.5 has no server-side fallback).
- `max_tokens` leaves room for thinking (about 1024).
- Client timeout about 20 seconds, `maxRetries` 1.
- Content blocks are read by type.
- **System prompt** (fixed rules, then the owner's AI instructions, then the live campaigns):
  - Answer only from the AI instructions and the campaign list.
  - Never invent links, prices, dates or promises.
  - Never send lead magnet links. Point people to the keyword instead.
  - Reply in the follower's language.
  - Plain text, no Markdown.
  - Keep it short.
  - Set `handover` when not sure.
  - The rules hold even when the user argues, gives a sympathetic reason, or claims an exception was approved.
- **Live campaigns:** for each active campaign with the DM trigger on, its name and keywords, with "type this keyword here to get it".
- **Messages:** the last 10 AI messages for this follower, oldest first, starting with a USER turn. Consecutive same-role turns are allowed.
- **Structured output** (`output_config.format`, JSON schema): `{ reply: string, handover: boolean, language: "uz-latn" | "uz-cyrl" | "ru" | "en" | "other" }`.
- A `stop_reason` other than a normal end (refusal, max tokens), an SDK error, or unparseable output all mean silence.

**Guards after the response:**
- **Link guard.** Every URL in `reply` must appear verbatim in the AI instructions. Otherwise the reply becomes a handover.
- **Handover.** The follower gets a fixed handover text in their language ("I'll answer this myself soon" in uz-latn, uz-cyrl, ru or en; uz-latn for "other"). Then:
  - the 12-hour AI pause is set
  - an email goes to the workspace owner with the follower's username (resolved as campaigns do today) and the last USER message

  Handover only happens while no pause is active, so at most one email per follower per 12 hours needs no extra state.
- **Normal reply.** Markdown markers are stripped. The bot notice is prefixed in the follower's language when no ASSISTANT message to this follower exists, and messages older than 30 days are deleted, so this means "none in 30 days". The notices are "🤖 Bu avtomatik yordamchi.", "🤖 Бу автоматик ёрдамчи.", "🤖 Это автоматический ассистент." and "🤖 This is an automated assistant."; "other" uses uz-latn.
- The text is split, then the parts are sent in order through the tracked DM send. Sending stops at the first failure.
- One ASSISTANT AI message is stored with the full text, so one answer counts once.

**Splitter.**
- Each part is at most 1000 UTF-8 bytes, with at most 3 parts.
- It breaks at paragraph, then sentence, then word boundaries, and never inside a grapheme (`Intl.Segmenter`).
- If the text still doesn't fit, the third part is cut and ends with "…".

**Language.** The model reports the language. "other" or a missing value uses uz-latn texts.

### Data model

Appended to the Prisma schema. Upstream models are untouched apart from back-relations.
- **AiSettings:** one per Instagram account (unique, cascades on account delete): `enabled` (default false), `instructions` (text), `dailyLimit` (default 100), timestamps.
- **AiMessage:** Instagram account (cascade), follower ID, role enum `AiMessageRole` (USER, ASSISTANT), text, message ID (unique, nullable; set for USER), created time. Indexes on (account, follower, created) and on created.
- **Pause, pending button, bot-sent IDs and nudge throttle** live in Redis with TTLs, not the DB.
- **Migration:** a new timestamped folder in the repo's migration convention, generated with `prisma migrate diff` against the previous schema (the repo has no `migrate dev` script). It is applied by the existing deploy migration step.
- **Retention:** the worker's periodic loop deletes AI messages older than 30 days.

### Settings panel and API

- **Panel.** A new extracted panel component, in the same style as the Zernio panel, placed in Settings after the Instagram section. It has an account picker when several META accounts are connected.
- **Controls:**
  - on/off switch (disabled with an explanation when no key is configured)
  - AI instructions box, pre-filled with the Uzbek starter template when the account has no settings yet
  - daily limit
  - today's count
  - "Try it" box
- **Routes**, all owner or admin only (current workspace context plus the manage-workspace role check, Origin check on writes, zod body validation, responses `{success, data | error}`):
  - GET settings for an account: settings, `keyConfigured`, `todayCount`
  - PUT settings: refuses `enabled: true` without a key, and checks the account belongs to the workspace
  - POST try: runs the same prompt build and Claude call for one typed message, with no history, no send, no storage and no counting. It returns the reply text (or the handover text) plus whether it was a handover.
- The key is read from server env only and never returned.

### Email

- A small owner-email helper mirrors the auth email setup: if `EMAIL_SERVER` is set, it uses Nodemailer; otherwise it calls Resend's REST API with `fetch` using `RESEND_API_KEY` and `EMAIL_FROM`. No new dependency.
- The recipient is the workspace owner's user email.
- Failures are logged and never thrown.

### Privacy page

- The Subprocessors section adds Anthropic, with one sentence: DMs that match no campaign may be processed by an AI provider (Anthropic) to draft automatic replies, and are kept up to 30 days.
- The page's updated date is bumped.

### Provisioning wizard

The gitignored local script is updated:
- **Stage 4:**
  - Meta App ID for `INSTAGRAM_APP_ID`
  - one Meta App secret written to both `INSTAGRAM_APP_SECRET` and `FACEBOOK_APP_SECRET`
  - `META_LOGIN_CONFIG_ID`
  - optional `META_INSTAGRAM_ACCOUNT_IDS`
- **Stage 5 env blocks:**
  - the new variables on Vercel and Railway
  - `ANTHROPIC_API_KEY` on both
  - Resend variables on the worker
  - `NEXTAUTH_URL=https://go.lazizpapi.uz`
- **Stage 7:**
  - Unified login configuration steps (Instagram-accounts asset only, the four permissions, redirect URL)
  - webhook fields `comments`, `messages`, `messaging_postbacks` and `messaging_seen`
  - the `go.lazizpapi.uz` CNAME in Eskiz plus the Vercel domain

## Testing Decisions

- **What makes a good test here:**
  - Tests drive behaviour through the highest available seam and assert what a follower or owner would observe: which messages are sent with what text, whether a pause is set, whether an email goes out, what the API returns.
  - No assertions on internal call order or private helpers.
  - No network: Meta, Anthropic, Redis and Prisma are mocked at their module boundaries, the way the existing suites do it (`vi.hoisted` mock objects plus `vi.mock` of the DB client, Meta client, queue client and `bullmq`).
- **Seam 1, the DM worker job processor** (existing seam, prior art `dm-worker.test.ts`). It covers:
  - campaign-first ordering
  - nudge (yes-word list, `haha` exclusion, 60-second throttle, unchanged resend, cleared on postback and on link send)
  - `ai-echo` classification (bot ID, template, human leading to a pause)
  - `ai-reply` skip rules (newer message, already answered, paused, owner follows, window, daily limit)
  - handover (fixed text, pause, single email)
  - bot notice once per 30 days
  - link guard
  - silence on provider error or refusal
  - routing of the new job names

  The Claude call is mocked at the AI provider boundary.
- **Seam 2, webhook parsing and intake** (prior art `webhook.test.ts`): echo events now yield `ai-echo` jobs for META accounts with a 15-second delay; Zernio behaviour is unchanged.
- **Seam 3, Unified login** (prior art `oauth.test.ts`, `instagram-provider.test.ts`):
  - authorization URL shape in both modes
  - code exchange host
  - account lookup order 1 to 5, including configured-ID verification and IG User ID preference
  - Graph base and path selection per account mode
  - refresh skipping null-expiry accounts
- **Leaf tests** for pure functions whose edge cases are cheapest to pin directly:
  - splitter (Cyrillic and ʻ byte counts, emoji graphemes, 3-part cap with "…")
  - yes-word matcher
  - Markdown stripper
  - URL guard
  - Tashkent day start
- **AI provider:** one test pins the request shape (model `claude-haiku-5-5`, effort low, JSON schema present, no sampling parameters) and that non-end stop reasons and SDK errors return "no reply".
- **Settings routes:** GET, PUT and try handlers with a mocked workspace context. They check role enforcement, account-ownership enforcement, the enable-without-key refusal, and that the key never appears in responses.
- **Checks before any ticket is done:** `npm test`, `npm run typecheck`, `npm run lint`, and `next build` with placeholder env. The worker entry loads under `tsx`. Nothing runs against live Meta or Anthropic from this PC; the "Try it" box and the second-account test after deploy are the live checks.

## Out of Scope

- AI writing or replying to comments, in any form.
- AI providers other than Claude (no Gemini or OpenAI switch).
- AI reading voice notes, images or video.
- Marking AI-sent messages in OpenReply's inbox.
- Feeding campaign messages into the AI's chat history. The AI sees only its own chat with the follower, plus the live campaign list.
- A per-follower "never use AI" list (replying personally covers it for 12 hours).
- Changes to the Zernio provider path.
- Any change to how campaigns are configured.
- App Review, Business Verification or Advanced Access.

## Further Notes

- The owner sets a $5 monthly spend limit in the Anthropic Console. Expected cost is about $1 a month at 100 answers a day.
- The AI assistant uses Claude Haiku 5.5 (`claude-haiku-5-5`).
- Build order: Unified login first, then deploy and prove comment → DM → link with a follower who isn't a tester. Nudge and AI follow. The AI stays off in production until the owner adds a key.
- Basis for the Unified login work: henacosta1/openreply commit `6f7a02a`, plus the `META_INSTAGRAM_ACCOUNT_IDS` fallback described in the owner's friend's MASTER_PROMPT (account lookup order: assigned accounts, token debug target IDs, businesses, pages, then the configured IDs).
