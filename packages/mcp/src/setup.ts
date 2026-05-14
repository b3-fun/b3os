#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  chmodSync,
  realpathSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { homedir, hostname, userInfo } from "node:os";
import { fileURLToPath } from "node:url";
import { execSync, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { waitForOAuthCallback } from "./oauth-callback.js";
import {
  createApiKey,
  createServiceAccount,
  findServiceAccountByName,
} from "./b3os-api.js";
import {
  detectKeystore,
  readApiKey,
  storeApiKey,
  type KeystoreKind,
} from "./keystore.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const ENV_URLS: Record<string, { api: string; web: string }> = {
  dev: { api: "https://dev-api.b3os.org", web: "https://dev.b3os.org" },
  local: { api: "http://localhost:8080", web: "http://localhost:3000" },
  prod: { api: "https://api.b3os.org", web: "https://b3os.org" },
};
const envKey = process.env.B3OS_ENV;
const envUrls = envKey ? ENV_URLS[envKey] : undefined;
if (envKey && !envUrls) {
  console.error(`✗ Unknown B3OS_ENV='${envKey}'. Use dev, local, or prod.`);
  process.exit(1);
}
const B3OS_SERVER_URL =
  process.env.B3OS_SERVER_URL || envUrls?.api || "https://api.b3os.org";
const B3OS_WEB_URL =
  process.env.B3OS_WEB_URL || envUrls?.web || "https://b3os.org";

/** Explicit permissions required by b3os-mcp at runtime — matches read-write scope. */
const MCP_SA_PERMISSIONS = [
  "workflow:read",
  "workflow:create",
  "workflow:update",
  "workflow:delete",
  "workflow:execute",
  "workflow:publish",
  "connector:read",
  "action:read",
  "action_proxy:execute",
  "run:read",
  "run:stream",
  "run:cancel",
  "execution:read",
  "execution:stream",
  "ai:chat",
  "database:read",
  "apikey:read",
] as const;

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Read-only / non-destructive b3os-mcp tools that are safe to pre-approve.
 * Write tools (create_workflow, run_action, query_database, etc.) stay
 * behind permission prompts — users must approve each mutation explicitly.
 */
const SAFE_AUTO_APPROVE_TOOLS = [
  // Identity
  "mcp__b3os-mcp__b3os_whoami",
  // Read-only lists
  "mcp__b3os-mcp__b3os_list_wallets",
  "mcp__b3os-mcp__b3os_list_connectors",
  "mcp__b3os-mcp__b3os_list_telegram_chats",
  "mcp__b3os-mcp__b3os_list_slack_channels",
  "mcp__b3os-mcp__b3os_list_actions",
  "mcp__b3os-mcp__b3os_search_actions",
  "mcp__b3os-mcp__b3os_get_action",
  "mcp__b3os-mcp__b3os_list_triggers",
  "mcp__b3os-mcp__b3os_get_trigger",
  "mcp__b3os-mcp__b3os_list_workflows",
  "mcp__b3os-mcp__b3os_get_workflow",
  "mcp__b3os-mcp__b3os_validate_workflow",
  "mcp__b3os-mcp__b3os_list_runs",
  "mcp__b3os-mcp__b3os_get_run",
  "mcp__b3os-mcp__b3os_list_tables",
  "mcp__b3os-mcp__b3os_get_table_schema",
  // Read-only lookups
  "mcp__b3os-mcp__b3os_query_action",
  "mcp__b3os-mcp__b3os_token_lookup",
  "mcp__b3os-mcp__b3os_price_lookup",
  "mcp__b3os-mcp__b3os_balance_lookup",
  "mcp__b3os-mcp__b3os_defi_lookup",
  "mcp__b3os-mcp__b3os_debug_transaction",
  "mcp__b3os-mcp__b3os_polymarket_lookup",
  // Caddie (analysis-only — doesn't mutate user workflows)
  "mcp__b3os-mcp__b3os_build_workflow",
  "mcp__b3os-mcp__b3os_debug_run",
] as const;

// ── Helpers ──

function print(msg: string): void {
  process.stdout.write(msg + "\n");
}

/**
 * Open a URL in the user's default browser. Platform-aware.
 * Silent on failure — the caller should also print the URL so the user can copy it.
 */
/**
 * Display a prompt and wait until the user presses Enter. In non-TTY
 * environments (CI, piped stdin), resolves immediately so automated
 * callers don't hang.
 */
function waitForEnter(promptText: string): Promise<void> {
  return new Promise((resolve) => {
    process.stdout.write(promptText);
    if (!process.stdin.isTTY) {
      process.stdout.write("\n");
      resolve();
      return;
    }
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const done = (): void => {
      rl.close();
      resolve();
    };
    rl.once("line", done);
    rl.once("close", () => resolve());
  });
}

function promptSetupChoice(): Promise<"signin" | "quickstart"> {
  return new Promise((resolve) => {
    process.stdout.write(
      "\nHow would you like to connect?\n\n" +
        "  1. Sign in or create account — Opens browser to log in or register\n" +
        "  2. Quick start — Instant access, no sign-up needed\n\n" +
        "Choice [1/2]: ",
    );

    if (!process.stdin.isTTY) {
      const useQuickStart = process.env.B3OS_QUICK_START === "1";
      process.stdout.write(useQuickStart ? "2\n" : "1\n");
      resolve(useQuickStart ? "quickstart" : "signin");
      return;
    }

    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.once("line", (line: string) => {
      rl.close();
      const choice = line.trim();
      if (choice === "2") {
        resolve("quickstart");
      } else {
        resolve("signin");
      }
    });
    rl.once("close", () => resolve("signin"));
  });
}

function openBrowser(url: string): void {
  const [cmd, ...args] =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];
  try {
    const child = spawn(cmd, args, {
      detached: true,
      stdio: "ignore",
    });
    child.on("error", () => {
      // Non-fatal — we already printed the URL
    });
    child.unref();
  } catch {
    // Non-fatal — we already printed the URL
  }
}

function getPackageDir(): string {
  // setup.js lives in dist/, package.json is one level up
  return join(__dirname, "..");
}

function getServerEntryPath(): string {
  // setup.js and index.js are always co-located in dist/ after tsc build
  return join(__dirname, "index.js");
}

/**
 * Ensure dist/index.js exists. If missing, attempt to build.
 */
function ensureBuild(): void {
  const entryPath = getServerEntryPath();
  if (existsSync(entryPath)) return;

  print("  ⚠ Build not found. Running pnpm build...");
  try {
    execSync("pnpm build", { cwd: getPackageDir(), stdio: "inherit" });
  } catch {
    print(
      "\n  ✗ Build failed. Run 'pnpm build' manually in packages/b3os-mcp/",
    );
    process.exit(1);
  }

  if (!existsSync(entryPath)) {
    print("\n  ✗ Build completed but dist/index.js not found.");
    process.exit(1);
  }
}

type LinkResult = "already-available" | "linked" | "failed";

/**
 * Ensure a global `b3os-mcp` command is available.
 *
 * If the command already resolves on PATH, we're done — this covers both
 * a prior successful `npm link` and a global install via
 * `npm install -g @b3dotfun/b3os-mcp`. Otherwise, run `npm link --force`
 * from the local package directory.
 *
 * Returns:
 *   - "already-available" — command was already on PATH; no linking attempted
 *   - "linked" — ran `npm link --force` and the command now resolves
 *   - "failed" — command is not available (caller should fall back to the
 *     absolute-path invocation)
 *
 * NOTE: we MUST NOT run `npm link` when this script is itself executing
 * from inside a global `node_modules` directory. In that case npm 10 mis-
 * resolves the link spec as `file:b3os-mcp` relative to the global
 * `node_modules` parent, tries to pack-and-extract the package onto
 * itself, and fails with ENOENT on a doubled path like
 * `.../@b3dotfun/b3os-mcp/b3os-mcp/package.json`. Globally installed
 * packages already expose their bins on PATH, so skipping is correct.
 */
function linkGlobally(): LinkResult {
  // Platform-aware PATH lookup: `which` is Unix-only, `where` is the
  // Windows equivalent. Without this, a Windows user with a global install
  // would fall through to `npm link` and re-trigger the ENOENT bug this
  // function is designed to avoid.
  const findOnPath =
    process.platform === "win32" ? "where b3os-mcp" : "which b3os-mcp";

  // Fast path: already on PATH, nothing to do.
  try {
    execSync(findOnPath, { stdio: "pipe" });
    return "already-available";
  } catch {
    // Not on PATH — fall through to npm link.
  }

  const pkgDir = getPackageDir();
  try {
    execSync("npm link --force", { cwd: pkgDir, stdio: "pipe" });
  } catch (err: unknown) {
    const stderr = (err as { stderr?: Buffer }).stderr?.toString().trim();
    print(`  ⚠ npm link failed: ${stderr || errMsg(err)}`);
    return "failed";
  }

  // Verify the symlink is resolvable
  try {
    execSync(findOnPath, { stdio: "pipe" });
    return "linked";
  } catch {
    print("  ⚠ b3os-mcp command not found after linking");
    return "failed";
  }
}

/**
 * Build the MCP server entry for config files.
 * Uses the global command name if available, falls back to absolute node path.
 *
 * NOTE: We use process.execPath (absolute path to the node binary) instead of
 * "node" because nvm/fnm paths are not available in subprocess environments
 * (e.g. when Claude Code spawns the MCP server process).
 */
function buildServerEntry(
  apiKey: string,
  useGlobalCommand: boolean,
  keystoreKind: KeystoreKind,
  opts?: { type?: string },
): Record<string, unknown> {
  const entry: Record<string, unknown> = useGlobalCommand
    ? { command: "b3os-mcp" }
    : { command: process.execPath, args: [getServerEntryPath()] };

  if (opts?.type) entry.type = opts.type;
  if (keystoreKind === "plaintext-fallback") {
    entry.env = { B3OS_API_KEY: apiKey, B3OS_SERVER_URL };
  } else {
    entry.env = { B3OS_SERVER_URL };
  }
  return entry;
}

/**
 * Check if an existing b3os config entry uses the old absolute-path format
 * (command: "node" with args pointing to a file path).
 */
function isStaleAbsolutePathEntry(entry: unknown): boolean {
  if (!entry || typeof entry !== "object") return false;
  const e = entry as Record<string, unknown>;
  if (e.command !== "node" || !Array.isArray(e.args) || e.args.length === 0)
    return false;
  const firstArg = String(e.args[0]);
  // Only match absolute paths to our index.js, not custom node setups
  return firstArg.startsWith("/") && firstArg.endsWith("/index.js");
}

// ── JSON config helpers ──

function readJsonConfig(filePath: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as Record<
      string,
      unknown
    >;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      print(
        `  ⚠ Could not parse existing config at ${filePath} — creating fresh`,
      );
    }
    return {};
  }
}

function writeJsonConfig(path: string, config: Record<string, unknown>): void {
  // Write with restrictive mode at create time so there's no window where
  // the file exists with default (0o644) permissions. The `mode` option only
  // applies when creating a new file, so we also chmod existing files below.
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    // chmod may fail on Windows — non-fatal
  }
}

// ── Permission pre-approval helpers ──

function getClaudeDir(): string {
  return join(homedir(), ".claude");
}

function getClaudeCodeSettingsPath(): string {
  return join(getClaudeDir(), "settings.json");
}

/**
 * Merge new tool entries into permissions.allow idempotently.
 * Does not touch disk. Mutates the input config in place and returns it.
 */
export function mergeAllowedTools(
  config: Record<string, unknown>,
  tools: readonly string[],
): { config: Record<string, unknown>; added: number } {
  const perms = (
    config.permissions && typeof config.permissions === "object"
      ? config.permissions
      : {}
  ) as Record<string, unknown>;
  const allow = Array.isArray(perms.allow) ? (perms.allow as string[]) : [];
  const existing = new Set(allow);
  let added = 0;
  for (const tool of tools) {
    if (!existing.has(tool)) {
      allow.push(tool);
      existing.add(tool);
      added++;
    }
  }
  perms.allow = allow;
  config.permissions = perms;
  return { config, added };
}

// ── Claude Desktop config ──

function getClaudeDesktopConfigPath(): string {
  const platform = process.platform;
  if (platform === "darwin") {
    return join(
      homedir(),
      "Library",
      "Application Support",
      "Claude",
      "claude_desktop_config.json",
    );
  } else if (platform === "win32") {
    return join(
      process.env.APPDATA || join(homedir(), "AppData", "Roaming"),
      "Claude",
      "claude_desktop_config.json",
    );
  }
  // Linux
  return join(homedir(), ".config", "Claude", "claude_desktop_config.json");
}

function isClaudeDesktopInstalled(): boolean {
  const configPath = getClaudeDesktopConfigPath();
  return existsSync(dirname(configPath));
}

function setupClaudeDesktop(
  apiKey: string,
  useGlobalCommand: boolean,
  keystoreKind: KeystoreKind,
): { migrated: boolean } {
  const configPath = getClaudeDesktopConfigPath();
  const config = readJsonConfig(configPath);

  const raw = config.mcpServers;
  const mcpServers = (
    typeof raw === "object" && raw && !Array.isArray(raw) ? raw : {}
  ) as Record<string, unknown>;
  const migrated = isStaleAbsolutePathEntry(mcpServers["b3os-mcp"]);
  mcpServers["b3os-mcp"] = buildServerEntry(
    apiKey,
    useGlobalCommand,
    keystoreKind,
  );
  config.mcpServers = mcpServers;

  writeJsonConfig(configPath, config);
  return { migrated };
}

// ── Claude Code config ──

/**
 * Get the user-scoped MCP config path (~/.claude/mcp.json).
 * This config applies to ALL projects — ideal for global installs.
 */
function getUserMcpJsonPath(): string {
  return join(getClaudeDir(), "mcp.json");
}

/**
 * Find the git root directory for the current working directory.
 * Returns null if not in a git repo.
 */
function findGitRoot(): string | null {
  try {
    return execSync("git rev-parse --show-toplevel", { stdio: "pipe" })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

/**
 * Get the project-scoped .mcp.json path if inside a git repo.
 * This config applies only to this project.
 */
function getProjectMcpJsonPath(): string | null {
  const root = findGitRoot();
  return root ? join(root, ".mcp.json") : null;
}

/**
 * Check if .mcp.json is listed in the repo's .gitignore.
 */
function isMcpJsonGitignored(): boolean {
  try {
    // git check-ignore exits 0 if the path is ignored, 1 if not
    execSync("git check-ignore -q .mcp.json", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

interface McpJson {
  mcpServers?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Write the b3os MCP server entry into an mcp.json config file.
 * Creates the file if it doesn't exist, merges if it does.
 */
function writeMcpJsonEntry(
  filePath: string,
  apiKey: string,
  useGlobalCommand: boolean,
  keystoreKind: KeystoreKind,
  opts?: { type?: string },
): { migrated: boolean } {
  const config = readJsonConfig(filePath) as McpJson;
  const mcpServers = (
    typeof config.mcpServers === "object" &&
    config.mcpServers &&
    !Array.isArray(config.mcpServers)
      ? config.mcpServers
      : {}
  ) as Record<string, unknown>;
  const migrated = isStaleAbsolutePathEntry(mcpServers["b3os-mcp"]);
  mcpServers["b3os-mcp"] = buildServerEntry(
    apiKey,
    useGlobalCommand,
    keystoreKind,
    opts,
  );
  config.mcpServers = mcpServers;
  writeJsonConfig(filePath, config);
  return { migrated };
}

// ── Diagnose ──

async function runDiagnose(): Promise<void> {
  // readApiKey and detectKeystore are statically imported at the top.
  print("B3OS MCP keystore status");
  print(`  Platform:  ${process.platform}`);
  const kind = detectKeystore();
  print(`  Backend:   ${kind}`);

  let key: string | null = null;
  let readError: string | null = null;
  try {
    key = await readApiKey();
  } catch (err) {
    readError = errMsg(err);
  }

  if (readError) {
    print("  Item:      ✗ read failed");
    print(`  Error:     ${readError.split("\n").join("\n             ")}`);
    return;
  }
  if (!key) {
    if (kind === "plaintext-fallback") {
      print(
        "  Item:      – plaintext-fallback (key lives in ~/.claude/mcp.json env block)",
      );
    } else {
      print("  Item:      ✗ not found");
      print("  Fix:       Run: b3os-mcp-setup");
    }
    return;
  }
  print(`  Item:      ✓ present (${key.slice(0, 12)}...)`);

  print("");
  print("Test API call...");
  try {
    // Set the env var so getApiKey() in client.ts takes the fast env path
    // instead of calling readApiKey() again (which would be a second
    // keychain read in the same process).
    if (key) process.env.B3OS_API_KEY = key;
    const { request } = await import("./client.js");
    await request("/v1/whoami");
    print("  ✓ /v1/whoami returned 200");
  } catch (err) {
    print(`  ✗ /v1/whoami failed: ${errMsg(err)}`);
    print("");
    print("  If the key is correct but the call fails, check:");
    print("    - B3OS_SERVER_URL (default: https://api.b3os.org)");
    print("    - Network reachability");
    print(
      "    - Key revocation status at b3os.org/organizations/settings?tab=api-keys",
    );
  }
}

// ── Main ──

// ANSI color codes — brand blue #6C8EEF (closest 256-color: 111).
// Guard against non-TTY output (piped/CI), NO_COLOR env (no-color.org), and dumb terminals
// to avoid printing raw escape sequences as literal garbage.
const supportsColor =
  process.stdout.isTTY && !process.env.NO_COLOR && process.env.TERM !== "dumb";
const BRAND = supportsColor ? "\x1b[38;5;111m\x1b[1m" : "";
const DIM = supportsColor ? "\x1b[2m" : "";
const RESET = supportsColor ? "\x1b[0m" : "";

const BANNER = `
${BRAND}  ██████╗ ██████╗  ██████╗ ███████╗${RESET}
${BRAND}  ██╔══██╗╚════██╗██╔═══██╗██╔════╝${RESET}
${BRAND}  ██████╔╝ █████╔╝██║   ██║███████╗${RESET}
${BRAND}  ██╔══██╗ ╚═══██╗██║   ██║╚════██║${RESET}
${BRAND}  ██████╔╝██████╔╝╚██████╔╝███████║${RESET}
${BRAND}  ╚═════╝ ╚═════╝  ╚═════╝ ╚══════╝${RESET}

  ${DIM}MCP server setup — connect Claude to B3OS${RESET}
`;

async function quickStartFlow(serverUrl: string): Promise<void> {
  const { callBootstrap } = await import("./bootstrap-api.js");

  process.stdout.write("\n  Provisioning account...\n");
  const result = await callBootstrap(serverUrl);

  const keystoreKind = detectKeystore();
  await storeApiKey(result.apiKey);

  ensureBuild();
  const linkResult = linkGlobally();
  const useGlobalCommand = linkResult !== "failed";

  const userScopeMcpJson = join(homedir(), ".claude", "mcp.json");
  writeMcpJsonEntry(
    userScopeMcpJson,
    result.apiKey,
    useGlobalCommand,
    keystoreKind,
    {
      type: "stdio",
    },
  );

  const settingsPath = join(homedir(), ".claude", "settings.json");
  const settingsConfig = readJsonConfig(settingsPath);
  mergeAllowedTools(settingsConfig, SAFE_AUTO_APPROVE_TOOLS);
  writeJsonConfig(settingsPath, settingsConfig);

  process.stdout.write(
    `\n  ✓ Connected to B3OS (${result.orgSlug})\n\n` +
      `  Your account is ready with ${result.initialCuGrant} CU.\n` +
      `  To claim this account and add your email:\n` +
      `    ${result.claimUrl}\n\n` +
      `  Claim is optional — you can start using B3OS now.\n` +
      `\n  Restart Claude Code, then try:\n` +
      `    "Build a workflow that monitors ETH price every 5 min"\n\n`,
  );
}

async function main(): Promise<void> {
  if (process.argv.slice(2).includes("--diagnose")) {
    await runDiagnose();
    return;
  }

  print(BANNER);

  const setupChoice = await promptSetupChoice();

  if (setupChoice === "quickstart") {
    await quickStartFlow(B3OS_SERVER_URL);
    return;
  }

  print("");
  print("  1. Logging in via browser...");
  print("");

  const oauthState = randomBytes(16).toString("hex");
  const { port, result } = await waitForOAuthCallback({
    expectedState: oauthState,
    timeoutMs: 300_000,
  });

  // Use 127.0.0.1 explicitly — "localhost" can resolve to ::1 on systems where
  // /etc/hosts prefers IPv6, but our callback server binds to 127.0.0.1 only.
  const authUrl = new URL(`${B3OS_WEB_URL}/cli/auth`);
  authUrl.searchParams.set("callback", `http://127.0.0.1:${port}/callback`);
  authUrl.searchParams.set("state", oauthState);
  authUrl.searchParams.set("mode", "mcp-setup");
  const authUrlStr = authUrl.toString();

  await waitForEnter(
    "     Press Enter to open the B3OS sign-in page in your browser... ",
  );
  print("");
  openBrowser(authUrlStr);
  print("     If your browser didn't open, paste this URL manually:");
  print(`     ${authUrlStr}`);
  print("");
  print("     Waiting for you to complete sign-in...");

  let jwt: string;
  let orgId: string;
  try {
    const callback = await result;
    jwt = callback.token;
    orgId = callback.orgId;
  } catch (err) {
    print(`\n  ✗ Sign-in failed: ${errMsg(err)}`);
    print(
      "    Make sure you completed sign-in in the browser, then re-run b3os-mcp-setup.",
    );
    process.exit(1);
  }

  print("  ✓ Logged in successfully");
  print("");

  const machineName = hostname() || "unknown-host";
  const saName = `b3os-mcp@${machineName}`;
  const description = `Created by b3os-mcp-setup on ${new Date().toISOString()}`;

  print(`  2. Setting up service account "${saName}"...`);
  let sa: { id: string };
  let saCreatedThisRun = false;
  try {
    // Reuse an existing SA with this name if present (idempotent re-run: lets
    // the user rotate their API key without manually deleting the SA first).
    const existing = await findServiceAccountByName({
      serverUrl: B3OS_SERVER_URL,
      jwt,
      orgId,
      name: saName,
    });
    if (existing) {
      sa = existing;
      print(`  ✓ Reusing existing service account (${sa.id})`);
    } else {
      sa = await createServiceAccount({
        serverUrl: B3OS_SERVER_URL,
        jwt,
        orgId,
        name: saName,
        description,
        permissions: [...MCP_SA_PERMISSIONS],
      });
      saCreatedThisRun = true;
      print(`  ✓ Service account created (${sa.id})`);
    }
  } catch (err) {
    print(`\n  ✗ Failed to create service account: ${errMsg(err)}`);
    print(
      "    If this is a permissions error, ask your org admin to grant you the",
    );
    print("    `service_account:write` and `apikey:create` permissions.");
    print("    Otherwise, re-run b3os-mcp-setup to try again.");
    process.exit(1);
  }
  print("");

  print("  3. Creating API key...");
  let apiKey: string;
  try {
    const keyResult = await createApiKey({
      serverUrl: B3OS_SERVER_URL,
      jwt,
      orgId,
      name: saName,
      description,
      serviceAccountId: sa.id,
    });
    apiKey = keyResult.key;
  } catch (err) {
    print(`\n  ✗ Failed to create API key: ${errMsg(err)}`);
    if (saCreatedThisRun) {
      print(
        `    An empty service account '${saName}' (${sa.id}) was created and may be left behind.`,
      );
      print(
        "    You can delete it from b3os.org/organizations/settings?tab=api-keys,",
      );
    }
    print("    Re-run b3os-mcp-setup to try again.");
    process.exit(1);
  }
  print(`  ✓ API key created (${apiKey.slice(0, 12)}...)`);
  print("");

  // Detect keystore kind once.
  const keystoreKind = detectKeystore();

  print("  4. Storing API key in OS keystore...");
  try {
    await storeApiKey(apiKey);
  } catch (err) {
    print(`\n  ✗ Failed to store API key in OS keystore: ${errMsg(err)}`);
    print("    Re-run b3os-mcp-setup to try again.");
    process.exit(1);
  }

  if (keystoreKind === "macos-keychain") {
    print(
      `  ✓ macOS Keychain — service 'b3os-mcp', account '${userInfo().username}'`,
    );
    print("    ℹ Key is encrypted at rest — no plaintext on disk.");
    print(
      "    ℹ To revoke later: security delete-generic-password -s b3os-mcp",
    );
  } else if (keystoreKind === "windows-dpapi") {
    print("  ✓ Windows DPAPI — encrypted at ~/.b3os/b3os-mcp-key.dpapi");
    print("    ℹ Decryptable only by this Windows user on this machine.");
    print("    ℹ To revoke later: delete that file + revoke key at b3os.org.");
  } else {
    print(
      "  – Linux detected — OS keystore not available, using plaintext fallback.",
    );
    print(
      "    Key will be stored in ~/.claude/mcp.json (owner-only, not committed).",
    );
  }
  print("");

  // Build validation & global link
  ensureBuild();

  print("  5. Linking b3os-mcp globally...");
  const linkResult = linkGlobally();
  const useGlobalCommand = linkResult !== "failed";

  if (linkResult === "already-available") {
    print("  ✓ Global command already available: b3os-mcp");
  } else if (linkResult === "linked") {
    print("  ✓ Global command linked: b3os-mcp");
  } else {
    print("  ⚠ Falling back to absolute path (global link unavailable)");
  }
  print("");

  // Configure Claude clients
  print("  6. Configuring Claude clients...");

  // 4a: Claude Code — user-scoped (~/.claude/mcp.json, works in all projects)
  const userMcpPath = getUserMcpJsonPath();
  {
    const { migrated } = writeMcpJsonEntry(
      userMcpPath,
      apiKey,
      useGlobalCommand,
      keystoreKind,
      { type: "stdio" },
    );
    print(`  ✓ Claude Code (global) — ${userMcpPath}`);
    if (migrated) print("    ✓ Migrated from absolute path to global command");
  }

  // 4b: Claude Code — project-scoped (.mcp.json in git root, if in a repo and gitignored)
  const projectMcpPath = getProjectMcpJsonPath();
  if (projectMcpPath) {
    if (isMcpJsonGitignored()) {
      const { migrated } = writeMcpJsonEntry(
        projectMcpPath,
        apiKey,
        useGlobalCommand,
        keystoreKind,
        {
          type: "stdio",
        },
      );
      print(`  ✓ Claude Code (project) — ${projectMcpPath}`);
      if (migrated)
        print("    ✓ Migrated from absolute path to global command");
    } else {
      if (keystoreKind === "plaintext-fallback") {
        print(
          "  – Skipped project .mcp.json (not in .gitignore — would leak API key)",
        );
      } else {
        print("  – Skipped project .mcp.json (not in .gitignore)");
      }
      print(
        "    Add '.mcp.json' to your .gitignore to enable project-scoped config",
      );
    }
  }

  // 4c: Claude Desktop
  let claudeDesktopConfigured = false;
  if (isClaudeDesktopInstalled()) {
    const { migrated } = setupClaudeDesktop(
      apiKey,
      useGlobalCommand,
      keystoreKind,
    );
    print("  ✓ Claude Desktop — configured");
    if (migrated) print("    ✓ Migrated from absolute path to global command");
    claudeDesktopConfigured = true;
  } else {
    print("  – Claude Desktop not detected (skipped)");
  }

  if (!claudeDesktopConfigured) {
    print("");
    print(
      "  ℹ To use B3OS with Claude Desktop, install it from https://claude.ai/download",
    );
    print("    and re-run this setup.");
  }

  // Auto-approve safe read-only tools (no prompt)
  print("");
  print(
    `  7. Pre-approving ${SAFE_AUTO_APPROVE_TOOLS.length} read-only b3os-mcp tools...`,
  );
  {
    const settingsPath = getClaudeCodeSettingsPath();
    const config = readJsonConfig(settingsPath);
    const { config: merged, added } = mergeAllowedTools(
      config,
      SAFE_AUTO_APPROVE_TOOLS,
    );
    writeJsonConfig(settingsPath, merged);
    if (added > 0) {
      print(`  ✓ Added ${added} tools to ${settingsPath}`);
    } else {
      print(
        `  ✓ All ${SAFE_AUTO_APPROVE_TOOLS.length} tools already pre-approved`,
      );
    }
    print(
      "    Write tools (create/update/delete/run) still require approval per call.",
    );
    print(
      "    To revert: remove the mcp__b3os-mcp__* entries from permissions.allow",
    );
  }

  print("");
  print("  ─────────────────────");
  print("  Restart Claude Code and/or Claude Desktop, then try:");
  print("");
  print('    "Build a workflow that monitors ETH price every 5 min"');
  print('    "What actions are available for DeFi?"');
  print('    "Why did tx 0xabc... on Base fail?"');
  print("");
}

// Only run main() when this file is the entry point (not when imported by tests).
// Resolve symlinks so `npm link` (which points argv[1] at a symlink) still matches.
function isEntryPoint(): boolean {
  if (!process.argv[1]) return false;
  try {
    const modulePath = fileURLToPath(import.meta.url);
    return realpathSync(modulePath) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  main().catch((err) => {
    print(`\n  ✗ Setup failed: ${errMsg(err)}`);
    process.exit(1);
  });
}
