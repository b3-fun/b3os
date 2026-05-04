import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { request, truncateResponse } from "../client.js";
import { validateOrgId } from "./shared.js";
import { registerToolSafe } from "./register-tool-safe.js";

interface TableInfo {
  name: string;
}

interface ColumnInfo {
  name: string;
  type: string;
  notNull: boolean;
  defaultValue: unknown;
  primaryKey: boolean;
}

interface QueryResult {
  rows: Record<string, unknown>[];
  rowsAffected: number;
  lastRowId: number;
}

// isReadOnlySQL mirrors the backend's `isReadOnlySQL` validation.
// The backend requires the trimmed, uppercased SQL to start with `SELECT `
// (note the trailing space) and routes anything else through the
// `org_database:update` permission check — which the MCP service account
// does not hold (`database:read` only). Allowing `WITH` here would surface
// as a confusing 403 from the backend instead of a clear MCP-side error.
export function isReadOnlySQL(sql: string): boolean {
  const normalized = sql.trim().toUpperCase();
  return normalized.startsWith("SELECT ");
}

export function registerDatabaseTools(s: McpServer): void {
  registerToolSafe(
    s,
    "b3os_list_tables",
    {
      description: `List all tables in the organization's database.

Each org gets one auto-provisioned database. Use this to discover existing tables
before creating new ones or writing queries. Requires orgId from b3os_whoami.`,
      inputSchema: {
        orgId: z.string().describe("Organization ID from b3os_whoami"),
      },
    },
    async ({ orgId }) => {
      validateOrgId(orgId);
      const data = await request<{ tables: TableInfo[] }>(
        `/v1/organizations/${orgId}/database/tables`,
      );
      const tables = data?.tables || [];
      if (tables.length === 0) {
        return {
          content: [
            { type: "text", text: "No tables found. The database is empty." },
          ],
        };
      }
      return {
        content: [{ type: "text", text: tables.map((t) => t.name).join("\n") }],
      };
    },
  );

  registerToolSafe(
    s,
    "b3os_get_table_schema",
    {
      description: `Get the column definitions for a specific table in the org's database.

Returns each column's name, type, constraints (NOT NULL, PRIMARY KEY), and default value.
Use this to understand table structure before writing queries.`,
      inputSchema: {
        orgId: z.string().describe("Organization ID from b3os_whoami"),
        tableName: z.string().describe("Table name to inspect"),
      },
    },
    async ({ orgId, tableName }) => {
      validateOrgId(orgId);
      const data = await request<{ columns: ColumnInfo[] }>(
        `/v1/organizations/${orgId}/database/tables/${encodeURIComponent(tableName)}`,
      );
      const columns = data?.columns || [];
      const text = JSON.stringify(columns, null, 2);
      return { content: [{ type: "text", text }] };
    },
  );

  registerToolSafe(
    s,
    "b3os_query_database",
    {
      description: `Execute read-only SQL queries against the organization's database (SQLite-compatible).

Only SELECT statements are supported. CTEs (WITH ...), PRAGMA, and write
operations (INSERT, UPDATE, DELETE, CREATE, ALTER, DROP) are rejected — the
MCP service account has database:read permission only.
Use b3os_get_table_schema for schema introspection.

Use parameterized queries with ? placeholders to prevent SQL injection.

Returns: { rows: [...], rowsAffected: 0 }

Examples:
- SELECT * FROM budgets WHERE workflow_id = ?  (params: ["my-workflow"])
- SELECT COUNT(*) FROM events WHERE created_at > ?  (params: ["2024-01-01"])`,
      inputSchema: {
        orgId: z.string().describe("Organization ID from b3os_whoami"),
        sql: z.string().describe("SQL SELECT statement to execute"),
        params: z
          .array(z.any())
          .optional()
          .describe("Parameterized query values (for ? placeholders)"),
      },
    },
    async ({ orgId, sql, params }) => {
      validateOrgId(orgId);

      // Defense-in-depth: reject non-SELECT statements at the MCP layer.
      // Mirrors the backend check exactly (see isReadOnlySQL above) so users
      // get a clear MCP-side message instead of a 403 from the backend
      // permission gate.
      if (!isReadOnlySQL(sql)) {
        const statementType =
          sql.trim().split(/\s+/)[0]?.toUpperCase() || "UNKNOWN";
        throw new Error(
          `Only SELECT statements are allowed. Got: ${statementType}. The MCP service account has database:read permission only.`,
        );
      }

      const data = await request<QueryResult>(
        `/v1/organizations/${orgId}/database/query`,
        {
          method: "POST",
          body: { sql, params: params || [] },
        },
      );
      const text = JSON.stringify(data, null, 2);
      return { content: [{ type: "text", text: truncateResponse(text) }] };
    },
  );
}
