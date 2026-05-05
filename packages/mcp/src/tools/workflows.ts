import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { request, truncateResponse } from "../client.js";
import type { PaginatedData, Workflow, WorkflowVersion } from "../types.js";
import {
  definitionSchema,
  validateWorkflowId,
  auditLog,
  buildPaginationParams,
  applyClientSideFilter,
} from "./shared.js";
import { registerToolSafe } from "./register-tool-safe.js";
import {
  analyzeWorkflowFunds,
  formatFundingAdvisory,
} from "./analyze-funds.js";

const WEB_APP_URL = "https://b3os.org";

function workflowEditUrl(workflowId: string): string {
  return `${WEB_APP_URL}/workflows/edit?id=${workflowId}`;
}

export function registerWorkflowTools(s: McpServer): void {
  registerToolSafe(
    s,
    "b3os_list_workflows",
    {
      description: `List workflows in the organization. Returns workflow metadata (id, name, status,
last triggered). Use this to find a workflow by name before getting its details.
Filter by status to find active, paused, or draft workflows.`,
      inputSchema: {
        status: z
          .enum(["draft", "active", "paused", "archived"])
          .optional()
          .describe("Filter by workflow status"),
        limit: z.number().optional().describe("Max results (default: 20)"),
        offset: z
          .number()
          .optional()
          .describe(
            "Offset for pagination. Ignored when `status` is set (filtering is client-side over an over-fetched window).",
          ),
      },
    },
    async ({ status, limit, offset }) => {
      const { params, safeLimit } = buildPaginationParams({
        limit,
        offset,
        status,
      });
      params._fields_filter =
        "id,name,status,description,lastTriggeredAt,createdAt";
      const data = await request<PaginatedData<Workflow>>("/v1/workflows", {
        params,
      });
      const { items: workflows, hasMore } = applyClientSideFilter(
        data?.items || [],
        status ? (w: Workflow) => w.status === status : null,
        safeLimit,
        data?.hasMore ?? false,
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                workflows: workflows.map((w) => ({
                  id: w.id,
                  name: w.name,
                  status: w.status,
                  description: w.description,
                  lastTriggeredAt: w.lastTriggeredAt,
                  createdAt: w.createdAt,
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
    "b3os_get_workflow",
    {
      description: `Get a workflow's full details including its definition (nodes, triggers, connections).
Use this to inspect an existing workflow before modifying it.`,
      inputSchema: {
        workflowId: z.string().describe("Workflow ID (e.g. 'wf_abc123')"),
      },
    },
    async ({ workflowId }) => {
      validateWorkflowId(workflowId);
      const workflow = await request<Workflow>(`/v1/workflows/${workflowId}`);
      if (!workflow) throw new Error(`Workflow ${workflowId} not found`);
      return {
        content: [
          {
            type: "text",
            text: truncateResponse(JSON.stringify(workflow, null, 2)),
          },
        ],
      };
    },
  );

  registerToolSafe(
    s,
    "b3os_create_workflow",
    {
      description: `Save a new workflow to B3OS.

IMPORTANT: Always call b3os_validate_workflow first to catch errors before saving.
After saving, use b3os_publish_workflow to make it live.`,
      inputSchema: {
        name: z.string().describe("Workflow name"),
        description: z.string().describe("What this workflow does"),
        definition: definitionSchema,
      },
      aliases: { workflow: "definition" },
    },
    async ({ name, description, definition }) => {
      const workflow = await request<Workflow>("/v1/workflows", {
        method: "POST",
        body: { name, description, definition },
      });
      if (!workflow)
        throw new Error("Failed to create workflow — empty response");
      const url = workflowEditUrl(workflow.id);
      return {
        content: [
          {
            type: "text",
            text: `Workflow created successfully.\n\n${JSON.stringify({ id: workflow.id, name: workflow.name, status: workflow.status, version: workflow.version }, null, 2)}\n\nLink: ${url}\nNext: use b3os_publish_workflow to make it live.`,
          },
        ],
      };
    },
  );

  registerToolSafe(
    s,
    "b3os_update_workflow",
    {
      description: `Update an existing workflow's metadata or definition. Only include the fields you want to change.`,
      inputSchema: {
        workflowId: z.string().describe("Workflow ID to update"),
        name: z.string().optional().describe("New name"),
        description: z.string().optional().describe("New description"),
        definition: definitionSchema.optional(),
        expectedCurrentVersion: z
          .number()
          .optional()
          .describe("Expected current version (optimistic locking)"),
      },
      aliases: { workflow: "definition" },
    },
    async ({
      workflowId,
      name,
      description,
      definition,
      expectedCurrentVersion,
    }) => {
      validateWorkflowId(workflowId);
      const body: Record<string, unknown> = {};
      if (name !== undefined) body.name = name;
      if (description !== undefined) body.description = description;
      if (definition !== undefined) body.definition = definition;
      if (expectedCurrentVersion !== undefined)
        body.expectedCurrentVersion = expectedCurrentVersion;

      const workflow = await request<Workflow>(`/v1/workflows/${workflowId}`, {
        method: "PUT",
        body,
      });
      if (!workflow) throw new Error(`Workflow ${workflowId} not found`);
      const url = workflowEditUrl(workflow.id);
      return {
        content: [
          {
            type: "text",
            text: `Workflow updated.\n\n${JSON.stringify({ id: workflow.id, name: workflow.name, status: workflow.status, version: workflow.version }, null, 2)}\n\nLink: ${url}`,
          },
        ],
      };
    },
  );

  registerToolSafe(
    s,
    "b3os_delete_workflow",
    {
      description: `Delete (archive) a workflow. This is irreversible. The workflow will be archived
and no longer execute. Always confirm with the user before calling this tool.`,
      inputSchema: {
        workflowId: z.string().describe("Workflow ID to delete"),
        confirm: z
          .literal(true)
          .describe(
            "Must be exactly true to confirm deletion — this is irreversible",
          ),
      },
    },
    // `confirm` is enforced by the z.literal(true) guard in the schema above —
    // the wrapper rejects the call before this handler runs if it is missing
    // or not exactly `true`, so no runtime check is needed here.
    async ({ workflowId }) => {
      validateWorkflowId(workflowId);
      auditLog("DELETE", `workflow ${workflowId}`);
      await request(`/v1/workflows/${workflowId}`, { method: "DELETE" });
      return {
        content: [{ type: "text", text: `Workflow ${workflowId} deleted.` }],
      };
    },
  );

  registerToolSafe(
    s,
    "b3os_publish_workflow",
    {
      description: `Publish a draft workflow to make it live. After creating or updating a workflow,
it starts in "draft" status. Publishing activates its triggers (schedules, webhooks, etc.)
so it begins executing automatically.

Before publishing, this tool checks whether your wallets have sufficient funds for the
workflow's on-chain actions. If balances are insufficient, it returns a funding advisory
instead of publishing. Pass skipFundCheck: true to bypass this check.`,
      inputSchema: {
        workflowId: z.string().describe("Workflow ID to publish"),
        expectedVersion: z
          .number()
          .optional()
          .describe("Expected version (optimistic locking)"),
        skipFundCheck: z
          .boolean()
          .optional()
          .describe("Skip the pre-publish fund balance check (default: false)"),
      },
    },
    async ({ workflowId, expectedVersion, skipFundCheck }) => {
      validateWorkflowId(workflowId);
      auditLog("PUBLISH", `workflow ${workflowId}`);

      if (!skipFundCheck) {
        try {
          const fundsData = await analyzeWorkflowFunds(workflowId);
          const advisory = formatFundingAdvisory(fundsData);
          if (advisory) {
            return { content: [{ type: "text", text: advisory }] };
          }
        } catch {
          // Graceful degradation: if fund analysis fails, proceed with publish
        }
      }

      const body: Record<string, unknown> = {};
      if (expectedVersion !== undefined) body.expectedVersion = expectedVersion;

      const workflow = await request<Workflow>(
        `/v1/workflows/${workflowId}/publish`,
        {
          method: "POST",
          body: Object.keys(body).length > 0 ? body : undefined,
        },
      );
      if (!workflow)
        throw new Error(`Failed to publish workflow ${workflowId}`);
      const url = workflowEditUrl(workflowId);
      return {
        content: [
          {
            type: "text",
            text: workflow.name
              ? `Workflow "${workflow.name}" is now live (status: ${workflow.status}).\n\nLink: ${url}`
              : `Workflow ${workflowId} published successfully (status: ${workflow.status || "active"}).\n\nLink: ${url}`,
          },
        ],
      };
    },
  );

  registerToolSafe(
    s,
    "b3os_pause_workflow",
    {
      description: `Pause an active workflow. Its triggers will stop firing and no new runs will start.
Use b3os_resume_workflow to reactivate it.`,
      inputSchema: { workflowId: z.string().describe("Workflow ID to pause") },
    },
    async ({ workflowId }) => {
      validateWorkflowId(workflowId);
      await request(`/v1/workflows/${workflowId}/pause`, { method: "POST" });
      return {
        content: [{ type: "text", text: `Workflow ${workflowId} paused.` }],
      };
    },
  );

  registerToolSafe(
    s,
    "b3os_resume_workflow",
    {
      description: `Resume a paused workflow. Its triggers will start firing again.`,
      inputSchema: { workflowId: z.string().describe("Workflow ID to resume") },
    },
    async ({ workflowId }) => {
      validateWorkflowId(workflowId);
      await request(`/v1/workflows/${workflowId}/resume`, { method: "POST" });
      return {
        content: [{ type: "text", text: `Workflow ${workflowId} resumed.` }],
      };
    },
  );

  registerToolSafe(
    s,
    "b3os_validate_workflow",
    {
      description: `Validate a workflow definition without saving it. ALWAYS call this before
b3os_create_workflow or b3os_update_workflow. No side effects. Returns validation results
including any missing fields, invalid payloads, or misconfigured nodes.`,
      inputSchema: {
        name: z
          .string()
          .optional()
          .describe(
            "Workflow name (defaults to 'Untitled' — the API requires a name for validation)",
          ),
        definition: definitionSchema,
      },
      aliases: { workflow: "definition" },
    },
    async ({ name, definition }) => {
      const result = await request<Record<string, unknown>>(
        "/v1/workflows/validate",
        {
          method: "POST",
          body: { name: name || "Untitled", definition },
        },
      );
      return {
        content: [
          {
            type: "text",
            text: result
              ? `Validation result:\n${JSON.stringify(result, null, 2)}`
              : "Workflow definition is valid.",
          },
        ],
      };
    },
  );

  registerToolSafe(
    s,
    "b3os_list_workflow_versions",
    {
      description: `List version history for a workflow. Each publish creates a new version.
Use this to see the change history and find a version to rollback to.`,
      inputSchema: {
        workflowId: z.string().describe("Workflow ID (e.g. 'wf_abc123')"),
        limit: z
          .number()
          .optional()
          .describe("Max versions to return (default: 20)"),
        offset: z.number().optional().describe("Offset for pagination"),
      },
    },
    async ({ workflowId, limit, offset }) => {
      validateWorkflowId(workflowId);
      const params: Record<string, string> = {
        limit: String(Math.min(limit ?? 20, 50)),
        offset: String(offset ?? 0),
      };
      const data = await request<PaginatedData<WorkflowVersion>>(
        `/v1/workflows/${workflowId}/versions`,
        { params },
      );
      const versions = (data?.items || []).map((v) => ({
        versionNumber: v.versionNumber,
        status: v.status,
        createdBy: v.createdBy,
        createdAt: v.createdAt,
        publishedAt: v.publishedAt,
      }));
      return {
        content: [
          {
            type: "text",
            text: truncateResponse(
              JSON.stringify(
                { versions, hasMore: data?.hasMore ?? false },
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
    "b3os_rollback_workflow",
    {
      description: `Rollback a workflow to a previous version. Creates a new draft with the definition
from the specified version. After rollback, review and publish to make it live.

Use b3os_list_workflow_versions to find the target version number.`,
      inputSchema: {
        workflowId: z.string().describe("Workflow ID to rollback"),
        versionNumber: z
          .number()
          .int()
          .min(1)
          .describe("Target version number to rollback to"),
      },
    },
    async ({ workflowId, versionNumber }) => {
      validateWorkflowId(workflowId);
      auditLog(
        "ROLLBACK",
        `workflow ${workflowId} to version ${versionNumber}`,
      );
      const result = await request<Workflow>(
        `/v1/workflows/${workflowId}/rollback`,
        {
          method: "POST",
          body: { versionNumber },
        },
      );
      if (!result) throw new Error(`Failed to rollback workflow ${workflowId}`);
      const url = workflowEditUrl(workflowId);
      return {
        content: [
          {
            type: "text",
            text: `Workflow rolled back to version ${versionNumber}. Current status: ${result.status}\n\nLink: ${url}\nNext: review the definition and use b3os_publish_workflow to make it live.`,
          },
        ],
      };
    },
  );

  registerToolSafe(
    s,
    "b3os_get_workflow_schedule",
    {
      description: `Get the schedule information for a workflow — when it last ran and when it will
run next. Only meaningful for workflows with schedule-based triggers (cron).`,
      inputSchema: {
        workflowId: z.string().describe("Workflow ID (e.g. 'wf_abc123')"),
      },
    },
    async ({ workflowId }) => {
      validateWorkflowId(workflowId);
      const schedule = await request<Record<string, unknown>>(
        `/v1/workflows/${workflowId}/schedule`,
      );
      if (!schedule)
        throw new Error(`No schedule found for workflow ${workflowId}`);
      return {
        content: [
          {
            type: "text",
            text: truncateResponse(JSON.stringify(schedule, null, 2)),
          },
        ],
      };
    },
  );
}
