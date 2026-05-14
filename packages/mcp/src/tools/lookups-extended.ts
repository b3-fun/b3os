import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { registerToolSafe } from "./register-tool-safe.js";
import { queryAction } from "./lookups.js";

export function registerExtendedLookupTools(s: McpServer): void {
  // ── 1. Hyperliquid Account ───────────────────────────────────────────
  registerToolSafe(
    s,
    "b3os_hyperliquid_account",
    {
      description: `Get a Hyperliquid account's positions, margin, open orders, and HIP-4 outcome holdings. Read-only, no CU cost.

INPUTS:
- address (required) — Ethereum address (0x...)
- dex (optional) — "xyz" for trade.xyz stocks/indices, "flx" for flx.finance,
  "vntl" for vntl.exchange. Omit for standard crypto perps.

EXAMPLES:
- { address: "0xabc..." } → crypto perp positions + margin
- { address: "0xabc...", dex: "xyz" } → trade.xyz stock positions`,
      inputSchema: {
        address: z
          .string()
          .describe("Ethereum address of the Hyperliquid account (0x...)"),
        dex: z
          .string()
          .optional()
          .describe(
            'DEX venue: "xyz" for trade.xyz, "flx" for flx.finance, "vntl" for vntl.exchange. Omit for crypto perps.',
          ),
      },
    },
    async ({ address, dex }) => {
      try {
        const payload: Record<string, unknown> = { address };
        if (dex) payload.dex = dex;
        const text = await queryAction("hyperliquid-get-account", payload);
        return { content: [{ type: "text", text }] };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Hyperliquid account lookup failed: ${err instanceof Error ? err.message : err}`,
            },
          ],
        };
      }
    },
  );

  // ── 2. Hyperliquid Markets ───────────────────────────────────────────
  registerToolSafe(
    s,
    "b3os_hyperliquid_markets",
    {
      description: `Get available Hyperliquid perpetual markets with trading parameters and prices. Read-only, no CU cost.

Returns coin symbols, max leverage, size decimals, and mid prices.

INPUTS:
- coin (optional) — filter by symbol (e.g. "BTC", "ETH", "TSLA")
- dex (optional) — "xyz" for trade.xyz stocks/indices/commodities. Omit for crypto perps.

EXAMPLES:
- {} → all crypto perp markets
- { coin: "BTC" } → BTC market info
- { dex: "xyz" } → all trade.xyz TradFi markets`,
      inputSchema: {
        coin: z
          .string()
          .optional()
          .describe('Filter by symbol (e.g. "BTC", "ETH", "SOL", "TSLA")'),
        dex: z
          .string()
          .optional()
          .describe(
            'DEX venue: "xyz" for trade.xyz TradFi markets. Omit for crypto perps.',
          ),
      },
    },
    async ({ coin, dex }) => {
      try {
        const payload: Record<string, unknown> = {};
        if (coin) payload.coin = coin;
        if (dex) payload.dex = dex;
        const text = await queryAction("hyperliquid-get-markets", payload);
        return { content: [{ type: "text", text }] };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Hyperliquid markets lookup failed: ${err instanceof Error ? err.message : err}`,
            },
          ],
        };
      }
    },
  );

  // ── 3. Hyperliquid Funding Rates ─────────────────────────────────────
  registerToolSafe(
    s,
    "b3os_hyperliquid_funding",
    {
      description: `Get current funding rates, open interest, mark prices, and 24h volume for Hyperliquid perps. Read-only, no CU cost.

Returns hourly and annualized rates, OI in USD, premium, and volume.
Results sorted by absolute rate (extremes first) when no coin filter applied.

INPUTS:
- coin (optional) — filter by symbol (e.g. "BTC", "ETH")
- dex (optional) — "xyz" for trade.xyz TradFi markets

EXAMPLES:
- {} → all markets sorted by extreme funding rates
- { coin: "BTC" } → BTC funding rate + OI
- { dex: "xyz" } → trade.xyz funding rates`,
      inputSchema: {
        coin: z
          .string()
          .optional()
          .describe('Filter by symbol (e.g. "BTC", "ETH")'),
        dex: z
          .string()
          .optional()
          .describe(
            '"xyz" for trade.xyz TradFi markets. Omit for crypto perps.',
          ),
      },
    },
    async ({ coin, dex }) => {
      try {
        const payload: Record<string, unknown> = {};
        if (coin) payload.coin = coin;
        if (dex) payload.dex = dex;
        const text = await queryAction(
          "hyperliquid-get-funding-rates",
          payload,
        );
        return { content: [{ type: "text", text }] };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Hyperliquid funding lookup failed: ${err instanceof Error ? err.message : err}`,
            },
          ],
        };
      }
    },
  );

  // ── 4. Polymarket Traders ────────────────────────────────────────────
  registerToolSafe(
    s,
    "b3os_polymarket_traders",
    {
      description: `Polymarket trader analytics — leaderboards, profiles, market holders. Read-only, no CU cost.

USE CASES:
- Get top traders by profit or volume (leaderboard)
- Look up a trader's profile and performance by wallet address
- Find top holders for a specific prediction market

INPUTS:
- walletAddress: trader's proxy wallet address (0x...) → profile mode
- conditionId: market condition ID (from b3os_polymarket_lookup) → holders mode
- If neither is provided → leaderboard mode (default)

Leaderboard options (only when no walletAddress/conditionId):
- category (optional): "OVERALL", "POLITICS", "SPORTS", "CRYPTO", "CULTURE", "WEATHER"
- timePeriod (optional): "DAY", "WEEK", "MONTH", "ALL"
- orderBy (optional): "PNL" (default) or "VOL"
- limit (optional): max results (default 10)

EXAMPLES:
- { timePeriod: "WEEK", orderBy: "PNL" } → top traders this week
- { walletAddress: "0xabc..." } → trader profile + stats
- { conditionId: "0x123..." } → top holders for a market`,
      inputSchema: {
        walletAddress: z
          .string()
          .optional()
          .describe("Trader's proxy wallet address for profile lookup (0x...)"),
        conditionId: z
          .string()
          .optional()
          .describe("Market condition ID for holder lookup"),
        category: z
          .string()
          .optional()
          .describe(
            'Leaderboard category: "OVERALL", "POLITICS", "SPORTS", "CRYPTO", "CULTURE", "WEATHER"',
          ),
        timePeriod: z
          .string()
          .optional()
          .describe('Leaderboard time filter: "DAY", "WEEK", "MONTH", "ALL"'),
        orderBy: z
          .string()
          .optional()
          .describe('Leaderboard sort: "PNL" (default) or "VOL"'),
        limit: z.number().optional().describe("Max results (default 10)"),
      },
    },
    async ({
      walletAddress,
      conditionId,
      category,
      timePeriod,
      orderBy,
      limit,
    }) => {
      try {
        if (walletAddress) {
          const text = await queryAction("polymarket-get-trader-profile", {
            walletAddress,
            ...(timePeriod ? { timePeriod } : {}),
          });
          return { content: [{ type: "text", text }] };
        }

        if (conditionId) {
          const text = await queryAction("polymarket-get-top-holders", {
            conditionId,
            ...(limit !== undefined ? { limit } : {}),
          });
          return { content: [{ type: "text", text }] };
        }

        const payload: Record<string, unknown> = {};
        if (category) payload.category = category;
        if (timePeriod) payload.timePeriod = timePeriod;
        if (orderBy) payload.orderBy = orderBy;
        if (limit !== undefined) payload.limit = limit;
        const text = await queryAction("polymarket-get-leaderboard", payload);
        return { content: [{ type: "text", text }] };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Polymarket traders lookup failed: ${err instanceof Error ? err.message : err}`,
            },
          ],
        };
      }
    },
  );

  // ── 5. Coinglass Markets ─────────────────────────────────────────────
  registerToolSafe(
    s,
    "b3os_coinglass_markets",
    {
      description: `Get futures market data from Coinglass — prices, open interest, funding rates, liquidations. Read-only, no CU cost.

INPUTS:
- coin (optional) — filter by symbol (e.g. "BTC", "ETH"). Omit for all coins.
- exchange (optional) — filter by exchange (e.g. "Binance", "Bybit")

EXAMPLES:
- {} → all coins with OI, funding, liquidation data
- { coin: "BTC" } → BTC futures market metrics`,
      inputSchema: {
        coin: z
          .string()
          .optional()
          .describe('Filter by coin symbol (e.g. "BTC", "ETH")'),
        exchange: z
          .string()
          .optional()
          .describe('Filter by exchange (e.g. "Binance", "Bybit")'),
      },
    },
    async ({ coin, exchange }) => {
      try {
        const payload: Record<string, unknown> = {};
        if (coin) payload.coin = coin;
        if (exchange) payload.exchange = exchange;
        const text = await queryAction("coinglass-get-coins-markets", payload);
        return { content: [{ type: "text", text }] };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Coinglass markets lookup failed: ${err instanceof Error ? err.message : err}`,
            },
          ],
        };
      }
    },
  );

  // ── 6. Coinglass Whales ──────────────────────────────────────────────
  registerToolSafe(
    s,
    "b3os_coinglass_whales",
    {
      description: `Track Hyperliquid whale positions and alerts via Coinglass. Read-only, no CU cost.

USE CASES:
- Get current whale positions (>$1M notional) with leverage, PnL, entry/liq prices
- Get recent whale alerts (position opens/closes)
- Look up positions for a specific wallet address

INPUTS:
- alerts: true → recent whale open/close alerts
- address: "0x..." → positions for a specific wallet
- If neither is provided → current whale positions (default)

EXAMPLES:
- {} → all current Hyperliquid whale positions
- { alerts: true } → recent whale alerts
- { address: "0xabc..." } → specific wallet's positions`,
      inputSchema: {
        alerts: z
          .boolean()
          .optional()
          .describe("Set true to get recent whale alerts"),
        address: z
          .string()
          .optional()
          .describe("Wallet address to look up positions for (0x...)"),
      },
    },
    async ({ alerts, address }) => {
      try {
        if (address) {
          const text = await queryAction(
            "coinglass-get-hyperliquid-positions-by-address",
            { address },
          );
          return { content: [{ type: "text", text }] };
        }

        if (alerts) {
          const text = await queryAction(
            "coinglass-get-hyperliquid-whale-alert",
            {},
          );
          return { content: [{ type: "text", text }] };
        }

        const text = await queryAction(
          "coinglass-get-hyperliquid-whale-positions",
          {},
        );
        return { content: [{ type: "text", text }] };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Coinglass whales lookup failed: ${err instanceof Error ? err.message : err}`,
            },
          ],
        };
      }
    },
  );

  // ── 7. Morpho Yield ──────────────────────────────────────────────────
  registerToolSafe(
    s,
    "b3os_morpho_yields",
    {
      description: `Get Morpho DeFi vault yields and positions. Read-only, no CU cost.

USE CASES:
- Find the best APY vault for a token
- Check a specific vault's APY
- Check a wallet's position in a vault
- Check claimable rewards

INPUTS (provide ONE mode):

Best APY mode:
- tokenAddress (required) — token contract address to find best vault for
- chainId (optional) — filter to chain (1=Ethereum, 8453=Base, 42161=Arbitrum, 10=Optimism, 137=Polygon)
- minApyPercent (optional) — minimum APY filter

Vault APY mode:
- vaultAddress (required) — vault contract address
- chainId (required) — chain the vault is on

Position mode:
- vaultAddress + walletAddress + chainId → wallet's position in vault

Rewards mode:
- rewards: true + walletAddress → claimable rewards for wallet

EXAMPLES:
- { tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", chainId: 8453 } → best USDC vault on Base
- { vaultAddress: "0x...", chainId: 1 } → specific vault APY
- { rewards: true, walletAddress: "0x..." } → claimable rewards`,
      inputSchema: {
        tokenAddress: z
          .string()
          .optional()
          .describe("Token contract address to find best vault for"),
        vaultAddress: z
          .string()
          .optional()
          .describe("Morpho vault contract address"),
        walletAddress: z
          .string()
          .optional()
          .describe("Wallet address to check position or rewards"),
        chainId: z
          .number()
          .optional()
          .describe(
            "Chain ID (1=Ethereum, 8453=Base, 42161=Arbitrum, 10=Optimism, 137=Polygon)",
          ),
        minApyPercent: z
          .number()
          .optional()
          .describe("Minimum APY percentage filter"),
        rewards: z
          .boolean()
          .optional()
          .describe("Set true to check claimable rewards for walletAddress"),
      },
    },
    async ({
      tokenAddress,
      vaultAddress,
      walletAddress,
      chainId,
      minApyPercent,
      rewards,
    }) => {
      try {
        if (rewards && walletAddress) {
          const payload: Record<string, unknown> = { walletAddress };
          if (chainId) payload.chainId = chainId;
          const text = await queryAction(
            "morpho-get-claimable-rewards",
            payload,
          );
          return { content: [{ type: "text", text }] };
        }

        if (vaultAddress && walletAddress && chainId) {
          const text = await queryAction("morpho-vault-get-position", {
            vaultAddress,
            walletAddress,
            chainId,
          });
          return { content: [{ type: "text", text }] };
        }

        if (vaultAddress && chainId) {
          const text = await queryAction("morpho-get-vault-apy", {
            vaultAddress,
            chainId,
          });
          return { content: [{ type: "text", text }] };
        }

        if (tokenAddress) {
          const payload: Record<string, unknown> = { tokenAddress };
          if (chainId) payload.chainId = chainId;
          if (minApyPercent !== undefined)
            payload.minApyPercent = minApyPercent;
          const text = await queryAction("morpho-get-best-apy", payload);
          return { content: [{ type: "text", text }] };
        }

        return {
          content: [
            {
              type: "text",
              text: "Provide `tokenAddress` to find best APY, `vaultAddress + chainId` for vault APY, or `rewards: true + walletAddress` for claimable rewards.",
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Morpho yield lookup failed: ${err instanceof Error ? err.message : err}`,
            },
          ],
        };
      }
    },
  );
}
