import { describe, expect, it } from "vitest";
import { HelloWorldAction } from "./execute";

const makeParams = (inputs: Record<string, unknown> = {}) => ({
  context: {
    userId: "test-user",
    executionId: "test-exec-1",
    timestamp: new Date(),
  },
  inputs,
  actionContext: { userId: "test-user" },
});

describe("HelloWorldAction", () => {
  const action = new HelloWorldAction();

  it("has correct metadata", () => {
    expect(action.actionId).toBe("hello-world");
    expect(action.metadata.name).toBe("Hello World");
    expect(action.metadata.category).toBe("utility");
  });

  it("returns a greeting with the provided name", async () => {
    const result = await action.execute(makeParams({ name: "B3OS" }));

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.message).toBe("Hello, B3OS!");
      expect(result.data.timestamp).toBeDefined();
    }
  });

  it("defaults to 'World' when no name is provided", async () => {
    const result = await action.execute(makeParams());

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.message).toBe("Hello, World!");
    }
  });

  it("validates inputs correctly", () => {
    expect(action.validateInputs({})).toBe(true);
    expect(action.validateInputs({ name: "test" })).toBe(true);
  });
});
