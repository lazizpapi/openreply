# 08: AI assistant Settings panel, "Try it" box, and privacy page

**What to build:** Settings gets an "AI assistant" panel, shown after the Instagram section, with an account picker when several META accounts are connected. In it the owner can:
- switch the assistant on or off
- write the AI instructions (pre-filled with an Uzbek starter template that has blanks)
- set the daily AI limit
- see today's count of AI answers
- try a message in a "Try it" box, without anything going to Instagram

Only owners and admins can change anything. The privacy page says that DMs may be processed by an AI provider.

See the spec, "Implementation Decisions → Settings panel and API" and "→ Privacy page".

**Blocked by:** 05 (AI assistant core: needs the AI settings model and the prompt and Claude call)

**Status:** ready-for-agent

- [x] **GET settings** for an account returns the settings (or the defaults with the starter template), `keyConfigured` and `todayCount` (ASSISTANT messages since 00:00 Asia/Tashkent).
- [x] **PUT settings** saves `enabled`, `instructions` and `dailyLimit`, validated with zod. It refuses `enabled: true` without `ANTHROPIC_API_KEY`, and refuses accounts outside the workspace.
- [x] **POST try** runs the same prompt build, Claude call and guards for one typed message. There is no history, no send, no storage and no counting. It returns the reply text (or the handover text) and whether it was a handover.
- [x] **All three routes** use the current workspace context and the manage-workspace role check. Writes check Origin. Responses are `{success, data | error}`. The API key never appears in any response.
- [x] **Panel component** follows the Zernio panel's style. The switch is disabled with an explanation when no key is configured. Text is English without `t()`, which the spec records as a shortcut.
- [x] **Starter template:** Uzbek, with blanks for who the owner is, what they make, and how to reach them. It notes that lead magnet links belong in campaigns, not in the instructions.
- [x] **Privacy page.** The Subprocessors section adds Anthropic, with the spec's sentence (DMs that match no campaign may be processed to draft automatic replies, and are kept up to 30 days). The updated date is bumped.
- [x] Route tests cover role enforcement, account ownership, the enable-without-key refusal, `try` not sending or storing, and the key never being returned.
- [x] `npm test`, `npm run typecheck`, `npm run lint` and a build with placeholder env pass.

## Comments

Implementation notes and deviations (agent, ticket 08):

**Where things live**

- Routes, all owner or admin only, `{ success, data | error }`:
  - `GET /api/ai/settings?instagramAccountId=<account row ID>` returns `{ settings: { enabled, instructions, dailyLimit }, keyConfigured, todayCount }`. With no settings row yet: `enabled: false`, the starter template, `dailyLimit: 100`.
  - `PUT /api/ai/settings` with `{ instagramAccountId, enabled, instructions, dailyLimit }` returns `{ settings }`. It refuses `enabled: true` without `ANTHROPIC_API_KEY` (400). Saving with the switch off works without a key.
  - `POST /api/ai/try` with `{ instagramAccountId, instructions, message }` returns `{ reply, handover }`. No answer from Claude, or an empty reply, is a 502 with "Claude gave no answer…". Without a key it is a 400 and Claude isn't called.
- `lib/ai/route-handler.ts`: `withAiManagement` (sign-in 401, `canManageWorkspace` 403, Origin check on writes, unknown errors logged and answered with a generic 500), `findAiAccount` and the shared `aiInstructionsSchema` (at most 10,000 characters).
- `lib/zernio/route-handler.ts`: the Origin check moved, unchanged, into an exported `assertSameOrigin`, which both wrappers call. The AI routes also reuse `readBody` and `ConnectionError` from there.
- `lib/ai/starter-template.ts`: `AI_STARTER_TEMPLATE`.
- `components/ai-assistant-panel.tsx`: the panel. The Settings page passes it the non-Zernio accounts and the same `canManage` the Zernio panel gets.

**For ticket 07**

- **Shaping helper:** `shapeAnswer(answer)` in `lib/ai/reply-text.ts`. "Try it" calls it today. It returns `{ reply: stripMarkdown(answer.reply).trim(), handover: answer.handover }`. A handover currently shows the model's own reply text. Put the link guard and the fixed handover text there (the link guard needs the instructions, so add a parameter), and make `processAiReply` call it too, so the worker and "Try it" shape replies the same way.

**Deviations and choices**

- **"Try it" uses the instructions as typed, saved or not.** The body carries `instructions`, so the owner can tune them before saving. Saving changes live replies when the assistant is on. The live campaigns still come from the database.
- **Accounts are scoped to META.** All three routes look the account up by ID, workspace and provider META. A Zernio account or another workspace's account gets the same 404, "Instagram account not found."
- **The switch saves at once.** It saves the form as shown, with the new on/off value, so turning the assistant off is one click. The Save button keeps the current switch state. When no key is configured, the switch shows off and is disabled, and saving sends `enabled: false`.
- **Daily limit range:** a whole number from 1 to 10,000. "Try it" messages are at most 1,000 characters.
- **The bot notice and splitting aren't shown in "Try it".** It shows the reply text a follower would get, without the first-message notice, as one block.
- **No accounts:** when no META account is connected, the panel shows one line saying to connect one with your own Meta app. Workspace members see "Ask your workspace owner or admin", like the Zernio panel.
- **SmoothUI:** the repo has no `components.json`, so the panel uses the existing `panel`, input and button classes and reuses `AccountSelect` (with `label` and `includeAll={false}`, so no `t()` text appears).
- **Privacy page:** the sentence is a second paragraph in Subprocessors. `updatedAt` is November 11, 2026. The terms, data-deletion and meta-review pages keep May 24.
- **Not verified live:** the panel wasn't opened in a browser (the app wasn't run), and the "Try it" Claude call wasn't made (no network from this PC). Route tests mock Prisma, the workspace context, `askClaude`, the Meta send and the queue.
