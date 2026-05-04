import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { request, clearKeyCache } from "../client.js";
import { deleteApiKey } from "../keystore.js";
import type { CuBalance, Organization, PaginatedData } from "../types.js";
import { z } from "zod";
import { registerToolSafe } from "./register-tool-safe.js";
import { auditLog, validateOrgId } from "./shared.js";

export function registerOrgTools(s: McpServer): void {
  registerToolSafe(
    s,
    "b3os_whoami",
    {
      description: `Show the organization associated with your B3OS API key. Use this to:
- Verify the API key is valid and see which org it belongs to
- Get the orgId needed for b3os_list_wallets
- Confirm identity before performing operations`,
      inputSchema: {},
    },
    async () => {
      const data = await request<PaginatedData<Organization>>("/v1/organizations");
      const orgs = data?.items || [];
      if (orgs.length === 0) {
        return { content: [{ type: "text", text: "No organization found for this API key." }] };
      }
      const org = orgs[0];
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                id: org.id,
                name: org.name,
                slug: org.slug,
                description: org.description,
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
    "b3os_get_cu_balance",
    {
      description: `Check the organization's compute unit (CU) balance. CUs are consumed when workflows
run actions. Shows current balance, total used, and plan limit.

Requires orgId — call b3os_whoami first to get it.`,
      inputSchema: {
        orgId: z.string().describe("Organization ID from b3os_whoami"),
      },
    },
    async ({ orgId }) => {
      validateOrgId(orgId);
      const cu = await request<CuBalance>(`/v1/organizations/${orgId}/cu`);
      if (!cu) throw new Error("Failed to fetch CU balance");
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(cu, null, 2),
          },
        ],
      };
    },
  );

  registerToolSafe(
    s,
    "b3os_logout",
    {
      description: `Log out from the current B3OS organization by removing the stored API key.
After logout, all b3os tools will fail until you re-run b3os-mcp-setup to sign in again.
Always confirm with the user before calling this tool.`,
      inputSchema: {
        confirm: z.literal(true).describe("Must be exactly true to confirm logout"),
      },
    },
    async () => {
      auditLog("LOGOUT", "removing stored API key");
      const deleted = await deleteApiKey();
      clearKeyCache();
      if (deleted) {
        return {
          content: [
            {
              type: "text",
              text: [
                "Logged out — API key removed from OS keystore.",
                "",
                "To sign in to a different org, run: b3os-mcp-setup",
                "The previous org's API key on the server is NOT revoked.",
                "To revoke it, visit: https://b3os.org/organizations/settings?tab=api-keys",
              ].join("\n"),
            },
          ],
        };
      }
      return {
        content: [
          {
            type: "text",
            text: [
              "No API key found in OS keystore (may be using env var B3OS_API_KEY).",
              "To clear an env-based key, unset B3OS_API_KEY in your shell or Claude config.",
              "",
              "To sign in, run: b3os-mcp-setup",
            ].join("\n"),
          },
        ],
      };
    },
  );
}
