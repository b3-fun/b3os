import type { ZodTypeAny } from "zod";
import {
  ZodOptional,
  ZodNullable,
  ZodDefault,
  ZodObject,
  ZodRecord,
} from "zod";

/** Unwraps ZodOptional/ZodNullable/ZodDefault to find the inner type. */
export function unwrapOptional(schema: ZodTypeAny): ZodTypeAny {
  if (
    schema instanceof ZodOptional ||
    schema instanceof ZodNullable ||
    schema instanceof ZodDefault
  ) {
    return unwrapOptional(schema.unwrap() as ZodTypeAny);
  }
  return schema;
}

/** True if a (possibly wrapped) zod type is an object or record schema. */
export function isObjectType(schema: ZodTypeAny): boolean {
  const inner = unwrapOptional(schema);
  return inner instanceof ZodObject || inner instanceof ZodRecord;
}

/** Walks a zod type and returns a compact one-token string like "string", "number", or "object". */
export function serializeZodType(schema: ZodTypeAny): string {
  // zod v4 stores type info on _zod.def. No v3 fallback — returns "unknown" if _zod.def is absent.
  const unwrapped = unwrapOptional(schema);
  const def = (
    unwrapped as unknown as {
      _zod?: {
        def?: {
          type?: string;
          values?: readonly unknown[];
          entries?: Record<string, unknown>;
          element?: ZodTypeAny;
        };
      };
    }
  )._zod?.def;
  if (!def) return "unknown";

  switch (def.type) {
    case "string":
      return "string";
    case "number":
    case "bigint":
      return "number";
    case "boolean":
      return "boolean";
    case "object":
    case "record":
      return "object";
    case "array": {
      const inner = def.element ? serializeZodType(def.element) : "unknown";
      return `${inner}[]`;
    }
    case "enum": {
      // zod v4 uses `entries` (object), not `values` (array)
      const entries = def.entries ?? {};
      const keys = Object.keys(entries);
      return keys.map((k) => `"${k}"`).join("|");
    }
    case "literal": {
      const values = def.values ?? [];
      const v = values[0];
      return typeof v === "string" ? `"${v}"` : String(v);
    }
    case "union": {
      // Recurse into each option — rare in tool schemas
      return "unknown";
    }
    default:
      return "unknown";
  }
}

/**
 * True if a zod field should be marked with `?` in the call signature —
 * i.e. the caller may omit it. This covers ZodOptional and ZodDefault.
 * Nullable fields are NOT considered optional: a nullable field is still
 * required to be provided (possibly as null), so it gets no `?` marker.
 */
export function isOptionalField(schema: ZodTypeAny): boolean {
  return schema instanceof ZodOptional || schema instanceof ZodDefault;
}

/** Produces "{ fieldA: type, fieldB?: type, ... }" from a raw zod shape. */
export function serializeShape(shape: Record<string, ZodTypeAny>): string {
  const keys = Object.keys(shape);
  if (keys.length === 0) return "{}";
  const parts = keys.map((key) => {
    const field = shape[key];
    const optional = isOptionalField(field) ? "?" : "";
    const type = serializeZodType(field);
    return `${key}${optional}: ${type}`;
  });
  return `{ ${parts.join(", ")} }`;
}
