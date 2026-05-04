import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { request, truncateResponse } from "../client.js";
import type { PaginatedData, Template } from "../types.js";
import { validateTemplateId } from "./shared.js";
import { registerToolSafe } from "./register-tool-safe.js";

export function registerTemplateTools(s: McpServer): void {
  registerToolSafe(
    s,
    "b3os_list_templates",
    {
      description: `Browse workflow templates — pre-built workflows that can be cloned or used as
inspiration. Filter by category.`,
      inputSchema: {
        category: z.string().optional().describe("Filter by category"),
        limit: z.number().optional().describe("Max results (default: 20)"),
        offset: z.number().optional().describe("Offset for pagination"),
      },
    },
    async ({ category, limit, offset }) => {
      const safeLimit = Math.min(limit ?? 20, 50);
      const params: Record<string, string> = {
        limit: String(safeLimit),
        offset: String(offset ?? 0),
      };
      if (category) params.category = category;

      const data = await request<PaginatedData<Template>>("/v1/templates", { params });
      const templates = (data?.items || []).map(t => ({
        id: t.id,
        name: t.name,
        description: t.description,
        category: t.category,
        tags: t.tags,
        isPromoted: t.isPromoted,
      }));

      return {
        content: [
          {
            type: "text",
            text: truncateResponse(JSON.stringify({ templates, hasMore: data?.hasMore ?? false }, null, 2)),
          },
        ],
      };
    },
  );

  registerToolSafe(
    s,
    "b3os_get_template",
    {
      description: `Get full details of a workflow template including its definition. Use this to
inspect a template before cloning it into a new workflow.`,
      inputSchema: {
        templateId: z.string().describe("Template ID (e.g. 'tmpl_abc123')"),
      },
    },
    async ({ templateId }) => {
      validateTemplateId(templateId);
      const template = await request<Template>(`/v1/templates/${templateId}`);
      if (!template) throw new Error(`Template ${templateId} not found`);
      return { content: [{ type: "text", text: truncateResponse(JSON.stringify(template, null, 2)) }] };
    },
  );
}
