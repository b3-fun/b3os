import { describe, it, expect } from "vitest";
import { formatCaddieBlocksForCLI } from "../tools/parse-caddie-blocks.js";

function askMsg(questions: unknown[], before = "", after = ""): string {
  const block = `[[ASK]]\n${JSON.stringify({ questions })}\n[[/ASK]]`;
  return [before, block, after].filter(Boolean).join("\n");
}

describe("formatAskBlockForCLI", () => {
  it("passes through messages without [[ASK]] block", () => {
    const msg = "Here is some information about your workflow.";
    expect(formatCaddieBlocksForCLI(msg)).toBe(msg);
  });

  it("passes through malformed JSON", () => {
    const msg = "[[ASK]]\n{this is not json at all!@#$\n[[/ASK]]";
    expect(formatCaddieBlocksForCLI(msg)).toBe(msg);
  });

  it("formats a minimal text question", () => {
    const msg = askMsg([{ id: "name", type: "text", label: "Workflow name" }]);
    const result = formatCaddieBlocksForCLI(msg);
    expect(result).toContain("Caddie needs the following information");
    expect(result).toContain("1. **Workflow name**");
    expect(result).not.toContain("   -> "); // text type has no tool instruction line
    expect(result).toContain("Workflow name:");
  });

  it("shows tool instructions for slack-channel", () => {
    const msg = askMsg([
      {
        id: "ch",
        type: "slack-channel",
        label: "Which Slack channel?",
        required: true,
      },
    ]);
    const result = formatCaddieBlocksForCLI(msg);
    expect(result).toContain("b3os_list_connectors");
    expect(result).toContain("b3os_list_slack_channels");
    expect(result).toContain("(required)");
  });

  it("shows tool instructions for turnkey-wallet", () => {
    const msg = askMsg([
      {
        id: "wallet",
        type: "turnkey-wallet",
        label: "Which wallet?",
        required: true,
      },
    ]);
    const result = formatCaddieBlocksForCLI(msg);
    expect(result).toContain("b3os_whoami");
    expect(result).toContain("b3os_list_wallets");
  });

  it("shows inline chain IDs for chain-id type", () => {
    const msg = askMsg([
      { id: "chain", type: "chain-id", label: "Which blockchain?" },
    ]);
    const result = formatCaddieBlocksForCLI(msg);
    expect(result).toContain("8453=Base");
    expect(result).toContain("1=Ethereum");
  });

  it("surfaces default values", () => {
    const msg = askMsg([
      {
        id: "chain",
        type: "chain-id",
        label: "Which blockchain?",
        default: 8453,
      },
    ]);
    const result = formatCaddieBlocksForCLI(msg);
    expect(result).toContain("Default: 8453");
  });

  it("renders options for select type", () => {
    const msg = askMsg([
      {
        id: "color",
        type: "select",
        label: "Pick a color",
        options: [
          { value: "red", label: "Red" },
          { value: "blue", label: "Blue" },
        ],
      },
    ]);
    const result = formatCaddieBlocksForCLI(msg);
    expect(result).toContain("Options: Red, Blue");
  });

  it("marks required questions", () => {
    const msg = askMsg([
      { id: "a", type: "text", label: "Required field", required: true },
      { id: "b", type: "text", label: "Optional field", required: false },
    ]);
    const result = formatCaddieBlocksForCLI(msg);
    expect(result).toContain("**Required field** (required)");
    expect(result).not.toContain("**Optional field** (required)");
  });

  it("preserves before and after text", () => {
    const msg = askMsg(
      [{ id: "x", type: "text", label: "Something" }],
      "I need a few details before continuing.",
      "Thanks for your patience!",
    );
    const result = formatCaddieBlocksForCLI(msg);
    expect(result).toContain("I need a few details before continuing.");
    expect(result).toContain("Thanks for your patience!");
  });

  it("handles unknown widget type gracefully", () => {
    const msg = askMsg([
      { id: "x", type: "future-widget-v99", label: "New thing" },
    ]);
    const result = formatCaddieBlocksForCLI(msg);
    expect(result).toContain("1. **New thing**");
    expect(result).not.toContain("   -> "); // no tool instruction for unknown type
  });

  it("returns before text for empty questions array", () => {
    const msg =
      'Some context\n[[ASK]]\n{"questions":[]}\n[[/ASK]]\nTrailing text';
    const result = formatCaddieBlocksForCLI(msg);
    expect(result).toBe(msg); // passes through unchanged
  });

  it("uses connector_type property for connector-account", () => {
    const msg = askMsg([
      {
        id: "gmail",
        type: "connector-account",
        label: "Gmail account",
        properties: { connector_type: "pipedream:gmail" },
      },
    ]);
    const result = formatCaddieBlocksForCLI(msg);
    expect(result).toContain("b3os_list_connectors");
    expect(result).toContain("pipedream:gmail");
  });

  it("handles repaired JSON with trailing commas", () => {
    // Simulate LLM trailing comma — the repair logic should fix it
    const msg =
      '[[ASK]]\n{"questions":[{"id":"x","type":"text","label":"Name",},]}\n[[/ASK]]';
    const result = formatCaddieBlocksForCLI(msg);
    expect(result).toContain("1. **Name**");
  });

  it("shows description when present", () => {
    const msg = askMsg([
      {
        id: "addr",
        type: "address",
        label: "Recipient address",
        description: "The wallet to send tokens to",
      },
    ]);
    const result = formatCaddieBlocksForCLI(msg);
    expect(result).toContain("The wallet to send tokens to");
  });

  it("shows token-address tool instructions", () => {
    const msg = askMsg([
      { id: "token", type: "token-address", label: "Which token?" },
    ]);
    const result = formatCaddieBlocksForCLI(msg);
    expect(result).toContain("b3os_token_lookup");
  });

  it("shows telegram-chat tool instructions", () => {
    const msg = askMsg([
      { id: "chat", type: "telegram-chat", label: "Which Telegram chat?" },
    ]);
    const result = formatCaddieBlocksForCLI(msg);
    expect(result).toContain("b3os_list_telegram_chats");
  });
});

function planMsg(
  changes: unknown[],
  note?: string,
  before = "",
  after = "",
): string {
  const block = `[[PLAN]]\n${JSON.stringify({ changes, ...(note ? { note } : {}) })}\n[[/PLAN]]`;
  return [before, block, after].filter(Boolean).join("\n");
}

describe("formatCaddieBlocksForCLI — PLAN blocks", () => {
  it("passes through messages without [[PLAN]] block", () => {
    const msg = "Here is some info.";
    expect(formatCaddieBlocksForCLI(msg)).toBe(msg);
  });

  it("formats a plan with changes", () => {
    const msg = planMsg([
      {
        action: "add",
        nodeId: "node-1",
        type: "coingecko-price",
        description: "Check ETH price",
      },
      {
        action: "add",
        nodeId: "node-2",
        type: "slack-send-message",
        description: "Send Slack alert",
      },
    ]);
    const result = formatCaddieBlocksForCLI(msg);
    expect(result).toContain("Caddie proposes the following workflow plan:");
    expect(result).toContain("1. [ADD] Check ETH price (coingecko-price)");
    expect(result).toContain("2. [ADD] Send Slack alert (slack-send-message)");
    expect(result).toContain(
      "IMPORTANT: Present this plan to the user for review",
    );
    expect(result).toContain("Looks good, build it.");
  });

  it("includes the note when present", () => {
    const msg = planMsg(
      [{ action: "add", nodeId: "node-1", description: "Do something" }],
      "This workflow monitors ETH price hourly.",
    );
    const result = formatCaddieBlocksForCLI(msg);
    expect(result).toContain("This workflow monitors ETH price hourly.");
  });

  it("preserves before and after text", () => {
    const msg = planMsg(
      [{ action: "add", nodeId: "node-1", description: "Step one" }],
      undefined,
      "Here is what I suggest.",
      "Let me know if you want changes.",
    );
    const result = formatCaddieBlocksForCLI(msg);
    expect(result).toContain("Here is what I suggest.");
    expect(result).toContain("Let me know if you want changes.");
  });

  it("handles update and remove actions", () => {
    const msg = planMsg([
      {
        action: "update",
        nodeId: "node-1",
        description: "Change threshold to $1500",
      },
      {
        action: "remove",
        nodeId: "node-3",
        description: "Remove duplicate filter",
      },
    ]);
    const result = formatCaddieBlocksForCLI(msg);
    expect(result).toContain("[UPDATE] Change threshold to $1500");
    expect(result).toContain("[REMOVE] Remove duplicate filter");
  });

  it("returns message unchanged for empty changes", () => {
    const msg = planMsg([]);
    expect(formatCaddieBlocksForCLI(msg)).toBe(msg);
  });

  it("includes feedback instruction", () => {
    const msg = planMsg([
      { action: "add", nodeId: "n1", description: "A step" },
    ]);
    const result = formatCaddieBlocksForCLI(msg);
    expect(result).toContain("If the user wants changes");
  });
});

describe("formatCaddieBlocksForCLI — callerTool parameter", () => {
  it("defaults to b3os_build_workflow in ASK footer", () => {
    const msg = askMsg([{ id: "x", type: "text", label: "Name" }]);
    const result = formatCaddieBlocksForCLI(msg);
    expect(result).toContain("call `b3os_build_workflow` again");
    expect(result).not.toContain("b3os_debug_run");
  });

  it("uses b3os_debug_run in ASK footer when specified", () => {
    const msg = askMsg([{ id: "x", type: "text", label: "Name" }]);
    const result = formatCaddieBlocksForCLI(msg, "b3os_debug_run");
    expect(result).toContain("call `b3os_debug_run` again");
    expect(result).not.toContain("b3os_build_workflow");
  });

  it("uses callerTool in PLAN footer for approve and feedback", () => {
    const msg = planMsg([
      { action: "add", nodeId: "n1", description: "A step" },
    ]);
    const result = formatCaddieBlocksForCLI(msg, "b3os_debug_run");
    expect(result).toContain(
      'call `b3os_debug_run` again with "Looks good, build it."',
    );
    expect(result).toContain("call `b3os_debug_run` with their feedback");
    expect(result).not.toContain("b3os_build_workflow");
  });
});

describe("getAnswerPlaceholder — address types", () => {
  it("uses <0x...> for address type", () => {
    const msg = askMsg([
      { id: "addr", type: "address", label: "Wallet address" },
    ]);
    const result = formatCaddieBlocksForCLI(msg);
    expect(result).toContain("Wallet address: <0x...>");
  });

  it("uses <0x...> for recipient-address type", () => {
    const msg = askMsg([
      { id: "to", type: "recipient-address", label: "Recipient" },
    ]);
    const result = formatCaddieBlocksForCLI(msg);
    expect(result).toContain("Recipient: <0x...>");
  });
});

// Extract the JSON payload between the AskUserQuestion markers so tests can
// assert on structured content rather than the wrapping text.
function extractAskUserQuestionPayload(
  text: string,
): { questions: Array<Record<string, unknown>> } | null {
  const openMarker =
    "=== AskUserQuestion payload (pass to AskUserQuestion verbatim) ===";
  const closeMarker = "=== end AskUserQuestion payload ===";
  const start = text.indexOf(openMarker);
  if (start === -1) return null;
  const end = text.indexOf(closeMarker, start);
  if (end === -1) return null;
  const json = text.slice(start + openMarker.length, end).trim();
  return JSON.parse(json);
}

describe("formatCaddieBlocksForCLI — AskUserQuestion payload", () => {
  it("emits a payload for a question with ≥2 discrete options", () => {
    const msg = askMsg([
      {
        id: "alert_action",
        type: "select",
        label: "What should happen on each check?",
        options: [
          {
            value: "post",
            label: "Post price every time",
            description: "Send on every tick",
          },
          {
            value: "threshold",
            label: "Alert only on threshold",
            description: "Only when crossed",
          },
        ],
      },
    ]);
    const result = formatCaddieBlocksForCLI(msg);
    const payload = extractAskUserQuestionPayload(result);
    expect(payload).not.toBeNull();
    expect(payload!.questions).toHaveLength(1);
    const q = payload!.questions[0] as {
      question: string;
      header: string;
      multiSelect: boolean;
      options: Array<{ label: string; description: string }>;
    };
    expect(q.question).toBe("What should happen on each check?");
    expect(q.multiSelect).toBe(false);
    expect(q.options).toHaveLength(2);
    expect(q.options[0].label).toBe("Post price every time"); // 4 words, under cap
    expect(q.options[0].description).toBe("Send on every tick");
  });

  it("skips the payload entirely when no question has options", () => {
    const msg = askMsg([
      { id: "threshold", type: "number", label: "Threshold in USD?" },
      { id: "recipient", type: "address", label: "Recipient wallet?" },
    ]);
    const result = formatCaddieBlocksForCLI(msg);
    expect(extractAskUserQuestionPayload(result)).toBeNull();
    // Text flow is still emitted
    expect(result).toContain("Caddie needs the following information");
  });

  it("includes only questions with ≥2 options in the payload", () => {
    const msg = askMsg([
      {
        id: "alert",
        type: "select",
        label: "Alert style?",
        options: [
          { value: "a", label: "Post" },
          { value: "b", label: "Threshold" },
        ],
      },
      { id: "threshold", type: "number", label: "Threshold value?" },
    ]);
    const result = formatCaddieBlocksForCLI(msg);
    const payload = extractAskUserQuestionPayload(result);
    expect(payload).not.toBeNull();
    expect(payload!.questions).toHaveLength(1);
    const q = payload!.questions[0] as { question: string };
    expect(q.question).toBe("Alert style?");
    // Text flow still covers the free-text threshold question
    expect(result).toContain("**Threshold value?**");
  });

  it("truncates option labels to 5 words", () => {
    const msg = askMsg([
      {
        id: "style",
        type: "select",
        label: "Pick one?",
        options: [
          {
            value: "a",
            label: "Post the current price to Slack every single tick",
          },
          { value: "b", label: "Alert only on threshold crossing events" },
        ],
      },
    ]);
    const result = formatCaddieBlocksForCLI(msg);
    const payload = extractAskUserQuestionPayload(result);
    const q = payload!.questions[0] as { options: Array<{ label: string }> };
    expect(q.options[0].label.split(/\s+/)).toHaveLength(5);
    expect(q.options[0].label).toBe("Post the current price to");
  });

  it("caps options at 4 when the question has more", () => {
    const msg = askMsg([
      {
        id: "choice",
        type: "select",
        label: "Pick?",
        options: [
          { value: "1", label: "One" },
          { value: "2", label: "Two" },
          { value: "3", label: "Three" },
          { value: "4", label: "Four" },
          { value: "5", label: "Five" },
          { value: "6", label: "Six" },
        ],
      },
    ]);
    const result = formatCaddieBlocksForCLI(msg);
    const payload = extractAskUserQuestionPayload(result);
    const q = payload!.questions[0] as { options: unknown[] };
    expect(q.options).toHaveLength(4);
  });

  it("caps questions at 4 when there are more eligible ones", () => {
    const options = [
      { value: "a", label: "A" },
      { value: "b", label: "B" },
    ];
    const msg = askMsg([
      { id: "q1", type: "select", label: "Q1?", options },
      { id: "q2", type: "select", label: "Q2?", options },
      { id: "q3", type: "select", label: "Q3?", options },
      { id: "q4", type: "select", label: "Q4?", options },
      { id: "q5", type: "select", label: "Q5?", options },
    ]);
    const result = formatCaddieBlocksForCLI(msg);
    const payload = extractAskUserQuestionPayload(result);
    expect(payload!.questions).toHaveLength(4);
  });

  it("derives header (≤12 chars) from snake_case id", () => {
    const msg = askMsg([
      {
        id: "chain_id",
        type: "select",
        label: "Which chain should the workflow run on?",
        options: [
          { value: "8453", label: "Base" },
          { value: "1", label: "Ethereum" },
        ],
      },
    ]);
    const result = formatCaddieBlocksForCLI(msg);
    const payload = extractAskUserQuestionPayload(result);
    const q = payload!.questions[0] as { header: string };
    expect(q.header).toBe("Chain Id");
    expect(q.header.length).toBeLessThanOrEqual(12);
  });

  it("falls back to a truncated label when id is too long", () => {
    const msg = askMsg([
      {
        id: "this_is_a_ridiculously_long_id_that_wont_fit",
        type: "select",
        label: "Which liquidity provider should we use?",
        options: [
          { value: "a", label: "Uniswap" },
          { value: "b", label: "Aerodrome" },
        ],
      },
    ]);
    const result = formatCaddieBlocksForCLI(msg);
    const payload = extractAskUserQuestionPayload(result);
    const q = payload!.questions[0] as { header: string };
    expect(q.header.length).toBeLessThanOrEqual(12);
    expect(q.header.length).toBeGreaterThan(0);
  });

  it("appends '?' to the question text when missing", () => {
    const msg = askMsg([
      {
        id: "x",
        type: "select",
        label: "Pick a thing",
        options: [
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ],
      },
    ]);
    const result = formatCaddieBlocksForCLI(msg);
    const payload = extractAskUserQuestionPayload(result);
    const q = payload!.questions[0] as { question: string };
    expect(q.question).toBe("Pick a thing?");
  });

  it("uses option description when provided, falls back to label otherwise", () => {
    const msg = askMsg([
      {
        id: "x",
        type: "select",
        label: "Pick?",
        options: [
          { value: "a", label: "Alpha", description: "First letter" },
          { value: "b", label: "Beta" },
        ],
      },
    ]);
    const result = formatCaddieBlocksForCLI(msg);
    const payload = extractAskUserQuestionPayload(result);
    const q = payload!.questions[0] as {
      options: Array<{ description: string }>;
    };
    expect(q.options[0].description).toBe("First letter");
    expect(q.options[1].description).toBe("Beta");
  });
});
