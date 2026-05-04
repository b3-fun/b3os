import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { request, truncateResponse } from "../client.js";
import { ACTION_TYPE_RE } from "./shared.js";
import { registerToolSafe } from "./register-tool-safe.js";

export function registerBlockchainTools(s: McpServer): void {
  registerToolSafe(
    s,
    "b3os_query_action",
    {
      description: `Execute any B3OS action as a read-only query — no CU cost, no state changes.

WORKFLOW: b3os_search_actions → b3os_get_action (schema) → b3os_query_action (call)

COMMON ACTIONS (no search needed):
- "coingecko-get-token-data" — token info by address ({network, address})
- "coingecko-get-token-price" — prices ({coinIds, vsCurrencies: ["usd"]})
- "sim-dune-get-wallet-balances" — balances ({address, chainIds?})
- "debug-transaction" — tx trace with decoded calls ({txHash, chainId})
- "get-transaction-details" — basic tx data ({txHash, chainId})
- "sim-dune-get-defi-positions" — DeFi positions ({address, chainId?})
- "polymarket-search-markets" — prediction markets ({query})
- "polymarket-get-market" — market details ({slug or marketUrl})
- "evm-read" — smart contract read ({chainId, contractAddress, abi, functionName, args})

For write operations (send tokens, place bets), build a workflow instead.`,
      inputSchema: {
        actionType: z
          .string()
          .describe(
            "Action type (e.g. 'debug-transaction', 'polymarket-search-markets')",
          ),
        payload: z
          .any()
          .describe(
            "Action payload object. Fields depend on the action — use b3os_get_action to see the schema.",
          ),
      },
    },
    async ({ actionType, payload }) => {
      if (!ACTION_TYPE_RE.test(actionType)) {
        return {
          content: [
            {
              type: "text",
              text: `Invalid actionType format: "${actionType}"`,
            },
          ],
        };
      }

      try {
        const parsedPayload = (payload ?? {}) as Record<string, unknown>;
        const result = await request(`/v1/action-proxy/${actionType}/query`, {
          method: "POST",
          body: { payload: parsedPayload },
        });
        const text = truncateResponse(JSON.stringify(result, null, 2));
        return { content: [{ type: "text", text }] };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Action query failed (${actionType}): ${err instanceof Error ? err.message : err}`,
            },
          ],
        };
      }
    },
  );
}
