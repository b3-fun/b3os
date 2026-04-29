import { describe, expect, it } from "vitest";
import { GenerateIdAction } from "./execute";

const makeParams = (inputs: Record<string, unknown> = {}) => ({
  context: {
    userId: "test-user",
    executionId: "test-exec-1",
    timestamp: new Date(),
  },
  inputs,
  actionContext: { userId: "test-user" },
});

describe("GenerateIdAction", () => {
  const action = new GenerateIdAction();

  it("has correct metadata", () => {
    expect(action.actionId).toBe("generate-id");
    expect(action.metadata.name).toBe("Generate ID");
    expect(action.metadata.category).toBe("utility");
  });

  it("generates a UUID by default", async () => {
    const result = await action.execute(makeParams());

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.format).toBe("uuid");
      expect(result.data.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    }
  });

  it("generates a UUID when format is explicitly uuid", async () => {
    const result = await action.execute(makeParams({ format: "uuid" }));

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.format).toBe("uuid");
      expect(result.data.id).toHaveLength(36);
    }
  });

  it("generates a short ID with default length", async () => {
    const result = await action.execute(makeParams({ format: "shortid" }));

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.format).toBe("shortid");
      expect(result.data.id).toHaveLength(8);
      expect(result.data.id).toMatch(/^[a-z0-9]+$/);
    }
  });

  it("generates a short ID with custom length", async () => {
    const result = await action.execute(
      makeParams({ format: "shortid", length: 16 }),
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toHaveLength(16);
      expect(result.data.id).toMatch(/^[a-z0-9]+$/);
    }
  });

  it("generates unique IDs on successive calls", async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => action.execute(makeParams())),
    );

    const ids = results
      .filter((r) => r.success)
      .map((r) => (r as { success: true; data: { id: string } }).data.id);

    expect(new Set(ids).size).toBe(10);
  });

  it("rejects invalid format", () => {
    expect(action.validateInputs({ format: "invalid" })).toBe(false);
  });

  it("rejects length out of range", () => {
    expect(action.validateInputs({ length: 2 })).toBe(false);
    expect(action.validateInputs({ length: 100 })).toBe(false);
  });

  it("accepts valid inputs", () => {
    expect(action.validateInputs({})).toBe(true);
    expect(action.validateInputs({ format: "uuid" })).toBe(true);
    expect(action.validateInputs({ format: "shortid", length: 12 })).toBe(true);
  });
});
