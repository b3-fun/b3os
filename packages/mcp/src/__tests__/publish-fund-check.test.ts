import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../client.js", async () => {
  const actual =
    await vi.importActual<typeof import("../client.js")>("../client.js");
  return {
    ...actual,
    request: vi.fn(),
    getApiKey: vi.fn(() => "test-key"),
    getServerUrl: vi.fn(() => "http://localhost"),
  };
});

vi.mock("../sse-client.js", () => ({
  consumeCaddieStream: vi.fn(),
}));

import { request } from "../client.js";
import { createServer } from "../server.js";
import { callTool } from "./test-utils.js";

const mockRequest = vi.mocked(request);

describe("b3os_publish_workflow fund pre-check", () => {
  let server: ReturnType<typeof createServer>;

  beforeEach(() => {
    server = createServer();
    mockRequest.mockReset();
  });

  it("blocks publish when funds are insufficient and returns advisory", async () => {
    mockRequest.mockResolvedValueOnce({
      workflowId: "wf_test123",
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
    });

    const result = (await callTool(server, "b3os_publish_workflow", {
      workflowId: "wf_test123",
    })) as { content: Array<{ type: string; text: string }> };

    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(mockRequest).toHaveBeenCalledWith(
      "/v1/workflows/wf_test123/analyze-funds",
    );

    const text = result.content[0].text;
    expect(text).toContain("Insufficient funds");
    expect(text).toContain("wallet-management");
    expect(text).not.toContain("is now live");
  });

  it("proceeds with publish when funds are sufficient", async () => {
    mockRequest.mockResolvedValueOnce({
      workflowId: "wf_test123",
      workflowVersion: 1,
      requirements: [],
      unresolved: [],
      balancesFetched: true,
    });

    mockRequest.mockResolvedValueOnce({
      id: "wf_test123",
      name: "My Workflow",
      status: "active",
      version: 2,
    });

    const result = (await callTool(server, "b3os_publish_workflow", {
      workflowId: "wf_test123",
    })) as { content: Array<{ type: string; text: string }> };

    expect(mockRequest).toHaveBeenCalledTimes(2);
    expect(result.content[0].text).toContain("is now live");
  });

  it("skips fund check when skipFundCheck is true", async () => {
    mockRequest.mockResolvedValueOnce({
      id: "wf_test123",
      name: "My Workflow",
      status: "active",
      version: 2,
    });

    const result = (await callTool(server, "b3os_publish_workflow", {
      workflowId: "wf_test123",
      skipFundCheck: true,
    })) as { content: Array<{ type: string; text: string }> };

    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(mockRequest).toHaveBeenCalledWith(
      "/v1/workflows/wf_test123/publish",
      expect.anything(),
    );
    expect(result.content[0].text).toContain("is now live");
  });

  it("proceeds with publish when analyze-funds call fails (graceful degradation)", async () => {
    mockRequest.mockRejectedValueOnce(new Error("Service unavailable"));

    mockRequest.mockResolvedValueOnce({
      id: "wf_test123",
      name: "My Workflow",
      status: "active",
      version: 2,
    });

    const result = (await callTool(server, "b3os_publish_workflow", {
      workflowId: "wf_test123",
    })) as { content: Array<{ type: string; text: string }> };

    expect(mockRequest).toHaveBeenCalledTimes(2);
    expect(result.content[0].text).toContain("is now live");
  });
});
