# 02: Wizard update for Unified login, own domain and AI variables

**What to build:** The owner's local provisioning wizard (gitignored, run in Git Bash) walks them through the Unified-login setup and the own domain. It also writes every new variable to `.env.production` and the hosting env blocks, so they can resume setup where they paused (stage 4).

See the spec, "Implementation Decisions → Provisioning wizard". Follow the `wizard` skill's rules:
- the library above the STAGES marker is untouched
- secrets use hidden entry
- an `.env` upsert happens for every persisted value
- a confirm comes before anything irreversible

**Blocked by:** None (can start immediately). Variable names are fixed in the spec.

**Status:** ready-for-agent

- [ ] **Stage 4 asks for:**
  - the Meta App ID (written as `INSTAGRAM_APP_ID`)
  - the Meta App secret, entered once and written to both `INSTAGRAM_APP_SECRET` and `FACEBOOK_APP_SECRET`
  - `META_LOGIN_CONFIG_ID`
  - optionally `META_INSTAGRAM_ACCOUNT_IDS`. The prompt explains the IG User ID (`1784…`) from Business Settings → Instagram accounts, not the 15-digit asset ID.
- [ ] Stage 4 also optionally asks for `ANTHROPIC_API_KEY`, with Enter to skip, and a reminder to set a $5 monthly spend limit in the Anthropic Console.
- [ ] **Stage 5 env blocks:**
  - Vercel gets the new variables plus `NEXTAUTH_URL=https://go.lazizpapi.uz`.
  - The Railway worker gets the new variables plus `RESEND_API_KEY` and `EMAIL_FROM`.
  - `ENCRYPTION_KEY` is identical on both.
- [ ] **Stage 7 describes the Meta steps:**
  - API setup with Unified login
  - business portfolio connection
  - a configuration from template, edited to the Instagram-accounts asset only (no ad accounts) and the permissions `business_management`, `instagram_basic`, `instagram_manage_comments` and `instagram_manage_messages`
  - the redirect URL `https://go.lazizpapi.uz/api/instagram/callback`
  - the webhook `https://go.lazizpapi.uz/api/webhook` with fields `comments`, `messages`, `messaging_postbacks` and `messaging_seen`
  - testing each field with "Send to server"
- [ ] The wizard covers adding `go.lazizpapi.uz` as a Vercel domain and the matching CNAME in Eskiz DNS.
- [ ] The Instagram-app reminder covers Connected tools → Allow access to messages, and disconnecting any other DM tool.
- [ ] Tester invites are accepted in a browser at `instagram.com/accounts/manage_access/`.
- [ ] `TOTAL_STAGES` matches the stage count. `bash -n` passes, and `shellcheck` passes if it is available.
- [ ] A static trace confirms that every value captured lands where the spec says.

## Comments
