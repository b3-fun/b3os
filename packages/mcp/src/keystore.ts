/**
 * keystore.ts — OS-native credential storage for the b3os-mcp API key.
 *
 * Dispatches by process.platform to one of three backends:
 *   - macOS: security CLI (add-generic-password / find-generic-password)
 *   - Windows: PowerShell + DPAPI (encrypted blob in ~/.b3os/b3os-mcp-key.dpapi)
 *   - Linux and other: plaintext fallback (key is stored in the Claude
 *     config env block by setup.ts — keystore returns null and the runtime
 *     falls back to process.env.B3OS_API_KEY)
 */
import {
  execFileSync as realExecFileSync,
  type ExecFileSyncOptions,
} from "node:child_process";
import {
  mkdirSync as realMkdirSync,
  writeFileSync as realWriteFileSync,
  readFileSync as realReadFileSync,
  type MakeDirectoryOptions,
  type WriteFileOptions,
} from "node:fs";
import { userInfo, homedir } from "node:os";
import { dirname, join } from "node:path";

/** Service name for the macOS Keychain entry. */
const KEYSTORE_SERVICE_NAME = "b3os-mcp";

/** Windows DPAPI-encrypted key file path. Parent dir ~/.b3os/ is created if missing. */
function getDpapiPath(): string {
  return join(homedir(), ".b3os", "b3os-mcp-key.dpapi");
}

/** PowerShell script that reads a plaintext key from stdin and writes the DPAPI-encrypted hex blob to stdout. */
const PS_ENCRYPT_SCRIPT = `
$key = [Console]::In.ReadToEnd().Trim()
$secure = ConvertTo-SecureString -String $key -AsPlainText -Force
$encrypted = ConvertFrom-SecureString -SecureString $secure
[Console]::Out.Write($encrypted)
`;

/** PowerShell script that reads a DPAPI-encrypted hex blob from stdin and writes the decrypted plaintext to stdout. */
const PS_DECRYPT_SCRIPT = `
$encrypted = [Console]::In.ReadToEnd().Trim()
$secure = ConvertTo-SecureString -String $encrypted
$ptr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  [Console]::Out.Write([System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr))
} finally {
  [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
}
`;

export type KeystoreKind =
  | "macos-keychain"
  | "windows-dpapi"
  | "plaintext-fallback";

export type KeystoreErrorCode =
  | "ACCESS_DENIED"
  | "DECRYPT_FAILED"
  | "TOOL_MISSING"
  | "UNKNOWN";

export class KeystoreError extends Error {
  constructor(
    public readonly code: KeystoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "KeystoreError";
  }
}

/**
 * Dispatch by platform. Returns the backend kind that will be used for
 * read/write operations. Called at startup and during setup so the caller
 * can render the correct user-facing messaging.
 */
export function detectKeystore(): KeystoreKind {
  if (process.platform === "darwin") return "macos-keychain";
  if (process.platform === "win32") return "windows-dpapi";
  return "plaintext-fallback";
}

/**
 * Store the API key in the current platform's keystore. No-op on
 * plaintext-fallback (the caller is expected to write the key into the
 * Claude config env block instead).
 */
export async function storeApiKey(key: string): Promise<void> {
  const kind = detectKeystore();
  if (kind === "macos-keychain") return storeMacosKeychain(key);
  if (kind === "windows-dpapi") return storeWindowsDpapi(key);
  // plaintext-fallback: nothing to do here.
}

/**
 * Read the API key from the current platform's keystore. Returns null
 * if the keystore has no value (either the user hasn't run setup yet,
 * the item was deleted, or we're on plaintext-fallback where the key
 * lives in the Claude config env block instead).
 */
export async function readApiKey(): Promise<string | null> {
  const kind = detectKeystore();
  if (kind === "macos-keychain") return readMacosKeychain();
  if (kind === "windows-dpapi") return readWindowsDpapi();
  return null; // plaintext-fallback: caller reads process.env.B3OS_API_KEY
}

/**
 * Delete the API key from the current platform's keystore. Returns true
 * if a key was deleted, false if there was nothing to delete.
 */
export async function deleteApiKey(): Promise<boolean> {
  const kind = detectKeystore();
  if (kind === "macos-keychain") return deleteMacosKeychain();
  if (kind === "windows-dpapi") return deleteWindowsDpapi();
  return false; // plaintext-fallback: caller must clear env / config
}

// ── Internal backend implementations ──
async function storeMacosKeychain(key: string): Promise<void> {
  try {
    const account = userInfo().username;
    execFileSync(
      "security",
      [
        "add-generic-password",
        "-U", // update if exists (idempotent re-run of setup)
        "-a",
        account,
        "-s",
        KEYSTORE_SERVICE_NAME,
        "-w",
        key,
        "-D",
        "b3os-mcp API key",
        "-j",
        `Created by b3os-mcp-setup on ${new Date().toISOString()}`,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new KeystoreError(
        "TOOL_MISSING",
        "'security' binary not found on PATH. This is required for storing the API key in macOS Keychain.",
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new KeystoreError(
      "UNKNOWN",
      `Failed to write macOS Keychain item: ${msg}`,
    );
  }
}
async function readMacosKeychain(): Promise<string | null> {
  try {
    const account = userInfo().username;
    const out = execFileSync(
      "security",
      [
        "find-generic-password",
        "-a",
        account,
        "-s",
        KEYSTORE_SERVICE_NAME,
        "-w",
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const text = typeof out === "string" ? out : out.toString("utf-8");
    return text.trimEnd();
  } catch (err) {
    return handleSecurityReadError(err);
  }
}

/**
 * Map errors from `security find-generic-password` into our KeystoreError
 * shape. Exit 44 = item not found (not an error, returns null). ENOENT =
 * tool missing. Stderr patterns for "User interaction is not allowed" or
 * "could not be decrypted" = user denied the ACL prompt or keychain is
 * locked — return a verbose remediation message pointing at Keychain
 * Access.app. Anything else = UNKNOWN with the raw message preserved.
 */
function handleSecurityReadError(err: unknown): null {
  const e = err as NodeJS.ErrnoException & {
    status?: number;
    stderr?: Buffer | string;
  };
  if (e.code === "ENOENT") {
    throw new KeystoreError(
      "TOOL_MISSING",
      "'security' binary not found on PATH. This is required for reading the API key from macOS Keychain.",
    );
  }
  // security exits 44 when the item is not found — treat as null, not error.
  if (e.status === 44) return null;

  const stderr =
    typeof e.stderr === "string"
      ? e.stderr
      : (e.stderr?.toString("utf-8") ?? "");
  if (
    stderr.includes("User interaction is not allowed") ||
    stderr.includes("could not be decrypted")
  ) {
    throw new KeystoreError(
      "ACCESS_DENIED",
      [
        "Keychain access denied.",
        "macOS denied Node access to the 'b3os-mcp' keychain item.",
        "To fix:",
        "  1. Open 'Keychain Access.app'",
        "  2. Find 'b3os-mcp' under login keychain > Passwords",
        "  3. Double-click > Access Control tab > click '+' > navigate to:",
        `     ${process.execPath}`,
        "  4. Close and restart Claude Code",
        "Or re-run 'b3os-mcp-setup' to recreate the item with fresh ACL.",
      ].join("\n"),
    );
  }
  const msg = e.message || stderr || "unknown error";
  throw new KeystoreError(
    "UNKNOWN",
    `Failed to read macOS Keychain item: ${msg}`,
  );
}
async function deleteMacosKeychain(): Promise<boolean> {
  try {
    const account = userInfo().username;
    execFileSync(
      "security",
      ["delete-generic-password", "-a", account, "-s", KEYSTORE_SERVICE_NAME],
      {
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    return true;
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { status?: number };
    if (e.status === 44) return false; // item not found
    if (e.code === "ENOENT") {
      throw new KeystoreError(
        "TOOL_MISSING",
        "'security' binary not found on PATH.",
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new KeystoreError(
      "UNKNOWN",
      `Failed to delete macOS Keychain item: ${msg}`,
    );
  }
}

async function deleteWindowsDpapi(): Promise<boolean> {
  const dpapiPath = getDpapiPath();
  try {
    const { unlinkSync } = await import("node:fs");
    unlinkSync(dpapiPath);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    const msg = err instanceof Error ? err.message : String(err);
    throw new KeystoreError("UNKNOWN", `Failed to delete DPAPI blob: ${msg}`);
  }
}

async function storeWindowsDpapi(key: string): Promise<void> {
  let encrypted: string;
  try {
    const out = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-Command", PS_ENCRYPT_SCRIPT],
      {
        input: key,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    encrypted = (
      typeof out === "string" ? out : out.toString("utf-8")
    ).trimEnd();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new KeystoreError(
        "TOOL_MISSING",
        "'powershell.exe' not found on PATH. This is required for storing the API key via Windows DPAPI.",
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new KeystoreError(
      "UNKNOWN",
      `Failed to encrypt key via PowerShell DPAPI: ${msg}`,
    );
  }

  try {
    const dpapiPath = getDpapiPath();
    // Note: mode is ignored on Windows (Node.js no-op). Security for the
    // DPAPI file comes from the encryption itself (user+machine scoped),
    // not from file permissions. The mode values are kept for correctness
    // on other platforms and to document the intended access level.
    fsMkdirSync(dirname(dpapiPath), { recursive: true, mode: 0o700 });
    fsWriteFileSync(dpapiPath, encrypted, { mode: 0o600 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new KeystoreError(
      "UNKNOWN",
      `Failed to write DPAPI blob to disk: ${msg}`,
    );
  }
}
async function readWindowsDpapi(): Promise<string | null> {
  const dpapiPath = getDpapiPath();
  // Read the file directly and handle ENOENT — avoids TOCTOU between
  // existsSync and readFileSync (the file could be deleted in between).
  let encrypted: string;
  try {
    encrypted = fsReadFileSync(dpapiPath, "utf-8").trim();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    const msg = err instanceof Error ? err.message : String(err);
    throw new KeystoreError("UNKNOWN", `Failed to read DPAPI blob: ${msg}`);
  }

  try {
    const out = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-Command", PS_DECRYPT_SCRIPT],
      {
        input: encrypted,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    return (typeof out === "string" ? out : out.toString("utf-8")).trimEnd();
  } catch (err) {
    return handlePowerShellReadError(err);
  }
}

/**
 * Map errors from the PowerShell decrypt script into our KeystoreError shape.
 * DPAPI's CryptographicException means the file was encrypted by a different
 * (user × machine) tuple.
 */
function handlePowerShellReadError(err: unknown): never {
  const e = err as NodeJS.ErrnoException & { stderr?: Buffer | string };
  if (e.code === "ENOENT") {
    throw new KeystoreError(
      "TOOL_MISSING",
      "'powershell.exe' not found on PATH. This is required for reading the API key from Windows DPAPI storage.",
    );
  }
  const stderr =
    typeof e.stderr === "string"
      ? e.stderr
      : (e.stderr?.toString("utf-8") ?? "");
  if (
    stderr.includes("Key not valid for use in specified state") ||
    stderr.includes("CryptographicException")
  ) {
    throw new KeystoreError(
      "DECRYPT_FAILED",
      [
        "Encrypted key cannot be decrypted.",
        `${getDpapiPath()} was encrypted by a different Windows user or on a different machine.`,
        "DPAPI is scoped to (user × machine) pairs.",
        "Run: b3os-mcp-setup to re-create it on this user/machine.",
      ].join("\n"),
    );
  }
  const msg = e.message || stderr || "unknown error";
  throw new KeystoreError(
    "UNKNOWN",
    `Failed to decrypt Windows DPAPI key: ${msg}`,
  );
}

// ── Test-only dependency injection ──
// Tests inject a fake execFileSync so they can run on any platform without
// touching real OS credential storage. Never call these in production code.

export type ExecFn = (
  file: string,
  args: readonly string[],
  options?: ExecFileSyncOptions,
) => Buffer | string;

let execFileSync: ExecFn = realExecFileSync as unknown as ExecFn;

export function __setExecFnForTests(fn: ExecFn): void {
  execFileSync = fn;
}

export function __resetExecFnForTests(): void {
  execFileSync = realExecFileSync as unknown as ExecFn;
}

// Injectable fs functions — same pattern as execFileSync above, so tests can
// stub out filesystem side-effects (mkdirSync / writeFileSync / readFileSync)
// without needing vi.spyOn on ESM namespace exports.
export type FsFns = {
  mkdirSync: (
    path: string,
    options?: MakeDirectoryOptions,
  ) => string | undefined;
  writeFileSync: (
    path: string,
    data: string,
    options?: WriteFileOptions,
  ) => void;
  readFileSync: (path: string, encoding: BufferEncoding) => string;
};

let fsMkdirSync: FsFns["mkdirSync"] =
  realMkdirSync as unknown as FsFns["mkdirSync"];
let fsWriteFileSync: FsFns["writeFileSync"] =
  realWriteFileSync as unknown as FsFns["writeFileSync"];
let fsReadFileSync: FsFns["readFileSync"] =
  realReadFileSync as unknown as FsFns["readFileSync"];

export function __setFsFnsForTests(fns: Partial<FsFns>): void {
  if (fns.mkdirSync) fsMkdirSync = fns.mkdirSync;
  if (fns.writeFileSync) fsWriteFileSync = fns.writeFileSync;
  if (fns.readFileSync) fsReadFileSync = fns.readFileSync;
}

export function __resetFsFnsForTests(): void {
  fsMkdirSync = realMkdirSync as unknown as FsFns["mkdirSync"];
  fsWriteFileSync = realWriteFileSync as unknown as FsFns["writeFileSync"];
  fsReadFileSync = realReadFileSync as unknown as FsFns["readFileSync"];
}
