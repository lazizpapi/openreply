# 01: Unified login

**What to build:** The owner can connect an Instagram account to OpenReply through Meta's Unified login (Facebook Login for Business) when `META_LOGIN_CONFIG_ID` is set.

- The connected account works for every existing feature: comments, comment poller, private replies, DMs, button DMs, follow gate and webhook subscription.
- It never needs a token refresh.
- If Meta hides the account from the login, it is found through `META_INSTAGRAM_ACCOUNT_IDS`.
- Without `META_LOGIN_CONFIG_ID`, Instagram login behaves exactly as today.

See the spec, "Implementation Decisions → Unified login". The basis is henacosta1/openreply commit `6f7a02a`: review it and port it rather than copying blindly.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [x] With `META_LOGIN_CONFIG_ID` set, the connect route redirects to a facebook.com Facebook Login for Business URL. The URL has `client_id` (Meta App ID from `INSTAGRAM_APP_ID`), `config_id`, `redirect_uri`, signed `state`, `response_type=code` and `override_default_response_type=true`, and no `scope`. Without it, the Instagram login URL is unchanged.
- [x] The callback exchanges the code on graph.facebook.com. There is no long-lived exchange, and the account is stored with a null token expiry.
- [x] The refresh-tokens cron skips Unified-login accounts with no change to its behaviour for Instagram-login accounts.
- [x] Account lookup tries the five strategies in the spec's order and stops at the first that returns accounts:
  1. assigned accounts
  2. `debug_token` granular-scope target IDs
  3. businesses
  4. pages
  5. configured IDs, each verified with a `/{id}?fields=id,username` read
- [x] IG User IDs are preferred over asset IDs.
- [x] Each lookup attempt logs counts, IDs and usernames, never tokens.
- [x] One login that returns several accounts upserts each through the existing connect checks.
- [x] No account found → redirect to Settings with an error that names `META_INSTAGRAM_ACCOUNT_IDS`.
- [x] For Unified-login accounts, every Graph call uses graph.facebook.com with the Instagram account ID in the path, never `/me`. The base-URL and path choice lives in one place in the Meta client. Instagram-login accounts keep today's hosts and paths.
- [x] The META Instagram context carries the account ID and the login mode.
- [x] Webhook subscription for Unified-login accounts requests `comments`, `messages`, `messaging_postbacks` and `messaging_seen`, and stays non-fatal.
- [x] `.env.example` documents `META_LOGIN_CONFIG_ID` and `META_INSTAGRAM_ACCOUNT_IDS`. Neither joins the core env validation.
- [x] Tests (extending the existing OAuth and Instagram-provider suites) cover:
  - the authorization URL in both modes
  - the exchange host
  - lookup order 1 to 5, including verification of configured IDs
  - Graph base and path selection per mode
  - refresh skipping a null expiry
- [x] `npm test`, `npm run typecheck`, `npm run lint` and a build with placeholder env pass.

## Comments

**Implementation notes (agent, 2026-11-11)**

- **Host switch is deployment-wide, not per account.** With `META_LOGIN_CONFIG_ID` set, every META account uses graph.facebook.com with the account ID in the path. The choice lives in `instagramGraphBase()` and `instagramAccountNode()` in `lib/meta/client.ts`. The context's `loginMode` comes from the same switch. Why: the send layer (`lib/instagram/send-messages.ts`) passes only the token and account ID to the Meta client, so a per-account choice would need a new DB column and send-layer changes. Another ticket is editing that file. Consequence: an account connected through Instagram login stops working for Graph calls once the variable is set, and has to be reconnected.
- **Token expiry and refresh.** The basis stored a 10-year expiry and made exchange and refresh no-ops. This port follows the spec instead. Under Unified login the callback skips the long-lived exchange and stores `tokenExpiresAt: null`, and the unchanged cron query (`tokenExpiresAt: { not: null, … }`) skips the account. `getLongLivedToken` and `refreshLongLivedToken` always use graph.instagram.com, so the cron behaves the same for Instagram-login accounts even when the variable is set. The cron tests pin existing behaviour; the cron code is unchanged.
- **No silent account pick.** The basis fell back to the first assigned account when no ID was given. Here, a Graph read under Unified login with no account ID throws.
- **Lookup** lives in the new module `lib/meta/unified-login.ts` (`findInstagramAccounts`). The Meta client gains one generic graph.facebook.com read helper, `getFacebookGraph`, which sends the token in the Authorization header. `debug_token` is called with the app token (`INSTAGRAM_APP_ID|INSTAGRAM_APP_SECRET`), and only target IDs of `instagram*` scopes are used. Those IDs aren't verified at lookup time, because the callback's profile read (`/{id}?fields=id,username,…`) follows straight after.
- **IG User ID preference (my reading of the spec).** Within one strategy's result, IDs matching `^1784\d{13,}$` win. 15-digit asset IDs are kept only when the strategy returned nothing else.
- **No-account error** reuses the existing `?instagram=failed&reason=…` redirect, which Settings already shows. The reason text names `META_INSTAGRAM_ACCOUNT_IDS`. This needs no new UI and no new `t()` key.
- The Unified-login code-exchange error no longer echoes the raw response body.
- Several accounts: as in the basis, a failed profile read for one account aborts the rest of the connect. Accounts already upserted stay connected.
- Not verified live (no Meta calls from this PC):
  - the strategy 1, 3 and 4 endpoints (`/me/assigned_instagram_accounts`, `/me/businesses?fields=id,instagram_accounts{id,username}`, `/me/accounts?fields=id,instagram_business_account{id,username}`)
  - whether sends, follow status and `subscribed_apps` on graph.facebook.com with the IG account ID accept a SYSTEM_USER token

  Ticket 03 is the live check.
- `send-messages.ts` and `dm-worker.ts` were not edited.
