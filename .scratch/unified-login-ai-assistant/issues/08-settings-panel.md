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

- [ ] **GET settings** for an account returns the settings (or the defaults with the starter template), `keyConfigured` and `todayCount` (ASSISTANT messages since 00:00 Asia/Tashkent).
- [ ] **PUT settings** saves `enabled`, `instructions` and `dailyLimit`, validated with zod. It refuses `enabled: true` without `ANTHROPIC_API_KEY`, and refuses accounts outside the workspace.
- [ ] **POST try** runs the same prompt build, Claude call and guards for one typed message. There is no history, no send, no storage and no counting. It returns the reply text (or the handover text) and whether it was a handover.
- [ ] **All three routes** use the current workspace context and the manage-workspace role check. Writes check Origin. Responses are `{success, data | error}`. The API key never appears in any response.
- [ ] **Panel component** follows the Zernio panel's style. The switch is disabled with an explanation when no key is configured. Text is English without `t()`, which the spec records as a shortcut.
- [ ] **Starter template:** Uzbek, with blanks for who the owner is, what they make, and how to reach them. It notes that lead magnet links belong in campaigns, not in the instructions.
- [ ] **Privacy page.** The Subprocessors section adds Anthropic, with the spec's sentence (DMs that match no campaign may be processed to draft automatic replies, and are kept up to 30 days). The updated date is bumped.
- [ ] Route tests cover role enforcement, account ownership, the enable-without-key refusal, `try` not sending or storing, and the key never being returned.
- [ ] `npm test`, `npm run typecheck`, `npm run lint` and a build with placeholder env pass.

## Comments
