import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import {
  applySpecificAliases,
  applySnakeToCamelAliases,
  applyStringToObjectCoercion,
  coerceArgs,
  buildCoercionPlan,
  coerceArgsFast,
  GLOBAL_ALIASES,
} from "../tools/param-coercion.js";

describe("applySpecificAliases", () => {
  it("renames known global alias (prompt -> message)", () => {
    const result = applySpecificAliases({ prompt: "hello" }, {});
    expect(result).toEqual({ message: "hello" });
  });

  it("renames per-tool alias (workflow -> definition)", () => {
    const result = applySpecificAliases(
      { workflow: { nodes: {} } },
      { workflow: "definition" },
    );
    expect(result).toEqual({ definition: { nodes: {} } });
  });

  it("per-tool alias overrides global on the same key", () => {
    const result = applySpecificAliases(
      { prompt: "x" },
      { prompt: "customField" },
    );
    expect(result).toEqual({ customField: "x" });
  });

  it("does not rename when the canonical key is already present", () => {
    const result = applySpecificAliases(
      { prompt: "x", message: "already" },
      {},
    );
    expect(result).toEqual({ prompt: "x", message: "already" });
  });

  it("passes non-object values through unchanged", () => {
    expect(applySpecificAliases(null as any, {})).toBe(null);
    expect(applySpecificAliases("string" as any, {})).toBe("string");
  });
});

describe("applySnakeToCamelAliases", () => {
  const shape = {
    connectorId: z.string(),
    workflowId: z.string(),
    isActive: z.boolean(),
  };

  it("renames connector_id -> connectorId when declared field is camelCase", () => {
    const result = applySnakeToCamelAliases({ connector_id: "abc" }, shape);
    expect(result).toEqual({ connectorId: "abc" });
  });

  it("renames workflow_id -> workflowId", () => {
    const result = applySnakeToCamelAliases({ workflow_id: "wf_1" }, shape);
    expect(result).toEqual({ workflowId: "wf_1" });
  });

  it("renames multi-boundary snake (is_active -> isActive)", () => {
    const result = applySnakeToCamelAliases({ is_active: true }, shape);
    expect(result).toEqual({ isActive: true });
  });

  it("leaves unrelated keys untouched", () => {
    const result = applySnakeToCamelAliases(
      { connector_id: "a", extra: "b" },
      shape,
    );
    expect(result).toEqual({ connectorId: "a", extra: "b" });
  });

  it("does not rename if canonical key already present", () => {
    const result = applySnakeToCamelAliases(
      { connector_id: "a", connectorId: "b" },
      shape,
    );
    expect(result).toEqual({ connector_id: "a", connectorId: "b" });
  });

  it("does not rename fields that are already lowercase (no camelCase target)", () => {
    const flatShape = { name: z.string() };
    const result = applySnakeToCamelAliases({ name: "x" }, flatShape);
    expect(result).toEqual({ name: "x" });
  });
});

describe("applyStringToObjectCoercion", () => {
  const shape = {
    definition: z.object({ nodes: z.record(z.string(), z.any()) }),
    name: z.string(),
    tags: z.array(z.string()).optional(),
  };

  it("parses JSON string for object-typed field", () => {
    const result = applyStringToObjectCoercion(
      { definition: '{"nodes":{}}' },
      shape,
    );
    expect(result).toEqual({ definition: { nodes: {} } });
  });

  it("leaves object-typed field alone when already an object", () => {
    const result = applyStringToObjectCoercion(
      { definition: { nodes: {} } },
      shape,
    );
    expect(result).toEqual({ definition: { nodes: {} } });
  });

  it("does not touch string-typed fields", () => {
    const result = applyStringToObjectCoercion({ name: "hello" }, shape);
    expect(result).toEqual({ name: "hello" });
  });

  it("handles optional object-typed field wrapped in ZodOptional", () => {
    const shapeWithOptional = {
      definition: z.object({ nodes: z.record(z.string(), z.any()) }).optional(),
    };
    const result = applyStringToObjectCoercion(
      { definition: '{"nodes":{"a":1}}' },
      shapeWithOptional,
    );
    expect(result).toEqual({ definition: { nodes: { a: 1 } } });
  });

  it("leaves invalid JSON string as-is (lets zod report it)", () => {
    const result = applyStringToObjectCoercion(
      { definition: "not json" },
      shape,
    );
    expect(result).toEqual({ definition: "not json" });
  });
});

describe("coerceArgs (integration)", () => {
  const shape = {
    message: z.string(),
    workflowId: z.string().optional(),
    definition: z.object({ nodes: z.record(z.string(), z.any()) }).optional(),
  };
  const aliases = {};

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("runs specific -> snake→camel -> string→object in order", () => {
    const result = coerceArgs(
      { prompt: "hi", workflow_id: "wf_1", definition: '{"nodes":{}}' },
      shape,
      aliases,
      "test_tool",
    );
    expect(result).toEqual({
      message: "hi",
      workflowId: "wf_1",
      definition: { nodes: {} },
    });
  });

  it("passes canonical inputs through unchanged", () => {
    const result = coerceArgs({ message: "hi" }, shape, aliases, "test_tool");
    expect(result).toEqual({ message: "hi" });
  });

  it("logs telemetry for each alias firing", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    coerceArgs({ prompt: "hi" }, shape, aliases, "test_tool");
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining(
        "alias-fired tool=test_tool from=prompt to=message",
      ),
    );
  });

  it("does not log when no alias fires", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    coerceArgs({ message: "hi" }, shape, aliases, "test_tool");
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("buildCoercionPlan + coerceArgsFast", () => {
  it("applies the same coercions as coerceArgs via pre-built plan", () => {
    const shape = {
      message: z.string(),
      workflowId: z.string().optional(),
      definition: z.object({ nodes: z.record(z.string(), z.any()) }).optional(),
    };
    const plan = buildCoercionPlan(shape, {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = coerceArgsFast(
      { prompt: "hi", workflow_id: "wf_1", definition: '{"nodes":{}}' },
      plan,
      "test_tool",
    );
    expect(result).toEqual({
      message: "hi",
      workflowId: "wf_1",
      definition: { nodes: {} },
    });
  });

  it("passes canonical inputs through unchanged (no allocation if no coercion)", () => {
    const shape = { message: z.string() };
    const plan = buildCoercionPlan(shape, {});
    const input = { message: "hi" };
    const result = coerceArgsFast(input, plan, "test_tool");
    expect(result).toBe(input); // reference equality — lazy copy never fired
  });

  it("pre-builds the snake→camel map at registration", () => {
    const shape = { connectorId: z.string(), workflowId: z.string() };
    const plan = buildCoercionPlan(shape, {});
    expect(plan.snakeToCamel.get("connector_id")).toBe("connectorId");
    expect(plan.snakeToCamel.get("workflow_id")).toBe("workflowId");
  });

  it("compounds chained specific aliases (A->B then B->C)", () => {
    // Regression: the fast-path alias loop must read membership from the
    // accumulator so later iterations see earlier renames. Previously it
    // read from `input` (the frozen original), causing chained aliases
    // to silently stop at the first hop.
    const shape = { baz: z.string() };
    // Build the plan with a per-tool alias A->B, then inject a second
    // entry B->C directly so we can test chain behavior without relying
    // on arbitrary GLOBAL_ALIASES ordering.
    const plan = buildCoercionPlan(shape, { foo: "bar" });
    plan.aliasEntries = [...plan.aliasEntries, ["bar", "baz"]];
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = coerceArgsFast({ foo: "hello" }, plan, "test_tool");
    expect(result).toEqual({ baz: "hello" });
  });
});
