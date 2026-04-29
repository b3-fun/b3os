import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOOLS_DIR = join(__dirname, "..", "tools");

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listTsFiles(full));
    } else if (entry.endsWith(".ts") && !entry.endsWith(".generated.ts")) {
      out.push(full);
    }
  }
  return out;
}

describe("no raw server.registerTool calls in tools/", () => {
  it("only register-tool-safe.ts may call server.registerTool directly", () => {
    const files = listTsFiles(TOOLS_DIR);
    const violations: Array<{ file: string; line: number; content: string }> = [];

    for (const file of files) {
      // register-tool-safe.ts is the ONE legitimate caller — it implements the wrapper
      if (file.endsWith("register-tool-safe.ts")) continue;

      const content = readFileSync(file, "utf8");
      // Strip block comments and line comments so documentation mentioning
      // `.registerTool(` doesn't trip this enforcement check. Stripping is
      // done to a copy; reported line numbers still come from the original.
      const stripped = content
        // Remove /* ... */ block comments (non-greedy, multiline)
        .replace(/\/\*[\s\S]*?\*\//g, block => block.replace(/[^\n]/g, " "))
        // Remove // line comments (preserve newline)
        .replace(/\/\/[^\n]*/g, line => " ".repeat(line.length));
      const lines = stripped.split("\n");
      lines.forEach((line, idx) => {
        // Match calls like `s.registerTool(`, `server.registerTool(`, or `.registerTool(`
        // but NOT `registerToolSafe(` (our wrapper).
        if (/\.registerTool\s*\(/.test(line) && !/registerToolSafe/.test(line)) {
          // Report the original line for a more useful error message.
          const originalLine = content.split("\n")[idx] ?? line;
          violations.push({ file: file.replace(TOOLS_DIR, "tools"), line: idx + 1, content: originalLine.trim() });
        }
      });
    }

    if (violations.length > 0) {
      const msg = violations.map(v => `  ${v.file}:${v.line}: ${v.content}`).join("\n");
      throw new Error(
        `Raw server.registerTool calls are forbidden — use registerToolSafe from './register-tool-safe.js' instead.\n\n` +
          `This ensures every tool gets auto-generated signature blocks, alias coercion, and rich failure hints.\n\n` +
          `Violations:\n${msg}`,
      );
    }

    expect(violations).toEqual([]);
  });
});
