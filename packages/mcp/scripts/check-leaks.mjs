#!/usr/bin/env node
/**
 * check-leaks.mjs — Pre-publish safety scanner for @b3dotfun/b3os-mcp.
 *
 * Runs automatically in prepublishOnly. Blocks `npm publish` if the tarball
 * contains secrets, internal URLs, personal info, or dev artifacts.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, statSync, readdirSync, realpathSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Resolve the b3os-mcp package root relative to this script's location.
 * scripts/check-leaks.mjs lives one directory below the package root,
 * so the parent dir of __dirname is what we want. Using this instead
 * of process.cwd() makes the scanner work regardless of where it's
 * invoked from (package dir, monorepo root, or vitest).
 */
function getPackageRoot() {
  const __dirname = fileURLToPath(new URL(".", import.meta.url));
  return join(__dirname, "..");
}

export const RULES = [
  // Secrets — never allowlistable (see validateAllowlist).
  {
    id: "b3os-secret-key",
    bucket: "secrets",
    severity: "error",
    regex: /\bb3sk_[A-Za-z0-9_-]{16,}/g,
    scope: "content",
  },
  {
    id: "stripe-key",
    bucket: "secrets",
    severity: "error",
    regex: /\bsk_(?:live|test)_[A-Za-z0-9]{16,}/g,
    scope: "content",
  },
  {
    id: "aws-access-key",
    bucket: "secrets",
    severity: "error",
    regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
    scope: "content",
  },
  {
    id: "github-token",
    bucket: "secrets",
    severity: "error",
    regex: /\b(?:ghp|gho|ghs|ghu)_[A-Za-z0-9]{36}\b/g,
    scope: "content",
  },
  {
    id: "anthropic-key",
    bucket: "secrets",
    severity: "error",
    regex: /\bsk-ant-[A-Za-z0-9_-]{32,}/g,
    scope: "content",
  },
  {
    id: "openai-key",
    bucket: "secrets",
    severity: "error",
    // Negative lookahead so this doesn't collide with the anthropic rule.
    regex: /\bsk-(?!ant-)[A-Za-z0-9_-]{32,}/g,
    scope: "content",
  },
  {
    id: "jwt",
    bucket: "secrets",
    severity: "error",
    regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
    scope: "content",
  },
  {
    id: "private-key-pem",
    bucket: "secrets",
    severity: "error",
    regex: /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/g,
    scope: "content",
  },
  {
    id: "basic-auth-url",
    bucket: "secrets",
    severity: "error",
    regex: /https?:\/\/[^\s:@/]+:[^\s@/]+@/g,
    scope: "content",
  },
  // Internal infrastructure URLs.
  {
    id: "dot-internal",
    bucket: "internal-urls",
    severity: "error",
    regex: /\b[a-z0-9-]+\.internal\b/g,
    scope: "content",
  },
  {
    id: "staging-subdomain",
    bucket: "internal-urls",
    severity: "error",
    // TLD alternation is deliberately broad: B3's own primary domain is
    // .fun, and modern internal infra also uses .app/.xyz/.co/.dev/.cloud.
    // A narrow `com|org|io|net` list (the original) would miss
    // `api.staging.b3.fun` entirely.
    regex:
      /\b[a-z0-9-]+\.(?:staging|dev|corp)\.[a-z0-9-]+\.(?:com|org|io|net|fun|app|xyz|co|dev|cloud)\b/g,
    scope: "content",
  },
  {
    id: "rfc1918-ipv4",
    bucket: "internal-urls",
    severity: "error",
    regex:
      /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})\b/g,
    scope: "content",
  },
  {
    id: "loopback-literal",
    bucket: "internal-urls",
    severity: "error",
    regex: /\b(?:127\.0\.0\.1|localhost)\b/g,
    scope: "content",
  },
  {
    id: "doppler-ref",
    bucket: "internal-urls",
    severity: "error",
    regex: /\bdoppler:\/\//g,
    scope: "content",
  },
  {
    id: "railway-ref",
    bucket: "internal-urls",
    severity: "error",
    regex: /\.up\.railway\.app\b/g,
    scope: "content",
  },
  {
    id: "internal-monorepo-path",
    bucket: "internal-urls",
    severity: "error",
    regex:
      /\b(?:services\/b3os-|apps\/b3os-|internal\/app\/|internal\/pkg\/)\b/g,
    scope: "content",
  },
  // Personal / developer info.
  {
    id: "macos-home-path",
    bucket: "personal",
    severity: "error",
    regex: /\/Users\/[a-zA-Z0-9._-]+\//g,
    scope: "content",
  },
  {
    id: "linux-home-path",
    bucket: "personal",
    severity: "error",
    regex: /\/home\/[a-zA-Z0-9._-]+\//g,
    scope: "content",
  },
  {
    id: "windows-home-path",
    bucket: "personal",
    severity: "error",
    regex: /[A-Z]:(?:\\\\|\\)Users(?:\\\\|\\)[a-zA-Z0-9._-]+(?:\\\\|\\)/g,
    scope: "content",
  },
  {
    id: "email",
    bucket: "personal",
    severity: "error",
    regex: /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g,
    scope: "content",
  },
  // File-presence rules (scope: "path") — fire on path alone, ignore content.
  {
    id: "test-file",
    bucket: "artifacts",
    severity: "error",
    regex: /\.(test)\.(ts|js|mjs|cjs)$/,
    scope: "path",
  },
  {
    id: "spec-file",
    bucket: "artifacts",
    severity: "error",
    regex: /\.(spec)\.(ts|js|mjs|cjs)$/,
    scope: "path",
  },
  {
    id: "tests-dir",
    bucket: "artifacts",
    severity: "error",
    regex: /(^|\/)__tests__\//,
    scope: "path",
  },
  {
    id: "mocks-dir",
    bucket: "artifacts",
    severity: "error",
    regex: /(^|\/)__mocks__\//,
    scope: "path",
  },
  {
    id: "env-file",
    bucket: "artifacts",
    severity: "error",
    regex: /(^|\/)\.env(\.[A-Za-z0-9_-]+)?$/,
    scope: "path",
  },
  {
    id: "doppler-config",
    bucket: "artifacts",
    severity: "error",
    regex: /(^|\/)doppler\.ya?ml$/,
    scope: "path",
  },
  {
    id: "ds-store",
    bucket: "artifacts",
    severity: "error",
    regex: /(^|\/)\.DS_Store$/,
    scope: "path",
  },
  // Narrow-scoped text rules — pathGlob restricts them to dist/**/*.js.
  {
    id: "console-usage",
    bucket: "artifacts",
    severity: "error",
    regex: /\bconsole\.(?:log|debug|trace)\b/g,
    scope: "content",
    // dist/**/*.js only — this package's tsc emits .js, not .mjs/.cjs.
    // Update if the build config changes.
    pathGlob: /^dist\/.*\.js$/,
  },
  {
    id: "todo-comment",
    bucket: "artifacts",
    severity: "warning",
    regex: /\b(?:TODO|FIXME|HACK|XXX)\b/g,
    scope: "content",
    // dist/**/*.js only — same assumption as console-usage above.
    pathGlob: /^dist\/.*\.js$/,
  },
];
// Module-load integrity check: every rule must reference a known bucket,
// severity, and scope. A typo anywhere in RULES (e.g. severity: "errror")
// would otherwise cause that rule's findings to be silently dropped during
// aggregation — fail loud at startup instead.
const VALID_BUCKETS = new Set([
  "secrets",
  "internal-urls",
  "personal",
  "artifacts",
]);
const VALID_SEVERITIES = new Set(["error", "warning"]);
const VALID_SCOPES = new Set(["content", "path"]);
for (const rule of RULES) {
  if (!VALID_BUCKETS.has(rule.bucket)) {
    throw new Error(
      `check-leaks: rule '${rule.id}' has unknown bucket '${rule.bucket}'`,
    );
  }
  if (!VALID_SEVERITIES.has(rule.severity)) {
    throw new Error(
      `check-leaks: rule '${rule.id}' has unknown severity '${rule.severity}'`,
    );
  }
  if (!VALID_SCOPES.has(rule.scope)) {
    throw new Error(
      `check-leaks: rule '${rule.id}' has unknown scope '${rule.scope}'`,
    );
  }
}

// Rule ID sets derived once at module load. Used by validateAllowlist to
// reject unknown or forbidden rule IDs without rebuilding the sets per call.
const KNOWN_RULE_IDS = new Set(RULES.map((r) => r.id));
const SECRET_RULE_IDS = new Set(
  RULES.filter((r) => r.bucket === "secrets").map((r) => r.id),
);

export const ALLOWLIST = [
  // Load-bearing loopback references in the OAuth callback server.
  // dist/oauth-callback.js binds to 127.0.0.1 explicitly (never 0.0.0.0) so
  // that the temporary auth server is only reachable from the local machine.
  // All four matches are either the literal bind address or comments that
  // document exactly why 127.0.0.1 is used instead of localhost.
  {
    rule: "loopback-literal",
    file: "dist/oauth-callback.js",
    match: /127\.0\.0\.1|localhost/,
    reason:
      "OAuth callback server binds to 127.0.0.1:0 (loopback-only, OS-assigned port) and parses incoming requests relative to that address",
  },
  // Load-bearing loopback references in the setup wizard.
  // setup.js constructs the callback URL as http://127.0.0.1:<port>/callback
  // and passes it to the B3OS auth page. The comment on the same lines
  // explains why 127.0.0.1 is preferred over 'localhost' (IPv6 ::1 issue).
  {
    rule: "loopback-literal",
    file: "dist/setup.js",
    match: /127\.0\.0\.1|localhost/,
    reason:
      "Setup wizard builds the OAuth redirect URL with 127.0.0.1 (not localhost) to avoid IPv6 resolution issues; comment on same line explains the rationale",
  },
  // Load-bearing loopback references in the API client.
  // getServerUrl() enforces HTTPS but exempts localhost/127.0.0.1 for local
  // development. The regex and the error message both reference "localhost".
  {
    rule: "loopback-literal",
    file: "dist/client.js",
    match: /127\.0\.0\.1|localhost/,
    reason:
      "getServerUrl() HTTPS enforcement regex exempts localhost and 127.0.0.1 for local development",
  },
  // Official vendor / support / CI email domains — not personal addresses.
  // These appear in package.json, README, and generated dist files as
  // repository author, support contact, or CI bot email addresses.
  {
    rule: "email",
    file: "*",
    match: /@(b3\.fun|b3dotfun\.com|anthropic\.com|noreply\.github\.com)$/,
    reason:
      "Official support / vendor / CI domains — not personal email addresses",
  },
];

/**
 * Scan a single file's text content against content-matching rules.
 * Returns an array of findings, one per matched rule occurrence.
 */
export function scanFileContent(file, content) {
  const findings = [];
  // Computed lazily on the first real match — most files are clean, so
  // avoid paying the O(N) newline-scan cost for every file in the tarball.
  let lineStarts = null;

  for (const rule of RULES) {
    if (rule.scope !== "content") continue;
    // Rules with a pathGlob only apply to matching files. Secrets,
    // internal-url, and personal rules have no pathGlob and apply to
    // every text file. Artifact text-scan rules (console-usage,
    // todo-comment) restrict themselves to dist/**/*.js so .d.ts
    // comments and README TODOs don't trip them.
    if (rule.pathGlob && !rule.pathGlob.test(file)) continue;

    const re = new RegExp(rule.regex.source, rule.regex.flags);
    let m;
    while ((m = re.exec(content)) !== null) {
      if (lineStarts === null) lineStarts = computeLineStarts(content);
      findings.push({
        bucket: rule.bucket,
        rule: rule.id,
        file,
        line: lineNumberFor(lineStarts, m.index),
        severity: rule.severity,
        matchedText: m[0],
      });
      if (!re.global) break;
    }
  }
  return findings;
}

/**
 * Scan a file path against file-presence rules (scope: "path"). Content is
 * ignored — these rules fire based on the path alone.
 */
export function scanFilePath(file) {
  const findings = [];
  for (const rule of RULES) {
    if (rule.scope !== "path") continue;
    if (rule.regex.test(file)) {
      findings.push({
        bucket: rule.bucket,
        rule: rule.id,
        file,
        line: 0,
        severity: rule.severity,
        matchedText: file,
      });
    }
  }
  return findings;
}

/**
 * Check whether a finding is suppressed by any ALLOWLIST entry.
 * All three fields (rule, file, match) must match for suppression.
 * The file field supports "*" as a wildcard that matches any file.
 * Returns true if suppressed, false otherwise.
 */
export function isAllowlisted(finding, allowlist = ALLOWLIST) {
  for (const entry of allowlist) {
    if (entry.rule !== finding.rule) continue;
    if (entry.file !== "*" && entry.file !== finding.file) continue;
    if (!entry.match.test(finding.matchedText)) continue;
    return true;
  }
  return false;
}

/**
 * Validate that no ALLOWLIST entry targets a bucket-1 (secrets) rule,
 * references an unknown rule ID, or uses a /g flag. Called at startup
 * from runMain(); thrown errors are caught and reported with exit code
 * 2. This enforces the "secrets are never allowlistable" rule in code,
 * not just as policy — a well-meaning PR that tries to suppress a real
 * secret finding will fail the scanner itself before it can suppress
 * anything.
 */
export function validateAllowlist(allowlist = ALLOWLIST) {
  for (const entry of allowlist) {
    // Ordering matters: verify the rule ID exists BEFORE checking whether
    // it's a secrets rule, so a typo'd secret rule ID can't slip past the
    // secrets guard by virtue of not appearing in SECRET_RULE_IDS.
    if (!KNOWN_RULE_IDS.has(entry.rule)) {
      throw new Error(
        `Allowlist entry references unknown rule '${entry.rule}' — check for typos`,
      );
    }
    if (SECRET_RULE_IDS.has(entry.rule)) {
      throw new Error(
        `Allowlist entry for rule '${entry.rule}' is forbidden: secret rules cannot be allowlisted`,
      );
    }
    // Reject /g flag: isAllowlisted uses regex.test() which leaves
    // lastIndex state on global regexes, silently breaking suppression
    // on the second and subsequent calls.
    if (entry.match.global) {
      throw new Error(
        `Allowlist entry for rule '${entry.rule}' uses a /g regex — allowlist regexes must not use the global flag`,
      );
    }
  }
}

/**
 * Redact a secret preview to the first 16 characters followed by a
 * horizontal ellipsis. Non-secret findings pass through unchanged.
 */
export function redactPreview(bucket, text) {
  if (bucket !== "secrets") return text;
  if (text.length <= 16) return text;
  return text.slice(0, 16) + "…";
}

/**
 * Detect binary content by looking for null bytes in the first 8 KB.
 * Text files (UTF-8, Latin-1) do not contain null bytes; binary files
 * almost always do near the start. This is the same heuristic git uses.
 * The 8 KB window is a compromise: large enough to catch any reasonable
 * binary format's header, small enough that the check is O(1) on
 * multi-megabyte files.
 */
export function isBinaryContent(buffer) {
  const sniffLen = Math.min(buffer.length, 8192);
  // Buffer.indexOf is C-speed vs. a JS byte loop. Returns -1 if absent.
  return buffer.subarray(0, sniffLen).indexOf(0) !== -1;
}

/**
 * Walk a fixture directory as if it were an npm tarball. Returns the
 * same shape as runNpmPackDryRun (name, version, files, bytes, rootDir)
 * but with placeholder name/version so fixture directories don't need
 * their own package.json. Used by the test-only --fixture-dir flag.
 *
 * File paths in the returned `files` array are relative to rootDir and
 * use forward-slash separators regardless of platform (matching the
 * shape of npm pack output).
 */
export function walkFixtureDir(rootDir) {
  const files = [];
  let totalBytes = 0;

  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
      } else if (entry.isFile()) {
        const rel = relative(rootDir, abs).split(sep).join("/");
        files.push(rel);
        totalBytes += statSync(abs).size;
      }
    }
  }

  walk(rootDir);
  files.sort();
  return {
    files,
    bytes: totalBytes,
    name: "fixture",
    version: "0.0.0",
    rootDir,
  };
}

/**
 * Run `npm pack --dry-run --json` against the b3os-mcp package and
 * return the same shape as walkFixtureDir — file list plus meta.
 *
 * We always resolve cwd via getPackageRoot() rather than relying on
 * process.cwd(), so the scanner works whether it's invoked from the
 * package directory, the monorepo root, or a vitest runner.
 *
 * The working tree itself is the source of file bytes — we never extract
 * the tarball, we just use npm to enumerate what it would include.
 * Subsequent scanning reads each file directly from disk.
 */
export function runNpmPackDryRun() {
  const rootDir = getPackageRoot();
  // Windows resolves `npm` to `npm.cmd`; execFileSync doesn't invoke the
  // shell, so the bare name would throw ENOENT on Windows. This lets
  // devs run `pnpm run check:leaks` locally on Windows machines.
  const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
  const raw = execFileSync(npmBin, ["pack", "--dry-run", "--json"], {
    cwd: rootDir,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("npm pack --dry-run --json returned empty output");
  }
  const pkg = parsed[0];
  return {
    name: pkg.name,
    version: pkg.version,
    files: pkg.files.map((f) => f.path),
    bytes: pkg.unpackedSize ?? pkg.size ?? 0,
    rootDir,
  };
}

// Internal helpers for line-number tracking.
function computeLineStarts(content) {
  const starts = [0];
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

function lineNumberFor(lineStarts, index) {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (lineStarts[mid] <= index) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

// ANSI color helpers — guarded against non-TTY / NO_COLOR / TERM=dumb.
const supportsColor =
  process.stdout.isTTY && !process.env.NO_COLOR && process.env.TERM !== "dumb";
const RED = supportsColor ? "\x1b[31m" : "";
const GREEN = supportsColor ? "\x1b[32m" : "";
const YELLOW = supportsColor ? "\x1b[33m" : "";
const DIM = supportsColor ? "\x1b[2m" : "";
const RESET = supportsColor ? "\x1b[0m" : "";

const BUCKET_LABELS = {
  secrets: "Secrets",
  "internal-urls": "Internal URLs",
  personal: "Personal info",
  artifacts: "Dev artifacts",
};

const BUCKET_ORDER = ["secrets", "internal-urls", "personal", "artifacts"];

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const FIX_HINTS = {
  secrets:
    "Remove the hardcoded credential. Secrets must come from environment variables.",
  "internal-urls":
    "Remove or generalize the internal URL. If load-bearing, add an allowlist entry with a reason.",
  personal:
    "Replace the personal path/email with a generic placeholder or env-driven value.",
  artifacts:
    "Exclude the file from the tarball (fix package.json `files` or use .npmignore).",
};

function fixHintFor(bucket) {
  return (
    FIX_HINTS[bucket] ??
    "Review the match and decide whether to remove it or allowlist it."
  );
}

/**
 * Group findings by bucket and severity in a single pass. Returns an
 * object keyed by bucket ID, each entry holding `{ errors, warnings }`
 * arrays, plus top-level `errorCount` / `warnCount` totals. Downstream
 * formatters read from this aggregate instead of re-filtering the raw
 * findings list for every bucket and severity.
 */
function aggregateFindings(findings) {
  const byBucket = {};
  for (const bucket of BUCKET_ORDER)
    byBucket[bucket] = { errors: [], warnings: [] };
  let errorCount = 0;
  let warnCount = 0;
  for (const f of findings) {
    const bucket = byBucket[f.bucket];
    if (!bucket) continue;
    if (f.severity === "error") {
      bucket.errors.push(f);
      errorCount++;
    } else if (f.severity === "warning") {
      bucket.warnings.push(f);
      warnCount++;
    }
  }
  return { byBucket, errorCount, warnCount };
}

function pluralize(count, word) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function pushDetailBlock(lines, group, bucket, { color, label, trailingLine }) {
  if (group.length === 0) return;
  lines.push("");
  lines.push(`${color}${label}: ${BUCKET_LABELS[bucket]}${RESET}`);
  for (const f of group) {
    lines.push(`  ${f.file}:${f.line}`);
    lines.push(`    Matched rule: ${f.rule}`);
    lines.push(`    Matched text: ${redactPreview(f.bucket, f.matchedText)}`);
    lines.push(`    ${trailingLine(f)}`);
  }
}

export function formatTextReport(findings, meta) {
  const lines = [];
  const { byBucket, errorCount, warnCount } = aggregateFindings(findings);

  lines.push(
    `${DIM}→ check-leaks: scanning ${meta.name}@${meta.version} tarball (${meta.files.length} files, ${formatBytes(meta.bytes)})${RESET}`,
  );

  // Per-bucket summary rows
  for (const bucket of BUCKET_ORDER) {
    const { errors, warnings } = byBucket[bucket];
    const marker =
      errors.length > 0
        ? `${RED}✗${RESET}`
        : warnings.length > 0
          ? `${YELLOW}⚠${RESET}`
          : `${GREEN}✓${RESET}`;
    const pad = BUCKET_LABELS[bucket].padEnd(20, " ");
    const summary =
      errors.length > 0
        ? pluralize(errors.length, "finding")
        : warnings.length > 0
          ? pluralize(warnings.length, "warning")
          : "0 findings";
    lines.push(`  ${marker} ${pad}— ${summary}`);
  }

  // Detail blocks: errors first, then warnings, ordered by bucket.
  for (const bucket of BUCKET_ORDER) {
    pushDetailBlock(lines, byBucket[bucket].errors, bucket, {
      color: RED,
      label: "FAIL",
      trailingLine: (f) => `Fix: ${fixHintFor(f.bucket)}`,
    });
  }
  for (const bucket of BUCKET_ORDER) {
    pushDetailBlock(lines, byBucket[bucket].warnings, bucket, {
      color: YELLOW,
      label: "WARN",
      trailingLine: () => "(warning only — publish not blocked)",
    });
  }

  lines.push("");
  if (errorCount === 0) {
    if (warnCount > 0) {
      lines.push(`${GREEN}✓ No hard-fail leaks. Safe to publish.${RESET}`);
      lines.push(
        `  ${YELLOW}${pluralize(warnCount, "warning")} (publish proceeds)${RESET}`,
      );
    } else {
      lines.push(`${GREEN}✓ No leaks detected. Safe to publish.${RESET}`);
    }
  } else {
    lines.push(
      `${RED}✗ ${pluralize(errorCount, "hard-fail finding")}. Publish aborted.${RESET}`,
    );
    lines.push(`  Exit code: 1`);
  }

  return lines.join("\n");
}

export function formatJsonReport(findings, meta) {
  const { errorCount, warnCount } = aggregateFindings(findings);
  return JSON.stringify(
    {
      package: meta.name,
      version: meta.version,
      tarballFiles: meta.files.length,
      tarballBytes: meta.bytes,
      findings: findings.map((f) => ({
        bucket: f.bucket,
        rule: f.rule,
        file: f.file,
        line: f.line,
        severity: f.severity,
        textPreview: redactPreview(f.bucket, f.matchedText),
      })),
      counts: { errors: errorCount, warnings: warnCount },
    },
    null,
    2,
  );
}

/**
 * Parse argv into a typed options object. Throws on unknown flags.
 */
function parseArgs(argv) {
  const args = { json: false, fixtureDir: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") {
      args.json = true;
    } else if (a === "--fixture-dir") {
      args.fixtureDir = argv[++i];
      if (!args.fixtureDir) {
        throw new Error("--fixture-dir requires a path argument");
      }
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }
  return args;
}

/**
 * Build a `{ exitCode: 2, ... }` return for scanner-level failures.
 * All exit-2 paths flow through here so the stderr prefix stays uniform.
 */
function fatalError(msg) {
  return { exitCode: 2, stdout: "", stderr: `check-leaks: ${msg}\n` };
}

/**
 * Run the scanner against a tarball (real via npm pack, or fixture via
 * --fixture-dir) and return { exitCode, stdout, stderr }. This is
 * exported so tests can drive it deterministically with custom argv
 * and capture output instead of relying on process.exit side effects.
 *
 * Exit codes:
 *   0 — clean, or warnings only (publish proceeds)
 *   1 — at least one error finding (publish aborted)
 *   2 — scanner error: bad allowlist, unreadable file, npm pack failure
 *       (publish aborted — "cannot vouch for safety")
 */
export function runMain(argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    return fatalError(err?.message || err);
  }

  // Validate the allowlist BEFORE scanning. Any malformed entry (unknown
  // rule, secrets rule, /g regex) aborts immediately.
  try {
    validateAllowlist();
  } catch (err) {
    return fatalError(err?.message || err);
  }

  let meta;
  try {
    meta = args.fixtureDir
      ? walkFixtureDir(args.fixtureDir)
      : runNpmPackDryRun();
  } catch (err) {
    return fatalError(`failed to enumerate tarball: ${err?.message || err}`);
  }

  const findings = [];
  for (const file of meta.files) {
    // Path-scoped rules (file presence / extension)
    findings.push(...scanFilePath(file));

    // Content-scoped rules — read the file and scan
    let buffer;
    try {
      buffer = readFileSync(join(meta.rootDir, file));
    } catch (err) {
      return fatalError(`failed to read ${file}: ${err?.message || err}`);
    }
    if (isBinaryContent(buffer)) continue;
    const content = buffer.toString("utf-8");
    findings.push(...scanFileContent(file, content));
  }

  // Apply allowlist suppression
  const filtered = findings.filter((f) => !isAllowlisted(f));

  const errorCount = filtered.filter((f) => f.severity === "error").length;
  const exitCode = errorCount > 0 ? 1 : 0;
  const report = args.json
    ? formatJsonReport(filtered, meta)
    : formatTextReport(filtered, meta);
  return { exitCode, stdout: report + "\n", stderr: "" };
}

function main() {
  const argv = process.argv.slice(2);
  const { exitCode, stdout, stderr } = runMain(argv);
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
  process.exit(exitCode);
}

// Entry-point guard: only run main() when invoked directly, not when
// imported by the test file. Resolves symlinks so npm-linked invocations
// (where argv[1] is a symlink to this file) still match.
function isEntryPoint() {
  if (!process.argv[1]) return false;
  try {
    return (
      realpathSync(fileURLToPath(import.meta.url)) ===
      realpathSync(process.argv[1])
    );
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  try {
    main();
  } catch (err) {
    process.stderr.write(
      `check-leaks: unexpected error: ${err?.message || err}\n`,
    );
    process.exit(2);
  }
}
