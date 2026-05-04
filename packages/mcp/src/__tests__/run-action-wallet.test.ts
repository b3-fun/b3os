import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { createServer } from "../server.js";

vi.mock("../client.js", async () => {
  const actual =
    await vi.importActual<typeof import("../client.js")>("../client.js");
  return {
    ...actual,
    request: vi.fn(),
    getApiKey: vi.fn(() => "test-key"),
    getServerUrl: vi.fn(() => "http://test"),
  };
});

vi.mock("../sse-client.js", () => ({
  consumeCaddieStream: vi.fn(async () => ({
    data: { type: "message", message: "mock" },
  })),
}));

import * as clientModule from "../client.js";
import { callTool } from "./test-utils.js";

const mockRequest = clientModule.request as ReturnType<typeof vi.fn>;

function findCall(pathSubstring: string, exclude?: string) {
  return mockRequest.mock.calls.find(
    (c: unknown[]) =>
      typeof c[0] === "string" &&
      (c[0] as string).includes(pathSubstring) &&
      (!exclude || !(c[0] as string).includes(exclude)),
  );
}

function getCallBody(call: unknown[]): Record<string, unknown> {
  return (call[1] as { body: Record<string, unknown> }).body;
}

describe("b3os_run_action — wallet resolution", () => {
  let server: ReturnType<typeof createServer>;

  beforeAll(() => {
    server = createServer();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("passes explicit walletId as connectorId, skipping action def lookup", async () => {
    mockRequest.mockResolvedValueOnce({
      result: { status: "success", srcTransactionHash: "0xabc" },
      durationMs: 1234,
    });

    const result = await callTool(server, "b3os_run_action", {
      actionType: "relay-swap",
      inputs: {
        srcChainId: 8453,
        tokenIn: "native",
        tokenOut: "0xUSDC",
        amountOut: "10000000",
      },
      walletId: "wal_explicit123",
    });

    expect((result as { isError?: boolean }).isError).not.toBe(true);

    expect(findCall("/actions/relay-swap", "/run")).toBeUndefined();

    const runCall = findCall("/run");
    expect(runCall).toBeDefined();
    expect(getCallBody(runCall!).connectorId).toBe("wal_explicit123");
  });

  it("auto-uses the only wallet when walletId omitted and org has exactly one", async () => {
    mockRequest
      .mockResolvedValueOnce({
        type: "relay-swap",
        connector: { type: "wallet" },
      })
      .mockResolvedValueOnce({ items: [{ id: "org_test1" }] })
      .mockResolvedValueOnce({
        items: [
          {
            id: "wal_only",
            name: "My Wallet",
            address: "0x111",
            isDefault: true,
          },
        ],
      })
      .mockResolvedValueOnce({
        result: { status: "success" },
        durationMs: 500,
      });

    const result = await callTool(server, "b3os_run_action", {
      actionType: "relay-swap",
      inputs: { srcChainId: 8453 },
    });

    expect((result as { isError?: boolean }).isError).not.toBe(true);

    const runCall = findCall("/run");
    expect(runCall).toBeDefined();
    expect(getCallBody(runCall!).connectorId).toBe("wal_only");
  });

  it("returns error when multiple wallets exist and walletId not specified", async () => {
    mockRequest
      .mockResolvedValueOnce({
        type: "relay-swap",
        connector: { type: "wallet" },
      })
      .mockResolvedValueOnce({ items: [{ id: "org_test1" }] })
      .mockResolvedValueOnce({
        items: [
          { id: "wal_one", name: "Wallet 1", address: "0x111" },
          { id: "wal_two", name: "Wallet 2", address: "0x222" },
        ],
      });

    const result = (await callTool(server, "b3os_run_action", {
      actionType: "relay-swap",
      inputs: {},
    })) as { content: { text: string }[] };

    expect(result.content[0].text).toContain("Multiple wallets found");
    expect(result.content[0].text).toContain("b3os_list_wallets");
  });

  it("returns error when action requires wallet but no wallets found", async () => {
    mockRequest
      .mockResolvedValueOnce({
        type: "relay-swap",
        connector: { type: "wallet" },
      })
      .mockResolvedValueOnce({ items: [{ id: "org_test1" }] })
      .mockResolvedValueOnce({ items: [] });

    const result = (await callTool(server, "b3os_run_action", {
      actionType: "relay-swap",
      inputs: {},
    })) as { content: { text: string }[] };

    expect(result.content[0].text).toContain("No wallets found");
  });

  it("skips wallet resolution for actions that don't require a wallet", async () => {
    mockRequest
      // 1st call: GET /v1/actions/coingecko-get-token-price (no connector)
      .mockResolvedValueOnce({
        type: "coingecko-get-token-price",
        // no connector field
      })
      // 2nd call: POST /v1/actions/coingecko-get-token-price/run
      .mockResolvedValueOnce({
        result: { price: "3000" },
        durationMs: 50,
      });

    const result = await callTool(server, "b3os_run_action", {
      actionType: "coingecko-get-token-price",
      inputs: { coinIds: ["ethereum"] },
    });

    expect((result as { isError?: boolean }).isError).not.toBe(true);

    expect(findCall("/organizations")).toBeUndefined();

    const runCall = findCall("/run");
    expect(getCallBody(runCall!).connectorId).toBeUndefined();
  });

  it("uses connectorId directly when provided (non-wallet connector)", async () => {
    mockRequest.mockResolvedValueOnce({
      result: { messageId: "msg_123" },
      durationMs: 200,
    });

    const result = await callTool(server, "b3os_run_action", {
      actionType: "slack-send-message",
      inputs: { channel: "#general", message: "hello" },
      connectorId: "conn_slack456",
    });

    expect((result as { isError?: boolean }).isError).not.toBe(true);

    expect(findCall("/actions/slack-send-message", "/run")).toBeUndefined();

    const runCall = mockRequest.mock.calls[0];
    expect(getCallBody(runCall).connectorId).toBe("conn_slack456");
  });

  it("prefers walletId over auto-resolve for multi-wallet orgs", async () => {
    mockRequest.mockResolvedValueOnce({
      result: { status: "success" },
      durationMs: 100,
    });

    const result = await callTool(server, "b3os_run_action", {
      actionType: "relay-swap",
      inputs: {},
      walletId: "wal_specific_wallet",
    });

    expect((result as { isError?: boolean }).isError).not.toBe(true);

    expect(findCall("/organizations")).toBeUndefined();
    expect(findCall("/actions/relay-swap", "/run")).toBeUndefined();

    const runCall = findCall("/run");
    expect(getCallBody(runCall!).connectorId).toBe("wal_specific_wallet");
  });

  it("returns error when both walletId and connectorId are provided", async () => {
    const result = (await callTool(server, "b3os_run_action", {
      actionType: "relay-swap",
      inputs: {},
      walletId: "wal_abc",
      connectorId: "conn_slack456",
    })) as { content: { text: string }[] };

    expect(result.content[0].text).toContain(
      "Cannot pass both walletId and connectorId",
    );
    expect(mockRequest).not.toHaveBeenCalled();
  });
});
