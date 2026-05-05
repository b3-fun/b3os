import type { ApiResponse } from "./types.js";
import { sanitizeBody } from "./http-utils.js";
import { readApiKey } from "./keystore.js";

let cachedKey: string | null = null;
let pendingKeyPromise: Promise<string> | null = null;

export async function getApiKey(): Promise<string> {
  if (cachedKey !== null) return cachedKey;
  // Env var wins — covers CI, manual override, and the Linux plaintext path
  // where the key lives in the Claude config env block.
  if (process.env.B3OS_API_KEY) {
    cachedKey = process.env.B3OS_API_KEY;
    return cachedKey;
  }
  // Coalesce concurrent callers — if a keystore read is already in flight,
  // return the same promise instead of spawning a second security/powershell
  // process (which could trigger duplicate OS auth prompts on macOS).
  if (pendingKeyPromise) return pendingKeyPromise;

  pendingKeyPromise = (async () => {
    try {
      const key = await readApiKey();
      if (!key) {
        throw new Error(
          "B3OS_API_KEY not found in env and keystore returned no value. Run: b3os-mcp-setup",
        );
      }
      cachedKey = key;
      return key;
    } finally {
      pendingKeyPromise = null;
    }
  })();

  return pendingKeyPromise;
}

/** Clear the in-memory API key cache so the next request re-reads from keystore. */
export function clearKeyCache(): void {
  cachedKey = null;
  pendingKeyPromise = null;
}

/** @deprecated Use clearKeyCache(). Kept for existing test compatibility. */
export const __resetKeyCacheForTests = clearKeyCache;

export function getServerUrl(): string {
  const url = (process.env.B3OS_SERVER_URL || "https://api.b3os.org").replace(
    /\/+$/,
    "",
  );
  if (
    !/^https:\/\//i.test(url) &&
    !/^http:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(url)
  ) {
    throw new Error("B3OS_SERVER_URL must use HTTPS (localhost is exempt)");
  }
  return url;
}

function friendlyHint(status: number): string {
  switch (status) {
    case 401:
      return "Your API key may be invalid or expired. Regenerate it at https://b3os.org/organizations/settings?tab=api-keys";
    case 403:
      return "Insufficient permissions. Check that your API key has read-write scope.";
    case 404:
      return "Resource not found. Verify the ID is correct.";
    case 409:
      return "Conflict — another update may have occurred. Retry with the latest version.";
    case 429:
      return "Rate limited. Wait a moment and try again.";
    default:
      return "";
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    public body: string,
  ) {
    const hint = friendlyHint(status);
    const cleanBody = sanitizeBody(body);
    super(
      `API error ${status}: ${statusText}${hint ? `\nHint: ${hint}` : ""}${cleanBody ? `\n${cleanBody}` : ""}`,
    );
    this.name = "ApiError";
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  params?: Record<string, string>;
  noAuth?: boolean;
  timeout?: number;
}

function buildUrl(path: string, params?: Record<string, string>): string {
  const url = new URL(`${getServerUrl()}${path}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value) url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

async function buildHeaders(noAuth?: boolean): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (!noAuth) {
    headers["Authorization"] = `Bearer ${await getApiKey()}`;
  }
  return headers;
}

export async function request<T = unknown>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const url = buildUrl(path, options.params);
  const controller = new AbortController();
  const timeoutMs = options.timeout ?? 30_000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: options.method || "GET",
      headers: await buildHeaders(options.noAuth),
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new ApiError(response.status, response.statusText, body);
    }

    const text = await response.text();
    if (!text) return undefined as T;

    const parsed = JSON.parse(text) as ApiResponse<unknown>;
    return parsed.data as T;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Request timed out after ${timeoutMs / 1000} seconds`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

/** Max bytes for a tool response text before truncation. */
export const MAX_RESPONSE_BYTES = 50_000;

/** Truncate a tool response string if it exceeds the byte limit. */
export function truncateResponse(
  text: string,
  maxBytes: number = MAX_RESPONSE_BYTES,
): string {
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= maxBytes) return text;
  return (
    buf.subarray(0, maxBytes).toString("utf8") +
    `\n…(truncated, ${buf.length} bytes total)`
  );
}
