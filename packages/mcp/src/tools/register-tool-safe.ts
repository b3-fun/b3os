import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z, type ZodTypeAny } from "zod";
import { serializeShape } from "./schema-serializer.js";
import {
  buildCoercionPlan,
  coerceArgsFast,
  type CoercionPlan,
} from "./param-coercion.js";
import { formatHint } from "./hint-formatter.js";

/**
 * Metadata stored per registered tool so the interceptor can format hints
 * with full schema context and invoke the real handler.
 */
interface ToolMetadata {
  plan: CoercionPlan;
  validator: z.ZodObject<Record<string, ZodTypeAny>>;
  shape: Record<string, ZodTypeAny>; // cached from validator.shape to avoid getter on error path
  handler: (
    args: Record<string, unknown>,
    extra: unknown,
  ) => Promise<CallToolResult>;
  signature: string;
}

/**
 * Per-server map of tool name → metadata. We key by the server instance so
 * multiple McpServer instances in the same process don't collide (useful in tests).
 */
const toolMetadataByServer = new WeakMap<object, Map<string, ToolMetadata>>();

/**
 * Tracks servers that already have the hint interceptor installed, so a
 * second call is a no-op instead of creating a handler chain via setRequestHandler.
 */
const interceptorInstalled = new WeakSet<object>();

function getMetadataMap(server: McpServer): Map<string, ToolMetadata> {
  let map = toolMetadataByServer.get(server);
  if (!map) {
    map = new Map();
    toolMetadataByServer.set(server, map);
  }
  return map;
}

export interface RegisterToolSafeDef<
  S extends Record<string, ZodTypeAny> = Record<string, ZodTypeAny>,
> {
  description: string;
  inputSchema: S;
  aliases?: Record<string, string>;
}

/**
 * Registers a tool with auto-generated signature block, coercion pipeline,
 * and hint-on-failure support. Use this instead of calling server.registerTool
 * directly. Enforced by src/__tests__/no-raw-register-tool.test.ts.
 *
 * Generic over the input schema shape S so handlers receive fully-typed args
 * via z.infer<z.ZodObject<S>> — no manual `as { ... }` casts needed.
 */
export function registerToolSafe<S extends Record<string, ZodTypeAny>>(
  server: McpServer,
  name: string,
  def: RegisterToolSafeDef<S>,
  handler: (
    args: z.infer<z.ZodObject<S>>,
    extra: unknown,
  ) => Promise<CallToolResult>,
): void {
  const aliases = def.aliases ?? {};
  const shape = def.inputSchema;
  const plan = buildCoercionPlan(shape, aliases);

  const signatureBlock = `Call signature: ${serializeShape(shape)}`;
  const enrichedDescription = `${signatureBlock}\n\n${def.description}`;

  // z.object(shape) is recognized directly by MCP SDK's normalizeObjectSchema
  // (v4 path at zod-compat.js:103-119 checks def.type === "object"). No wrapper
  // or patch needed — coercion happens at request time in installHintInterceptor,
  // not via zod preprocess.
  const validator = z.object(shape);

  // Store metadata so the hint interceptor can produce rich errors later
  // and invoke the real handler without going through the SDK's dispatcher.
  // Cast at the storage boundary — ToolMetadata uses the erased internal type.
  getMetadataMap(server).set(name, {
    plan,
    validator,
    shape,
    handler: handler as unknown as ToolMetadata["handler"],
    signature: signatureBlock,
  });

  // Note: at runtime, the SDK's tools/call handler is fully replaced by
  // installHintInterceptor — we still register here so tools/list / tools/get
  // emit the correct JSON Schema.
  server.registerTool(
    name,
    {
      description: enrichedDescription,
      // The SDK's registerTool signature expects a raw shape (Record<string, ZodTypeAny>)
      // for type inference. We pass a pre-built ZodObject instead so normalizeObjectSchema
      // recognizes it directly and tools/list emits correct JSON Schema.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      inputSchema: validator as any,
    },
    // Handler is stored by the SDK but invoked from installHintInterceptor via
    // metadata lookup (the interceptor replaces the SDK's dispatcher entirely).
    // The cast erases the generic shape because the SDK's signature doesn't carry it.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handler as any,
  );
}

/**
 * Installs the interceptor that replaces the SDK's tools/call request handler.
 * Must be called AFTER all registerToolSafe() calls, typically at the end of
 * createServer() in server.ts.
 *
 * The interceptor:
 *   1. Coerces raw args through the pipeline (aliases, snake→camel, string→object).
 *   2. Validates against the stored shape.
 *   3. On validation failure, returns a rich hint CallToolResult.
 *   4. On success, invokes the user handler directly with the coerced args.
 *
 * We fully replace the SDK's tools/call handler rather than wrapping it because
 * SDK ^1.11.0 (tested with 1.27.1) catches and wraps thrown McpErrors
 * (including -32602 InvalidParams) into tool error results inside its own
 * try/catch, so there's nothing for a wrapping try/catch to intercept.
 * Replacing the handler lets us produce the hint cleanly and keeps handler
 * errors as thrown errors (which tests expect).
 *
 * For unknown tools (not registered via registerToolSafe), the interceptor
 * delegates to the original SDK handler, preserving default behavior.
 */
export function installHintInterceptor(server: McpServer): void {
  const underlying = (
    server as unknown as {
      server: {
        _requestHandlers: Map<
          string,
          (req: unknown, extra: unknown) => Promise<unknown>
        >;
        setRequestHandler: (schema: unknown, handler: unknown) => void;
      };
    }
  ).server;

  // Idempotency: calling this twice on the same server would chain the second
  // interceptor over the first. Track installation and short-circuit on re-entry.
  if (interceptorInstalled.has(underlying)) {
    return;
  }

  const original = underlying._requestHandlers.get("tools/call");
  if (!original) {
    throw new Error(
      "installHintInterceptor: no tools/call handler registered yet — call after registering tools",
    );
  }

  const metadataMap = getMetadataMap(server);

  underlying.setRequestHandler(
    CallToolRequestSchema,
    async (request: unknown, extra: unknown) => {
      const req = request as { params: { name: string; arguments: unknown } };
      const toolName = req.params.name;
      const meta = metadataMap.get(toolName);

      // Unknown tool (or not registered via registerToolSafe): delegate to the
      // SDK's original handler so its default behavior (not-found errors, tools
      // registered via other means) is preserved.
      if (!meta) {
        return original(request, extra);
      }

      const coerced = coerceArgsFast(req.params.arguments, meta.plan, toolName);
      const parseResult = meta.validator.safeParse(coerced);

      if (!parseResult.success) {
        const hint = formatHint({
          toolName,
          shape: meta.shape,
          rawArgs: req.params.arguments,
          error: parseResult.error,
          signature: meta.signature,
        });
        return {
          content: [{ type: "text", text: hint }],
          isError: true,
        };
      }

      return meta.handler(parseResult.data as Record<string, unknown>, extra);
    },
  );

  // Mark as installed AFTER setRequestHandler succeeds, so a throw during
  // setup leaves the server in a state where retry is possible.
  interceptorInstalled.add(underlying);
}
