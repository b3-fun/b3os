import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ApiError, request, truncateResponse } from "../client.js";
import type { ActionTestResult, Connector, PaginatedData, SlackChannel, TelegramChat, Wallet } from "../types.js";
import { registerToolSafe } from "./register-tool-safe.js";
import { validateOrgId } from "./shared.js";

export function registerConnectorTools(s: McpServer): void {
  registerToolSafe(
    s,
    "b3os_list_wallets",
    {
      description: `List wallets for the organization. Wallets are blockchain addresses managed by B3OS
(HSM-backed). Useful for workflows that send tokens or interact with DeFi protocols.

Requires orgId — call b3os_whoami first to get it.`,
      inputSchema: { orgId: z.string().describe("Organization ID from b3os_whoami") },
    },
    async ({ orgId }) => {
      validateOrgId(orgId);
      const allWallets: Wallet[] = [];
      const limit = 50;
      const maxPages = 20;
      const deadline = Date.now() + 30_000;
      let offset = 0;

      for (let page = 0; page < maxPages; page++) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        const data = await request<PaginatedData<Wallet>>(`/v1/organizations/${orgId}/wallets`, {
          params: { limit: String(limit), offset: String(offset) },
          timeout: Math.max(remaining, 1000),
        });
        const items = data?.items || [];
        allWallets.push(...items);
        if (!data?.hasMore || items.length === 0) break;
        offset += items.length;
      }

      const text = JSON.stringify(
        allWallets.map(w => ({
          id: w.id,
          name: w.name,
          address: w.address,
          isDefault: w.isDefault,
        })),
        null,
        2,
      );
      return { content: [{ type: "text", text: truncateResponse(text) }] };
    },
  );

  registerToolSafe(
    s,
    "b3os_list_connectors",
    {
      description: `List configured connectors (OAuth integrations) for the organization. Connectors are
credentials for external services — Slack, Discord, Google Sheets, wallets, etc.

Use this to discover which connectors are available before building workflows. The
connector ID is needed for workflow nodes that interact with external services:
  "connector": { "type": "slack", "id": "conn_abc123" }

Without this tool, you'd have to use placeholder connector references.`,
      inputSchema: {},
    },
    async () => {
      const data = await request<PaginatedData<Connector>>("/v1/connectors", {
        params: { limit: "100" },
      });
      const connectors = data?.items || [];
      if (connectors.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No connectors configured yet.\n\nConnectors link workflows to external services (Slack, Telegram, Gmail, wallets, etc.). Set up your first connector at: https://b3os.org/connectors",
            },
          ],
        };
      }
      const text = JSON.stringify(
        connectors.map(c => ({
          id: c.id,
          name: c.name,
          type: c.type,
          provider: c.provider,
        })),
        null,
        2,
      );
      return { content: [{ type: "text", text: truncateResponse(text) }] };
    },
  );

  registerToolSafe(
    s,
    "b3os_list_telegram_chats",
    {
      description: `List verified Telegram chats (DMs, groups, channels) for a connector. Use this to
discover available chatId values before building workflows with send-telegram-message.

Returns chatId, chatTitle, chatType (private/group/supergroup/channel), and chatUsername.
Filter by connectorId to see chats for a specific Telegram bot.

Call b3os_list_connectors first to find telegram-bot connector IDs.`,
      inputSchema: {
        connectorId: z.string().optional().describe("Filter by telegram-bot connector ID (from b3os_list_connectors)"),
        query: z.string().optional().describe("Search query to filter chats by title or username"),
      },
    },
    async ({ connectorId, query }) => {
      const params: Record<string, string> = { limit: "50", offset: "0" };
      if (connectorId) params.connector_id = connectorId;
      if (query) params.query = query;

      const data = await request<PaginatedData<TelegramChat>>("/v1/telegram-bot/chats", { params });
      const chats = data?.items || [];
      if (chats.length === 0) {
        const hint = connectorId
          ? `No Telegram chats found for connector ${connectorId}. Make sure:\n1. The Telegram bot is running\n2. Users have sent /start to the bot\n3. The bot has been added to any target groups`
          : "No Telegram chats found. Set up a telegram-bot connector at https://b3os.org/connectors first, then send /start to the bot in Telegram.";
        return { content: [{ type: "text", text: hint }] };
      }
      const text = JSON.stringify(
        chats.map(c => ({
          chatId: c.chatId,
          chatTitle: c.chatTitle,
          chatType: c.chatType,
          chatUsername: c.chatUsername,
          connectorId: c.connectorId,
          connectorName: c.connectorName,
        })),
        null,
        2,
      );
      return { content: [{ type: "text", text: truncateResponse(text) }] };
    },
  );

  registerToolSafe(
    s,
    "b3os_list_slack_channels",
    {
      description: `List Slack channels available to a connector. Use this to discover channel IDs
before building workflows with slack-send-message or slack-post-message.

Returns channel id, name, type (public/private), and member count.
Requires a slack connector ID — call b3os_list_connectors first.`,
      inputSchema: {
        connectorId: z.string().describe("Slack connector ID (from b3os_list_connectors)"),
      },
    },
    async ({ connectorId }) => {
      const seen = new Set<string>();
      const allChannels: SlackChannel[] = [];
      const maxPages = 3;
      let cursor: string | undefined;

      for (let page = 0; page < maxPages; page++) {
        let data: ActionTestResult | undefined;
        try {
          const inputs: Record<string, unknown> = { limit: 1000 };
          if (cursor) inputs.cursor = cursor;

          data = await request<ActionTestResult>("/v1/actions/slack-list-channels/test", {
            method: "POST",
            body: {
              inputs,
              connector: { id: connectorId, type: "slack" },
            },
          });
        } catch (err: unknown) {
          if (err instanceof ApiError && err.status === 400) {
            return {
              content: [
                {
                  type: "text",
                  text: `Slack connector "${connectorId}" not found. Run b3os_list_connectors to see available connectors, or set up a new Slack connector at: https://b3os.org/connectors`,
                },
              ],
            };
          }
          // Surface transient errors instead of silently returning empty results
          const msg = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: "text", text: `Failed to fetch Slack channels: ${msg}` }],
          };
        }

        const ret = data?.result?.data?.ret;
        if (!ret || typeof ret !== "object") break;

        const channels = ret.channels;
        let newCount = 0;
        if (Array.isArray(channels)) {
          for (const ch of channels) {
            if (
              ch &&
              typeof ch.id === "string" &&
              typeof ch.name === "string" &&
              !ch.is_archived &&
              ch.num_members > 0 &&
              !seen.has(ch.id)
            ) {
              seen.add(ch.id);
              allChannels.push({
                id: ch.id,
                name: ch.name,
                is_private: ch.is_private || ch.is_group,
                num_members: ch.num_members,
              });
              newCount++;
            }
          }
        }

        const nextCursor = ret.next_cursor;
        if (!nextCursor || typeof nextCursor !== "string" || newCount === 0) break;
        cursor = nextCursor;
      }

      if (allChannels.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No Slack channels found for connector ${connectorId}. Make sure the B3OS Slack app has been added to channels in your workspace.`,
            },
          ],
        };
      }

      const text = JSON.stringify(
        allChannels.map(c => ({
          id: c.id,
          name: c.name,
          type: c.is_private ? "private" : "public",
          members: c.num_members,
        })),
        null,
        2,
      );
      return { content: [{ type: "text", text: truncateResponse(text) }] };
    },
  );
}
