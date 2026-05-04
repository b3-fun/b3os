import { describe, it, expect } from "vitest";
import { waitForOAuthCallback } from "../oauth-callback.js";

describe("waitForOAuthCallback", () => {
  it("resolves with token and orgId when callback arrives with matching state", async () => {
    const state = "test-state-123";
    const { port, result } = await waitForOAuthCallback({
      expectedState: state,
      timeoutMs: 5000,
    });

    // Simulate the browser redirecting to the callback
    await fetch(
      `http://127.0.0.1:${port}/callback?token=jwt-abc&orgId=org_123&state=${state}`,
    );

    const { token, orgId } = await result;
    expect(token).toBe("jwt-abc");
    expect(orgId).toBe("org_123");
  });
});

describe("waitForOAuthCallback error cases", () => {
  it("rejects when state does not match (CSRF protection)", async () => {
    const { port, result } = await waitForOAuthCallback({
      expectedState: "expected",
      timeoutMs: 5000,
    });
    await fetch(
      `http://127.0.0.1:${port}/callback?token=jwt&orgId=org&state=wrong`,
    );
    await expect(result).rejects.toThrow("Invalid OAuth callback");
  });

  it("rejects when token is missing", async () => {
    const { port, result } = await waitForOAuthCallback({
      expectedState: "s",
      timeoutMs: 5000,
    });
    await fetch(`http://127.0.0.1:${port}/callback?orgId=org&state=s`);
    await expect(result).rejects.toThrow("Invalid OAuth callback");
  });

  it("rejects when orgId is missing", async () => {
    const { port, result } = await waitForOAuthCallback({
      expectedState: "s",
      timeoutMs: 5000,
    });
    await fetch(`http://127.0.0.1:${port}/callback?token=jwt&state=s`);
    await expect(result).rejects.toThrow("Invalid OAuth callback");
  });

  it("times out when no callback arrives", async () => {
    const { result } = await waitForOAuthCallback({
      expectedState: "s",
      timeoutMs: 100,
    });
    await expect(result).rejects.toThrow("Timed out");
  });

  it("returns 404 for unknown paths", async () => {
    const { port, result } = await waitForOAuthCallback({
      expectedState: "s",
      timeoutMs: 2000,
    });
    const res = await fetch(`http://127.0.0.1:${port}/unknown`);
    expect(res.status).toBe(404);
    // Then resolve the main promise via a valid callback so the test doesn't hang
    await fetch(
      `http://127.0.0.1:${port}/callback?token=jwt&orgId=org&state=s`,
    );
    await expect(result).resolves.toBeDefined();
  });
});
