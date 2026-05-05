import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { request, truncateResponse } from "../client.js";
import { registerToolSafe } from "./register-tool-safe.js";

/**
 * Named lookup tools — convenience wrappers over the action proxy.
 * Each calls POST /v1/action-proxy/{type}/query — no CU cost, read-only.
 *
 * ## Adding a new lookup tool
 * 1. Identify the B3OS action type (e.g. "coingecko-get-token-data")
 * 2. Add a registerToolSafe call below
 * 3. Use queryAction(actionType, payload) helper
 */

async function queryAction(
  actionType: string,
  payload: Record<string, unknown>,
): Promise<string> {
  const result = await request(`/v1/action-proxy/${actionType}/query`, {
    method: "POST",
    body: { payload },
  });
  return truncateResponse(JSON.stringify(result, null, 2));
}

export function registerLookupTools(s: McpServer): void {
  // ── 1. Token Lookup ─────────────────────────────────────────────────
  registerToolSafe(
    s,
    "b3os_token_lookup",
    {
      description: `Look up token information by on-chain address or CoinGecko ID. Read-only, no CU cost.

USE CASES:
- Get token metadata (name, symbol, market cap, image) by contract address on a chain
- Get current USD price by CoinGecko coin ID (e.g. "bitcoin", "ethereum")

INPUTS (provide ONE of these combinations):
- coinId → fetches price via CoinGecko ID (e.g. "bitcoin", "uniswap", "aave")
- network + address → fetches full token data by on-chain contract address
  network values: "ethereum", "base", "arbitrum-one", "polygon-pos", "optimistic-ethereum", "avalanche", "bsc"

EXAMPLES:
- { coinId: "bitcoin" } → current BTC/USD price
- { network: "base", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" } → USDC on Base`,
      inputSchema: {
        network: z
          .string()
          .optional()
          .describe(
            'Chain network slug (e.g. "ethereum", "base", "arbitrum-one")',
          ),
        address: z
          .string()
          .optional()
          .describe("Token contract address (hex, checksummed or lowercase)"),
        coinId: z
          .string()
          .optional()
          .describe(
            'CoinGecko coin ID (e.g. "bitcoin", "ethereum", "uniswap")',
          ),
      },
    },
    async ({ network, address, coinId }) => {
      try {
        if (coinId) {
          const text = await queryAction("coingecko-get-token-price", {
            coinIds: [coinId],
            vsCurrencies: ["usd"],
          });
          return { content: [{ type: "text", text }] };
        }

        if (network && address) {
          const text = await queryAction("coingecko-get-token-data", {
            network,
            address,
          });
          return { content: [{ type: "text", text }] };
        }

        return {
          content: [
            {
              type: "text",
              text: "Provide either `coinId` for a price lookup, or both `network` and `address` for full token data.",
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Token lookup failed: ${err instanceof Error ? err.message : err}`,
            },
          ],
        };
      }
    },
  );

  // ── 2. Price Lookup ─────────────────────────────────────────────────
  registerToolSafe(
    s,
    "b3os_price_lookup",
    {
      description: `Get current prices for one or more tokens by CoinGecko ID. Read-only, no CU cost.

Batch-friendly: pass multiple coin IDs in a single call.

EXAMPLES:
- { coinIds: ["bitcoin", "ethereum"] } → BTC and ETH prices in USD
- { coinIds: ["aave"], vsCurrencies: ["usd", "eur"] } → AAVE in USD and EUR`,
      inputSchema: {
        coinIds: z
          .array(z.string())
          .describe(
            'Array of CoinGecko coin IDs (e.g. ["bitcoin", "ethereum"])',
          ),
        vsCurrencies: z
          .array(z.string())
          .optional()
          .describe(
            'Quote currencies (default: ["usd"]). e.g. ["usd", "eur", "btc"]',
          ),
      },
    },
    async ({ coinIds, vsCurrencies }) => {
      try {
        const text = await queryAction("coingecko-get-token-price", {
          coinIds,
          vsCurrencies: vsCurrencies ?? ["usd"],
        });
        return { content: [{ type: "text", text }] };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Price lookup failed: ${err instanceof Error ? err.message : err}`,
            },
          ],
        };
      }
    },
  );

  // ── 3. Balance Lookup ───────────────────────────────────────────────
  registerToolSafe(
    s,
    "b3os_balance_lookup",
    {
      description: `Get wallet token balances across all supported chains. Read-only, no CU cost.

Returns token holdings with USD values, sorted by value descending.

INPUTS:
- address (required) — wallet address to check
- chainIds (optional) — filter to specific chain IDs (e.g. [1, 8453] for Ethereum + Base)
- limit (optional, default 20) — max tokens to return
- offset (optional) — pagination offset

CHAIN IDs: 1=Ethereum, 8453=Base, 42161=Arbitrum, 137=Polygon, 10=Optimism, 43114=Avalanche, 56=BSC

EXAMPLES:
- { address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" } → vitalik.eth balances
- { address: "0x...", chainIds: [8453], limit: 50 } → top 50 tokens on Base`,
      inputSchema: {
        address: z.string().describe("Wallet address (0x...)"),
        chainIds: z
          .array(z.number())
          .optional()
          .describe("Filter by chain IDs (e.g. [1, 8453])"),
        limit: z
          .number()
          .optional()
          .describe("Max tokens to return (default: 20)"),
        offset: z.number().optional().describe("Pagination offset"),
      },
    },
    async ({ address, chainIds, limit, offset }) => {
      try {
        const payload: Record<string, unknown> = {
          address,
          limit: limit ?? 20,
        };
        if (chainIds) payload.chainIds = chainIds;
        if (offset !== undefined) payload.offset = offset;

        const text = await queryAction("sim-dune-get-wallet-balances", payload);
        return { content: [{ type: "text", text }] };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Balance lookup failed: ${err instanceof Error ? err.message : err}`,
            },
          ],
        };
      }
    },
  );

  // ── 4. DeFi Lookup ──────────────────────────────────────────────────
  registerToolSafe(
    s,
    "b3os_defi_lookup",
    {
      description: `Get DeFi positions (lending, staking, LPs, vaults) for a wallet. Read-only, no CU cost.

Returns protocol positions with USD values across supported chains.

INPUTS:
- address (required) — wallet address to check
- chainId (optional) — filter to a single chain ID

EXAMPLES:
- { address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" } → all DeFi positions
- { address: "0x...", chainId: 1 } → Ethereum-only DeFi positions`,
      inputSchema: {
        address: z.string().describe("Wallet address (0x...)"),
        chainId: z
          .number()
          .optional()
          .describe("Filter to a single chain ID (e.g. 1 for Ethereum)"),
      },
    },
    async ({ address, chainId }) => {
      try {
        const payload: Record<string, unknown> = { address };
        if (chainId !== undefined) payload.chainId = chainId;

        const text = await queryAction("sim-dune-get-defi-positions", payload);
        return { content: [{ type: "text", text }] };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `DeFi lookup failed: ${err instanceof Error ? err.message : err}`,
            },
          ],
        };
      }
    },
  );

  // ── 5. Debug Transaction ────────────────────────────────────────────
  registerToolSafe(
    s,
    "b3os_debug_transaction",
    {
      description: `Trace and debug an EVM transaction. Read-only, no CU cost.

Returns decoded call trace, logs, balance changes, and revert reasons (if failed).
Much richer than a block explorer — shows internal calls, state diffs, and decoded parameters.

INPUTS:
- txHash (required) — the transaction hash
- chainId (required) — numeric chain ID

CHAIN IDs: 1=Ethereum, 8453=Base, 42161=Arbitrum, 137=Polygon, 10=Optimism, 43114=Avalanche, 56=BSC

EXAMPLES:
- { txHash: "0xabc...123", chainId: 8453 } → debug a Base transaction
- { txHash: "0xdef...456", chainId: 1 } → debug an Ethereum transaction`,
      inputSchema: {
        txHash: z.string().describe("Transaction hash (0x...)"),
        chainId: z.number().describe("Numeric chain ID (e.g. 1, 8453, 42161)"),
      },
    },
    async ({ txHash, chainId }) => {
      try {
        const text = await queryAction("debug-transaction", {
          txHash,
          chainId,
        });
        return { content: [{ type: "text", text }] };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Debug transaction failed: ${err instanceof Error ? err.message : err}`,
            },
          ],
        };
      }
    },
  );

  // ── 6. Polymarket Lookup ────────────────────────────────────────────
  registerToolSafe(
    s,
    "b3os_polymarket_lookup",
    {
      description: `Search or fetch Polymarket prediction markets. Read-only, no CU cost.

USE CASES:
- Search markets by keyword (e.g. "bitcoin", "election", "fed rate")
- Fetch a specific market by slug or URL

INPUTS (provide ONE):
- query → search markets by keyword
- slug → fetch a specific market by its slug (the URL path segment)
- marketUrl → fetch a specific market by its full Polymarket URL

EXAMPLES:
- { query: "bitcoin 100k" } → search for Bitcoin prediction markets
- { slug: "will-bitcoin-hit-100k-2025" } → get specific market details
- { marketUrl: "https://polymarket.com/event/will-bitcoin-hit-100k-2025" } → same, by URL`,
      inputSchema: {
        query: z
          .string()
          .optional()
          .describe("Search keyword(s) for finding markets"),
        slug: z.string().optional().describe("Market slug (URL path segment)"),
        marketUrl: z.string().optional().describe("Full Polymarket URL"),
      },
    },
    async ({ query, slug, marketUrl }) => {
      try {
        if (slug || marketUrl) {
          const payload: Record<string, unknown> = {};
          if (slug) payload.slug = slug;
          if (marketUrl) payload.marketUrl = marketUrl;

          const text = await queryAction("polymarket-get-market", payload);
          return { content: [{ type: "text", text }] };
        }

        if (query) {
          const text = await queryAction("polymarket-search-markets", {
            query,
          });
          return { content: [{ type: "text", text }] };
        }

        return {
          content: [
            {
              type: "text",
              text: "Provide `query` to search markets, or `slug`/`marketUrl` to fetch a specific market.",
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Polymarket lookup failed: ${err instanceof Error ? err.message : err}`,
            },
          ],
        };
      }
    },
  );
}
