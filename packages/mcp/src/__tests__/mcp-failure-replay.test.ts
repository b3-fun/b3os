import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { createServer } from "../server.js";

// Mock the client.request function used by all tools. Every tool call hits this mock.
vi.mock("../client.js", async () => {
  const actual =
    await vi.importActual<typeof import("../client.js")>("../client.js");
  return {
    ...actual,
    request: vi.fn(),
    getApiKey: vi.fn(() => "test-key"),
    getServerUrl: vi.fn(() => "http://test"),
  };
});

// Mock the SSE Caddie stream so b3os_build_workflow doesn't hit the network.
vi.mock("../sse-client.js", () => ({
  consumeCaddieStream: vi.fn(async () => ({
    data: { type: "message", message: "caddie said hi" },
  })),
}));

import * as clientModule from "../client.js";
import * as sseModule from "../sse-client.js";

import { callTool } from "./test-utils.js";

describe("MCP failure replay — transcript regression tests", () => {
  let server: ReturnType<typeof createServer>;

  beforeAll(() => {
    server = createServer();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("Failure #1: b3os_list_slack_channels with snake_case connector_id", async () => {
    // Transcript error: `expected string, received undefined` for `connectorId`
    (clientModule.request as ReturnType<typeof vi.fn>).mockResolvedValue({
      items: [{ id: "C1", name: "testbot-action" }],
    });

    const result = await callTool(server, "b3os_list_slack_channels", {
      connector_id: "conn_d72d8f37b42000fmpbkg",
    });

    expect((result as { isError?: boolean }).isError).not.toBe(true);
    expect(clientModule.request).toHaveBeenCalled();
  });

  it("Failure #2: b3os_build_workflow with 'prompt' instead of 'message'", async () => {
    // Transcript error: `expected string, received undefined` for `message`
    const result = await callTool(server, "b3os_build_workflow", {
      prompt: "Build a workflow that monitors ETH price every 5 min",
    });

    expect((result as { isError?: boolean }).isError).not.toBe(true);
    expect(sseModule.consumeCaddieStream).toHaveBeenCalledWith(
      "test-key",
      "http://test",
      expect.objectContaining({
        message: "Build a workflow that monitors ETH price every 5 min",
      }),
    );
  });

  it("Failure #3: b3os_validate_workflow with 'workflow' instead of 'definition'", async () => {
    // Transcript error: `expected object, received undefined` for `definition`
    (clientModule.request as ReturnType<typeof vi.fn>).mockResolvedValue({
      valid: true,
    });

    const result = await callTool(server, "b3os_validate_workflow", {
      workflow: {
        nodes: { root: { type: "manual", payload: {}, children: [] } },
      },
    });

    expect((result as { isError?: boolean }).isError).not.toBe(true);
    expect(clientModule.request).toHaveBeenCalledWith(
      "/v1/workflows/validate",
      expect.objectContaining({
        method: "POST",
        body: expect.objectContaining({
          definition: {
            nodes: { root: { type: "manual", payload: {}, children: [] } },
          },
        }),
      }),
    );
  });

  it("Failure #4: b3os_validate_workflow with stringified definition", async () => {
    // Transcript error: `expected object, received string` for `definition`
    (clientModule.request as ReturnType<typeof vi.fn>).mockResolvedValue({
      valid: true,
    });

    const stringifiedDef =
      '{"nodes":{"root":{"type":"manual","payload":{},"children":[]}}}';
    const result = await callTool(server, "b3os_validate_workflow", {
      definition: stringifiedDef,
    });

    expect((result as { isError?: boolean }).isError).not.toBe(true);
    expect(clientModule.request).toHaveBeenCalledWith(
      "/v1/workflows/validate",
      expect.objectContaining({
        method: "POST",
        body: expect.objectContaining({
          definition: {
            nodes: { root: { type: "manual", payload: {}, children: [] } },
          },
        }),
      }),
    );
  });
});
