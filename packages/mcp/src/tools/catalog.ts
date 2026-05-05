import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { request, truncateResponse } from "../client.js";
import type { ActionDefinition, LogicAction, TriggerDefinition, SearchResults } from "../types.js";
import { ACTION_TYPE_RE } from "./shared.js";
import { registerToolSafe } from "./register-tool-safe.js";

export function registerCatalogTools(s: McpServer): void {
  registerToolSafe(
    s,
    "b3os_list_actions",
    {
      description: `Browse the B3OS action catalog. Returns all available actions that can be used as
workflow nodes. Filter by tags (e.g. "defi", "social", "data").

For keyword search, use b3os_search_actions instead — it's faster and more relevant.`,
      inputSchema: {
        tags: z.string().optional().describe("Filter by tags (comma-separated)"),
        limit: z
          .number()
          .optional()
          .describe("Max actions to return (default: 50). Use b3os_search_actions for targeted results."),
      },
    },
    async ({ tags, limit }) => {
      const params: Record<string, string> = { summary: "true" };
      if (tags) params.tags = tags;
      const actions = await request<ActionDefinition[]>("/v1/actions", { params, noAuth: true });
      const allActions = actions || [];
      const safeLimit = limit ?? 50;
      const truncated = allActions.length > safeLimit;
      const items = (truncated ? allActions.slice(0, safeLimit) : allActions).map(a => ({
        type: a.type,
        name: a.name,
        description: a.description,
        category: a.category,
        tags: a.tags,
        requiresGas: a.requiresGas,
        connector: a.connector?.type,
      }));
      const note = truncated
        ? `\n\nShowing ${safeLimit} of ${allActions.length}. Use b3os_search_actions for targeted results.`
        : "";
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(items, null, 2) + note,
          },
        ],
      };
    },
  );

  registerToolSafe(
    s,
    "b3os_search_actions",
    {
      description: `Search for B3OS actions by keyword. Uses hybrid search (keyword + semantic) to
find the most relevant actions for your workflow. Returns top matches with name,
description, category, and tags.

Use this FIRST when building a workflow to find the right action types. Then use
b3os_get_action to get the full payload/result schemas for the actions you choose.

Examples: "send slack message", "swap tokens", "fetch token price", "google sheets"`,
      inputSchema: {
        query: z.string().min(1).describe("Search query (e.g. 'send slack message', 'token price')"),
        limit: z.number().optional().describe("Max results (default: 10)"),
      },
    },
    async ({ query, limit }) => {
      const safeLimit = Math.min(limit || 10, 50);
      const params: Record<string, string> = {
        q: query,
        types: "action",
        limit: String(safeLimit),
      };
      try {
        const results = await request<SearchResults>("/v1/search", { params });
        const hits = results?.results || [];
        return {
          content: [
            {
              type: "text",
              text:
                hits.length > 0
                  ? JSON.stringify(
                      hits.map(h => ({
                        type: h.id,
                        name: h.name,
                        description: h.description,
                        category: h.category,
                        tags: h.tags,
                      })),
                      null,
                      2,
                    )
                  : `No actions found for "${query}". Try broader terms or use b3os_list_actions to browse all.`,
            },
          ],
        };
      } catch {
        return {
          content: [
            {
              type: "text",
              text: `Search unavailable — use b3os_list_actions to browse the full catalog instead.`,
            },
          ],
        };
      }
    },
  );

  registerToolSafe(
    s,
    "b3os_get_action",
    {
      description: `Get full details of a specific action, including its payload schema (input fields)
and result schema (output fields). Use the 'type' field from search results
(e.g. "coingecko-get-token-price", "send-erc20-token", "slack-send-message").

Read the payload schema to understand what fields to set in the node's payload,
and the result schema to understand what data flows to downstream nodes.`,
      inputSchema: { type: z.string().describe("Action type identifier (e.g. 'coingecko-get-token-price')") },
    },
    async ({ type }) => {
      if (!ACTION_TYPE_RE.test(type)) {
        throw new Error(`Invalid action type format: "${type}". Use b3os_search_actions to find valid types.`);
      }
      const action = await request<ActionDefinition>(`/v1/actions/${type}`, { noAuth: true });
      if (!action) throw new Error(`Action "${type}" not found`);
      return { content: [{ type: "text", text: truncateResponse(JSON.stringify(action, null, 2)) }] };
    },
  );

  registerToolSafe(
    s,
    "b3os_list_triggers",
    {
      description: `Browse available trigger types. Triggers start workflow execution — schedules (cron),
webhooks, blockchain events, manual triggers, etc. Filter by tags.`,
      inputSchema: { tags: z.string().optional().describe("Filter by tags (comma-separated)") },
    },
    async ({ tags }) => {
      const params: Record<string, string> = { summary: "true" };
      if (tags) params.tags = tags;
      const triggers = await request<TriggerDefinition[]>("/v1/triggers", { params, noAuth: true });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              (triggers || []).map(t => ({
                type: t.type,
                name: t.name,
                description: t.description,
                tags: t.tags,
                connector: t.connector?.type,
              })),
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
    "b3os_get_trigger",
    {
      description: `Get full details of a specific trigger type, including its payload schema.
Use the 'type' field from b3os_list_triggers (e.g. "cronjob", "webhook").`,
      inputSchema: { type: z.string().describe("Trigger type identifier (e.g. 'cronjob')") },
    },
    async ({ type }) => {
      if (!ACTION_TYPE_RE.test(type)) {
        throw new Error(`Invalid trigger type format: "${type}". Use b3os_list_triggers to browse valid types.`);
      }
      const trigger = await request<TriggerDefinition>(`/v1/triggers/${type}`, { noAuth: true });
      if (!trigger) throw new Error(`Trigger "${type}" not found`);
      return { content: [{ type: "text", text: truncateResponse(JSON.stringify(trigger, null, 2)) }] };
    },
  );

  registerToolSafe(
    s,
    "b3os_list_logic_actions",
    {
      description: `List built-in logic actions for workflow control flow. These are handled by the
workflow engine directly (not via the action service). Includes: if/else branching,
for-each loops, filters, delay, wait, format, log, and data transformation nodes.

Use these to build conditional or iterative workflows.`,
      inputSchema: {},
    },
    async () => {
      const actions = await request<LogicAction[]>("/v1/logic-actions", { noAuth: true });
      return {
        content: [
          {
            type: "text",
            text: truncateResponse(
              JSON.stringify(
                (actions || []).map(a => ({
                  type: a.type,
                  name: a.name,
                  description: a.description,
                })),
                null,
                2,
              ),
            ),
          },
        ],
      };
    },
  );

  registerToolSafe(
    s,
    "b3os_test_trigger",
    {
      description: `Test a trigger configuration without creating a workflow. Returns a sample trigger
result showing what data the trigger would produce. Useful for verifying trigger
payloads before wiring them into a workflow definition.`,
      inputSchema: {
        type: z.string().describe("Trigger type identifier (e.g. 'cronjob', 'webhook', 'erc20-transfer')"),
        payload: z.any().optional().describe("Trigger configuration payload to test"),
        connectorId: z.string().optional().describe("Connector ID if the trigger requires one"),
        connectorType: z
          .string()
          .optional()
          .describe("Connector type (e.g. 'wallet', 'slack', 'telegram-bot'). Required when connectorId is provided."),
      },
    },
    async ({ type, payload, connectorId, connectorType }) => {
      if (!ACTION_TYPE_RE.test(type)) {
        throw new Error(`Invalid trigger type format: "${type}". Use b3os_list_triggers to browse valid types.`);
      }
      const body: Record<string, unknown> = { inputs: payload ?? {} };
      if (connectorId) body.connector = { id: connectorId, type: connectorType ?? "wallet" };

      const result = await request(`/v1/triggers/${type}/test`, {
        method: "POST",
        body,
        timeout: 35_000,
      });
      return { content: [{ type: "text", text: truncateResponse(JSON.stringify(result, null, 2)) }] };
    },
  );
}
