import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { request, truncateResponse } from "../client.js";
import type { ActionDefinition, Organization, PaginatedData, Run, Wallet } from "../types.js";
import {
  ACTION_TYPE_RE,
  definitionSchema,
  payloadSchema,
  validateWorkflowId,
  validateRunId,
  auditLog,
  buildPaginationParams,
  applyClientSideFilter,
} from "./shared.js";
import { registerToolSafe } from "./register-tool-safe.js";

export type WalletResolution = { ok: true; walletId: string } | { ok: false; error: string };

export async function resolveWalletId(): Promise<WalletResolution> {
  const orgData = await request<PaginatedData<Organization>>("/v1/organizations");
  const org = orgData?.items?.[0];
  if (!org) return { ok: false, error: "No organization found. Set up your org at https://b3os.org" };

  const walletData = await request<PaginatedData<Wallet>>(`/v1/organizations/${org.id}/wallets`, {
    params: { limit: "2" },
  });
  const wallets = walletData?.items || [];

  if (wallets.length === 0) {
    return { ok: false, error: "No wallets found. Create one at https://b3os.org" };
  }
  if (wallets.length === 1) {
    return { ok: true, walletId: wallets[0].id };
  }
  return {
    ok: false,
    error:
      "Multiple wallets found — pass walletId to specify which one. Use b3os_list_wallets to see available wallets.",
  };
}

export function registerRunTools(s: McpServer): void {
  registerToolSafe(
    s,
    "b3os_run_workflow",
    {
      description: `Trigger execution of a saved workflow. Returns a runId that you can track with
b3os_get_run. The workflow must be published (status: "active") to run.

Pass an optional payload for manual triggers that expect input data (e.g., a wallet
address, token symbol, or other parameters).`,
      inputSchema: {
        workflowId: z.string().describe("Workflow ID to run"),
        payload: payloadSchema
          .optional()
          .describe("Optional trigger payload data (for manual triggers that expect input)"),
      },
    },
    async ({ workflowId, payload }) => {
      validateWorkflowId(workflowId);
      auditLog("RUN", `workflow ${workflowId}`);
      const body: Record<string, unknown> = {};
      if (payload !== undefined) body.payload = payload;

      const result = await request<{ runId: string }>(`/v1/workflows/${workflowId}/run`, {
        method: "POST",
        body: Object.keys(body).length > 0 ? body : undefined,
      });
      if (!result?.runId) throw new Error(`Failed to trigger workflow ${workflowId}`);
      return {
        content: [
          {
            type: "text",
            text: `Workflow triggered. Run ID: ${result.runId}\n\nUse b3os_get_run to check the result.`,
          },
        ],
      };
    },
  );

  registerToolSafe(
    s,
    "b3os_run_action",
    {
      description: `Execute a single action immediately and return its result.

Simpler than b3os_run_ephemeral — no workflow definition needed.
Provide the action type and its inputs directly.

Use for one-shot lookups: "get ETH price", "fetch wallet balances",
"look up a token address". For multi-step workflows or if-node branching,
use b3os_run_ephemeral instead.

WALLET ACTIONS: For actions that require a wallet (swaps, sends, DeFi),
pass walletId to specify which wallet to use. If the org has exactly one wallet,
it is used automatically. If multiple wallets exist, walletId is required.
Use b3os_list_wallets to see available wallets.

PAGINATION: Actions that return lists (e.g. wallet balances, market results) support
inputs.limit and inputs.offset. For wallet balance actions, always pass a limit (e.g.
limit: 20) and filter with chainIds or filters to avoid oversized responses. Use the
nextOffset field from the result to fetch the next page.

Action types use hyphens only (e.g. "coingecko-get-token-price", "sim-dune-get-wallet-balances").
Use b3os_search_actions to discover available action types.`,
      inputSchema: {
        actionType: z
          .string()
          .describe(
            'Action type ID — hyphens only, no slashes (e.g. "coingecko-get-token-price", "sim-dune-get-wallet-balances")',
          ),
        inputs: z.any().optional().describe("Action input payload"),
        walletId: z
          .string()
          .optional()
          .describe(
            "Wallet ID for actions that require signing (swaps, sends). Use b3os_list_wallets to find IDs. Required when the org has multiple wallets; auto-detected for single-wallet orgs.",
          ),
        connectorId: z
          .string()
          .optional()
          .describe("Connector ID for non-wallet authenticated actions (Slack, Telegram, etc.)"),
      },
    },
    async ({ actionType, inputs, walletId, connectorId }) => {
      if (!ACTION_TYPE_RE.test(actionType)) {
        return {
          content: [
            {
              type: "text",
              text: `Invalid actionType format: "${actionType}". Use b3os_search_actions to find valid action types.`,
            },
          ],
        };
      }

      if (walletId && connectorId) {
        return {
          content: [
            {
              type: "text",
              text: `Cannot pass both walletId and connectorId. Use walletId for wallet actions (swaps, sends) or connectorId for other authenticated actions (Slack, Telegram).`,
            },
          ],
        };
      }

      let effectiveConnectorId = connectorId;

      if (!effectiveConnectorId) {
        if (walletId) {
          effectiveConnectorId = walletId;
        } else {
          const actionDef = await request<ActionDefinition>(`/v1/actions/${actionType}`);
          if (actionDef?.connector?.type === "wallet") {
            const resolved = await resolveWalletId();
            if (!resolved.ok) {
              return {
                content: [
                  {
                    type: "text",
                    text: `Action "${actionType}" requires a wallet. ${resolved.error}`,
                  },
                ],
              };
            }
            effectiveConnectorId = resolved.walletId;
          }
        }
      }

      const body: Record<string, unknown> = {
        inputs: inputs ?? {},
      };
      if (effectiveConnectorId) body.connectorId = effectiveConnectorId;

      const result = await request<{ result: Record<string, unknown>; durationMs: number }>(
        `/v1/actions/${actionType}/run`,
        { method: "POST", body, timeout: 35_000 },
      );

      if (!result) throw new Error("Action returned empty response");

      const text = truncateResponse(JSON.stringify(result.result, null, 2));
      return {
        content: [{ type: "text", text: `${actionType} (${result.durationMs}ms):\n${text}` }],
      };
    },
  );

  registerToolSafe(
    s,
    "b3os_run_ephemeral",
    {
      description: `Execute a workflow definition immediately without saving it. Runs synchronously —
blocks until all nodes complete and returns the full execution results.

Perfect for one-shot operations: "check ETH price", "get Polymarket leaderboard",
"fetch wallet balances". No polling needed — results come back in the response.

Constraints: max 20 nodes, manual trigger only, no wait/for-each nodes, 60s timeout.

The typical one-shot flow:
1. Construct a simple workflow definition (manual trigger → action)
2. b3os_run_ephemeral → executes and returns all node results
That's it — one call, nothing persisted.`,
      inputSchema: {
        definition: definitionSchema,
        payload: payloadSchema.optional().describe("Optional trigger payload data"),
      },
    },
    async ({ definition, payload }) => {
      auditLog("RUN_EPHEMERAL");
      const body: Record<string, unknown> = { definition };
      if (payload !== undefined) body.payload = payload;

      const result = await request<{
        runId: string;
        status: string;
        executionState: Record<string, { type: string; status: string; result?: Record<string, unknown> }>;
        durationMs: number;
      }>("/v1/runs/sync", {
        method: "POST",
        body,
        timeout: 65_000,
      });

      if (!result) throw new Error("Sync run returned empty response");

      const parts: string[] = [];
      parts.push(`Run ${result.runId}: ${result.status} (${result.durationMs}ms)`);

      if (result.executionState) {
        for (const [nodeId, node] of Object.entries(result.executionState)) {
          if (nodeId === "root") continue;
          if (node.status === "failure") {
            parts.push(`\n--- FAILED: ${nodeId} (${node.type}) ---`);
            if (node.result) parts.push(truncateResponse(JSON.stringify(node.result, null, 2)));
          } else if (node.status === "success" && node.result) {
            parts.push(`\n--- ${nodeId} (${node.type}) ---`);
            parts.push(truncateResponse(JSON.stringify(node.result, null, 2)));
          }
        }
      }

      return { content: [{ type: "text", text: truncateResponse(parts.join("\n")) }] };
    },
  );

  registerToolSafe(
    s,
    "b3os_list_runs",
    {
      description: `List workflow runs. Filter by workflowId and/or status.
Use status="failure" to find failed runs for debugging.`,
      inputSchema: {
        workflowId: z.string().optional().describe("Filter by workflow ID"),
        status: z
          .enum(["running", "success", "failure", "waiting", "cancelled"])
          .optional()
          .describe("Filter by run status (e.g. 'failure' to find failed runs)"),
        limit: z.number().optional().describe("Max results (default: 20)"),
        offset: z
          .number()
          .optional()
          .describe(
            "Offset for pagination. Ignored when `status` is set (filtering is client-side over an over-fetched window).",
          ),
      },
    },
    async ({ workflowId, status, limit, offset }) => {
      const { params, safeLimit } = buildPaginationParams({ limit, offset, status });
      if (workflowId) params.workflowId = workflowId;
      const data = await request<PaginatedData<Run>>("/v1/runs", { params });
      const { items: runs, hasMore } = applyClientSideFilter(
        data?.items || [],
        status ? (r: Run) => r.status === status : null,
        safeLimit,
        data?.hasMore ?? false,
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                runs: runs.map(r => ({
                  id: r.id,
                  workflowId: r.workflowId,
                  status: r.status,
                  triggerSource: r.triggerSource,
                  startedAt: r.startedAt,
                  finishedAt: r.finishedAt,
                })),
                hasMore,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  registerToolSafe(
    s,
    "b3os_get_run",
    {
      description: `Get details of a workflow run. By default returns full execution state for every node.

Use summary=true to get only run metadata (status, timing, IDs) without the heavy
execution state and workflow definition — much smaller payload, ideal for checking
run status or listing recent runs.

Use nodeIds to fetch execution state for specific nodes only — useful for debugging
a single failed node without downloading the entire state.

Check the failed node's input and result fields to understand what went wrong.`,
      inputSchema: {
        runId: z.string().describe("Run ID (e.g. 'run_abc123')"),
        summary: z
          .boolean()
          .optional()
          .describe("When true, omit ExecutionState and WorkflowDefinition to reduce payload size"),
        nodeIds: z
          .array(z.string())
          .optional()
          .describe("Only include these node IDs in ExecutionState (comma-separated in the API)"),
      },
    },
    async ({ runId, summary, nodeIds }) => {
      validateRunId(runId);
      const params: Record<string, string> = {};
      if (summary) params.summary = "true";
      if (nodeIds?.length) params.nodeIds = nodeIds.join(",");

      const run = await request<Run>(`/v1/runs/${runId}`, { params });
      if (!run) throw new Error(`Run ${runId} not found`);
      return { content: [{ type: "text", text: truncateResponse(JSON.stringify(run, null, 2)) }] };
    },
  );

  registerToolSafe(
    s,
    "b3os_cancel_run",
    {
      description: `Cancel a running workflow execution. Use this to stop a workflow that is stuck,
misconfigured, or performing unwanted actions. Only works on runs with status "running"
or "waiting".`,
      inputSchema: {
        runId: z.string().describe("Run ID to cancel (e.g. 'run_abc123')"),
      },
    },
    async ({ runId }) => {
      validateRunId(runId);
      auditLog("CANCEL", `run ${runId}`);
      await request(`/v1/runs/${runId}/cancel`, { method: "POST" });
      return { content: [{ type: "text", text: `Run ${runId} cancelled.` }] };
    },
  );
}
