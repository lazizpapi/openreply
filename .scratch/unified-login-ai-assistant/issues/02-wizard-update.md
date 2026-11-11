# 02: Wizard update for Unified login, own domain and AI variables

**What to build:** The owner's local provisioning wizard (gitignored, run in Git Bash) walks them through the Unified-login setup and the own domain. It also writes every new variable to `.env.production` and the hosting env blocks, so they can resume setup where they paused (stage 4).

See the spec, "Implementation Decisions → Provisioning wizard". Follow the `wizard` skill's rules:
- the library above the STAGES marker is untouched
- secrets use hidden entry
- an `.env` upsert happens for every persisted value
- a confirm comes before anything irreversible

**Blocked by:** None (can start immediately). Variable names are fixed in the spec.

**Status:** ready-for-agent

- [x] **Stage 4 asks for:**
  - the Meta App ID (written as `INSTAGRAM_APP_ID`)
  - the Meta App secret, entered once and written to both `INSTAGRAM_APP_SECRET` and `FACEBOOK_APP_SECRET`
  - `META_LOGIN_CONFIG_ID`
  - optionally `META_INSTAGRAM_ACCOUNT_IDS`. The prompt explains the IG User ID (`1784…`) from Business Settings → Instagram accounts, not the 15-digit asset ID.
- [x] Stage 4 also optionally asks for `ANTHROPIC_API_KEY`, with Enter to skip, and a reminder to set a $5 monthly spend limit in the Anthropic Console.
- [x] **Stage 5 env blocks:**
  - Vercel gets the new variables plus `NEXTAUTH_URL=https://go.lazizpapi.uz`.
  - The Railway worker gets the new variables plus `RESEND_API_KEY` and `EMAIL_FROM`.
  - `ENCRYPTION_KEY` is identical on both.
- [x] **Stage 7 describes the Meta steps:**
  - API setup with Unified login
  - business portfolio connection
  - a configuration from template, edited to the Instagram-accounts asset only (no ad accounts) and the permissions `business_management`, `instagram_basic`, `instagram_manage_comments` and `instagram_manage_messages`
  - the redirect URL `https://go.lazizpapi.uz/api/instagram/callback`
  - the webhook `https://go.lazizpapi.uz/api/webhook` with fields `comments`, `messages`, `messaging_postbacks` and `messaging_seen`
  - testing each field with "Send to server"
- [x] The wizard covers adding `go.lazizpapi.uz` as a Vercel domain and the matching CNAME in Eskiz DNS.
- [x] The Instagram-app reminder covers Connected tools → Allow access to messages, and disconnecting any other DM tool.
- [x] Tester invites are accepted in a browser at `instagram.com/accounts/manage_access/`.
- [x] `TOTAL_STAGES` matches the stage count. `bash -n` passes, and `shellcheck` passes if it is available.
- [x] A static trace confirms that every value captured lands where the spec says.

## Comments

- Stage layout is now 11 stages. Deviations: (1) the Unified-login configuration steps live in stage 4 (not 7), because `META_LOGIN_CONFIG_ID` is needed before the Vercel/Railway env blocks; stage 9 (old 7) re-checks it. (2) The Anthropic key is its own stage 5 to keep stages focused. (3) The Vercel domain and Eskiz CNAME are a new stage 7. (4) `NEXTAUTH_URL` is written as `https://go.lazizpapi.uz` in stage 6, so the old "redeploy if URL differs" block is gone. (5) Instagram message access and tester invites are stage 10. (6) shellcheck is not installed; only `bash -n` was run, plus a sourced dry run of the env block functions. Menu paths in the Meta/Eskiz/Vercel steps describe what to look for, not exact UI wording.
