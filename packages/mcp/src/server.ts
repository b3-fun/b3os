import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerOrgTools } from "./tools/org.js";
import { registerConnectorTools } from "./tools/connectors.js";
import { registerCatalogTools } from "./tools/catalog.js";
import { registerWorkflowTools } from "./tools/workflows.js";
import { registerRunTools } from "./tools/runs.js";
import { registerBlockchainTools } from "./tools/blockchain.js";
import { registerDatabaseTools } from "./tools/database.js";
import { registerLookupTools } from "./tools/lookups.js";
import { registerCaddieTools } from "./tools/caddie.js";
import { installHintInterceptor } from "./tools/register-tool-safe.js";
import { GUIDE_URI, GUIDE_CONTENT } from "./guide.js";

const INSTRUCTIONS = `You have access to B3OS, a workflow automation platform for blockchain operations.

CRITICAL RULES:

1. GATHER ALL PREREQUISITES FIRST — Before building any workflow, collect every user
   input needed (connector choice, wallet, chat IDs, addresses, thresholds, etc.).
   Ask all questions in ONE message, not one at a time. Use these tools to discover
   options: b3os_list_connectors, b3os_list_wallets, b3os_list_telegram_chats,
   b3os_list_slack_channels. Present the available options to the user and let them choose.

   CONNECTOR SETUP: If b3os_list_connectors returns no connectors of the type needed
   (e.g., no "slack" connector for a Slack workflow), tell the user to set one up at
   https://b3os.org/connectors BEFORE proceeding. Do NOT build a workflow with
   placeholder connector IDs — it will fail at runtime.

2. CONFIRM BEFORE SENSITIVE OPERATIONS — Always ask for explicit user confirmation
   before: b3os_publish_workflow, b3os_delete_workflow, b3os_run_workflow,
   b3os_run_ephemeral, b3os_cancel_run.
   Show a summary of what will happen and wait for approval.

3. PRESENT QUESTIONS INTERACTIVELY — When b3os_build_workflow or b3os_debug_run
   returns a "Caddie needs the following information to continue:" block and
   the response includes a section marked:

     === AskUserQuestion payload (pass to AskUserQuestion verbatim) ===
     { "questions": [ ... ] }
     === end AskUserQuestion payload ===

   call your host's native interactive question tool (in Claude Code: the
   AskUserQuestion tool) with EXACTLY that questions array — do NOT echo the
   text list as a chat message. The payload is already shaped to the
   AskUserQuestion schema (header ≤12 chars, 2-4 options per question,
   ≤4 questions total); pass it through verbatim without transformation.

   If the payload has fewer questions than the text block shows, those missing
   questions are free-text or had too many options to fit the picker — ask
   about them as a follow-up text prompt after the user picks the interactive
   ones.

   If the response has no "=== AskUserQuestion payload ===" marker at all, no
   questions were eligible for the picker (all free-text); fall back to echoing
   the text list and letting the user type answers.

   After collecting the user's answers, call the originating tool
   (b3os_build_workflow or b3os_debug_run) again with the answers inlined in
   the message field.

HOW TO BUILD WORKFLOWS:

Use b3os_build_workflow to construct workflows. It delegates to Caddie, the B3OS AI
agent which has deep domain knowledge, address verification, and repair capabilities.

1. Gather prerequisites: b3os_list_connectors, b3os_list_wallets → present options
2. Describe the workflow in natural language to b3os_build_workflow
3. Review the returned definition with the user
4. Save: b3os_create_workflow (new) or b3os_update_workflow (existing)
5. Confirm with user → then deploy: b3os_publish_workflow

To modify an existing workflow, pass its workflowId to b3os_build_workflow.

DEBUGGING FAILED RUNS:

Use b3os_debug_run to diagnose failures. Caddie will analyze the execution state,
identify the root cause, and suggest definition fixes.

1. b3os_list_runs (status: "failure") → find failed runs
2. b3os_debug_run (runId) → Caddie diagnoses + suggests fixes
3. Apply fix: b3os_update_workflow → b3os_publish_workflow

DATA QUERIES (use named lookup tools for common queries):

- Token info: b3os_token_lookup (network + address, or coinId)
- Prices: b3os_price_lookup (coinIds)
- Wallet balances: b3os_balance_lookup (address, chainIds, limit)
- DeFi positions: b3os_defi_lookup (address, chainId)
- Tx debugging: b3os_debug_transaction (txHash, chainId)
- Polymarket: b3os_polymarket_lookup (query, slug, or marketUrl)
- Any other read-only query: b3os_query_action (use b3os_search_actions to find action types first)

ONE-SHOT EXECUTION (no save):
- b3os_run_action for single-action lookups (simpler than ephemeral)
- b3os_run_ephemeral for multi-step definitions (max 20 nodes, 60s timeout)

DATABASE (org's SQLite-compatible database, READ-ONLY via MCP):
- ALWAYS call b3os_list_tables FIRST to check what already exists before querying
- b3os_get_table_schema → inspect column definitions of existing tables
- b3os_query_database → execute read-only SQL (SELECT only). Write operations
  (INSERT, UPDATE, DELETE, CREATE, ALTER, DROP) must be done via the web UI at
  b3os.org/databases.
- Use parameterized queries: sql="SELECT * FROM t WHERE id = ?", params=["val"]
- Reuse existing tables when possible — check schema and data before suggesting new ones

BLOCK EXPLORER RULE: NEVER fetch from basescan.org, etherscan.io, or other block
explorers. Use b3os_debug_transaction or b3os_query_action instead.

RESOURCES: Read b3os://guide for workflow definition anatomy, expression syntax, node
types, and common patterns.`;

export function createServer(): McpServer {
  // The MCP spec defines server `instructions` (§ 5.2.1) but the SDK types
  // don't expose it yet. Cast to satisfy the compiler.
  // https://spec.modelcontextprotocol.io/specification/2025-03-26/server/utilities/instructions/
  const server = new McpServer({ name: "b3os", version: "1.0.0" }, { instructions: INSTRUCTIONS } as Record<
    string,
    unknown
  >);

  registerOrgTools(server);
  registerConnectorTools(server);
  registerCatalogTools(server);
  registerWorkflowTools(server);
  registerRunTools(server);
  registerBlockchainTools(server);
  registerDatabaseTools(server);
  registerLookupTools(server);
  registerCaddieTools(server);

  server.resource("guide", GUIDE_URI, { mimeType: "text/markdown" }, async () => ({
    contents: [
      {
        uri: GUIDE_URI,
        mimeType: "text/markdown",
        text: GUIDE_CONTENT,
      },
    ],
  }));

  // Must run AFTER all tools are registered so the tools/call request handler exists.
  // Replaces the SDK's dispatcher with one that catches validation failures and
  // returns rich hints instead of raw error responses.
  installHintInterceptor(server);

  return server;
}
