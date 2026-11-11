# 01: Unified login

**What to build:** The owner can connect an Instagram account to OpenReply through Meta's Unified login (Facebook Login for Business) when `META_LOGIN_CONFIG_ID` is set.

- The connected account works for every existing feature: comments, comment poller, private replies, DMs, button DMs, follow gate and webhook subscription.
- It never needs a token refresh.
- If Meta hides the account from the login, it is found through `META_INSTAGRAM_ACCOUNT_IDS`.
- Without `META_LOGIN_CONFIG_ID`, Instagram login behaves exactly as today.

See the spec, "Implementation Decisions → Unified login". The basis is henacosta1/openreply commit `6f7a02a`: review it and port it rather than copying blindly.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] With `META_LOGIN_CONFIG_ID` set, the connect route redirects to a facebook.com Facebook Login for Business URL. The URL has `client_id` (Meta App ID from `INSTAGRAM_APP_ID`), `config_id`, `redirect_uri`, signed `state`, `response_type=code` and `override_default_response_type=true`, and no `scope`. Without it, the Instagram login URL is unchanged.
- [ ] The callback exchanges the code on graph.facebook.com. There is no long-lived exchange, and the account is stored with a null token expiry.
- [ ] The refresh-tokens cron skips Unified-login accounts with no change to its behaviour for Instagram-login accounts.
- [ ] Account lookup tries the five strategies in the spec's order and stops at the first that returns accounts:
  1. assigned accounts
  2. `debug_token` granular-scope target IDs
  3. businesses
  4. pages
  5. configured IDs, each verified with a `/{id}?fields=id,username` read
- [ ] IG User IDs are preferred over asset IDs.
- [ ] Each lookup attempt logs counts, IDs and usernames, never tokens.
- [ ] One login that returns several accounts upserts each through the existing connect checks.
- [ ] No account found → redirect to Settings with an error that names `META_INSTAGRAM_ACCOUNT_IDS`.
- [ ] For Unified-login accounts, every Graph call uses graph.facebook.com with the Instagram account ID in the path, never `/me`. The base-URL and path choice lives in one place in the Meta client. Instagram-login accounts keep today's hosts and paths.
- [ ] The META Instagram context carries the account ID and the login mode.
- [ ] Webhook subscription for Unified-login accounts requests `comments`, `messages`, `messaging_postbacks` and `messaging_seen`, and stays non-fatal.
- [ ] `.env.example` documents `META_LOGIN_CONFIG_ID` and `META_INSTAGRAM_ACCOUNT_IDS`. Neither joins the core env validation.
- [ ] Tests (extending the existing OAuth and Instagram-provider suites) cover:
  - the authorization URL in both modes
  - the exchange host
  - lookup order 1 to 5, including verification of configured IDs
  - Graph base and path selection per mode
  - refresh skipping a null expiry
- [ ] `npm test`, `npm run typecheck`, `npm run lint` and a build with placeholder env pass.

## Comments
