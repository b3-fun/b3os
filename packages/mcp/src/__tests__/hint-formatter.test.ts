import { describe, it, expect } from "vitest";
import { z } from "zod";
import { formatHint, levenshtein, synthesizeExample } from "../tools/hint-formatter.js";

describe("levenshtein", () => {
  it("returns 0 for identical strings", () => {
    expect(levenshtein("abc", "abc")).toBe(0);
  });

  it("counts substitutions", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
  });

  it("counts insertions/deletions", () => {
    expect(levenshtein("abc", "abcd")).toBe(1);
    expect(levenshtein("abcd", "abc")).toBe(1);
  });
});

describe("synthesizeExample", () => {
  it("omits optional fields and fills required with type placeholders", () => {
    const shape = {
      message: z.string(),
      workflowId: z.string().optional(),
      count: z.number(),
    };
    expect(synthesizeExample(shape)).toEqual({
      message: "...",
      count: 0,
    });
  });

  it("uses {} for required object and [] for required array", () => {
    const shape = {
      definition: z.object({ nodes: z.record(z.string(), z.any()) }),
      tags: z.array(z.string()),
    };
    const ex = synthesizeExample(shape);
    expect(ex.definition).toEqual({});
    expect(ex.tags).toEqual([]);
  });
});

describe("formatHint", () => {
  const shape = {
    message: z.string().describe("The message"),
    workflowId: z.string().optional(),
    definition: z.object({ nodes: z.record(z.string(), z.any()) }).optional(),
  };

  it("includes 'Did you mean' for close unknown keys", () => {
    const parseResult = z.object(shape).safeParse({ messag: "hello" });
    expect(parseResult.success).toBe(false);
    const hint = formatHint({
      toolName: "b3os_build_workflow",
      shape,
      rawArgs: { messag: "hello" },
      error: parseResult.success ? null : parseResult.error,
    });
    expect(hint).toContain("b3os_build_workflow");
    expect(hint).toContain("Did you mean");
    expect(hint).toContain("message"); // typo of "messag" → "message" at distance 1
    expect(hint).toContain("Call signature:");
    expect(hint).toContain("message: string");
  });

  it("does not suggest a match for unrelated garbage keys", () => {
    const parseResult = z.object(shape).safeParse({ xyz: "hi" });
    const hint = formatHint({
      toolName: "test_tool",
      shape,
      rawArgs: { xyz: "hi" },
      error: parseResult.success ? null : parseResult.error,
    });
    expect(hint).toContain("Unknown parameter `xyz`");
    expect(hint).not.toContain("Did you mean");
    // Valid-parameters list is still shown as the backstop.
    expect(hint).toContain("Valid parameters:");
  });

  it("reports missing required parameters", () => {
    const parseResult = z.object(shape).safeParse({});
    const hint = formatHint({
      toolName: "test_tool",
      shape,
      rawArgs: {},
      error: parseResult.success ? null : parseResult.error,
    });
    expect(hint).toContain("Missing required parameter");
    expect(hint).toContain("message");
  });

  it("reports wrong type for a known parameter", () => {
    const parseResult = z.object(shape).safeParse({ message: 123 });
    const hint = formatHint({
      toolName: "test_tool",
      shape,
      rawArgs: { message: 123 },
      error: parseResult.success ? null : parseResult.error,
    });
    expect(hint).toContain("message");
    expect(hint).toContain("string");
  });

  it("includes a synthesized example", () => {
    const parseResult = z.object(shape).safeParse({});
    const hint = formatHint({
      toolName: "test_tool",
      shape,
      rawArgs: {},
      error: parseResult.success ? null : parseResult.error,
    });
    expect(hint).toContain("Example:");
    expect(hint).toContain('"message":');
  });

  it("lists all valid parameters", () => {
    const parseResult = z.object(shape).safeParse({ bogus: 1 });
    const hint = formatHint({
      toolName: "test_tool",
      shape,
      rawArgs: { bogus: 1 },
      error: parseResult.success ? null : parseResult.error,
    });
    expect(hint).toContain("Valid parameters:");
    expect(hint).toContain("message");
    expect(hint).toContain("workflowId");
    expect(hint).toContain("definition");
  });
});
