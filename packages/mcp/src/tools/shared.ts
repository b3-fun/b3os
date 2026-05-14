import { z } from "zod";

/** Regex for action/trigger type identifiers (lowercase slug format). */
export const ACTION_TYPE_RE = /^[a-z0-9][a-z0-9-]*$/;

/** Workflow definition schema — must be an object with a `nodes` map. */
export const definitionSchema = z
  .object({ nodes: z.record(z.string(), z.unknown()) })
  .describe("Workflow definition (JSON object with nodes map)");

/** Payload schema — must be a key-value object, not a primitive or array. */
export const payloadSchema = z
  .record(z.string(), z.unknown())
  .describe("Payload key-value object");

export function validateWorkflowId(workflowId: string): void {
  if (!/^wf_\w+$/.test(workflowId)) {
    throw new Error("Invalid workflowId format — expected 'wf_' prefix");
  }
}

export function validateRunId(runId: string): void {
  if (!/^run_\w+$/.test(runId)) {
    throw new Error("Invalid runId format — expected 'run_' prefix");
  }
}

export function validateOrgId(orgId: string): void {
  if (!/^org_\w+$/.test(orgId)) {
    throw new Error(
      "Invalid orgId format — expected 'org_' prefix (e.g. 'org_abc123')",
    );
  }
}

export function validateTemplateId(templateId: string): void {
  if (!/^tmpl_\w+$/.test(templateId)) {
    throw new Error(
      "Invalid templateId format — expected 'tmpl_' prefix (e.g. 'tmpl_abc123')",
    );
  }
}

export function auditLog(action: string, detail?: string): void {
  console.error(
    `[b3os-mcp] ${action}${detail ? ` ${detail}` : ""} at ${new Date().toISOString()}`,
  );
}

/**
 * Client-side pagination + status filter helper. Used by list tools that
 * need to filter by a field the backend API doesn't support natively.
 *
 * Because the backend can't filter server-side, we over-fetch (3x the
 * safe limit) when a filter is active, then slice on the client.
 */
export function buildPaginationParams({
  limit,
  offset,
  status,
}: {
  limit?: number;
  offset?: number;
  status?: string;
}): { params: Record<string, string>; safeLimit: number } {
  const safeLimit = Math.min(limit ?? 20, 100);
  const params: Record<string, string> = {};
  params.limit = String(status ? Math.max(safeLimit * 3, 60) : safeLimit);
  if (offset && !status) params.offset = String(offset);
  return { params, safeLimit };
}

/**
 * Applies a client-side filter to a list of items and returns the trimmed
 * result plus a `hasMore` flag. Use with `buildPaginationParams`.
 */
export function applyClientSideFilter<T>(
  items: T[],
  predicate: ((item: T) => boolean) | null,
  safeLimit: number,
  apiHasMore: boolean,
): { items: T[]; hasMore: boolean } {
  if (!predicate) return { items, hasMore: apiHasMore };
  const filtered = items.filter(predicate);
  if (filtered.length > safeLimit)
    return { items: filtered.slice(0, safeLimit), hasMore: true };
  return { items: filtered, hasMore: apiHasMore };
}
