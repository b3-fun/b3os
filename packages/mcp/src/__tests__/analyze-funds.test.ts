import { describe, it, expect } from "vitest";
import { formatFundingAdvisory } from "../tools/analyze-funds.js";
import type { AnalyzeFundsResponse } from "../tools/analyze-funds.js";

describe("formatFundingAdvisory", () => {
  it("returns null when no requirements are insufficient or low", () => {
    const response: AnalyzeFundsResponse = {
      workflowId: "wf_abc",
      workflowVersion: 1,
      requirements: [
        {
          nodeId: "node-1",
          nodeType: "send-erc20-token",
          nodeName: "Send USDC",
          source: "fundsMovement.sent",
          walletAddress: "0xWALLET",
          chainId: 8453,
          chainName: "Base",
          tokenAddress: "0xTOKEN",
          symbol: "USDC",
          decimals: 6,
          isNative: false,
          requiredAmount: "1000000",
          amountIsHumanReadable: false,
          balance: {
            walletAddress: "0xWALLET",
            chainId: 8453,
            tokenAddress: "0xTOKEN",
            symbol: "USDC",
            decimals: 6,
            amount: "5000000",
            isLow: false,
            isInsufficient: false,
          },
        },
      ],
      unresolved: [],
      balancesFetched: true,
    };
    expect(formatFundingAdvisory(response)).toBeNull();
  });

  it("returns advisory text for insufficient token balance", () => {
    const response: AnalyzeFundsResponse = {
      workflowId: "wf_abc",
      workflowVersion: 1,
      requirements: [
        {
          nodeId: "node-1",
          nodeType: "send-erc20-token",
          nodeName: "Send USDC",
          source: "fundsMovement.sent",
          walletAddress: "0xWALLET",
          chainId: 8453,
          chainName: "Base",
          tokenAddress: "0xTOKEN",
          symbol: "USDC",
          decimals: 6,
          isNative: false,
          requiredAmount: "5000000",
          amountIsHumanReadable: false,
          balance: {
            walletAddress: "0xWALLET",
            chainId: 8453,
            tokenAddress: "0xTOKEN",
            symbol: "USDC",
            decimals: 6,
            amount: "1000000",
            isLow: false,
            isInsufficient: true,
          },
        },
      ],
      unresolved: [],
      balancesFetched: true,
    };
    const result = formatFundingAdvisory(response);
    expect(result).not.toBeNull();
    expect(result).toContain("Insufficient funds");
    expect(result).toContain("USDC");
    expect(result).toContain("Base");
    expect(result).toContain("0xWALLET");
    expect(result).toContain("https://b3os.org/wallet-management");
  });

  it("returns advisory for low gas balance", () => {
    const response: AnalyzeFundsResponse = {
      workflowId: "wf_abc",
      workflowVersion: 1,
      requirements: [
        {
          nodeId: "node-1",
          nodeType: "send-erc20-token",
          nodeName: "Send USDC",
          source: "requiresGas",
          walletAddress: "0xWALLET",
          chainId: 8453,
          chainName: "Base",
          tokenAddress: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
          symbol: "ETH",
          decimals: 18,
          isNative: true,
          balance: {
            walletAddress: "0xWALLET",
            chainId: 8453,
            tokenAddress: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
            symbol: "ETH",
            decimals: 18,
            amount: "1000000000000000",
            isLow: true,
            isInsufficient: false,
          },
        },
      ],
      unresolved: [],
      balancesFetched: true,
    };
    const result = formatFundingAdvisory(response);
    expect(result).not.toBeNull();
    expect(result).toContain("Low gas");
    expect(result).toContain("ETH");
    expect(result).toContain("Base");
  });

  it("deduplicates requirements by wallet+chain+token", () => {
    const makeReq = (nodeId: string) => ({
      nodeId,
      nodeType: "send-erc20-token",
      nodeName: `Send USDC ${nodeId}`,
      source: "fundsMovement.sent" as const,
      walletAddress: "0xWALLET",
      chainId: 8453,
      chainName: "Base",
      tokenAddress: "0xTOKEN",
      symbol: "USDC",
      decimals: 6,
      isNative: false,
      requiredAmount: "1000000",
      amountIsHumanReadable: false,
      balance: {
        walletAddress: "0xWALLET",
        chainId: 8453,
        tokenAddress: "0xTOKEN",
        symbol: "USDC",
        decimals: 6,
        amount: "500000",
        isLow: false,
        isInsufficient: true,
      },
    });
    const response: AnalyzeFundsResponse = {
      workflowId: "wf_abc",
      workflowVersion: 1,
      requirements: [makeReq("node-1"), makeReq("node-2"), makeReq("node-3")],
      unresolved: [],
      balancesFetched: true,
    };
    const result = formatFundingAdvisory(response)!;
    const walletMentions = result.split("0xWALLET").length - 1;
    expect(walletMentions).toBeLessThanOrEqual(2);
  });

  it("handles unresolved requirements gracefully", () => {
    const response: AnalyzeFundsResponse = {
      workflowId: "wf_abc",
      workflowVersion: 1,
      requirements: [],
      unresolved: [
        {
          nodeId: "node-1",
          nodeType: "send-erc20-token",
          nodeName: "Send Unknown",
          source: "fundsMovement.sent",
          unresolved: true,
          unresolvedReason: "tokenAddress",
        },
      ],
      balancesFetched: true,
    };
    const result = formatFundingAdvisory(response);
    expect(result).not.toBeNull();
    expect(result).toContain("Cannot verify funds");
    expect(result).toContain("unresolved");
  });

  it("returns null when requirements list is empty and no unresolved", () => {
    const response: AnalyzeFundsResponse = {
      workflowId: "wf_abc",
      workflowVersion: 1,
      requirements: [],
      unresolved: [],
      balancesFetched: true,
    };
    expect(formatFundingAdvisory(response)).toBeNull();
  });

  it("includes human-readable amounts when amountIsHumanReadable is true", () => {
    const response: AnalyzeFundsResponse = {
      workflowId: "wf_abc",
      workflowVersion: 1,
      requirements: [
        {
          nodeId: "node-1",
          nodeType: "send-erc20-token",
          nodeName: "Send USDC",
          source: "fundsMovement.sent",
          walletAddress: "0xWALLET",
          chainId: 8453,
          chainName: "Base",
          tokenAddress: "0xTOKEN",
          symbol: "USDC",
          decimals: 6,
          isNative: false,
          requiredAmount: "5.0",
          amountIsHumanReadable: true,
          balance: {
            walletAddress: "0xWALLET",
            chainId: 8453,
            tokenAddress: "0xTOKEN",
            symbol: "USDC",
            decimals: 6,
            amount: "1000000",
            isLow: false,
            isInsufficient: true,
          },
        },
      ],
      unresolved: [],
      balancesFetched: true,
    };
    const result = formatFundingAdvisory(response)!;
    expect(result).toContain("5.0");
  });
});
