import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { request, truncateResponse, getApiKey, getServerUrl } from "../client.js";
import { consumeCaddieStream, type CaddieDoneEvent } from "../sse-client.js";
import { definitionSchema, validateWorkflowId, validateRunId, auditLog } from "./shared.js";
import type { Run } from "../types.js";
import { formatCaddieBlocksForCLI } from "./parse-caddie-blocks.js";
import { registerToolSafe } from "./register-tool-safe.js";

/** Format a Caddie workflow response with incomplete fields, validation errors, and next steps. */
function formatWorkflowResponse(done: CaddieDoneEvent, header: string, nextSteps: string): string {
  const parts: string[] = [header];
  parts.push(JSON.stringify(done.data.workflow, null, 2));

  if (done.data.incompleteFields?.length) {
    parts.push(`\nIncomplete fields that need user input:\n- ${done.data.incompleteFields.join("\n- ")}`);
  }

  if (done.data.validationErrors?.length) {
    parts.push("\nValidation errors:");
    for (const err of done.data.validationErrors) {
      parts.push(`- ${err.nodeId ? `[${err.nodeId}] ` : ""}${err.message}`);
    }
  }

  parts.push(`\nNext steps:\n${nextSteps}`);
  return truncateResponse(parts.join("\n"));
}

export function registerCaddieTools(s: McpServer): void {
  registerToolSafe(
    s,
    "b3os_build_workflow",
    {
      description: `Build or modify a workflow using Caddie, the B3OS AI agent. Describe what you want
in natural language and Caddie will generate or update the workflow definition.

Use this when you need to:
- Create a new workflow from a description ("monitor ETH price and alert on Telegram")
- Modify an existing workflow ("add a filter node before the swap action")
- Get help designing complex logic (branching, loops, error handling)

If workflowId is provided, Caddie loads the existing workflow and modifies it.
If definition is provided, Caddie uses it as the starting point.
Otherwise, Caddie creates a new workflow from scratch.

Returns the workflow definition JSON (ready for b3os_create_workflow or b3os_update_workflow)
along with any incomplete fields that still need user input and validation errors.`,
      inputSchema: {
        message: z.string().describe("Natural language description of what to build or change"),
        workflowId: z.string().optional().describe("Existing workflow ID to modify (e.g. 'wf_abc123')"),
        definition: definitionSchema.optional().describe("Starting definition to modify (alternative to workflowId)"),
      },
      aliases: { prompt: "message" },
    },
    async ({ message, workflowId, definition }) => {
      try {
        if (workflowId) validateWorkflowId(workflowId);
        auditLog("CADDIE_BUILD", workflowId ? `workflow ${workflowId}` : "new workflow");

        const apiKey = await getApiKey();
        const serverUrl = getServerUrl();

        const done = await consumeCaddieStream(apiKey, serverUrl, {
          message,
          workflowId,
          definition,
        });

        if (done.data.type === "workflow" && done.data.workflow) {
          const text = formatWorkflowResponse(
            done,
            "Caddie generated a workflow definition:\n",
            "1. Review the definition and fill in any incomplete fields\n2. Use b3os_validate_workflow to check for errors\n3. Use b3os_create_workflow or b3os_update_workflow to save it",
          );
          return { content: [{ type: "text", text }] };
        }

        return {
          content: [
            {
              type: "text",
              text: formatCaddieBlocksForCLI(done.data.message || "Caddie did not return a workflow or message."),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Caddie build failed: ${err instanceof Error ? err.message : err}` }],
        };
      }
    },
  );

  registerToolSafe(
    s,
    "b3os_debug_run",
    {
      description: `Debug a failed or stuck workflow run using Caddie, the B3OS AI agent.
Provide a run ID and Caddie will analyze the execution state, identify what went wrong,
and suggest fixes — potentially returning a corrected workflow definition.

Use this when:
- A run failed and you want to understand why
- A run is stuck in "running" or "waiting" status
- You need help fixing a workflow based on runtime errors

Caddie receives the full run context (status, timing, execution state per node)
and provides a diagnosis with actionable next steps.`,
      inputSchema: {
        runId: z.string().describe("Run ID to debug (e.g. 'run_abc123')"),
        message: z.string().optional().describe("Additional context or specific question about the failure"),
      },
      aliases: { prompt: "message" },
    },
    async ({ runId, message }) => {
      try {
        validateRunId(runId);
        auditLog("CADDIE_DEBUG", `run ${runId}`);

        const run = await request<Run>(`/v1/runs/${runId}`);
        if (!run) throw new Error(`Run ${runId} not found`);

        const contextParts: string[] = [];
        contextParts.push(`Debug this workflow run:`);
        contextParts.push(`- Run ID: ${run.id}`);
        contextParts.push(`- Status: ${run.status}`);
        contextParts.push(`- Workflow ID: ${run.workflowId}`);
        contextParts.push(`- Workflow Version: ${run.workflowVersion}`);
        if (run.startedAt) contextParts.push(`- Started: ${run.startedAt}`);
        if (run.finishedAt) contextParts.push(`- Finished: ${run.finishedAt}`);
        if (run.triggerSource) contextParts.push(`- Trigger: ${run.triggerSource}`);

        if (run.executionState) {
          // Truncate to avoid blowing Caddie's token budget on large execution states
          const stateJson = JSON.stringify(run.executionState, null, 2);
          contextParts.push(
            `\nExecution state:\n${stateJson.length > 30_000 ? stateJson.slice(0, 30_000) + "\n...(truncated)" : stateJson}`,
          );
        }

        if (message) {
          contextParts.push(`\nUser context: ${message}`);
        }

        const debugPrompt = contextParts.join("\n");

        const apiKey = await getApiKey();
        const serverUrl = getServerUrl();
        const done = await consumeCaddieStream(apiKey, serverUrl, {
          message: debugPrompt,
          workflowId: run.workflowId,
        });

        if (done.data.type === "workflow" && done.data.workflow) {
          const text = formatWorkflowResponse(
            done,
            `Caddie diagnosed run ${runId} and produced a fixed definition:\n`,
            `1. Review the fixed definition\n2. Use b3os_validate_workflow to verify\n3. Use b3os_update_workflow to save it to workflow ${run.workflowId}`,
          );
          return { content: [{ type: "text", text }] };
        }

        return {
          content: [
            {
              type: "text",
              text: formatCaddieBlocksForCLI(
                done.data.message || `Caddie analyzed run ${runId} but did not return a diagnosis.`,
                "b3os_debug_run",
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Caddie debug failed: ${err instanceof Error ? err.message : err}` }],
        };
      }
    },
  );
}
