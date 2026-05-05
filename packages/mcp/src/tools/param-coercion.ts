import type { ZodTypeAny } from "zod";
import { unwrapOptional, isObjectType } from "./schema-serializer.js";

/** 1 MB — strings longer than this are left as-is for string→object coercion; zod surfaces the type error. */
const MAX_JSON_COERCE_BYTES = 1_000_000;

/** @internal Cross-tool aliases for LLM priors observed in real agent sessions. */
export const GLOBAL_ALIASES: Record<string, string> = {
  prompt: "message",
};

/** True if a string is camelCase (contains at least one lowercase letter followed by an uppercase letter). */
function isCamelCase(s: string): boolean {
  return /[a-z][A-Z]/.test(s);
}

/** Logs a coercion firing for telemetry (stderr, matches auditLog style). */
function logCoercionFired(
  toolName: string,
  from: string,
  to: string,
  type?: string,
): void {
  const typeField = type ? ` type=${type}` : "";
  console.error(
    `[b3os-mcp] alias-fired tool=${toolName} from=${from} to=${to}${typeField} at ${new Date().toISOString()}`,
  );
}

/**
 * @internal Test-only slow-path reference implementation.
 * Production code uses `coerceArgsFast` with a pre-built plan via `buildCoercionPlan`.
 *
 * Stage 1: apply specific aliases (global + per-tool). Per-tool wins on collision.
 * Rename only happens if the canonical key is NOT already present.
 */
export function applySpecificAliases(
  args: Record<string, unknown>,
  perToolAliases: Record<string, string>,
  toolName = "",
): Record<string, unknown> {
  if (!args || typeof args !== "object" || Array.isArray(args)) return args;
  const aliases = { ...GLOBAL_ALIASES, ...perToolAliases };
  const out: Record<string, unknown> = { ...args };
  for (const [from, to] of Object.entries(aliases)) {
    if (from in out && !(to in out)) {
      out[to] = out[from];
      delete out[from];
      if (toolName) logCoercionFired(toolName, from, to);
    }
  }
  return out;
}

/**
 * @internal Test-only slow-path reference implementation.
 * Production code uses `coerceArgsFast` with a pre-built plan via `buildCoercionPlan`.
 *
 * Stage 2: for every camelCase field declared in the shape, accept its snake_case form.
 * Rename only happens if canonical key is NOT already present.
 */
export function applySnakeToCamelAliases(
  args: Record<string, unknown>,
  shape: Record<string, ZodTypeAny>,
  toolName = "",
): Record<string, unknown> {
  if (!args || typeof args !== "object" || Array.isArray(args)) return args;
  const out: Record<string, unknown> = { ...args };
  for (const fieldName of Object.keys(shape)) {
    if (!isCamelCase(fieldName)) continue;
    const snakeName = fieldName.replace(/([A-Z])/g, "_$1").toLowerCase();
    if (snakeName in out && !(fieldName in out)) {
      out[fieldName] = out[snakeName];
      delete out[snakeName];
      if (toolName) logCoercionFired(toolName, snakeName, fieldName);
    }
  }
  return out;
}

/**
 * @internal Test-only slow-path reference implementation.
 * Production code uses `coerceArgsFast` with a pre-built plan via `buildCoercionPlan`.
 *
 * Stage 3: for every object-typed field in the shape, if the incoming value is a JSON string,
 * parse it. Leaves strings that fail to parse alone so zod can surface the real error.
 */
export function applyStringToObjectCoercion(
  args: Record<string, unknown>,
  shape: Record<string, ZodTypeAny>,
  toolName = "",
): Record<string, unknown> {
  if (!args || typeof args !== "object" || Array.isArray(args)) return args;
  const out: Record<string, unknown> = { ...args };
  for (const [fieldName, fieldSchema] of Object.entries(shape)) {
    if (!isObjectType(fieldSchema)) continue;
    const value = out[fieldName];
    if (typeof value === "string") {
      try {
        out[fieldName] = JSON.parse(value);
        if (toolName)
          logCoercionFired(toolName, fieldName, fieldName, "string->object");
      } catch {
        // Leave as-is; zod will produce a proper type error.
      }
    }
  }
  return out;
}

/**
 * @internal Test-only slow-path reference implementation.
 * Production code uses `coerceArgsFast` with a pre-built plan via `buildCoercionPlan`.
 *
 * Full coercion pipeline. Pure function — easy to test.
 */
export function coerceArgs(
  args: unknown,
  shape: Record<string, ZodTypeAny>,
  perToolAliases: Record<string, string>,
  toolName: string,
): unknown {
  if (!args || typeof args !== "object" || Array.isArray(args)) return args;
  let coerced = args as Record<string, unknown>;
  coerced = applySpecificAliases(coerced, perToolAliases, toolName);
  coerced = applySnakeToCamelAliases(coerced, shape, toolName);
  coerced = applyStringToObjectCoercion(coerced, shape, toolName);
  return coerced;
}

/**
 * Pre-computes registration-time metadata for the coercion pipeline.
 * Builds the merged alias map and the snake→camel field map once so
 * hot-path invocations don't redo the work.
 */
export interface CoercionPlan {
  aliasEntries: ReadonlyArray<[string, string]>;
  snakeToCamel: Map<string, string>;
  objectFields: string[];
}

export function buildCoercionPlan(
  shape: Record<string, ZodTypeAny>,
  perToolAliases: Record<string, string>,
): CoercionPlan {
  const aliasEntries: [string, string][] = Object.entries({
    ...GLOBAL_ALIASES,
    ...perToolAliases,
  });
  const snakeToCamel = new Map<string, string>();
  const objectFields: string[] = [];
  for (const fieldName of Object.keys(shape)) {
    if (isCamelCase(fieldName)) {
      const snakeName = fieldName.replace(/([A-Z])/g, "_$1").toLowerCase();
      snakeToCamel.set(snakeName, fieldName);
    }
    if (isObjectType(shape[fieldName])) {
      objectFields.push(fieldName);
    }
  }
  return { aliasEntries, snakeToCamel, objectFields };
}

/**
 * Hot-path coercion pipeline: specific aliases → snake→camel → string→object.
 * Each stage uses lazy copy — if no coercion fires, the input is returned
 * by reference.
 */
export function coerceArgsFast(
  args: unknown,
  plan: CoercionPlan,
  toolName: string,
): unknown {
  if (!args || typeof args !== "object" || Array.isArray(args)) return args;
  const input = args as Record<string, unknown>;

  let out: Record<string, unknown> | undefined;
  for (const [from, to] of plan.aliasEntries) {
    // Read membership from the accumulator so chained aliases compound
    // correctly. With `aliasEntries = [[A,B], [B,C]]` and input `{ A: 1 }`,
    // the second iteration must see `B` present (from the first rename)
    // and carry it through to `C`. The slow-path applySpecificAliases
    // accumulates the same way; mismatching here silently diverges.
    const src = out ?? input;
    if (from in src && !(to in src)) {
      out ??= { ...input };
      out[to] = out[from];
      delete out[from];
      if (toolName) logCoercionFired(toolName, from, to);
    }
  }

  for (const [snakeName, camelName] of plan.snakeToCamel) {
    const src = out ?? input;
    if (snakeName in src && !(camelName in src)) {
      out ??= { ...input };
      out[camelName] = out[snakeName];
      delete out[snakeName];
      if (toolName) logCoercionFired(toolName, snakeName, camelName);
    }
  }

  for (const fieldName of plan.objectFields) {
    const src = out ?? input;
    const value = src[fieldName];
    if (typeof value === "string" && value.length <= MAX_JSON_COERCE_BYTES) {
      try {
        const parsed = JSON.parse(value);
        out ??= { ...input };
        out[fieldName] = parsed;
        if (toolName)
          logCoercionFired(toolName, fieldName, fieldName, "string->object");
      } catch {
        // leave as-is; zod will surface the real error
      }
    }
  }

  return out ?? input;
}
