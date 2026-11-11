import { getConfiguredInstagramAccountIds, requireEnv } from "@/lib/env";
import { debugToken, getFacebookGraph } from "./client";

export type FoundInstagramAccount = { id: string; username?: string };

type Lookup = (token: string) => Promise<FoundInstagramAccount[]>;
type Page<T> = { data?: T[] };

const LOOKUPS: [string, Lookup][] = [
  [
    "assigned accounts",
    async (token) =>
      (
        await getFacebookGraph<Page<FoundInstagramAccount>>(
          "/me/assigned_instagram_accounts",
          token,
          { fields: "id,username" }
        )
      ).data ?? [],
  ],
  [
    "debug_token target IDs",
    async (token) => {
      const appToken = `${requireEnv("INSTAGRAM_APP_ID")}|${requireEnv("INSTAGRAM_APP_SECRET")}`;
      const debug = (await debugToken(token, appToken)) as {
        data?: {
          granular_scopes?: { scope: string; target_ids?: string[] }[];
        };
      };
      return (debug.data?.granular_scopes ?? [])
        .filter(({ scope }) => scope.startsWith("instagram"))
        .flatMap(({ target_ids }) => target_ids ?? [])
        .map((id) => ({ id }));
    },
  ],
  [
    "businesses",
    async (token) =>
      (
        await getFacebookGraph<
          Page<{ instagram_accounts?: Page<FoundInstagramAccount> }>
        >("/me/businesses", token, {
          fields: "id,instagram_accounts{id,username}",
        })
      ).data?.flatMap((business) => business.instagram_accounts?.data ?? []) ??
      [],
  ],
  [
    "pages",
    async (token) =>
      (
        await getFacebookGraph<
          Page<{ instagram_business_account?: FoundInstagramAccount }>
        >("/me/accounts", token, {
          fields: "id,instagram_business_account{id,username}",
        })
      ).data?.flatMap((page) =>
        page.instagram_business_account ? [page.instagram_business_account] : []
      ) ?? [],
  ],
  [
    "META_INSTAGRAM_ACCOUNT_IDS",
    async (token) => {
      // Each configured ID must be readable with this token, so a typo fails
      // loudly instead of connecting an account the login cannot act for.
      const verified: FoundInstagramAccount[] = [];
      for (const id of getConfiguredInstagramAccountIds()) {
        try {
          verified.push(
            await getFacebookGraph<FoundInstagramAccount>(
              `/${encodeURIComponent(id)}`,
              token,
              { fields: "id,username" }
            )
          );
        } catch (error) {
          console.warn("[Unified login] Configured account is not reachable", {
            id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return verified;
    },
  ],
];

// IG User IDs (1784…, 17 digits) address the account in Graph calls; a
// 15-digit business asset ID does not. Asset IDs are kept only when a strategy
// returns nothing else.
const IG_USER_ID = /^1784\d{13,}$/;

function preferIgUserIds(accounts: FoundInstagramAccount[]) {
  const igUsers = accounts.filter(({ id }) => IG_USER_ID.test(id));
  return igUsers.length ? igUsers : accounts;
}

/**
 * The Instagram accounts a Unified login token can act for. Strategies run in
 * order and the first that returns accounts wins. Logs IDs and usernames only.
 */
export async function findInstagramAccounts(
  token: string
): Promise<FoundInstagramAccount[]> {
  for (const [strategy, lookup] of LOOKUPS) {
    let accounts: FoundInstagramAccount[] = [];
    try {
      accounts = preferIgUserIds(
        (await lookup(token)).map(({ id, username }) => ({ id, username }))
      );
    } catch (error) {
      console.warn("[Unified login] Account lookup failed", {
        strategy,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    console.log("[Unified login] Account lookup", {
      strategy,
      count: accounts.length,
      accounts,
    });
    if (accounts.length) return accounts;
  }
  return [];
}
