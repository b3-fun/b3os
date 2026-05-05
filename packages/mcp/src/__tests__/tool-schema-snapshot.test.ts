import { describe, it, expect, vi } from "vitest";
import { createServer } from "../server.js";

// Mock client + sse so createServer() doesn't need real credentials.
vi.mock("../client.js", async () => {
  const actual = await vi.importActual<typeof import("../client.js")>("../client.js");
  return { ...actual, request: vi.fn(), getApiKey: vi.fn(() => "k"), getServerUrl: vi.fn(() => "http://t") };
});

vi.mock("../sse-client.js", () => ({
  consumeCaddieStream: vi.fn(),
}));

describe("tool schema snapshot", () => {
  it("captures the public surface of every registered tool", () => {
    const server = createServer();
    const tools = (
      server as unknown as {
        _registeredTools: Record<string, { description: string; inputSchema: unknown }>;
      }
    )._registeredTools;

    const serialized = Object.entries(tools)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, tool]) => {
        // Extract the auto-signature block (first line) from the description.
        const firstLine = tool.description.split("\n")[0];
        return {
          name,
          signature: firstLine,
        };
      });

    expect(serialized).toMatchSnapshot();
  });
});
