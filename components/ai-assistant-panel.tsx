"use client";

// shortcut: English text without t() (spec "General"), add catalog keys if this panel is upstreamed.
import { useEffect, useState } from "react";
import AccountSelect, { type AccountOption } from "@/components/account-select";

type AiSettings = { enabled: boolean; instructions: string; dailyLimit: number };
type PanelData = { settings: AiSettings; keyConfigured: boolean; todayCount: number };
type TryAnswer = { reply: string; handover: boolean };

const inputClass =
  "w-full rounded border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-accent/40";

async function callAi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/ai/${path}`, {
    cache: "no-store",
    ...init,
    headers: { "Content-Type": "application/json" },
  });
  const result = await response.json();
  if (!result.success) throw new Error(result.error);
  return result.data;
}

const errorText = (error: unknown, fallback: string) => (error instanceof Error && error.message) || fallback;

/** Settings panel for the AI assistant of one META account. Owners and admins only. */
export function AiAssistantPanel({ accounts, canManage }: { accounts: AccountOption[]; canManage: boolean }) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [data, setData] = useState<PanelData | null>(null);
  const [instructions, setInstructions] = useState("");
  const [dailyLimit, setDailyLimit] = useState("");
  const [busy, setBusy] = useState<"save" | "try" | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [message, setMessage] = useState("");
  const [answer, setAnswer] = useState<TryAnswer | null>(null);
  const [tryError, setTryError] = useState("");

  useEffect(() => {
    if (!canManage || !accountId) return;
    let current = true;
    callAi<PanelData>(`settings?instagramAccountId=${encodeURIComponent(accountId)}`)
      .then((next) => {
        if (!current) return;
        setData(next);
        setInstructions(next.settings.instructions);
        setDailyLimit(String(next.settings.dailyLimit));
      })
      .catch((e) => current && setError(errorText(e, "Could not load the AI assistant settings.")));
    return () => {
      current = false;
    };
  }, [canManage, accountId]);

  function selectAccount(id: string) {
    setAccountId(id);
    setData(null);
    setError("");
    setSaved(false);
    setAnswer(null);
    setTryError("");
  }

  // The switch and the Save button both save what the form shows.
  async function save(enabled: boolean) {
    setBusy("save");
    setError("");
    setSaved(false);
    try {
      const result = await callAi<{ settings: AiSettings }>("settings", {
        method: "PUT",
        body: JSON.stringify({ instagramAccountId: accountId, enabled, instructions, dailyLimit: Number(dailyLimit) }),
      });
      setData((current) => current && { ...current, settings: result.settings });
      setSaved(true);
    } catch (e) {
      setError(errorText(e, "Could not save the AI assistant settings."));
    } finally {
      setBusy(null);
    }
  }

  async function tryMessage() {
    setBusy("try");
    setAnswer(null);
    setTryError("");
    try {
      setAnswer(
        await callAi<TryAnswer>("try", {
          method: "POST",
          body: JSON.stringify({ instagramAccountId: accountId, instructions, message }),
        })
      );
    } catch (e) {
      setTryError(errorText(e, "Could not try the AI assistant."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="panel rounded p-4 sm:p-6" aria-labelledby="ai-assistant-heading">
      <h2 id="ai-assistant-heading" className="text-base font-semibold">AI assistant</h2>
      <p className="mt-1 text-sm text-muted">
        Answers follower DMs and story replies that match no campaign, using only your AI instructions. It never
        writes comments and never sends lead magnet links.
      </p>

      {!canManage ? (
        <p className="mt-4 text-sm">Ask your workspace owner or admin to set up the AI assistant.</p>
      ) : !accounts.length ? (
        <p className="mt-4 text-sm text-muted">
          Connect an Instagram account with your own Meta app to use the AI assistant.
        </p>
      ) : (
        <div className="mt-5 space-y-5">
          {accounts.length > 1 && (
            <AccountSelect
              accounts={accounts}
              value={accountId}
              onChange={selectAccount}
              includeAll={false}
              label="Instagram account"
            />
          )}
          {error && (
            <p role="alert" className="rounded border border-error/30 p-3 text-sm text-error">
              {error}
            </p>
          )}
          {!data ? (
            !error && <p className="text-sm text-muted">Loading…</p>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 border-b border-border pb-4">
                <div>
                  <label htmlFor="ai-enabled" className="text-sm font-medium text-foreground">
                    Answer DMs automatically
                  </label>
                  <p id="ai-enabled-help" className="mt-0.5 text-xs text-muted">
                    {data.keyConfigured
                      ? "Turning this on or off saves the form below too."
                      : "No Claude API key is configured, so the assistant can't be turned on. Add ANTHROPIC_API_KEY to the server environment."}
                  </p>
                </div>
                <input
                  id="ai-enabled"
                  type="checkbox"
                  role="switch"
                  aria-describedby="ai-enabled-help"
                  checked={data.keyConfigured && data.settings.enabled}
                  disabled={!data.keyConfigured || busy !== null}
                  onChange={(event) => void save(event.target.checked)}
                  className="h-5 w-5 shrink-0 accent-accent disabled:opacity-50"
                />
              </div>

              <div className="flex items-center justify-between gap-3 border-b border-border pb-4">
                <div>
                  <p className="text-sm font-medium text-foreground">AI answers today</p>
                  <p className="mt-0.5 text-xs text-muted">Counted since midnight, Tashkent time.</p>
                </div>
                <span className="text-sm font-semibold text-foreground">
                  {data.todayCount} / {data.settings.dailyLimit}
                </span>
              </div>

              <form
                className="space-y-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void save(data.keyConfigured && data.settings.enabled);
                }}
              >
                <label htmlFor="ai-instructions" className="block text-sm font-medium text-foreground">
                  AI instructions
                </label>
                <textarea
                  id="ai-instructions"
                  rows={12}
                  maxLength={10_000}
                  value={instructions}
                  onChange={(event) => {
                    setInstructions(event.target.value);
                    setSaved(false);
                  }}
                  aria-describedby="ai-instructions-help"
                  className={inputClass}
                />
                <p id="ai-instructions-help" className="text-xs leading-5 text-muted">
                  The only facts the assistant may tell followers. Replace the blanks in brackets. Lead magnet links
                  belong in campaigns, not here: the assistant tells followers which keyword to type instead.
                </p>
                <label htmlFor="ai-daily-limit" className="block text-sm font-medium text-foreground">
                  Daily AI limit
                </label>
                <input
                  id="ai-daily-limit"
                  type="number"
                  required
                  min={1}
                  max={10_000}
                  step={1}
                  value={dailyLimit}
                  onChange={(event) => {
                    setDailyLimit(event.target.value);
                    setSaved(false);
                  }}
                  aria-describedby="ai-daily-limit-help"
                  className={`${inputClass} sm:w-40`}
                />
                <p id="ai-daily-limit-help" className="text-xs leading-5 text-muted">
                  The most AI answers per day across all followers. At the limit the assistant stays silent.
                </p>
                <div className="flex items-center gap-3">
                  <button
                    disabled={busy !== null}
                    className="rounded bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
                  >
                    {busy === "save" ? "Saving…" : "Save"}
                  </button>
                  {saved && (
                    <p role="status" className="text-sm text-success">
                      Saved.
                    </p>
                  )}
                </div>
              </form>

              <form
                className="space-y-3 border-t border-border pt-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void tryMessage();
                }}
              >
                <label htmlFor="ai-try" className="block text-sm font-medium text-foreground">
                  Try it
                </label>
                <p className="text-xs leading-5 text-muted">
                  Type a message as a follower would. It uses the instructions above, saved or not. Nothing is sent
                  to Instagram, stored, or counted.
                </p>
                <div className="flex flex-col gap-3 sm:flex-row">
                  <input
                    id="ai-try"
                    required
                    maxLength={1000}
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    placeholder="narxi qancha?"
                    className={inputClass}
                  />
                  <button
                    disabled={busy !== null || !data.keyConfigured || !message.trim()}
                    className="rounded border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-border-hover disabled:opacity-50"
                  >
                    {busy === "try" ? "Asking…" : "Try"}
                  </button>
                </div>
                {tryError && (
                  <p role="alert" className="text-sm text-error">
                    {tryError}
                  </p>
                )}
                {answer && (
                  <div role="status" className="rounded border border-border bg-surface/70 p-3 text-sm">
                    {answer.handover && (
                      <p className="mb-2 text-xs font-semibold text-warning">
                        Handover: the assistant would pass this chat to you.
                      </p>
                    )}
                    <p className="whitespace-pre-wrap text-foreground">{answer.reply}</p>
                  </div>
                )}
              </form>
            </>
          )}
        </div>
      )}
    </section>
  );
}
