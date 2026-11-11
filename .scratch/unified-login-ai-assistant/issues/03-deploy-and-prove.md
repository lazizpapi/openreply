# 03: Deploy and prove the campaign path with a real follower

**What to build:** OpenReply runs at `go.lazizpapi.uz`, with the web app on Vercel Hobby and the worker, Postgres and Redis on Railway, and the owner's Instagram connected through Unified login. A comment from a second Instagram account that is **not** a tester gets the public reply, then the opening DM with its button, then the lead magnet link. This is the go/no-go check before the AI work matters.

The owner does the logins, accepts terms and pastes keys. Claude checks every result from logs and the database. The AI stays off: no `ANTHROPIC_API_KEY` yet, or AI settings disabled.

**Blocked by:** 01 (Unified login), 02 (Wizard update)

**Status:** ready-for-human

- [ ] The wizard is run to the end. The Meta app is Live, and the webhook fields are verified with "Send to server".
- [ ] `/api/health` reports `status: ok` and a healthy worker. If Railway's internal `REDIS_URL` fails, `?family=0` is appended.
- [ ] `/privacy`, `/terms` and `/data-deletion` return 200 on `go.lazizpapi.uz`.
- [ ] Settings shows the account connected through Unified login with the webhook ready. Any lookup fallback that was needed is noted in Comments.
- [ ] A `TEST` campaign is live: all posts, public reply, opening DM with button, follow gate, link.
- [ ] From the non-tester account: a comment of `TEST` leads to the public reply, then the DM with the button, then the follow prompt (if not following), then the link through `go.lazizpapi.uz/r/...`.
- [ ] DM Logs shows SENT. The path that delivered the comment is recorded in Comments: a webhook event within seconds, or the poller within 5 minutes.
- [ ] The unused Meta app "OpenReply Lazizbek 2" is deleted, with the owner's confirmation.

## Comments
