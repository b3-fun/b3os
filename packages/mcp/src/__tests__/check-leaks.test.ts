import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  scanFileContent,
  scanFilePath,
  isAllowlisted,
  redactPreview,
  validateAllowlist,
  isBinaryContent,
  walkFixtureDir,
  runNpmPackDryRun,
  formatTextReport,
  formatJsonReport,
  runMain,
  RULES,
  ALLOWLIST,
} from "../../scripts/check-leaks.mjs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const FIXTURES = join(__dirname, "fixtures");

describe("check-leaks scaffold", () => {
  it("exports the expected helpers", () => {
    expect(typeof scanFileContent).toBe("function");
    expect(typeof scanFilePath).toBe("function");
    expect(typeof isAllowlisted).toBe("function");
    expect(typeof redactPreview).toBe("function");
    expect(Array.isArray(RULES)).toBe(true);
    expect(Array.isArray(ALLOWLIST)).toBe(true);
  });

  it("scanFileContent returns empty array for empty content", () => {
    expect(scanFileContent("x.js", "")).toEqual([]);
  });

  it("redactPreview passes non-secrets through unchanged", () => {
    expect(
      redactPreview("internal-urls", "https://example.com/some/path"),
    ).toBe("https://example.com/some/path");
  });

  it("redactPreview passes short secrets through unchanged", () => {
    expect(redactPreview("secrets", "short")).toBe("short");
  });

  it("redactPreview truncates long secrets to 16 chars + horizontal ellipsis", () => {
    expect(redactPreview("secrets", "b3sk_abcDEF1234567890XYZabc")).toBe(
      "b3sk_abcDEF12345\u2026",
    );
  });
});

describe("bucket 1: secrets", () => {
  const cases: Array<{ rule: string; positive: string; negative: string }> = [
    {
      rule: "b3os-secret-key",
      positive: 'const k = "b3sk_abcDEF1234567890";',
      negative: "// see the b3sk_ prefix in docs",
    },
    {
      rule: "stripe-key",
      positive: 'const k = "sk_live_abcDEF1234567890XY";',
      negative: "// a stripe key is sk_live_ followed by random chars",
    },
    {
      rule: "aws-access-key",
      positive: 'const k = "AKIAIOSFODNN7EXAMPLE";',
      negative: "// AKIA is the prefix for AWS long-term credentials",
    },
    {
      rule: "github-token",
      positive: 'const k = "ghp_1234567890abcdef1234567890abcdef1234";',
      negative: "// ghp_ tokens start with these four characters",
    },
    {
      rule: "anthropic-key",
      positive: 'const k = "sk-ant-api03_abcDEF1234567890abcDEF1234567890";',
      negative: "// sk-ant- is the anthropic prefix",
    },
    {
      rule: "openai-key",
      positive: 'const k = "sk-proj_abcDEF1234567890abcDEF1234567890";',
      negative: "// sk-ant-... is anthropic, not openai",
    },
    {
      rule: "jwt",
      positive:
        'const t = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";',
      negative: "// a JWT has three dot-separated base64url segments",
    },
    {
      rule: "private-key-pem",
      positive: "-----BEGIN PRIVATE KEY-----",
      negative: "// a PEM block starts with -----BEGIN",
    },
    {
      rule: "basic-auth-url",
      positive: 'const u = "https://alice:secret@example.com/api";',
      negative: "// basic auth URLs embed user:pass before the host",
    },
  ];

  for (const { rule, positive, negative } of cases) {
    it(`${rule} matches positive case`, () => {
      const findings = scanFileContent("dist/x.js", positive);
      expect(findings).toContainEqual(expect.objectContaining({ rule }));
    });

    it(`${rule} skips negative case`, () => {
      const findings = scanFileContent("dist/x.js", negative);
      expect(findings.filter((f) => f.rule === rule)).toEqual([]);
    });
  }

  it("private-key-pem also matches named PEM variants (RSA, EC, OPENSSH)", () => {
    for (const header of [
      "-----BEGIN RSA PRIVATE KEY-----",
      "-----BEGIN EC PRIVATE KEY-----",
      "-----BEGIN OPENSSH PRIVATE KEY-----",
    ]) {
      const findings = scanFileContent("dist/x.js", header);
      expect(findings.filter((f) => f.rule === "private-key-pem")).toHaveLength(
        1,
      );
    }
  });
});

describe("bucket 2: internal URLs", () => {
  const cases: Array<{ rule: string; positive: string; negative: string }> = [
    {
      rule: "dot-internal",
      positive: 'const host = "api.internal/v1";',
      negative: "// .internal domains are RFC 6762 special-use",
    },
    {
      rule: "staging-subdomain",
      positive: 'const host = "api.staging.example.com";',
      negative: "// staging subdomains are blocked by this rule",
    },
    {
      rule: "rfc1918-ipv4",
      positive: 'const ip = "10.0.0.1";',
      negative: "// RFC 1918 private address space is blocked",
    },
    {
      rule: "loopback-literal",
      positive: 'const bind = "127.0.0.1";',
      negative: "// 127 is the loopback prefix (no full address here)",
    },
    {
      rule: "doppler-ref",
      positive:
        'const s = "doppler://projects/my-project/configs/prd/api_key";',
      negative: "// doppler runtime reads from environment",
    },
    {
      rule: "railway-ref",
      positive: 'const url = "https://my-app.up.railway.app/health";',
      negative: "// railway apps live on *.railway.app (no .up prefix here)",
    },
    {
      rule: "internal-monorepo-path",
      positive: "// mirrors services/b3os-workflow/internal/app/api/query.go",
      negative: "// the backend validates read-only SQL",
    },
  ];

  for (const { rule, positive, negative } of cases) {
    it(`${rule} matches positive case`, () => {
      const findings = scanFileContent("dist/x.js", positive);
      expect(findings).toContainEqual(expect.objectContaining({ rule }));
    });

    it(`${rule} skips negative case`, () => {
      const findings = scanFileContent("dist/x.js", negative);
      expect(findings.filter((f) => f.rule === rule)).toEqual([]);
    });
  }
});

describe("bucket 3: personal info", () => {
  const cases: Array<{ rule: string; positive: string; negative: string }> = [
    {
      rule: "macos-home-path",
      positive: 'const p = "/Users/alice/Projects/b3os-mcp/src/setup.ts";',
      negative: "// macOS home dirs live under the /Users hierarchy",
    },
    {
      rule: "linux-home-path",
      positive: 'const p = "/home/bob/work/repo/file.js";',
      negative: "// linux home dirs use the /home hierarchy",
    },
    {
      rule: "windows-home-path",
      positive: 'const p = "C:\\\\Users\\\\Carol\\\\AppData\\\\Local";',
      negative: "// Windows home dirs are under the Users folder on C drive",
    },
    {
      rule: "email",
      positive: 'const contact = "random@evil-corp.com";',
      negative: "// contact addresses are stored in env vars, not code",
    },
  ];

  for (const { rule, positive, negative } of cases) {
    it(`${rule} matches positive case`, () => {
      const findings = scanFileContent("dist/x.js", positive);
      expect(findings).toContainEqual(expect.objectContaining({ rule }));
    });

    it(`${rule} skips negative case`, () => {
      const findings = scanFileContent("dist/x.js", negative);
      expect(findings.filter((f) => f.rule === rule)).toEqual([]);
    });
  }

  it("windows-home-path also matches raw single-backslash paths", () => {
    // README.md and similar documentation might embed raw Windows paths.
    const content =
      "See the example at C:\\Users\\Carol\\Projects\\repo for details.";
    const findings = scanFileContent("README.md", content);
    expect(findings).toContainEqual(
      expect.objectContaining({ rule: "windows-home-path" }),
    );
  });
});

describe("bucket 4a: file-presence rules", () => {
  const cases: Array<{ rule: string; positive: string; negative: string }> = [
    {
      rule: "test-file",
      positive: "dist/foo.test.js",
      negative: "dist/foo.js",
    },
    {
      rule: "spec-file",
      positive: "dist/foo.spec.js",
      negative: "dist/foo.js",
    },
    {
      rule: "tests-dir",
      positive: "dist/__tests__/helpers.js",
      negative: "dist/helpers.js",
    },
    {
      rule: "mocks-dir",
      positive: "dist/__mocks__/fetch.js",
      negative: "dist/fetch.js",
    },
    { rule: "env-file", positive: ".env", negative: "dist/index.js" },
    {
      rule: "env-file",
      positive: ".env.production",
      negative: "dist/index.js",
    },
    {
      rule: "doppler-config",
      positive: "doppler.yaml",
      negative: "dist/index.js",
    },
    { rule: "ds-store", positive: "dist/.DS_Store", negative: "dist/index.js" },
  ];

  for (const { rule, positive, negative } of cases) {
    it(`${rule} fires on ${positive}`, () => {
      const findings = scanFilePath(positive);
      expect(findings).toContainEqual(expect.objectContaining({ rule }));
    });

    it(`${rule} does not fire on ${negative}`, () => {
      const findings = scanFilePath(negative);
      expect(findings.filter((f) => f.rule === rule)).toEqual([]);
    });
  }
});

describe("bucket 4b: narrow-scoped text rules", () => {
  it("console-usage fires inside dist/**/*.js", () => {
    const findings = scanFileContent("dist/server.js", "console.log('hi')");
    expect(findings).toContainEqual(
      expect.objectContaining({ rule: "console-usage" }),
    );
  });

  it("console-usage skips dist/**/*.d.ts", () => {
    const findings = scanFileContent(
      "dist/server.d.ts",
      "/** console.log usage */",
    );
    expect(findings.filter((f) => f.rule === "console-usage")).toEqual([]);
  });

  it("console-usage skips README.md", () => {
    const findings = scanFileContent(
      "README.md",
      "Use console.log for debugging",
    );
    expect(findings.filter((f) => f.rule === "console-usage")).toEqual([]);
  });

  it("todo-comment fires as a warning", () => {
    const findings = scanFileContent(
      "dist/index.js",
      "// TODO: wire up caching",
    );
    const todos = findings.filter((f) => f.rule === "todo-comment");
    expect(todos).toHaveLength(1);
    expect(todos[0].severity).toBe("warning");
  });

  it("todo-comment skips README.md", () => {
    const findings = scanFileContent("README.md", "## TODO\n\nAdd examples");
    expect(findings.filter((f) => f.rule === "todo-comment")).toEqual([]);
  });
});

describe("allowlist", () => {
  it("suppresses finding when all three fields match", () => {
    const allowlist = [
      {
        rule: "loopback-literal",
        file: "dist/oauth-callback.js",
        match: /127\.0\.0\.1|localhost/,
        reason: "OAuth callback binding",
      },
    ];
    const finding = {
      bucket: "internal-urls",
      rule: "loopback-literal",
      file: "dist/oauth-callback.js",
      line: 10,
      severity: "error",
      matchedText: "127.0.0.1",
    };
    expect(isAllowlisted(finding, allowlist)).toBe(true);
  });

  it("does not suppress when file differs", () => {
    const allowlist = [
      {
        rule: "loopback-literal",
        file: "dist/oauth-callback.js",
        match: /127\.0\.0\.1/,
        reason: "...",
      },
    ];
    const finding = {
      bucket: "internal-urls",
      rule: "loopback-literal",
      file: "dist/new-file.js",
      line: 10,
      severity: "error",
      matchedText: "127.0.0.1",
    };
    expect(isAllowlisted(finding, allowlist)).toBe(false);
  });

  it("supports * wildcard file", () => {
    const allowlist = [
      {
        rule: "email",
        file: "*",
        match: /@b3\.fun$/,
        reason: "Official domain",
      },
    ];
    const finding = {
      bucket: "personal",
      rule: "email",
      file: "dist/whatever.js",
      line: 1,
      severity: "error",
      matchedText: "support@b3.fun",
    };
    expect(isAllowlisted(finding, allowlist)).toBe(true);
  });

  it("does not suppress when rule ID differs", () => {
    const allowlist = [
      {
        rule: "loopback-literal",
        file: "dist/x.js",
        match: /.*/,
        reason: "...",
      },
    ];
    const finding = {
      bucket: "internal-urls",
      rule: "rfc1918-ipv4",
      file: "dist/x.js",
      line: 1,
      severity: "error",
      matchedText: "10.0.0.1",
    };
    expect(isAllowlisted(finding, allowlist)).toBe(false);
  });
});

describe("bucket-1 allowlist guard", () => {
  it("validateAllowlist rejects entries targeting secret rules", () => {
    expect(() =>
      validateAllowlist([
        {
          rule: "b3os-secret-key",
          file: "*",
          match: /.*/,
          reason: "dangerous",
        },
      ]),
    ).toThrow(/cannot be allowlisted/);
  });

  it("validateAllowlist accepts entries targeting non-secret rules", () => {
    expect(() =>
      validateAllowlist([
        {
          rule: "loopback-literal",
          file: "dist/x.js",
          match: /.*/,
          reason: "ok",
        },
      ]),
    ).not.toThrow();
  });

  it("validateAllowlist rejects entries with unknown rule IDs", () => {
    expect(() =>
      validateAllowlist([
        {
          rule: "loopback-literall", // typo: double 'l'
          file: "dist/x.js",
          match: /.*/,
          reason: "typo",
        },
      ]),
    ).toThrow(/unknown rule/);
  });

  it("validateAllowlist rejects /g regex entries", () => {
    expect(() =>
      validateAllowlist([
        {
          rule: "loopback-literal",
          file: "dist/x.js",
          match: /.*/g,
          reason: "has global flag",
        },
      ]),
    ).toThrow(/must not use the global flag/);
  });

  it("validateAllowlist unknown-rule check fires before secrets check", () => {
    // A typo'd secret rule ID should fail as unknown-rule, not slip
    // through the secrets guard.
    expect(() =>
      validateAllowlist([
        {
          rule: "b3sk-secret-key", // typo: missing 'o'
          file: "*",
          match: /.*/,
          reason: "typo'd secret rule ID",
        },
      ]),
    ).toThrow(/unknown rule/);
  });
});

describe("isBinaryContent", () => {
  it("detects null bytes as binary", () => {
    const buf = Buffer.from([0x00, 0x01, 0x02, 0x03]);
    expect(isBinaryContent(buf)).toBe(true);
  });

  it("treats pure ASCII as text", () => {
    expect(isBinaryContent(Buffer.from("hello world"))).toBe(false);
  });

  it("treats UTF-8 as text", () => {
    expect(isBinaryContent(Buffer.from("héllo wörld — 你好"))).toBe(false);
  });

  it("only sniffs the first 8 KB", () => {
    // 9 KB of text followed by a null byte — null is beyond the sniff window
    const text = Buffer.from("a".repeat(9 * 1024));
    const withNullPastWindow = Buffer.concat([text, Buffer.from([0x00])]);
    expect(isBinaryContent(withNullPastWindow)).toBe(false);
  });
});

describe("runNpmPackDryRun", () => {
  // `npm pack --dry-run` only enumerates files that exist on disk. If
  // this runs in a fresh checkout or CI workspace before `pnpm build`,
  // dist/ doesn't exist and the spot-check for `dist/index.js` would
  // fail with a confusing assertion error. Skip instead so the failure
  // mode is clearly "dist not built" rather than "scanner bug".
  const distExists = existsSync(
    join(__dirname, "..", "..", "dist", "index.js"),
  );
  const maybeIt = distExists ? it : it.skip;

  maybeIt(
    "parses the npm pack --dry-run --json output against the real package",
    () => {
      const result = runNpmPackDryRun();
      expect(result.name).toBe("@b3dotfun/b3os-mcp");
      expect(typeof result.version).toBe("string");
      expect(Array.isArray(result.files)).toBe(true);
      expect(result.files.length).toBeGreaterThan(0);
      // Spot check a few files we know should ship
      expect(result.files).toContain("dist/index.js");
      expect(result.files).toContain("README.md");
      expect(result.bytes).toBeGreaterThan(0);
    },
  );
});

describe("walkFixtureDir", () => {
  it("returns files relative to the fixture root", () => {
    const result = walkFixtureDir(join(FIXTURES, "clean"));
    expect(result.files).toContain("dist/index.js");
    expect(result.name).toBe("fixture");
    expect(result.version).toBe("0.0.0");
    expect(result.bytes).toBeGreaterThan(0);
  });

  it("walks nested directories", () => {
    const result = walkFixtureDir(join(FIXTURES, "leaky"));
    expect(result.files).toContain("dist/index.js");
    expect(result.files).toContain("dist/config.js");
  });
});

describe("formatTextReport", () => {
  it("reports a clean run with 'No leaks detected'", () => {
    const report = formatTextReport([], {
      name: "@b3dotfun/b3os-mcp",
      version: "0.1.5",
      files: ["dist/index.js"],
      bytes: 1024,
    });
    expect(report).toContain("No leaks detected");
    expect(report).toContain("Secrets");
    expect(report).toContain("0 findings");
  });

  it("reports a dirty run with redacted secrets", () => {
    const findings = [
      {
        bucket: "secrets",
        rule: "b3os-secret-key",
        file: "dist/setup.js",
        line: 447,
        severity: "error",
        matchedText: "b3sk_abcDEF1234567890XYZabc",
      },
    ];
    const report = formatTextReport(findings, {
      name: "@b3dotfun/b3os-mcp",
      version: "0.1.5",
      files: ["dist/setup.js"],
      bytes: 1024,
    });
    expect(report).toContain("FAIL: Secrets");
    expect(report).toContain("b3sk_abcDEF12345\u2026");
    expect(report).not.toContain("b3sk_abcDEF1234567890XYZabc");
    expect(report).toContain("1 hard-fail finding. Publish aborted.");
  });

  it("separates warnings from errors and reports clean when only warnings present", () => {
    const findings = [
      {
        bucket: "artifacts",
        rule: "todo-comment",
        file: "dist/index.js",
        line: 10,
        severity: "warning",
        matchedText: "TODO",
      },
    ];
    const report = formatTextReport(findings, {
      name: "@b3dotfun/b3os-mcp",
      version: "0.1.5",
      files: ["dist/index.js"],
      bytes: 1024,
    });
    expect(report).toContain("WARN: Dev artifacts");
    // Wording differs depending on whether warnings are present: the
    // warning-only path says "No hard-fail leaks" to avoid implying the
    // WARN block above is fine. Only the fully-clean path says "No leaks
    // detected" verbatim.
    expect(report).toContain("No hard-fail leaks");
    expect(report).toContain("1 warning (publish proceeds)");
  });
});

describe("formatJsonReport", () => {
  it("serializes findings with redacted secret previews", () => {
    const findings = [
      {
        bucket: "secrets",
        rule: "b3os-secret-key",
        file: "dist/setup.js",
        line: 447,
        severity: "error",
        matchedText: "b3sk_abcDEF1234567890XYZabc",
      },
    ];
    const json = JSON.parse(
      formatJsonReport(findings, {
        name: "@b3dotfun/b3os-mcp",
        version: "0.1.5",
        files: ["dist/setup.js"],
        bytes: 1024,
      }),
    );
    expect(json.package).toBe("@b3dotfun/b3os-mcp");
    expect(json.version).toBe("0.1.5");
    expect(json.tarballFiles).toBe(1);
    expect(json.tarballBytes).toBe(1024);
    expect(json.findings).toHaveLength(1);
    expect(json.findings[0].textPreview).toBe("b3sk_abcDEF12345\u2026");
    expect(json.findings[0].matchedText).toBeUndefined();
    expect(json.counts).toEqual({ errors: 1, warnings: 0 });
  });
});

describe("main() integration via --fixture-dir", () => {
  it("clean fixture exits 0 and emits 'No leaks detected'", () => {
    const result = runMain([
      "--fixture-dir",
      join(FIXTURES, "clean"),
      "--json",
    ]);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.findings).toEqual([]);
    expect(parsed.counts).toEqual({ errors: 0, warnings: 0 });
  });

  it("leaky fixture exits 1 with error findings", () => {
    const result = runMain([
      "--fixture-dir",
      join(FIXTURES, "leaky"),
      "--json",
    ]);
    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.counts.errors).toBeGreaterThanOrEqual(2);
    expect(
      parsed.findings.some(
        (f: { rule: string }) => f.rule === "b3os-secret-key",
      ),
    ).toBe(true);
    expect(
      parsed.findings.some(
        (f: { rule: string }) => f.rule === "macos-home-path",
      ),
    ).toBe(true);
    // Secret preview is redacted in JSON output
    const secret = parsed.findings.find(
      (f: { rule: string }) => f.rule === "b3os-secret-key",
    );
    expect(secret.textPreview).toMatch(/…$/);
  });

  it("warning-only fixture exits 0 with 1 warning", () => {
    const result = runMain([
      "--fixture-dir",
      join(FIXTURES, "warning-only"),
      "--json",
    ]);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.counts).toEqual({ errors: 0, warnings: 1 });
    expect(parsed.findings[0].rule).toBe("todo-comment");
  });
});
