import { describe, it, expect } from "vitest";
import { ApiError } from "../client.js";

describe("ApiError friendly hints", () => {
  it("includes hint for 401 (expired/invalid key)", () => {
    const err = new ApiError(401, "Unauthorized", "");
    expect(err.message).toContain("API key may be invalid or expired");
  });

  it("includes hint for 403 (permissions)", () => {
    const err = new ApiError(403, "Forbidden", "");
    expect(err.message).toContain("Insufficient permissions");
  });

  it("includes hint for 404 (not found)", () => {
    const err = new ApiError(404, "Not Found", "");
    expect(err.message).toContain("Resource not found");
  });

  it("includes hint for 409 (conflict)", () => {
    const err = new ApiError(409, "Conflict", "");
    expect(err.message).toContain("another update");
  });

  it("includes hint for 429 (rate limited)", () => {
    const err = new ApiError(429, "Too Many Requests", "");
    expect(err.message).toContain("Rate limited");
  });

  it("no hint for generic 500 errors", () => {
    const err = new ApiError(500, "Internal Server Error", "oops");
    expect(err.message).not.toContain("Hint:");
    expect(err.message).toContain("oops");
  });

  it("includes body text in message", () => {
    const err = new ApiError(400, "Bad Request", '{"error":"invalid definition"}');
    expect(err.message).toContain("invalid definition");
  });

  it("has correct name and properties", () => {
    const err = new ApiError(404, "Not Found", "body");
    expect(err.name).toBe("ApiError");
    expect(err.status).toBe(404);
    expect(err.statusText).toBe("Not Found");
    expect(err.body).toBe("body");
  });
});
