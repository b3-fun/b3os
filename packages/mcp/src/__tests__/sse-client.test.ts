import { describe, it, expect } from "vitest";
import { parseSseEvents } from "../sse-client.js";

describe("parseSseEvents", () => {
  it("parses a complete SSE stream into events", () => {
    const raw =
      `data: {"type":"thinking","message":"Searching actions..."}\n\n` +
      `data: {"type":"tool_start","toolName":"search_actions"}\n\n` +
      `data: {"type":"done","data":{"type":"workflow","workflow":{"nodes":{}}},"usage":{"inputTokens":100,"outputTokens":50}}\n\n`;

    const events = parseSseEvents(raw);
    expect(events).toHaveLength(3);
    expect(events[0]).toEqual({
      type: "thinking",
      message: "Searching actions...",
    });
    expect(events[2].type).toBe("done");
    expect(events[2].data.type).toBe("workflow");
    expect(events[2].data.workflow).toEqual({ nodes: {} });
  });

  it("skips empty lines and non-data lines", () => {
    const raw = `: heartbeat\n\ndata: {"type":"done","data":{"type":"message","message":"hi"}}\n\n`;
    const events = parseSseEvents(raw);
    expect(events).toHaveLength(1);
    expect(events[0].data.message).toBe("hi");
  });

  it("handles multi-line data fields", () => {
    const raw = `data: {"type":"chunk",\ndata: "data":"hello"}\n\n`;
    const events = parseSseEvents(raw);
    expect(events).toHaveLength(1);
  });
});
