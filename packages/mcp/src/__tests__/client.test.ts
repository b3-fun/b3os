import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("getApiKey (async with keystore fallback)", () => {
  const originalEnv = process.env.B3OS_API_KEY;

  beforeEach(() => {
    delete process.env.B3OS_API_KEY;
    vi.resetModules();
  });

  afterEach(() => {
    if (originalEnv !== undefined) process.env.B3OS_API_KEY = originalEnv;
    else delete process.env.B3OS_API_KEY;
    vi.doUnmock("../keystore.js");
  });

  it("returns process.env.B3OS_API_KEY when it is set", async () => {
    process.env.B3OS_API_KEY = "b3sk_envvalue1234567890";
    vi.doMock("../keystore.js", () => ({
      readApiKey: async () => {
        throw new Error("keystore should not be called when env var is set");
      },
    }));
    const mod = await import("../client.js");
    await expect(mod.getApiKey()).resolves.toBe("b3sk_envvalue1234567890");
  });

  it("falls back to readApiKey() when env var is missing", async () => {
    vi.doMock("../keystore.js", () => ({
      readApiKey: async () => "b3sk_keystorevalue12345",
    }));
    const mod = await import("../client.js");
    await expect(mod.getApiKey()).resolves.toBe("b3sk_keystorevalue12345");
  });

  it("caches the result across calls (second call does not re-invoke keystore)", async () => {
    let callCount = 0;
    vi.doMock("../keystore.js", () => ({
      readApiKey: async () => {
        callCount++;
        return "b3sk_cachedvalue123456";
      },
    }));
    const mod = await import("../client.js");
    await mod.getApiKey();
    await mod.getApiKey();
    await mod.getApiKey();
    expect(callCount).toBe(1);
  });

  it("throws a clear error when env var and keystore both return nothing", async () => {
    vi.doMock("../keystore.js", () => ({
      readApiKey: async () => null,
    }));
    const mod = await import("../client.js");
    await expect(mod.getApiKey()).rejects.toThrow(/B3OS_API_KEY not found/);
  });

  it("clearKeyCache forces the next getApiKey to re-read from keystore", async () => {
    let callCount = 0;
    vi.doMock("../keystore.js", () => ({
      readApiKey: async () => {
        callCount++;
        return `b3sk_round${callCount}_1234567890`;
      },
    }));
    const mod = await import("../client.js");
    const first = await mod.getApiKey();
    expect(first).toBe("b3sk_round1_1234567890");
    expect(callCount).toBe(1);

    mod.clearKeyCache();
    const second = await mod.getApiKey();
    expect(second).toBe("b3sk_round2_1234567890");
    expect(callCount).toBe(2);
  });

  it("coalesces concurrent calls into one keystore read", async () => {
    let callCount = 0;
    vi.doMock("../keystore.js", () => ({
      readApiKey: async () => {
        callCount++;
        return "b3sk_concurrent1234567";
      },
    }));
    const mod = await import("../client.js");
    const [r1, r2, r3] = await Promise.all([mod.getApiKey(), mod.getApiKey(), mod.getApiKey()]);
    expect(callCount).toBe(1);
    expect(r1).toBe("b3sk_concurrent1234567");
    expect(r2).toBe("b3sk_concurrent1234567");
    expect(r3).toBe("b3sk_concurrent1234567");
  });
});
