import { describe, it, expect } from "vitest";
import { z } from "zod";
import { serializeShape, serializeZodType } from "../tools/schema-serializer.js";

describe("serializeZodType", () => {
  it("serializes primitive types", () => {
    expect(serializeZodType(z.string())).toBe("string");
    expect(serializeZodType(z.number())).toBe("number");
    expect(serializeZodType(z.boolean())).toBe("boolean");
  });

  it("serializes objects and arrays generically", () => {
    expect(serializeZodType(z.object({ a: z.string() }))).toBe("object");
    expect(serializeZodType(z.array(z.string()))).toBe("string[]");
    expect(serializeZodType(z.array(z.object({}))).replace(/\s+/g, "")).toBe("object[]");
  });

  it("serializes enums as literal unions", () => {
    expect(serializeZodType(z.enum(["draft", "active", "paused"]))).toBe('"draft"|"active"|"paused"');
  });

  it("serializes literal", () => {
    expect(serializeZodType(z.literal(true))).toBe("true");
  });

  it("unwraps optional to mark nullable at the field level (but here just strips)", () => {
    expect(serializeZodType(z.string().optional())).toBe("string");
  });
});

describe("serializeShape", () => {
  it("produces a compact signature with optional markers", () => {
    const shape = {
      message: z.string(),
      workflowId: z.string().optional(),
      definition: z.object({ nodes: z.record(z.string(), z.any()) }).optional(),
    };
    expect(serializeShape(shape)).toBe("{ message: string, workflowId?: string, definition?: object }");
  });

  it("handles an empty shape", () => {
    expect(serializeShape({})).toBe("{}");
  });

  it("preserves insertion order", () => {
    const shape = { b: z.string(), a: z.string() };
    expect(serializeShape(shape)).toBe("{ b: string, a: string }");
  });

  it("serializes enum fields inline", () => {
    const shape = { status: z.enum(["draft", "active"]).optional() };
    expect(serializeShape(shape)).toBe('{ status?: "draft"|"active" }');
  });
});
