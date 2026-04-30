const MAX_ERROR_BODY_LENGTH = 500;

/**
 * Sanitize an HTTP error body for inclusion in user-facing error messages.
 *
 * - Replaces HTML error pages (Cloudflare 502s, nginx 503s) with a clean message
 *   so the user doesn't see raw `<!DOCTYPE html>...` output
 * - Truncates long bodies to avoid flooding the terminal with server internals
 */
export function sanitizeBody(body: string): string {
  if (!body) return "";
  if (/^\s*<(!DOCTYPE|html)/i.test(body)) {
    return "(HTML error page — server may be temporarily unavailable)";
  }
  if (body.length > MAX_ERROR_BODY_LENGTH) {
    return body.slice(0, MAX_ERROR_BODY_LENGTH) + "…(truncated)";
  }
  return body;
}
