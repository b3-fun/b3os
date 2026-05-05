import { describe, it, expect } from "vitest";
import { mergeAllowedTools } from "../setup.js";

describe("mergeAllowedTools", () => {
  it("adds tools to empty config", () => {
    const { config, added } = mergeAllowedTools({}, ["a", "b"]);
    expect(added).toBe(2);
    const perms = config.permissions as { allow: string[] };
    expect(perms.allow).toEqual(["a", "b"]);
  });

  it("merges with existing allow list", () => {
    const { config, added } = mergeAllowedTools({ permissions: { allow: ["x"] } }, ["a", "b"]);
    expect(added).toBe(2);
    const perms = config.permissions as { allow: string[] };
    expect(perms.allow).toEqual(["x", "a", "b"]);
  });

  it("is idempotent — no duplicates on re-run", () => {
    const first = mergeAllowedTools({}, ["a", "b"]);
    const second = mergeAllowedTools(first.config, ["a", "b", "c"]);
    expect(second.added).toBe(1);
    const perms = second.config.permissions as { allow: string[] };
    expect(perms.allow).toEqual(["a", "b", "c"]);
  });

  it("preserves other permissions fields", () => {
    const { config } = mergeAllowedTools({ permissions: { allow: ["x"], deny: ["y"] } }, ["a"]);
    const perms = config.permissions as { allow: string[]; deny: string[] };
    expect(perms.deny).toEqual(["y"]);
    expect(perms.allow).toEqual(["x", "a"]);
  });
});
