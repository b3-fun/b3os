/**
 * Parse [[ASK]] and [[PLAN]] blocks from Caddie messages and format them
 * as CLI-friendly instructions.
 *
 * [[ASK]] blocks become tool instructions (which MCP tools to call).
 * [[PLAN]] blocks become reviewable proposals (present to user before approving).
 */

import type { AskWidgetType } from "./ask-widget-types.generated.js";

interface AskOption {
  value: string;
  label: string;
  description?: string;
}

interface AskQuestion {
  id: string;
  type: AskWidgetType | (string & {});
  label: string;
  options?: AskOption[];
  required?: boolean;
  default?: unknown;
  description?: string;
  properties?: Record<string, unknown>;
  chainFamily?: "evm" | "solana";
}

interface AskBlock {
  questions: AskQuestion[];
}

const CHAIN_IDS_HINT =
  "Common chain IDs: 1=Ethereum, 8453=Base, 42161=Arbitrum, 137=Polygon, 10=Optimism, 56=BSC, 7565164=Solana";

/**
 * Maps widget types to CLI-friendly tool instructions.
 * Types not in this map get no tool suggestion (ask user directly).
 * Update here when adding new widget types that have associated MCP tools.
 */
const TOOL_INSTRUCTIONS: Partial<Record<AskWidgetType, string | ((q: AskQuestion) => string)>> = {
  "slack-channel":
    'Use `b3os_list_connectors` to find your Slack connector ID (type: "slack"), then `b3os_list_slack_channels` with that connectorId to see available channels.',
  "telegram-chat":
    'Use `b3os_list_connectors` to find your Telegram bot connector ID (type: "telegram-bot"), then `b3os_list_telegram_chats` with that connectorId to see available chats.',
  "turnkey-wallet":
    "Use `b3os_whoami` to get your orgId, then `b3os_list_wallets` with that orgId to see available wallets.",
  "connector-account": (q: AskQuestion) => {
    const connType = q.properties?.connector_type as string | undefined;
    if (connType) {
      return `Use \`b3os_list_connectors\` and find a connector with type: "${connType}".`;
    }
    return "Use `b3os_list_connectors` to see available connectors.";
  },
  "quickbooks-account": 'Use `b3os_list_connectors` to find your QuickBooks connector (type: "quickbooks").',
  "token-address":
    "Use `b3os_token_lookup` to resolve a token by name/symbol, or provide the contract address directly.",
  "token-addresses":
    "Use `b3os_token_lookup` to resolve tokens by name/symbol, or provide contract addresses directly.",
  "asset-selector": "Use `b3os_token_lookup` to find the token, or provide the CoinGecko coin ID directly.",
  "chain-id": CHAIN_IDS_HINT,
  "chain-ids": CHAIN_IDS_HINT,
  network: CHAIN_IDS_HINT,
  networks: CHAIN_IDS_HINT,
  "polymarket-outcome":
    'Use `b3os_polymarket_lookup` to find the market, then provide the answer as JSON: { "market": "<url>", "outcome": "Yes" }',
  "database-table": (q: AskQuestion) => {
    const tableName = q.properties?.tableName as string | undefined;
    const columns = q.properties?.columns;
    const schemaInfo = tableName ? ` Proposed table name: "${tableName}".` : "";
    const columnInfo = Array.isArray(columns) ? ` Proposed columns: ${JSON.stringify(columns)}.` : "";
    return (
      `The table must be created BEFORE the workflow runs — workflow nodes cannot CREATE/ALTER tables.${schemaInfo}${columnInfo} ` +
      `REVIEW THE SCHEMA: tables should be named by FUNCTION (e.g. "price_alerts", "budgets", "positions"), NOT by workflow (e.g. "eth_price_alert_state"). ` +
      `Always include a workflow_id TEXT column so multiple workflows can share the table. ` +
      `If Caddie's proposed name/schema is workflow-specific, suggest a more reusable design to the user before proceeding. ` +
      `The MCP service account is read-only and cannot create tables. Once the user approves a schema, ask them to create the table via the B3OS web UI at b3os.org/databases, then ask for the table name to use as the answer.`
    );
  },
};

// JSON repair logic for LLM-generated blocks

function repairLLMJSON(json: string): string {
  let repaired = json.replace(/\r?\n/g, " ");
  repaired = repaired.replace(/,\s*([}\]])/g, "$1");
  return repaired;
}

function findBracePositions(json: string, brace: string): number[] {
  const positions: number[] = [];
  let inString = false;
  let escaped = false;

  for (let i = 0; i < json.length; i++) {
    const ch = json[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (!inString && ch === brace) positions.push(i);
  }

  return positions;
}

function rebalanceBraces<T>(json: string): T | null {
  const openPositions = findBracePositions(json, "{");
  const closePositions = findBracePositions(json, "}");

  let targets: number[];
  if (closePositions.length > openPositions.length) {
    targets = closePositions.slice(0, -1).reverse();
  } else if (openPositions.length > closePositions.length) {
    targets = openPositions.slice(1);
  } else {
    return null;
  }

  for (const pos of targets) {
    const candidate = json.slice(0, pos) + json.slice(pos + 1);
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // Try next position
    }
  }

  return null;
}

// Matches only the first [[ASK]] block — multiple blocks per message are not expected.
const ASK_BLOCK_REGEX = /\[\[ASK\]\]\s*([\s\S]*?)\s*\[\[\/ASK\]\]/;

function parseAskBlock(message: string): { before: string; askBlock: AskBlock | null; after: string } {
  const match = message.match(ASK_BLOCK_REGEX);

  if (!match) {
    return { before: message, askBlock: null, after: "" };
  }

  const [fullMatch, jsonContent] = match;
  const matchIndex = match.index!;

  const before = message.slice(0, matchIndex).trim();
  const after = message.slice(matchIndex + fullMatch.length).trim();

  let parsed: AskBlock | null = null;
  try {
    parsed = JSON.parse(jsonContent) as AskBlock;
  } catch {
    const repaired = repairLLMJSON(jsonContent);
    try {
      parsed = JSON.parse(repaired) as AskBlock;
    } catch {
      parsed = rebalanceBraces<AskBlock>(repaired);
    }
  }

  return { before, askBlock: parsed, after };
}

function getToolInstruction(question: AskQuestion): string | null {
  const entry = TOOL_INSTRUCTIONS[question.type as AskWidgetType];
  if (!entry) return null;
  if (typeof entry === "function") return entry(question);
  return entry;
}

function formatDefault(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).join(", ");
  if (typeof value === "object" && value !== null) return JSON.stringify(value);
  return String(value);
}

function formatQuestionBlock(question: AskQuestion, index: number): string {
  const lines: string[] = [];

  const reqMarker = question.required ? " (required)" : "";
  lines.push(`${index + 1}. **${question.label}**${reqMarker}`);

  if (question.description) {
    lines.push(`   ${question.description}`);
  }

  const formattedDefault = question.default != null ? formatDefault(question.default) : "";
  if (formattedDefault) {
    lines.push(`   Default: ${formattedDefault}`);
  }

  if (question.options?.length) {
    const optLabels = question.options.map(o => o.label || o.value);
    lines.push(`   Options: ${optLabels.join(", ")}`);
  }

  const instruction = getToolInstruction(question);
  if (instruction) {
    lines.push(`   -> ${instruction}`);
  }

  return lines.join("\n");
}

function getAnswerPlaceholder(type: string): string {
  switch (type) {
    case "chain-id":
    case "network":
      return "<chain ID>";
    case "chain-ids":
    case "networks":
      return "<chain ID>, <chain ID>";
    case "token-address":
    case "contract-address":
    case "address":
    case "recipient-address":
      return "<0x...>";
    case "token-addresses":
      return "<0x...>, <0x...>";
    case "turnkey-wallet":
      return "<wallet address or ID>";
    case "slack-channel":
      return "<channel ID>";
    case "telegram-chat":
      return "<chat ID>";
    case "polymarket-outcome":
      return '<{ "market": "...", "outcome": "Yes" }>';
    case "boolean":
      return "<Yes/No>";
    case "date-time":
    case "date":
      return "<ISO 8601>";
    default:
      return "<value>";
  }
}

// Markers wrapping the machine-readable AskUserQuestion payload. Both the
// server instructions and any downstream parser look for these exact strings,
// so don't change them without updating server.ts INSTRUCTIONS.
const ASK_UI_PAYLOAD_MARKER_OPEN = "=== AskUserQuestion payload (pass to AskUserQuestion verbatim) ===";
const ASK_UI_PAYLOAD_MARKER_CLOSE = "=== end AskUserQuestion payload ===";

// Mirrors Claude Code's AskUserQuestion tool schema:
// https://docs.anthropic.com/en/docs/claude-code/ask-user-question
interface AskUserQuestionOption {
  label: string; // 1-5 words, shown to user
  description: string; // required, explains the choice
}

interface AskUserQuestionEntry {
  question: string;
  header: string; // ≤12 chars
  multiSelect: boolean;
  options: AskUserQuestionOption[]; // 2-4 items
}

interface AskUserQuestionPayload {
  questions: AskUserQuestionEntry[]; // 1-4 items
}

/**
 * Derive a chip/tag label (≤12 chars) for the AskUserQuestion `header` field.
 * Prefers a humanized form of the question id; falls back to truncating the
 * question label.
 */
function deriveHeader(question: AskQuestion): string {
  if (question.id) {
    const humanized = question.id
      .replace(/[_-]+/g, " ")
      .trim()
      .split(/\s+/)
      .map(w => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : w))
      .join(" ");
    if (humanized.length > 0 && humanized.length <= 12) return humanized;
  }
  const stripped = question.label.replace(/^(which|what|how many|how)\s+/i, "").trim();
  return stripped.slice(0, 12).trim() || "Choice";
}

/** Truncate to the first N words so option labels stay within the 1-5 word limit. */
function truncateToWords(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/);
  if (words.length <= maxWords) return text.trim();
  return words.slice(0, maxWords).join(" ");
}

/**
 * Build an AskUserQuestion payload from the ASK block, mapping each question
 * with ≥2 discrete options into the schema. Free-text questions and questions
 * with <2 options are skipped — the text-formatted portion of the response
 * already covers them. Returns null if nothing is eligible.
 */
function buildAskUserQuestionPayload(askBlock: AskBlock): AskUserQuestionPayload | null {
  const entries: AskUserQuestionEntry[] = [];

  for (const q of askBlock.questions) {
    if (!q.options || q.options.length < 2) continue;

    // Schema caps options at 4; take the first 4 and normalize.
    const options: AskUserQuestionOption[] = q.options.slice(0, 4).map(opt => {
      const rawLabel = opt.label || opt.value || "Option";
      return {
        label: truncateToWords(rawLabel, 5),
        // description is required on every option — fall back through label/value
        description: opt.description || rawLabel,
      };
    });

    if (options.length < 2) continue;

    const questionText = q.label.trim().endsWith("?") ? q.label.trim() : `${q.label.trim()}?`;

    entries.push({
      question: questionText,
      header: deriveHeader(q),
      multiSelect: false,
      options,
    });

    // Schema caps questions at 4 per call.
    if (entries.length >= 4) break;
  }

  if (entries.length === 0) return null;
  return { questions: entries };
}

function formatAskBlockForCLI(message: string, callerTool: string): string {
  const { before, askBlock, after } = parseAskBlock(message);

  if (!askBlock?.questions?.length) {
    return message;
  }

  const parts: string[] = [];

  if (before) {
    parts.push(before);
    parts.push("");
  }

  parts.push("Caddie needs the following information to continue:");
  parts.push("");

  const answerLines: string[] = [];
  for (const [i, q] of askBlock.questions.entries()) {
    if (i > 0) parts.push("");
    parts.push(formatQuestionBlock(q, i));
    answerLines.push(`  ${q.label}: ${getAnswerPlaceholder(q.type)}`);
  }

  parts.push("");
  parts.push("IMPORTANT: Present these questions to the user. Do NOT auto-answer them.");
  parts.push(
    "Only fill in values the user has already provided in this conversation. For any missing value, ask the user directly.",
  );
  parts.push(
    "If a question has an MCP tool suggestion (-> line), you may run that tool to gather options to present, but still let the user pick.",
  );
  parts.push("");
  parts.push(`Once you have the user's answers, call \`${callerTool}\` again with them formatted as:`);
  parts.push(...answerLines);

  // Emit an AskUserQuestion-shaped payload for questions with discrete choices
  // so the host (Claude Code) can render a keyboard-navigable picker instead
  // of forcing the user to type answers. Questions that aren't representable
  // as a picker (free-text, <2 options) are intentionally omitted — the text
  // block above already covers them.
  const payload = buildAskUserQuestionPayload(askBlock);
  if (payload) {
    parts.push("");
    parts.push(ASK_UI_PAYLOAD_MARKER_OPEN);
    parts.push(JSON.stringify(payload, null, 2));
    parts.push(ASK_UI_PAYLOAD_MARKER_CLOSE);
  }

  if (after) {
    parts.push("");
    parts.push(after);
  }

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// PLAN block parser
// ---------------------------------------------------------------------------

interface PlanChange {
  action: "add" | "update" | "remove";
  nodeId: string;
  type?: string;
  description: string;
}

interface PlanBlock {
  changes: PlanChange[];
  note?: string;
}

// Matches only the first [[PLAN]] block.
const PLAN_BLOCK_REGEX = /\[\[PLAN\]\]\s*([\s\S]*?)\s*\[\[\/PLAN\]\]/;

function parsePlanBlock(message: string): { before: string; planBlock: PlanBlock | null; after: string } {
  const match = message.match(PLAN_BLOCK_REGEX);

  if (!match) {
    return { before: message, planBlock: null, after: "" };
  }

  const [fullMatch, jsonContent] = match;
  const matchIndex = match.index!;

  const before = message.slice(0, matchIndex).trim();
  const after = message.slice(matchIndex + fullMatch.length).trim();

  let parsed: PlanBlock | null = null;
  try {
    parsed = JSON.parse(jsonContent) as PlanBlock;
  } catch {
    const repaired = repairLLMJSON(jsonContent);
    try {
      parsed = JSON.parse(repaired) as PlanBlock;
    } catch {
      parsed = rebalanceBraces<PlanBlock>(repaired);
    }
  }

  return { before, planBlock: parsed, after };
}

function formatPlanBlockForCLI(message: string, callerTool: string): string {
  const { before, planBlock, after } = parsePlanBlock(message);

  if (!planBlock?.changes?.length) {
    return message;
  }

  const parts: string[] = [];

  if (before) {
    parts.push(before);
    parts.push("");
  }

  parts.push("Caddie proposes the following workflow plan:");
  parts.push("");

  if (planBlock.note) {
    parts.push(planBlock.note);
    parts.push("");
  }

  for (const [i, change] of planBlock.changes.entries()) {
    const action = change.action.toUpperCase();
    const nodeType = change.type ? ` (${change.type})` : "";
    parts.push(`${i + 1}. [${action}] ${change.description}${nodeType}`);
  }

  parts.push("");
  parts.push("IMPORTANT: Present this plan to the user for review. Do NOT auto-approve it.");
  parts.push(
    `If the user approves, call \`${callerTool}\` again with "Looks good, build it." to generate the full workflow definition.`,
  );
  parts.push(`If the user wants changes, call \`${callerTool}\` with their feedback.`);

  if (after) {
    parts.push("");
    parts.push(after);
  }

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Unified formatter — handles both [[ASK]] and [[PLAN]] blocks
// ---------------------------------------------------------------------------

/**
 * Parse [[ASK]] and [[PLAN]] blocks from a Caddie message and format them
 * as CLI-friendly instructions.
 *
 * `callerTool` is the MCP tool name the agent should call when re-submitting
 * answers or approving the plan (e.g. "b3os_build_workflow" or "b3os_debug_run").
 *
 * If no blocks are found, returns the message unchanged.
 *
 * ASK and PLAN are mutually exclusive in Caddie's output (the agent must
 * choose one per response), so ASK takes precedence if both are present.
 */
export function formatCaddieBlocksForCLI(message: string, callerTool = "b3os_build_workflow"): string {
  if (message.includes("[[ASK]]")) {
    return formatAskBlockForCLI(message, callerTool);
  }
  if (message.includes("[[PLAN]]")) {
    return formatPlanBlockForCLI(message, callerTool);
  }
  return message;
}
