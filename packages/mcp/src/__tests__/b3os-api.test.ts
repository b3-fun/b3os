import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createServiceAccount, createApiKey } from "../b3os-api.js";

const mockFetch = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const TEST_PERMISSIONS = ["workflow:read", "workflow:create"] as const;

const apiKeyOptions = (overrides: Partial<Parameters<typeof createApiKey>[0]> = {}) => ({
  serverUrl: "https://api.b3os.org",
  jwt: "jwt-token",
  orgId: "org_xyz",
  name: "b3os-mcp@test-machine",
  description: "Test",
  serviceAccountId: "sa_abc123",
  ...overrides,
});

describe("createServiceAccount", () => {
  it("POSTs to /v1/service-accounts with JWT + X-Org-ID headers and returns the SA", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: 200,
          message: "success",
          data: { id: "sa_abc123", name: "b3os-mcp@test-machine" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await createServiceAccount({
      serverUrl: "https://api.b3os.org",
      jwt: "jwt-token",
      orgId: "org_xyz",
      name: "b3os-mcp@test-machine",
      description: "Test",
      permissions: [...TEST_PERMISSIONS],
    });

    expect(result).toEqual({ id: "sa_abc123", name: "b3os-mcp@test-machine" });
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.b3os.org/v1/service-accounts",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer jwt-token",
          "X-Org-ID": "org_xyz",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          name: "b3os-mcp@test-machine",
          description: "Test",
          permissions: [...TEST_PERMISSIONS],
        }),
      }),
    );
  });
});

describe("createApiKey", () => {
  it("POSTs to /v1/api-keys with serviceAccountId and returns the plaintext key", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: 200,
          message: "success",
          data: {
            id: "ak_abc",
            key: "b3sk_1234567890abcdef",
            name: "b3os-mcp@test-machine",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await createApiKey(apiKeyOptions());

    expect(result.key).toBe("b3sk_1234567890abcdef");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.b3os.org/v1/api-keys",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          name: "b3os-mcp@test-machine",
          description: "Test",
          scope: "read-write",
          serviceAccountId: "sa_abc123",
        }),
      }),
    );
  });

  it("throws a clear error on non-200 responses", async () => {
    mockFetch.mockResolvedValueOnce(new Response("Forbidden: insufficient permissions", { status: 403 }));

    await expect(
      createApiKey(apiKeyOptions({ name: "x", description: "y", serviceAccountId: "sa_1" })),
    ).rejects.toThrow("B3OS API error 403");
  });

  it("scrubs the JWT from error messages if the server echoes it back", async () => {
    mockFetch.mockResolvedValueOnce(new Response("Unauthorized: token jwt-secret-xyz invalid", { status: 401 }));

    try {
      await createApiKey(
        apiKeyOptions({ jwt: "jwt-secret-xyz", name: "x", description: "y", serviceAccountId: "sa_1" }),
      );
      expect.fail("Should have thrown");
    } catch (err) {
      expect((err as Error).message).not.toContain("jwt-secret-xyz");
      expect((err as Error).message).toContain("401");
    }
  });

  it("replaces HTML error pages with a clean message", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response("<!DOCTYPE html><html><body>502 Bad Gateway</body></html>", { status: 502 }),
    );

    await expect(
      createApiKey(apiKeyOptions({ name: "x", description: "y", serviceAccountId: "sa_1" })),
    ).rejects.toThrow("HTML error page");
  });
});
