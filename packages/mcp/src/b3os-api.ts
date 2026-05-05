/**
 * JWT-authenticated client for one-shot setup-time API calls.
 * Kept separate from `client.ts` (which uses `b3sk_` keys for runtime MCP calls).
 */

import type { ApiResponse } from "./types.js";
import { sanitizeBody } from "./http-utils.js";

interface JwtRequestOptions {
  serverUrl: string;
  jwt: string;
  orgId: string;
}

async function jwtRequest<TResponse>(
  method: "GET" | "POST",
  path: string,
  body: unknown,
  options: JwtRequestOptions,
): Promise<TResponse> {
  let response: Response;
  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${options.jwt}`,
      "X-Org-ID": options.orgId,
    };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    response = await fetch(`${options.serverUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new Error(`B3OS API request to ${path} timed out after 15 seconds`);
    }
    throw err;
  }

  if (!response.ok) {
    let errorBody = "";
    try {
      errorBody = await response.text();
    } catch {
      // ignore
    }
    // Scrub the JWT from the error body to prevent token leakage in logs/Sentry.
    // A misconfigured proxy or WAF may echo the Authorization header back in the
    // response body; sanitize before including in the thrown Error.message.
    const scrubbedBody = errorBody.replaceAll(options.jwt, "[REDACTED]");
    throw new Error(`B3OS API error ${response.status} on ${path}: ${sanitizeBody(scrubbedBody)}`);
  }

  const envelope = (await response.json()) as ApiResponse<TResponse>;
  if (envelope == null || typeof envelope !== "object" || !("data" in envelope) || envelope.data == null) {
    throw new Error(`B3OS API error ${response.status}: unexpected response shape on ${path}`);
  }
  return envelope.data;
}

async function jwtPost<TResponse>(path: string, body: unknown, options: JwtRequestOptions): Promise<TResponse> {
  return jwtRequest<TResponse>("POST", path, body, options);
}

async function jwtGet<TResponse>(path: string, options: JwtRequestOptions): Promise<TResponse> {
  return jwtRequest<TResponse>("GET", path, undefined, options);
}

export interface ServiceAccount {
  id: string;
  name: string;
  description?: string;
  permissions?: string[];
}

export interface CreateServiceAccountOptions extends JwtRequestOptions {
  name: string;
  description: string;
  permissions: readonly string[];
}

export async function createServiceAccount(options: CreateServiceAccountOptions): Promise<ServiceAccount> {
  return jwtPost<ServiceAccount>(
    "/v1/service-accounts",
    { name: options.name, description: options.description, permissions: options.permissions },
    options,
  );
}

interface PaginatedServiceAccounts {
  items: ServiceAccount[];
  limit: number;
  offset: number;
  hasMore: boolean;
}

/**
 * Find a service account by name within the org. Paginates through the list
 * until either a match is found or the list is exhausted.
 *
 * Used by setup.ts to reuse an existing `b3os-mcp@<hostname>` SA on re-run
 * instead of failing with a 409 duplicate-name error.
 */
// Pagination constants for findServiceAccountByName. The cap is a safety net —
// no org is expected to have 1000+ service accounts.
const SA_LIST_PAGE_SIZE = 100;
const SA_LIST_MAX_PAGES = 10;

export async function findServiceAccountByName(
  options: JwtRequestOptions & { name: string },
): Promise<ServiceAccount | null> {
  let offset = 0;
  for (let page = 0; page < SA_LIST_MAX_PAGES; page++) {
    const data = await jwtGet<PaginatedServiceAccounts>(
      `/v1/service-accounts?limit=${SA_LIST_PAGE_SIZE}&offset=${offset}`,
      options,
    );
    const match = data.items.find(sa => sa.name === options.name);
    if (match) return match;
    if (!data.hasMore) return null;
    offset += data.items.length;
  }
  return null;
}

export interface CreateApiKeyOptions extends JwtRequestOptions {
  name: string;
  description: string;
  serviceAccountId: string;
}

export interface CreateApiKeyResult {
  id: string;
  key: string;
  name: string;
}

export async function createApiKey(options: CreateApiKeyOptions): Promise<CreateApiKeyResult> {
  return jwtPost<CreateApiKeyResult>(
    "/v1/api-keys",
    {
      name: options.name,
      description: options.description,
      scope: "read-write",
      serviceAccountId: options.serviceAccountId,
    },
    options,
  );
}
