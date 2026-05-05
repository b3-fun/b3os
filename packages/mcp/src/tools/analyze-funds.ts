import { request } from "../client.js";

// ── Types (mirrors backend schemas/analyze_funds_workflow.go) ──

export interface AnalyzeFundsBalance {
  walletAddress: string;
  chainId: number;
  tokenAddress: string;
  symbol?: string;
  decimals?: number;
  amount: string;
  amountUsd?: number;
  isLow?: boolean;
  isInsufficient?: boolean;
}

export interface AnalyzeFundsRequirement {
  nodeId: string;
  nodeType: string;
  nodeName: string;
  source: "requiredTokens" | "fundsMovement.sent" | "requiresGas";
  reason?: string;
  walletAddress?: string;
  chainId?: number;
  chainName?: string;
  tokenAddress?: string;
  symbol?: string;
  decimals?: number;
  isNative?: boolean;
  requiredAmount?: string;
  amountIsHumanReadable?: boolean;
  unresolved?: boolean;
  unresolvedReason?: "chainId" | "tokenAddress" | "parseError";
  balance?: AnalyzeFundsBalance;
}

export interface AnalyzeFundsResponse {
  workflowId: string;
  workflowVersion: number;
  requirements: AnalyzeFundsRequirement[];
  unresolved: AnalyzeFundsRequirement[];
  balancesFetched: boolean;
}

// ── API call ──

export async function analyzeWorkflowFunds(
  workflowId: string,
): Promise<AnalyzeFundsResponse> {
  const data = await request<AnalyzeFundsResponse>(
    `/v1/workflows/${workflowId}/analyze-funds`,
  );
  if (!data)
    throw new Error(`Failed to analyze funds for workflow ${workflowId}`);
  return data;
}

// ── Formatter ──

interface FundingIssue {
  kind: "insufficient" | "low_gas";
  wallet: string;
  chain: string;
  symbol: string;
  required?: string;
  current: string;
}

function dedupKey(wallet: string, chainId: number, token: string): string {
  return `${wallet.toLowerCase()}|${chainId}|${token.toLowerCase()}`;
}

function formatRawAmount(
  raw: string,
  decimals: number,
  fallback: string,
): string {
  try {
    const n = BigInt(raw);
    const d = 10n ** BigInt(decimals);
    const whole = n / d;
    const frac = n % d;
    if (frac === 0n) return whole.toString();
    return `${whole}.${frac.toString().padStart(decimals, "0").replace(/0+$/, "")}`;
  } catch {
    return fallback;
  }
}

function formatAmount(req: AnalyzeFundsRequirement): string {
  if (!req.requiredAmount) return "unknown";
  if (req.amountIsHumanReadable) return req.requiredAmount;
  return formatRawAmount(
    req.requiredAmount,
    req.balance?.decimals ?? req.decimals ?? 18,
    req.requiredAmount,
  );
}

function formatBalance(bal: AnalyzeFundsBalance): string {
  return formatRawAmount(bal.amount, bal.decimals ?? 18, bal.amount);
}

export function formatFundingAdvisory(
  response: AnalyzeFundsResponse,
): string | null {
  const issues: FundingIssue[] = [];
  const seen = new Set<string>();

  for (const req of response.requirements) {
    const bal = req.balance;
    if (!bal) continue;

    const isInsufficient = bal.isInsufficient === true;
    const isLowGas = bal.isLow === true && req.source === "requiresGas";

    if (!isInsufficient && !isLowGas) continue;

    const wallet = req.walletAddress || bal.walletAddress;
    const chainId = req.chainId || bal.chainId;
    const token = req.tokenAddress || bal.tokenAddress;
    const key = dedupKey(wallet, chainId, token);
    if (seen.has(key)) continue;
    seen.add(key);

    issues.push({
      kind: isLowGas && !isInsufficient ? "low_gas" : "insufficient",
      wallet,
      chain: req.chainName || `Chain ${chainId}`,
      symbol: bal.symbol || req.symbol || "Unknown",
      required: isInsufficient ? formatAmount(req) : undefined,
      current: formatBalance(bal),
    });
  }

  const hasUnresolved = response.unresolved.length > 0;

  if (issues.length === 0 && !hasUnresolved) return null;

  const lines: string[] = [];
  const header =
    issues.length > 0
      ? "Insufficient funds — workflow not published.\n"
      : "Cannot verify funds — workflow not published.\n";
  lines.push(header);

  if (issues.length > 0) {
    const insufficient = issues.filter((i) => i.kind === "insufficient");
    const lowGas = issues.filter((i) => i.kind === "low_gas");

    if (insufficient.length > 0) {
      lines.push("Insufficient token balances:");
      for (const i of insufficient) {
        const req = i.required
          ? ` (need ${i.required}, have ${i.current})`
          : ` (have ${i.current})`;
        lines.push(`  - ${i.symbol} on ${i.chain} — wallet ${i.wallet}${req}`);
      }
      lines.push("");
    }

    if (lowGas.length > 0) {
      lines.push("Low gas balances:");
      for (const i of lowGas) {
        lines.push(
          `  - ${i.symbol} on ${i.chain} — wallet ${i.wallet} (balance: ${i.current})`,
        );
      }
      lines.push("");
    }
  }

  if (hasUnresolved) {
    lines.push(
      `${response.unresolved.length} unresolved fund requirement(s) — some nodes have incomplete chain/token configuration.`,
    );
    lines.push("");
  }

  lines.push("Fund your wallets at: https://b3os.org/wallet-management");
  lines.push(
    "Then retry publishing, or pass skipFundCheck: true to publish anyway.",
  );

  return lines.join("\n");
}
