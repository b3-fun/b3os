import { describe, it, expect, beforeEach, vi } from "vitest";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerToolSafe, installHintInterceptor } from "../tools/register-tool-safe.js";
import { callTool } from "./test-utils.js";

describe("registerToolSafe", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("auto-prepends the call signature to the description", () => {
    const server = new McpServer({ name: "test", version: "1.0.0" });
    const handler = vi.fn(async () => ({ content: [{ type: "text", text: "ok" }] }));
    registerToolSafe(
      server,
      "test_tool",
      {
        description: "original description here",
        inputSchema: { message: z.string(), workflowId: z.string().optional() },
      },
      handler,
    );
    const registered = (server as unknown as { _registeredTools: Record<string, { description: string }> })
      ._registeredTools["test_tool"];
    expect(registered.description).toMatch(/^Call signature: \{ message: string, workflowId\?: string \}/);
    expect(registered.description).toContain("original description here");
  });

  it("accepts the canonical parameter name", async () => {
    const server = new McpServer({ name: "test", version: "1.0.0" });
    const handler = vi.fn(async (args: { message: string }) => ({ content: [{ type: "text", text: args.message }] }));
    registerToolSafe(server, "test_tool", { description: "test", inputSchema: { message: z.string() } }, handler);
    installHintInterceptor(server);

    const result = await callTool(server, "test_tool", { message: "direct" });
    expect(handler).toHaveBeenCalledWith({ message: "direct" }, expect.anything());
    expect((result as { content: Array<{ text: string }> }).content[0].text).toBe("direct");
  });

  it("coerces specific alias (prompt -> message) before the handler runs", async () => {
    const server = new McpServer({ name: "test", version: "1.0.0" });
    const handler = vi.fn(async (args: { message: string }) => ({ content: [{ type: "text", text: args.message }] }));
    registerToolSafe(server, "test_tool", { description: "test", inputSchema: { message: z.string() } }, handler);
    installHintInterceptor(server);

    const result = await callTool(server, "test_tool", { prompt: "aliased" });
    expect(handler).toHaveBeenCalledWith({ message: "aliased" }, expect.anything());
    expect((result as { content: Array<{ text: string }> }).content[0].text).toBe("aliased");
  });

  it("coerces per-tool alias from the def.aliases field", async () => {
    const server = new McpServer({ name: "test", version: "1.0.0" });
    const handler = vi.fn(async (args: { definition: { nodes: Record<string, unknown> } }) => ({
      content: [{ type: "text", text: JSON.stringify(args.definition) }],
    }));
    registerToolSafe(
      server,
      "test_tool",
      {
        description: "test",
        inputSchema: { definition: z.object({ nodes: z.record(z.string(), z.any()) }) },
        aliases: { workflow: "definition" },
      },
      handler,
    );
    installHintInterceptor(server);

    const result = await callTool(server, "test_tool", { workflow: { nodes: { a: 1 } } });
    expect(handler).toHaveBeenCalledWith({ definition: { nodes: { a: 1 } } }, expect.anything());
    expect((result as { content: Array<{ text: string }> }).content[0].text).toBe('{"nodes":{"a":1}}');
  });

  it("coerces snake_case to camelCase", async () => {
    const server = new McpServer({ name: "test", version: "1.0.0" });
    const handler = vi.fn(async (args: { connectorId: string }) => ({
      content: [{ type: "text", text: args.connectorId }],
    }));
    registerToolSafe(server, "test_tool", { description: "test", inputSchema: { connectorId: z.string() } }, handler);
    installHintInterceptor(server);

    const result = await callTool(server, "test_tool", { connector_id: "conn_abc" });
    expect(handler).toHaveBeenCalledWith({ connectorId: "conn_abc" }, expect.anything());
    expect((result as { content: Array<{ text: string }> }).content[0].text).toBe("conn_abc");
  });

  it("coerces string to object for object-typed fields", async () => {
    const server = new McpServer({ name: "test", version: "1.0.0" });
    const handler = vi.fn(async (args: { definition: { nodes: Record<string, unknown> } }) => ({
      content: [{ type: "text", text: JSON.stringify(args.definition) }],
    }));
    registerToolSafe(
      server,
      "test_tool",
      {
        description: "test",
        inputSchema: { definition: z.object({ nodes: z.record(z.string(), z.any()) }) },
      },
      handler,
    );
    installHintInterceptor(server);

    await callTool(server, "test_tool", { definition: '{"nodes":{"a":1}}' });
    expect(handler).toHaveBeenCalledWith({ definition: { nodes: { a: 1 } } }, expect.anything());
  });
});

describe("installHintInterceptor", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("returns a hint tool result on validation failure instead of throwing", async () => {
    const server = new McpServer({ name: "test", version: "1.0.0" });
    const handler = vi.fn(async () => ({ content: [{ type: "text", text: "reached" }] }));
    registerToolSafe(server, "test_tool", { description: "test", inputSchema: { message: z.string() } }, handler);
    installHintInterceptor(server);

    const result = await callTool(server, "test_tool", { message: 123 });
    expect(handler).not.toHaveBeenCalled();
    const typedResult = result as { isError?: boolean; content: Array<{ type: string; text: string }> };
    expect(typedResult.isError).toBe(true);
    const text = typedResult.content[0].text;
    expect(text).toContain("Invalid arguments for `test_tool`");
    expect(text).toContain("Call signature:");
    expect(text).toContain("message: string");
  });

  it("produces a hint with did-you-mean for an unknown param that gets past coercion", async () => {
    const server = new McpServer({ name: "test", version: "1.0.0" });
    const handler = vi.fn(async () => ({ content: [{ type: "text", text: "reached" }] }));
    registerToolSafe(server, "test_tool", { description: "test", inputSchema: { message: z.string() } }, handler);
    installHintInterceptor(server);

    // "messag" is a typo of "message" — should get a did-you-mean suggestion
    const result = await callTool(server, "test_tool", { messag: "hi" });
    const typedResult = result as { isError?: boolean; content: Array<{ type: string; text: string }> };
    expect(typedResult.isError).toBe(true);
    const text = typedResult.content[0].text;
    expect(text).toContain("Did you mean");
    expect(text).toContain("message");
  });

  it("passes through non-validation errors unchanged", async () => {
    const server = new McpServer({ name: "test", version: "1.0.0" });
    const handler = vi.fn(async () => {
      throw new Error("handler blew up");
    });
    registerToolSafe(server, "test_tool", { description: "test", inputSchema: { message: z.string() } }, handler);
    installHintInterceptor(server);

    await expect(callTool(server, "test_tool", { message: "x" })).rejects.toThrow("handler blew up");
  });

  it("is idempotent: calling installHintInterceptor twice does not chain handlers", async () => {
    const server = new McpServer({ name: "test", version: "1.0.0" });
    const handler = vi.fn(async (args: { message: string }) => ({ content: [{ type: "text", text: args.message }] }));
    registerToolSafe(server, "test_tool", { description: "test", inputSchema: { message: z.string() } }, handler);
    installHintInterceptor(server);
    installHintInterceptor(server); // second call should be a no-op
    const result = await callTool(server, "test_tool", { message: "hello" });
    expect(handler).toHaveBeenCalledOnce();
    expect((result as { content: Array<{ text: string }> }).content[0].text).toBe("hello");
  });
});
