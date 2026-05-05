import type { ZodTypeAny, ZodError } from "zod";
import { serializeShape, serializeZodType, isOptionalField, unwrapOptional } from "./schema-serializer.js";

/**
 * Classic Levenshtein distance with 2 rolling rows for O(min(a,b)) space.
 * @internal Exported only for direct unit testing from hint-formatter.test.ts.
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  // Use the shorter string as the inner dimension for cache efficiency
  if (a.length > b.length) [a, b] = [b, a];
  let prev = new Array(a.length + 1);
  let curr = new Array(a.length + 1);
  for (let i = 0; i <= a.length; i++) prev[i] = i;
  for (let j = 1; j <= b.length; j++) {
    curr[0] = j;
    for (let i = 1; i <= a.length; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[i] = Math.min(prev[i] + 1, curr[i - 1] + 1, prev[i - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[a.length];
}

/** Produces a default placeholder value for a required zod type. */
function placeholderValue(schema: ZodTypeAny): unknown {
  // Branches below must stay in sync with serializeZodType's output strings.
  const typeStr = serializeZodType(schema);
  if (typeStr === "string") return "...";
  if (typeStr === "number") return 0;
  if (typeStr === "boolean") return false;
  if (typeStr === "object") return {};
  if (typeStr.endsWith("[]")) return [];
  // Numeric literal (e.g. z.literal(42) → "42")
  if (/^-?\d+(\.\d+)?$/.test(typeStr)) return Number(typeStr);
  if (typeStr.startsWith('"')) {
    // enum/literal — pick the first literal
    const match = typeStr.match(/^"([^"]*)"/);
    return match ? match[1] : "...";
  }
  return null;
}

/**
 * Build a minimal valid example object using the required fields in the shape.
 * @internal Exported only for direct unit testing from hint-formatter.test.ts.
 */
export function synthesizeExample(shape: Record<string, ZodTypeAny>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(shape)) {
    if (isOptionalField(field)) continue;
    out[key] = placeholderValue(unwrapOptional(field));
  }
  return out;
}

export interface FormatHintInput {
  toolName: string;
  shape: Record<string, ZodTypeAny>;
  rawArgs: unknown;
  error: ZodError | null;
  signature?: string;
}

/** Produces the rich agent-readable hint string shown when zod validation fails. */
export function formatHint(input: FormatHintInput): string {
  const { toolName, shape, rawArgs, error, signature } = input;
  const validKeys = Object.keys(shape);
  const lines: string[] = [];
  lines.push(`Invalid arguments for \`${toolName}\`.`);
  lines.push("");

  const rawKeys = rawArgs && typeof rawArgs === "object" ? Object.keys(rawArgs as Record<string, unknown>) : [];
  const validKeySet = new Set(validKeys);
  const unknownKeys = rawKeys.filter(k => !validKeySet.has(k));

  for (const bad of unknownKeys) {
    let bestV = "";
    let bestD = Infinity;
    const threshold = Math.max(3, Math.floor(Math.max(bad.length, 0) / 2));
    for (const v of validKeys) {
      const perKeyThreshold = Math.max(threshold, Math.max(3, Math.floor(v.length / 2)));
      const d = levenshtein(bad, v);
      if (d < bestD && d <= perKeyThreshold) {
        bestV = v;
        bestD = d;
      }
    }
    if (bestD < Infinity) {
      lines.push(`Problem: Unknown parameter \`${bad}\`.`);
      lines.push(`Did you mean: \`${bestV}\`? (Levenshtein distance ${bestD})`);
    } else {
      lines.push(`Problem: Unknown parameter \`${bad}\`. No close match in the schema.`);
    }
  }

  // Zod-level issues (missing required, wrong type, etc.)
  // Note: zod v4 does NOT put a `received` field on issue objects.
  if (error) {
    const issues = error.issues ?? [];
    for (const issue of issues) {
      const path = issue.path?.join(".") ?? "<root>";
      if (issue.code === "invalid_type") {
        // Locale-safe missing-required detection: for shallow paths, check if the key is
        // actually absent from rawArgs. Falls back to English message matching for nested
        // paths (zod v4 removed the structured `received` field, so message text is the
        // only other signal).
        const isShallow = issue.path.length === 1;
        const rawKey = isShallow ? (issue.path[0] as string) : null;
        const rawIsObject = rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs);
        const isMissingShallow = isShallow && rawIsObject && rawKey !== null && !(rawKey in (rawArgs as object));
        const msg =
          typeof (issue as { message?: string }).message === "string" ? (issue as { message: string }).message : "";
        const isMissingNested = !isShallow && msg.includes("received undefined");

        if (isMissingShallow || isMissingNested) {
          lines.push(`Problem: Missing required parameter \`${path}\`.`);
        } else {
          const expected = (issue as { expected?: string }).expected ?? "unknown";
          // zod v4 has no structured `received` field for invalid_type; extract from the message.
          const receivedMatch = msg.match(/received (\w+)/);
          const received = receivedMatch ? receivedMatch[1] : "unknown";
          lines.push(`Problem: Wrong type for \`${path}\`: expected ${expected}, got ${received}.`);
        }
      } else if (issue.code === "unrecognized_keys") {
        // already handled above via unknownKeys
      } else {
        lines.push(`Problem: ${issue.message} (at \`${path}\`)`);
      }
    }
  }

  lines.push("");
  lines.push(signature ?? `Call signature: ${serializeShape(shape)}`);
  lines.push("");
  lines.push("Example:");
  lines.push(JSON.stringify(synthesizeExample(shape), null, 2));
  lines.push("");
  lines.push(`Valid parameters: ${validKeys.join(", ")}`);
  return lines.join("\n");
}
