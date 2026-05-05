import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * Directly invokes a tool's `tools/call` request handler without setting up
 * a transport. Accesses the underlying server's request handler map.
 */
export async function callTool(server: McpServer, name: string, args: unknown) {
  const underlying = (
    server as unknown as {
      server: { _requestHandlers: Map<string, (req: unknown, extra: unknown) => Promise<unknown>> };
    }
  ).server;
  const handler = underlying._requestHandlers.get("tools/call");
  if (!handler) throw new Error("no tools/call handler");
  return handler(
    { params: { name, arguments: args }, method: "tools/call" },
    { sendNotification: () => {}, signal: new AbortController().signal, requestId: 1, sessionId: "test" },
  );
}
