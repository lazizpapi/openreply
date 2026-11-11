import { getFacebookGraph } from "./client";

export type FoundInstagramAccount = { id: string; username?: string };

type Lookup = (token: string) => Promise<FoundInstagramAccount[]>;

const LOOKUPS: [string, Lookup][] = [
  [
    "assigned accounts",
    async (token) =>
      (
        await getFacebookGraph<{ data?: FoundInstagramAccount[] }>(
          "/me/assigned_instagram_accounts",
          token,
          { fields: "id,username" }
        )
      ).data ?? [],
  ],
];

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
      accounts = (await lookup(token)).map(({ id, username }) => ({
        id,
        username,
      }));
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
