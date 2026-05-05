import { randomUUID } from "node:crypto";
import { execFileSync as realExecFileSync } from "node:child_process";
import { userInfo } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  detectKeystore,
  readApiKey,
  storeApiKey,
  deleteApiKey,
  KeystoreError,
  __setExecFnForTests,
  __resetExecFnForTests,
  __setFsFnsForTests,
  __resetFsFnsForTests,
  type ExecFn,
  type FsFns,
} from "../keystore.js";

afterEach(() => {
  __resetExecFnForTests();
  __resetFsFnsForTests();
});

describe("keystore scaffold", () => {
  it("exports the expected public API", () => {
    expect(typeof detectKeystore).toBe("function");
    expect(typeof storeApiKey).toBe("function");
    expect(typeof readApiKey).toBe("function");
    expect(typeof KeystoreError).toBe("function");
  });

  it("KeystoreError carries a code", () => {
    const err = new KeystoreError("ACCESS_DENIED", "test message");
    expect(err.code).toBe("ACCESS_DENIED");
    expect(err.message).toBe("test message");
    expect(err.name).toBe("KeystoreError");
  });
});

describe("detectKeystore", () => {
  const originalPlatform = process.platform;
  afterEach(() => {
    Object.defineProperty(process, "platform", {
      value: originalPlatform,
      configurable: true,
    });
  });

  function setPlatform(p: string): void {
    Object.defineProperty(process, "platform", {
      value: p,
      configurable: true,
    });
  }

  it("returns macos-keychain on darwin", () => {
    setPlatform("darwin");
    expect(detectKeystore()).toBe("macos-keychain");
  });

  it("returns windows-dpapi on win32", () => {
    setPlatform("win32");
    expect(detectKeystore()).toBe("windows-dpapi");
  });

  it("returns plaintext-fallback on linux", () => {
    setPlatform("linux");
    expect(detectKeystore()).toBe("plaintext-fallback");
  });

  it("returns plaintext-fallback on unknown platform", () => {
    setPlatform("freebsd");
    expect(detectKeystore()).toBe("plaintext-fallback");
  });
});

describe("plaintext-fallback behavior", () => {
  const originalPlatform = process.platform;
  afterEach(() => {
    Object.defineProperty(process, "platform", {
      value: originalPlatform,
      configurable: true,
    });
  });

  it("storeApiKey is a no-op on plaintext-fallback", async () => {
    Object.defineProperty(process, "platform", {
      value: "linux",
      configurable: true,
    });
    await expect(storeApiKey("b3sk_whatever")).resolves.toBeUndefined();
  });

  it("readApiKey returns null on plaintext-fallback", async () => {
    Object.defineProperty(process, "platform", {
      value: "linux",
      configurable: true,
    });
    await expect(readApiKey()).resolves.toBeNull();
  });
});

describe("storeMacosKeychain", () => {
  const originalPlatform = process.platform;

  function onMacos(): void {
    Object.defineProperty(process, "platform", {
      value: "darwin",
      configurable: true,
    });
  }

  afterEach(() => {
    Object.defineProperty(process, "platform", {
      value: originalPlatform,
      configurable: true,
    });
  });

  it("calls security add-generic-password with the correct argv", async () => {
    onMacos();
    const calls: Array<{ file: string; args: readonly string[] }> = [];
    __setExecFnForTests(((file: string, args: readonly string[]) => {
      calls.push({ file, args });
      return Buffer.from("");
    }) as ExecFn);

    await storeApiKey("b3sk_abcDEF1234567890");

    expect(calls).toHaveLength(1);
    expect(calls[0].file).toBe("security");
    expect(calls[0].args[0]).toBe("add-generic-password");
    expect(calls[0].args).toContain("-U");
    expect(calls[0].args).toContain("-s");
    expect(calls[0].args[calls[0].args.indexOf("-s") + 1]).toBe("b3os-mcp");
    expect(calls[0].args).toContain("-w");
    expect(calls[0].args[calls[0].args.indexOf("-w") + 1]).toBe(
      "b3sk_abcDEF1234567890",
    );
    expect(calls[0].args).toContain("-a");
    const accountIdx = calls[0].args.indexOf("-a");
    expect(typeof calls[0].args[accountIdx + 1]).toBe("string");
    expect((calls[0].args[accountIdx + 1] as string).length).toBeGreaterThan(0);
  });

  it("does NOT pass the -A flag (strict ACL)", async () => {
    onMacos();
    const calls: Array<readonly string[]> = [];
    __setExecFnForTests(((_file: string, args: readonly string[]) => {
      calls.push(args);
      return Buffer.from("");
    }) as ExecFn);

    await storeApiKey("b3sk_abcDEF1234567890");

    expect(calls[0]).not.toContain("-A");
  });

  it("key value is passed as a single argv item, not string-interpolated", async () => {
    onMacos();
    const calls: Array<readonly string[]> = [];
    __setExecFnForTests(((_file: string, args: readonly string[]) => {
      calls.push(args);
      return Buffer.from("");
    }) as ExecFn);

    // Use a key containing shell metacharacters to catch string-interpolation bugs.
    const sneakyKey = 'b3sk_; rm -rf / #"';
    await storeApiKey(sneakyKey);

    const wIdx = calls[0].indexOf("-w");
    expect(calls[0][wIdx + 1]).toBe(sneakyKey);
    // No argv item should contain shell-style concatenation with our key.
    for (const arg of calls[0]) {
      if (arg !== sneakyKey) {
        expect(arg).not.toContain("rm -rf");
      }
    }
  });

  it("throws KeystoreError({ code: TOOL_MISSING }) when security binary is missing", async () => {
    onMacos();
    __setExecFnForTests((() => {
      const err = new Error("spawn security ENOENT") as NodeJS.ErrnoException;
      err.code = "ENOENT";
      throw err;
    }) as ExecFn);

    await expect(storeApiKey("b3sk_whatever")).rejects.toMatchObject({
      name: "KeystoreError",
      code: "TOOL_MISSING",
    });
  });

  it("throws KeystoreError({ code: UNKNOWN }) for non-ENOENT failures (e.g. security exit 1)", async () => {
    onMacos();
    __setExecFnForTests((() => {
      // Simulate security exiting with code 1 (non-ENOENT). execFileSync
      // synthesizes an Error with status + stderr attached but no `code`
      // property (NodeJS.ErrnoException.code is reserved for spawn failures).
      const err = new Error(
        "Command failed: security add-generic-password",
      ) as Error & {
        status?: number;
        stderr?: Buffer;
      };
      err.status = 1;
      err.stderr = Buffer.from("some unexpected stderr\n");
      throw err;
    }) as ExecFn);

    await expect(storeApiKey("b3sk_whatever")).rejects.toMatchObject({
      name: "KeystoreError",
      code: "UNKNOWN",
    });
    // The underlying message should be preserved in the KeystoreError message.
    await expect(storeApiKey("b3sk_whatever")).rejects.toThrow(
      /Command failed: security/,
    );
  });
});

describe("readMacosKeychain", () => {
  const originalPlatform = process.platform;
  function onMacos(): void {
    Object.defineProperty(process, "platform", {
      value: "darwin",
      configurable: true,
    });
  }
  afterEach(() => {
    Object.defineProperty(process, "platform", {
      value: originalPlatform,
      configurable: true,
    });
  });

  it("returns the trimmed key on successful read", async () => {
    onMacos();
    __setExecFnForTests((() =>
      Buffer.from("b3sk_abcDEF1234567890\n")) as ExecFn);
    await expect(readApiKey()).resolves.toBe("b3sk_abcDEF1234567890");
  });

  it("returns null when the item is not found (security exit 44)", async () => {
    onMacos();
    __setExecFnForTests((() => {
      const err = new Error("security returned 44") as Error & {
        status?: number;
      };
      err.status = 44;
      throw err;
    }) as ExecFn);
    await expect(readApiKey()).resolves.toBeNull();
  });

  it("throws KeystoreError({ code: ACCESS_DENIED }) on 'User interaction is not allowed'", async () => {
    onMacos();
    __setExecFnForTests((() => {
      const err = new Error("read failed") as Error & {
        status?: number;
        stderr?: Buffer;
      };
      err.status = 51;
      err.stderr = Buffer.from(
        "security: SecKeychainSearchCopyNext: User interaction is not allowed.\n",
      );
      throw err;
    }) as ExecFn);
    await expect(readApiKey()).rejects.toMatchObject({
      name: "KeystoreError",
      code: "ACCESS_DENIED",
    });
  });

  it("throws KeystoreError({ code: ACCESS_DENIED }) on 'could not be decrypted'", async () => {
    onMacos();
    __setExecFnForTests((() => {
      const err = new Error("read failed") as Error & {
        status?: number;
        stderr?: Buffer;
      };
      err.status = 51;
      err.stderr = Buffer.from("security: The item could not be decrypted\n");
      throw err;
    }) as ExecFn);
    await expect(readApiKey()).rejects.toMatchObject({
      name: "KeystoreError",
      code: "ACCESS_DENIED",
    });
  });

  it("throws KeystoreError({ code: TOOL_MISSING }) when security binary is missing", async () => {
    onMacos();
    __setExecFnForTests((() => {
      const err = new Error("spawn security ENOENT") as NodeJS.ErrnoException;
      err.code = "ENOENT";
      throw err;
    }) as ExecFn);
    await expect(readApiKey()).rejects.toMatchObject({
      name: "KeystoreError",
      code: "TOOL_MISSING",
    });
  });

  it("throws KeystoreError({ code: UNKNOWN }) for other non-zero exits", async () => {
    onMacos();
    __setExecFnForTests((() => {
      const err = new Error("read failed") as Error & {
        status?: number;
        stderr?: Buffer;
      };
      err.status = 1;
      err.stderr = Buffer.from("some other failure\n");
      throw err;
    }) as ExecFn);
    await expect(readApiKey()).rejects.toMatchObject({
      name: "KeystoreError",
      code: "UNKNOWN",
    });
  });
});

describe("storeWindowsDpapi", () => {
  const originalPlatform = process.platform;
  function onWindows(): void {
    Object.defineProperty(process, "platform", {
      value: "win32",
      configurable: true,
    });
  }
  afterEach(() => {
    Object.defineProperty(process, "platform", {
      value: originalPlatform,
      configurable: true,
    });
  });

  it("calls powershell.exe with -NoProfile -Command and pipes key via input", async () => {
    onWindows();
    const calls: Array<{
      file: string;
      args: readonly string[];
      input: unknown;
    }> = [];
    __setExecFnForTests(((
      file: string,
      args: readonly string[],
      options?: { input?: unknown },
    ) => {
      calls.push({ file, args, input: options?.input });
      return Buffer.from(
        "01000000d08c9ddf0115d1118c7a00c04fc297eb0100000000000000",
      );
    }) as ExecFn);

    // Stub fs side-effects so the test doesn't actually create ~/.b3os/
    const mkdirCalls: Array<Parameters<FsFns["mkdirSync"]>> = [];
    const writeCalls: Array<Parameters<FsFns["writeFileSync"]>> = [];
    __setFsFnsForTests({
      mkdirSync: ((...args: Parameters<FsFns["mkdirSync"]>) => {
        mkdirCalls.push(args);
      }) as FsFns["mkdirSync"],
      writeFileSync: ((...args: Parameters<FsFns["writeFileSync"]>) => {
        writeCalls.push(args);
      }) as FsFns["writeFileSync"],
    });

    await storeApiKey("b3sk_abcDEF1234567890");

    expect(calls).toHaveLength(1);
    expect(calls[0].file).toBe("powershell.exe");
    expect(calls[0].args).toContain("-NoProfile");
    expect(calls[0].args).toContain("-Command");
    // The key is piped via stdin, NOT argv.
    expect(calls[0].input).toBe("b3sk_abcDEF1234567890");
    for (const arg of calls[0].args) {
      expect(arg).not.toContain("b3sk_abcDEF1234567890");
    }

    // The encrypted blob is written to ~/.b3os/b3os-mcp-key.dpapi with mode 0o600.
    expect(mkdirCalls).toHaveLength(1);
    expect(writeCalls).toHaveLength(1);
    const writeCall = writeCalls[0];
    expect(typeof writeCall[0]).toBe("string");
    expect(writeCall[0] as string).toMatch(/\.b3os[\\/]b3os-mcp-key\.dpapi$/);
    expect(writeCall[1]).toBe(
      "01000000d08c9ddf0115d1118c7a00c04fc297eb0100000000000000",
    );
    expect((writeCall[2] as { mode?: number }).mode).toBe(0o600);

    // The parent directory is created with mode 0o700
    const mkdirCall = mkdirCalls[0];
    expect((mkdirCall[1] as { mode?: number }).mode).toBe(0o700);
  });

  it("throws KeystoreError({ code: TOOL_MISSING }) when powershell.exe is missing", async () => {
    onWindows();
    __setExecFnForTests((() => {
      const err = new Error(
        "spawn powershell.exe ENOENT",
      ) as NodeJS.ErrnoException;
      err.code = "ENOENT";
      throw err;
    }) as ExecFn);

    await expect(storeApiKey("b3sk_whatever")).rejects.toMatchObject({
      name: "KeystoreError",
      code: "TOOL_MISSING",
    });
  });
});

describe("readWindowsDpapi", () => {
  const originalPlatform = process.platform;
  function onWindows(): void {
    Object.defineProperty(process, "platform", {
      value: "win32",
      configurable: true,
    });
  }
  afterEach(() => {
    Object.defineProperty(process, "platform", {
      value: originalPlatform,
      configurable: true,
    });
  });

  it("returns null when the DPAPI file does not exist (no PowerShell call)", async () => {
    onWindows();
    const execCalls: number[] = [];
    __setExecFnForTests((() => {
      execCalls.push(1);
      return Buffer.from("");
    }) as ExecFn);
    // Stub readFileSync to throw ENOENT — matches production code path
    // where readWindowsDpapi tries to read the file directly and catches
    // ENOENT instead of using existsSync (TOCTOU-safe).
    __setFsFnsForTests({
      readFileSync: () => {
        throw Object.assign(new Error("ENOENT: no such file or directory"), {
          code: "ENOENT",
        });
      },
    });

    await expect(readApiKey()).resolves.toBeNull();
    expect(execCalls).toHaveLength(0); // No PowerShell call when file missing
  });

  it("returns the decrypted key on successful read", async () => {
    onWindows();
    __setFsFnsForTests({
      readFileSync: () => "01000000d08c9ddf" as unknown as Buffer,
    });
    __setExecFnForTests((() =>
      Buffer.from("b3sk_abcDEF1234567890\n")) as ExecFn);

    await expect(readApiKey()).resolves.toBe("b3sk_abcDEF1234567890");
  });

  it("throws KeystoreError({ code: DECRYPT_FAILED }) on CryptographicException", async () => {
    onWindows();
    __setFsFnsForTests({
      readFileSync: () => "deadbeef" as unknown as Buffer,
    });
    __setExecFnForTests((() => {
      const err = new Error("powershell failed") as NodeJS.ErrnoException & {
        stderr?: Buffer;
      };
      err.stderr = Buffer.from(
        "ConvertTo-SecureString : Key not valid for use in specified state.\nSystem.Security.Cryptography.CryptographicException\n",
      );
      throw err;
    }) as ExecFn);

    await expect(readApiKey()).rejects.toMatchObject({
      name: "KeystoreError",
      code: "DECRYPT_FAILED",
    });
  });

  it("throws KeystoreError({ code: TOOL_MISSING }) when powershell.exe is missing", async () => {
    onWindows();
    __setFsFnsForTests({
      readFileSync: () => "deadbeef" as unknown as Buffer,
    });
    __setExecFnForTests((() => {
      const err = new Error(
        "spawn powershell.exe ENOENT",
      ) as NodeJS.ErrnoException;
      err.code = "ENOENT";
      throw err;
    }) as ExecFn);

    await expect(readApiKey()).rejects.toMatchObject({
      name: "KeystoreError",
      code: "TOOL_MISSING",
    });
  });
});

describe("deleteMacosKeychain", () => {
  const originalPlatform = process.platform;
  function onMacos(): void {
    Object.defineProperty(process, "platform", {
      value: "darwin",
      configurable: true,
    });
  }
  afterEach(() => {
    Object.defineProperty(process, "platform", {
      value: originalPlatform,
      configurable: true,
    });
  });

  it("calls security delete-generic-password and returns true on success", async () => {
    onMacos();
    const calls: Array<{ file: string; args: readonly string[] }> = [];
    __setExecFnForTests(((file: string, args: readonly string[]) => {
      calls.push({ file, args });
      return Buffer.from("");
    }) as ExecFn);

    const result = await deleteApiKey();

    expect(result).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].file).toBe("security");
    expect(calls[0].args[0]).toBe("delete-generic-password");
    expect(calls[0].args).toContain("-s");
    expect(calls[0].args[calls[0].args.indexOf("-s") + 1]).toBe("b3os-mcp");
  });

  it("returns false when item not found (security exit 44)", async () => {
    onMacos();
    __setExecFnForTests((() => {
      const err = new Error("security returned 44") as Error & {
        status?: number;
      };
      err.status = 44;
      throw err;
    }) as ExecFn);

    await expect(deleteApiKey()).resolves.toBe(false);
  });

  it("throws KeystoreError({ code: TOOL_MISSING }) when security binary is missing", async () => {
    onMacos();
    __setExecFnForTests((() => {
      const err = new Error("spawn security ENOENT") as NodeJS.ErrnoException;
      err.code = "ENOENT";
      throw err;
    }) as ExecFn);

    await expect(deleteApiKey()).rejects.toMatchObject({
      name: "KeystoreError",
      code: "TOOL_MISSING",
    });
  });

  it("throws KeystoreError({ code: UNKNOWN }) for other failures", async () => {
    onMacos();
    __setExecFnForTests((() => {
      const err = new Error(
        "Command failed: security delete-generic-password",
      ) as Error & { status?: number };
      err.status = 1;
      throw err;
    }) as ExecFn);

    await expect(deleteApiKey()).rejects.toMatchObject({
      name: "KeystoreError",
      code: "UNKNOWN",
    });
  });
});

describe("deleteWindowsDpapi", () => {
  const originalPlatform = process.platform;
  function onWindows(): void {
    Object.defineProperty(process, "platform", {
      value: "win32",
      configurable: true,
    });
  }
  afterEach(() => {
    Object.defineProperty(process, "platform", {
      value: originalPlatform,
      configurable: true,
    });
  });

  it("returns false when DPAPI file does not exist", async () => {
    onWindows();
    __setFsFnsForTests({
      readFileSync: () => {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      },
    });
    await expect(deleteApiKey()).resolves.toBe(false);
  });
});

describe("deleteApiKey plaintext-fallback", () => {
  const originalPlatform = process.platform;
  afterEach(() => {
    Object.defineProperty(process, "platform", {
      value: originalPlatform,
      configurable: true,
    });
  });

  it("returns false on plaintext-fallback (nothing to delete)", async () => {
    Object.defineProperty(process, "platform", {
      value: "linux",
      configurable: true,
    });
    await expect(deleteApiKey()).resolves.toBe(false);
  });
});

describe.skipIf(
  !process.env.B3OS_MCP_REAL_KEYCHAIN_TEST || process.platform !== "darwin",
)("keystore integration (real macOS Keychain, opt-in)", () => {
  const testService = `b3os-mcp-TEST-${randomUUID()}`;
  const testKey = `b3sk_test_${randomUUID().replace(/-/g, "")}`;

  afterEach(() => {
    try {
      realExecFileSync(
        "security",
        ["delete-generic-password", "-s", testService],
        {
          stdio: ["ignore", "ignore", "ignore"],
        },
      );
    } catch {
      // Entry may not exist — that's fine.
    }
  });

  it("round-trips a key through the real keychain", () => {
    const account = userInfo().username;
    realExecFileSync(
      "security",
      [
        "add-generic-password",
        "-U",
        "-a",
        account,
        "-s",
        testService,
        "-w",
        testKey,
        "-D",
        "b3os-mcp TEST entry",
        "-j",
        "Integration test — safe to delete",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );

    const out = realExecFileSync(
      "security",
      ["find-generic-password", "-a", account, "-s", testService, "-w"],
      {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    expect(out.trim()).toBe(testKey);
  });
});
