import type { ApiResponse } from "./types.js";

interface BootstrapResponse {
  orgId: string;
  orgSlug: string;
  apiKey: string;
  initialCuGrant: number;
  expiresAt: string;
  claimUrl: string;
  status: "created" | "existing";
}

export async function callBootstrap(
  serverUrl: string,
): Promise<BootstrapResponse> {
  const url = `${serverUrl}/v1/bootstrap`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Bootstrap failed (${response.status}): ${text}`);
  }

  const envelope = (await response.json()) as ApiResponse<BootstrapResponse>;
  if (envelope.code !== 0) {
    throw new Error(`Bootstrap error: ${envelope.message}`);
  }

  return envelope.data;
}
