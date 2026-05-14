# B3OS MCP Server

> **Blockchain automation at the speed of conversation.**

Connect Claude to [B3OS](https://b3os.org) and build, run, and debug blockchain workflows in plain English — no UI, no code, no context-switching.

Works with Claude Code, Claude Desktop, and agent teammates.

---

## What is B3OS?

B3OS is a workflow automation platform built for blockchain. Think Zapier or n8n, but with first-class wallets, gas, transaction confirmation, and on-chain triggers — the things general-purpose automation tools force you to bolt on yourself.

A B3OS workflow is a graph of nodes that runs when something happens (a price moves, a wallet receives a token, a contract emits an event, a schedule fires, a webhook arrives) and can do almost anything: swap tokens, send messages, fetch market data, deposit into DeFi, post to Slack, write to a sheet. Workflows are persistent, observable, retryable, and have full execution history. The MCP server lets Claude build, run, and debug these workflows for you through conversation.

---

## What you can do

### Build workflows in one sentence

```
"Monitor ETH price every 5 minutes and alert me on Slack if it drops below $2000"

"Every Monday at 9am, swap 100 USDC to ETH on Base and email me a confirmation"

"When my wallet receives an ERC-20 token, log it to a Google Sheet and send a Telegram alert"
```

Claude searches the action catalog, picks the right triggers and connectors, wires them together, and asks you to review before publishing.

### Query the chain

```
"What's the current price of ETH and BTC?"
"What tokens does vitalik.eth hold on Base?"
"Why did tx 0xabc... fail?"
"Show me the top Polymarket markets right now"
```

No workflow needed — answers come back inline using read-only action queries (no gas, no state changes).

### Debug with full execution context

```
"Why did my last workflow run fail?"
"Explain what this node did and how to fix it"
```

Claude pulls the execution trace, identifies which node failed, surfaces the error, and offers a fix you can apply with one more message.

### Operate live workflows

```
"Pause my ETH alert workflow"
"Change the Slack channel in my swap notifier"
"Re-run last night's failed price snapshot"
```

Claude can list, get, update, publish, pause, resume, run, and trace any workflow you own.

---

## What's in the box

### Triggers

Schedule, webhook, manual, EVM smart contract logs, native transfers, ERC-20 receives, token price thresholds (CEX feeds), Polymarket market events, Slack mentions, and external API polling. New trigger types ship continuously.

### Chains

Major EVM networks — Ethereum, Base, Arbitrum, Optimism, Polygon, BNB Chain — plus Solana for native and SPL token operations. Wallet signing is handled by the platform; you never expose private keys to Claude.

### Actions

Hundreds of actions across:

- **EVM operations** — send native + ERC-20, approve, wrap/unwrap, deploy contracts, arbitrary contract calls
- **DEX & swaps** — 0x, 1inch, Jupiter, CoW Protocol, Relay, gasless permit swaps
- **DeFi** — Uniswap v2/v3/v4 liquidity, Morpho deposits/withdrawals, Aerodrome
- **Privacy** — RAILGUN shield/unshield, private transfers
- **Market data** — CoinGecko, Dune, Sim Dune, DeBank, Zerion, CoinGlass, DEX Screener, Token Discovery
- **Prediction markets** — Polymarket place/redeem/close, market search, leaderboards
- **Social & messaging** — Slack, Discord, Telegram, Email (Gmail), Twilio SMS, Twitter, Farcaster (Neynar)
- **Business** — Shopify, Airtable, Google Sheets, webhooks
- **Web & AI** — Firecrawl scraping, LLM transformations

### Control flow primitives

`if`, `filter`, `for-each` (with nested loop variables), `delay`, `wait` (resume on webhook or timeout), `format` (templating), `pluck`, `regex`, `code-transform`, `log`, `send-webhook`, `trigger-workflow`. Combine these to build branching, looping, and pausing workflows that survive restarts.

### Expressions

Reference any prior node's output with `{{node.result.field}}`, template props with `{{$props.key}}`, loop items with `{{$item}}` and `{{$index}}`, and parent loops with `{{$parent_item}}`. The expression engine resolves variables at runtime against the persistent execution state.

---

## Quick Start

### 1. Install

```bash
npm install -g @b3dotfun/b3os-mcp
```

<details>
<summary>Install from source</summary>

```bash
git clone https://github.com/b3-fun/b3os.git
cd b3os/packages/mcp
pnpm install && pnpm run build
```

</details>

### 2. Run setup

```bash
b3os-mcp-setup
```

The wizard opens your browser, signs you in to B3OS, creates a dedicated API key scoped to this machine, and stores it securely in your OS keychain (macOS Keychain or Windows DPAPI). On Linux, the key is written to your Claude config. Takes about 20 seconds.

You only run it once per machine. Re-running issues a new key under the same service account — it does not revoke the old one. To revoke a key, visit [b3os.org/organizations/settings?tab=api-keys](https://b3os.org/organizations/settings?tab=api-keys).

### 3. Restart Claude

Restart your Claude Code session or Claude Desktop app, and you're done.

---

## Usage

After setup, just talk to Claude:

> **You:** "Build me a workflow that swaps any stable received on Base into ETH and sends me a Slack DM"
>
> **Claude:** _searches the action catalog, picks the connectors, constructs the workflow, and asks you to review before publishing_

Or for one-off queries:

> **You:** "What's in my Base wallet?"
>
> **Claude:** _calls the balance lookup and returns the full token breakdown with USD values_

Or for debugging:

> **You:** "My last workflow run failed — what happened?"
>
> **Claude:** _pulls the execution trace, points at the failing node, explains the error, and offers a fix_

---

## Configuration

### Environment variables

| Variable          | Required | Description                                                                                                                             |
| ----------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `B3OS_API_KEY`    | No       | API key — on macOS/Windows the key is read from the OS keychain automatically. Set this only on Linux, CI, or to override the keychain. |
| `B3OS_SERVER_URL` | No       | Override the API endpoint (defaults to B3OS production)                                                                                 |

### CI / headless environments

For machines without a browser (CI runners, headless servers), create an API key
from the [B3OS dashboard](https://b3os.org/organizations/settings?tab=api-keys)
and inject it via your CI platform's secrets management (e.g., GitHub Actions
secrets, Doppler, Vault). The runtime reads the `B3OS_API_KEY` environment
variable automatically — no wizard needed.

### Manual config (advanced)

The setup wizard handles everything, but if you need to edit your Claude config by hand:

**On macOS or Windows (with keystore support):** the `env` block should contain
only `B3OS_SERVER_URL`. The API key is read from the OS keystore at runtime:

```json
{
  "mcpServers": {
    "b3os-mcp": {
      "type": "stdio",
      "command": "b3os-mcp",
      "env": {
        "B3OS_SERVER_URL": "https://api.b3os.org"
      }
    }
  }
}
```

**On Linux (no keystore):** the setup wizard writes the API key into the `env`
block automatically. If you need to configure manually, run `pnpm run setup`
first — it stores the key and generates the config for you.

> **nvm / fnm users:** If `b3os-mcp` isn't resolved — common with Claude Desktop since it doesn't inherit your shell's `PATH` — replace `"command": "b3os-mcp"` with the absolute node path and the absolute path to `dist/index.js`. Find your node with `which node`. The interactive setup handles this automatically.

---

## How Claude uses the server

The MCP server exposes tools across five areas: action catalog (search and inspect), workflows (CRUD + publish/pause/resume), runs (trigger, list, trace), data queries (read-only action proxy), and organization context (whoami, wallets, connectors). Claude picks the right tool for the task and you stay in the conversation.

Read operations (lookups, listings, schemas, traces) run freely. Write operations — creating workflows, publishing, executing on-chain actions, triggering runs — always require your explicit approval per call.

---

## Security

- Each install creates a dedicated API key scoped to your machine (`b3os-mcp@<hostname>`)
- **macOS:** the key is stored in the system Keychain (service `b3os-mcp`), encrypted at rest by your login password. No plaintext key on disk. Revoke via `security delete-generic-password -s b3os-mcp`.
- **Windows:** the key is DPAPI-encrypted at `%USERPROFILE%\.b3os\b3os-mcp-key.dpapi`. Decryption is scoped to (Windows user x machine) — the file alone is useless without the user's Windows credentials on the same machine.
- **Linux:** the key is stored in plaintext in `~/.claude/mcp.json` with owner-only permissions (`chmod 0600`). Keychain support via libsecret is possible — open an issue if you need it.
- The Claude config files (`~/.claude/mcp.json`, `claude_desktop_config.json`) contain only `B3OS_SERVER_URL` on macOS/Windows — **no API key**. On Linux the key is in the config as a fallback.
- Session tokens from the browser login are discarded immediately — only the long-lived API key is persisted
- Wallet signing happens server-side; private keys are never exposed to Claude or to the MCP server
- Revoke anytime at [b3os.org/organizations/settings?tab=api-keys](https://b3os.org/organizations/settings?tab=api-keys)
- Write operations (creating workflows, running actions, executing transactions) always require your explicit approval per call

---

## Links

- **Platform:** [b3os.org](https://b3os.org)
- **API keys:** [b3os.org/organizations/settings?tab=api-keys](https://b3os.org/organizations/settings?tab=api-keys)
- **MCP Protocol:** [modelcontextprotocol.io](https://modelcontextprotocol.io)

---

## License

MIT
