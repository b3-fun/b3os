import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { request } from "../client.js";
import type { Organization, PaginatedData } from "../types.js";
import { registerToolSafe } from "./register-tool-safe.js";

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
}
