/**
 * SSE Event types emitted by the Caddie chat endpoint.
 *
 * ## Adding new event types
 * When Caddie adds a new SSE event type:
 * 1. Add the type string to CaddieEventType
 * 2. Add the typed interface to CaddieEvent union
 * 3. consumeCaddieStream() already forwards unknown events — no changes needed there
 */
export type CaddieEventType =
  | "thinking"
  | "tool_start"
  | "tool_result"
  | "node"
  | "chunk"
  | "done"
  | "error"
  | "mode_switch"
  | "sheet_data";

export interface CaddieDoneData {
  type: "workflow" | "message";
  workflow?: Record<string, unknown>;
  message?: string;
  incompleteFields?: string[];
  validationErrors?: Array<{ nodeId?: string; message: string }>;
}

export interface CaddieDoneEvent {
  type: "done";
  data: CaddieDoneData;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
  };
  toolUtilization?: Array<{ toolName: string; callCount: number; score: number }>;
}

export interface CaddieErrorEvent {
  type: "error";
  error: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CaddieEvent = { type: CaddieEventType; [key: string]: any };

/**
 * Parse raw SSE text into an array of typed events.
 * Each SSE message is separated by a blank line (`\n\n`).
 * Lines starting with `data: ` contain the JSON payload.
 * Lines starting with `:` are comments (heartbeats) and are skipped.
 */
export function parseSseEvents(raw: string): CaddieEvent[] {
  const events: CaddieEvent[] = [];
  const blocks = raw.split("\n\n");

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    const dataLines: string[] = [];
    for (const line of trimmed.split("\n")) {
      if (line.startsWith("data: ")) {
        dataLines.push(line.slice(6));
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5));
      }
    }

    if (dataLines.length === 0) continue;

    try {
      const parsed = JSON.parse(dataLines.join("")) as CaddieEvent;
      if (parsed && typeof parsed.type === "string") {
        events.push(parsed);
      }
    } catch {
      // Skip malformed JSON
    }
  }

  return events;
}

/**
 * POST to the Caddie chat endpoint and consume the SSE stream.
 * Returns the final `done` event, or throws on `error` event or timeout.
 *
 * @param apiKey  - B3OS API key for Authorization header
 * @param serverUrl - B3OS server base URL
 * @param params  - Chat request parameters (message, workflowId, definition, etc.)
 * @param timeoutMs - Max time to wait for the stream to complete (default: 120s)
 */
export async function consumeCaddieStream(
  apiKey: string,
  serverUrl: string,
  params: {
    message: string;
    workflowId?: string;
    definition?: Record<string, unknown>;
    agentVersion?: string;
  },
  timeoutMs = 120_000,
): Promise<CaddieDoneEvent> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${serverUrl}/v1/ai/workflow/chat/stream`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        message: params.message,
        workflowId: params.workflowId,
        definition: params.definition,
        agentVersion: params.agentVersion ?? "v2",
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text();
      // Sanitize: strip HTML error pages (Cloudflare 502s etc.) and truncate
      const clean = /^\s*<(!DOCTYPE|html)/i.test(body)
        ? "(HTML error page — server may be temporarily unavailable)"
        : body.length > 500
          ? body.slice(0, 500) + "…(truncated)"
          : body;
      throw new Error(`Caddie API error ${response.status}: ${clean}`);
    }

    const text = await response.text();
    const events = parseSseEvents(text);

    const errorEvent = events.find((e): e is CaddieErrorEvent => e.type === "error");
    if (errorEvent) {
      throw new Error(`Caddie error: ${errorEvent.error}`);
    }

    const doneEvent = events.find(
      (e): e is CaddieDoneEvent => e.type === "done" && e.data != null && typeof e.data.type === "string",
    );
    if (!doneEvent) {
      // Check if there's a done event without valid data — distinguishes "no done event" from "malformed done event"
      const malformedDone = events.find(e => e.type === "done");
      if (malformedDone) {
        throw new Error(
          `Caddie returned a done event without valid data: ${JSON.stringify(malformedDone).slice(0, 500)}`,
        );
      }
      throw new Error("Caddie stream ended without a done event");
    }

    return doneEvent;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Caddie request timed out after ${timeoutMs / 1000} seconds`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
