export const GUIDE_URI = "b3os://guide";

export const GUIDE_CONTENT = `# B3OS Platform Guide

B3OS is a workflow automation platform for blockchain operations. Users create
automated workflows triggered by blockchain events, schedules, webhooks, or
manual execution. Workflows combine 560+ actions across DeFi, social, data,
and on-chain operations.

---

## Workflow Definition Anatomy

A workflow definition is a JSON object with a single \`nodes\` map. Each key is a
node ID, and the value describes that node's type, configuration, and connections.

\`\`\`json
{
  "nodes": {
    "root": {
      "type": "cronjob",
      "payload": { "rrule": "DTSTART:20260101T090000Z\\nRRULE:FREQ=MINUTELY;INTERVAL=5" },
      "children": ["fetch_price"]
    },
    "fetch_price": {
      "type": "coingecko-get-token-price",
      "payload": { "coinId": "ethereum" },
      "children": ["check_drop"]
    },
    "check_drop": {
      "type": "if",
      "payload": {
        "condition": { "$and": [{ "{{fetch_price.result.price}}": { "$lte": 2000 } }] }
      },
      "children": ["send_alert", "do_nothing"]
    },
    "send_alert": {
      "type": "slack-send-message",
      "branch": "then",
      "payload": {
        "conversation": "{{ask.slack_channel}}",
        "text": "ETH dropped to \${{fetch_price.result.price}}"
      },
      "connector": { "type": "slack" },
      "children": []
    },
    "do_nothing": {
      "type": "log",
      "branch": "else",
      "payload": { "message": "Price OK: {{fetch_price.result.price}}" },
      "children": []
    }
  }
}
\`\`\`

### Key Structural Rules

- **\`root\` is always the trigger node.** The workflow engine starts execution from \`root\`.
- **\`children\`** is an ordered array of node IDs that execute after the parent completes.
- **\`branch\`** is required on children of \`if\` nodes (\`"then"\` or \`"else"\`) and \`wait\` nodes (\`"resumed"\` or \`"timed_out"\`).
- **\`payload\`** contains the node's configuration. Supports \`{{}}\` template expressions.
- **\`connector\`** references an OAuth credential: \`{ "type": "slack" }\` or \`{ "type": "slack", "id": "conn_abc" }\`. Only needed for actions that interact with external services.
- **\`loopBody\`** (on \`for-each\` nodes) is an array of node IDs that run per iteration — these go in \`loopBody\`, not \`children\`.
- **\`description\`** and **\`titleOverride\`** are optional display labels.

---

## Expression Syntax Reference

Template expressions use \`{{ }}\` syntax and are resolved at runtime.

| Pattern | Example | Resolves To |
|---------|---------|-------------|
| Node result | \`{{fetch_data.result.items}}\` | Output field from an upstream node |
| Nested path | \`{{fetch_data.result.data.price}}\` | Nested field access |
| Node payload | \`{{root.payload.chainId}}\` | Config value from another node |
| Trigger input | \`{{root.result.body.userId}}\` | Webhook body data |
| User input (ASK) | \`{{ask.wallet_address}}\` | Creates a UI widget for user input at setup time |
| Props | \`{{$props.chainId}}\` | Workflow properties, inlined at creation time |
| Block inputs | \`{{$inputs.coinId}}\` | Inputs passed into a reusable block |
| Loop item | \`{{$item.name}}\` | Current for-each iteration item |
| Loop index | \`{{$index}}\` | Current for-each iteration index (0-based) |
| Parent loop | \`{{$parent_item}}\` | Parent for-each item (nested loops) |
| Ancestor loop | \`{{$for.outer_loop.item}}\` | Named ancestor for-each (3+ nesting) |
| Workflow ID | \`{{$workflowId}}\` | Current workflow's ID |
| Fallback | \`{{node.result.count \\|\\| 0}}\` | Use 0 if the variable is nil |

**Important:** Expressions can only reference ancestor nodes — nodes that have already
executed before the current node in the DAG. You cannot reference sibling or descendant nodes.

---

## Node Types Quick Reference

### Triggers (always the \`root\` node)

**Core triggers:**

| Type | Description | Key Payload Fields |
|------|-------------|-------------------|
| \`cronjob\` | Schedule-based | \`rrule\` (two-line DTSTART+RRULE string) |
| \`manual\` | User clicks "Run" or webhook POST | (none — also serves as webhook endpoint) |
| \`erc20-receive\` | ERC-20 token received | \`chainId\`, \`tokenAddress\`, \`walletAddress\` |
| \`erc20-send\` | ERC-20 token sent | \`chainId\`, \`tokenAddress\`, \`walletAddress\` |
| \`eth-receive\` | Native ETH received | \`chainId\`, \`walletAddress\`, \`minAmount\` (wei) |
| \`eth-send\` | Native ETH sent | \`chainId\`, \`walletAddress\` |
| \`evm-log\` | Smart contract event | \`chainId\`, \`contractAddress\`, \`eventName\`, \`abi\` |
| \`token-price-cexes\` | Real-time price monitor | \`asset\`, \`condition\`, \`threshold\` |
| \`solana-transaction\` | Solana tx event | \`address\`, \`network\` |

**Polymarket triggers:**

| Type | Description |
|------|-------------|
| \`polymarket-user-bet\` | A specific user places a bet |
| \`polymarket-market-trade\` | Any trade on a market (CLOB WebSocket) |
| \`polymarket-new-market\` | New market created |
| \`polymarket-market-close\` | Market resolves |

**Social/messaging triggers:**

| Type | Description |
|------|-------------|
| \`telegram-channel\` | New Telegram message |
| \`slack-mentions\` | Slack mention detection |
| \`slack-new-message-in-channels\` | New message in Slack channel |
| \`farcaster-new-cast\` | New Farcaster cast |
| \`x-new-tweet\` | New tweet (requires username or keywords filter) |
| \`gmail-new-email-received\` | Gmail inbox (OAuth) |
| \`email-new-email-received\` | Disposable inbox |

**Other triggers:**

| Type | Description |
|------|-------------|
| \`exchange-listing\` | New trading pair on CEX (Binance, Coinbase, etc.) |
| \`stripe-payment-receive\` | Stripe payment received |
| \`shopify-order-created\` | Shopify order created |
| \`coinbase-payment-received\` | Coinbase Commerce payment |

Use \`b3os_list_triggers\` to see all available trigger types and their payload schemas.

### Logic Nodes (built-in, no connector needed)

| Type | Description | Key Fields |
|------|-------------|------------|
| \`if\` | Conditional branch | \`payload.condition\` (object with \`$and\`/\`$or\`). Children use \`branch: "then"/"else"\` |
| \`for-each\` | Loop over array | \`payload.array\` (expression). Loop nodes go in \`loopBody\`, not \`children\` |
| \`filter\` | Filter array | \`payload.array\`, \`payload.condition\` |
| \`pluck\` | Extract fields | \`payload.array\`, \`payload.fields\` |
| \`delay\` | Wait for duration | \`payload.delayMs\` (milliseconds) |
| \`log\` | Log a message | \`payload.message\` (supports templates) |
| \`code-transform\` | Run JavaScript | \`payload.code\` (must be \`function transform(input) {...}\`), \`payload.input\`, \`payload.outputType\` |
| \`regex\` | Regex extraction | \`payload.input\`, \`payload.pattern\` |
| \`wait\` | Pause until event | \`payload.triggerType\`, \`payload.triggerConfig\`, \`payload.timeoutMs\`. Children use \`branch: "resumed"/"timed_out"\` |
| \`send-webhook\` | HTTP POST | \`payload.url\`, \`payload.headers\`, \`payload.body\` |

### Dynamic Actions (560+ from catalog)

Use \`b3os_search_actions\` to find actions by keyword, then \`b3os_get_action\` to get
the full payload and result schemas. Common categories:

- **Token ops:** \`send-erc20-token\`, \`send-native-token\`, \`approve-erc20\`
- **Swaps:** \`0x-swap\`, \`cow-swap-gasless\`, \`relay-swap\`, \`swapkit-swap\`
- **Perps/Trading:** \`hyperliquid-market-order\`, \`hyperliquid-limit-order\`, \`hyperliquid-update-leverage\`, \`hyperliquid-close-position\`, \`hyperliquid-stop-loss\`, \`hyperliquid-take-profit\`, \`hyperliquid-get-account\`
- **DeFi:** \`morpho-vault-deposit\`, \`morpho-vault-withdraw\`, \`v3-add-liquidity\`
- **Data:** \`coingecko-get-token-price\`, \`coinglass-get-funding-rate\`
- **Messaging:** \`slack-send-message\`, \`slack-send-block-kit-message\`, \`discord-send-message\`, \`telegram-send-message\`
- **Polymarket:** \`polymarket-place-bet\`, \`polymarket-redeem\`

IMPORTANT: This list is NOT exhaustive. The catalog grows constantly. ALWAYS use
\`b3os_search_actions\` to discover actions — never assume something is unsupported.

---

## Connector Rules

Some actions require a \`connector\` field linking them to an external credential:

\`\`\`json
"connector": { "type": "slack" }
\`\`\`

Or with a specific connector ID:

\`\`\`json
"connector": { "type": "slack", "id": "conn_abc123" }
\`\`\`

**Three kinds of connectors:**
- **OAuth connectors** (\`slack\`, \`discord\`, \`telegram\`, \`gmail\`, \`google_sheets\`): Must be
  set up at b3os.org/connectors before use. Required for actions that talk to third-party
  APIs via OAuth.
- **Wallet connector** (\`wallet\`): References the org's HSM-backed wallets (from
  \`b3os_list_wallets\`). Used for all on-chain actions — sending tokens, swaps, DeFi,
  perps trading. These are always available if the org has wallets; no separate setup needed.
- **Database connector** (\`db\`): For database actions.

**Logic nodes NEVER need connectors:** \`if\`, \`for-each\`, \`filter\`, \`pluck\`, \`delay\`, \`log\`, \`code-transform\`, \`regex\`, \`wait\`, \`send-webhook\`.

OAuth connectors must be pre-configured in the B3OS UI before workflows can use them.
If the connector ID is unknown at build time, use \`{{ask.connector_id}}\` or leave
only the \`type\` field — the user will select the connector in the B3OS UI.

Note: \`connector_id\` here is an ASK-widget field name inside workflow JSON.
When calling MCP tools directly (e.g. \`b3os_list_slack_channels\`), the parameter
is camelCase: \`connectorId\`. The MCP wrapper also accepts \`connector_id\` as an
alias, so either form works for tool calls.

---

## If Condition Format

The \`if\` node uses a JSON condition object. The top-level key MUST be \`$and\` or \`$or\`:

\`\`\`json
{
  "condition": {
    "$and": [
      { "{{fetch_price.result.price}}": { "$lte": 2000 } },
      { "{{fetch_price.result.volume}}": { "$gte": 1000000 } }
    ]
  }
}
\`\`\`

**Operators:** \`$eq\`, \`$ne\`, \`$gt\`, \`$gte\`, \`$lt\`, \`$lte\`, \`$contains\`, \`$notContains\`,
\`$startsWith\`, \`$endsWith\`, \`$exists\`, \`$notExists\`, \`$in\`, \`$notIn\`.

---

## Common Workflow Patterns

**Pattern A — Monitor + Alert:** \`cronjob → fetch data → if condition → send notification\`
Most common pattern. Schedule a check, fetch external data, conditionally alert.

**Pattern B — Webhook + Transform:** \`webhook → code-transform → send-webhook / action\`
Receive external data, transform it, take action. Used for API integrations.

**Pattern C — Trigger + Loop + Action:** \`trigger → fetch list → for-each → action per item\`
Batch processing. Trigger fetches a list, loops over items, processes each.

**Pattern D — Approval Flow:** \`trigger → slack-send-block-kit-message → wait → if approve/reject → action\`
Human-in-the-loop. Post approval buttons, wait for click, branch on decision.

---

## Numeric Conventions

**On-chain amounts are strings in raw units (wei/atomic):**
- 1 ETH = \`"1000000000000000000"\` (18 decimals)
- 1 USDC = \`"1000000"\` (6 decimals)
- 1 WBTC = \`"100000000"\` (8 decimals)

NEVER pass human-readable decimals to send/swap/approve actions. Always convert
to the token's raw unit string. Look up token decimals — never hardcode them.

**Prices and display values are numbers:** \`2000.50\`, \`0.65\`, \`1500000\`
These are used in conditions and display, not on-chain transactions.

---

## ASK Widget Patterns

\`{{ask.fieldName}}\` creates a user-input widget in the B3OS UI. Use it for values
the user should provide at setup time:

\`\`\`json
"walletAddress": "{{ask.wallet_address}}",
"conversation": "{{ask.slack_channel}}",
"threshold": "{{ask.price_threshold}}"
\`\`\`

**Rich widget types** are available for common fields. Use the matching field name
pattern and the B3OS UI will render the appropriate widget:
- \`wallet_address\` → Wallet selector
- \`token_address\` / \`token_addresses\` → Token contract picker (with chain)
- \`chain_id\` / \`chain_ids\` → Network selector
- \`connector_id\` → Connector account picker (MCP tool parameter equivalent: \`connectorId\`)
- \`slack_channel\` → Slack channel picker
- \`telegram_chat\` → Telegram chat picker
- \`token_amount\` → Token amount with decimals
- \`recipient_address\` → Recipient wallet address
- \`contract_address\` → Smart contract address
- \`network\` / \`networks\` → Network selector (alternative)
- \`boolean\`, \`number\`, \`select\`, \`multiselect\`, \`textarea\`, \`date\`, \`color\` → Basic types

---

## How to Use B3OS Tools

### Building a Workflow
Use \`b3os_build_workflow\` to delegate to Caddie, the B3OS AI agent. Caddie has
deep domain knowledge, address verification, and 30+ specialized tools.

1. Gather prerequisites: \`b3os_list_connectors\`, \`b3os_list_wallets\` → present options
2. Describe the workflow in natural language to \`b3os_build_workflow\`
3. Review the returned definition with the user
4. Save: \`b3os_create_workflow\` (new) or \`b3os_update_workflow\` (existing)
5. Confirm with user → deploy: \`b3os_publish_workflow\`

To modify an existing workflow, pass its \`workflowId\` to \`b3os_build_workflow\`.

### Debugging a Failure
Use \`b3os_debug_run\` to delegate diagnosis to Caddie:

1. \`b3os_list_runs\` (status: "failure") → find failed runs
2. \`b3os_debug_run\` (runId) → Caddie diagnoses + suggests fixes
3. Apply fix: \`b3os_update_workflow\` → \`b3os_publish_workflow\`

For manual inspection: \`b3os_get_run\` with nodeIds to see per-node input, result, and error.

### Data Queries (no workflow needed)
Use named lookup tools for common queries:
- Token info: \`b3os_token_lookup\` (network + address, or coinId)
- Prices: \`b3os_price_lookup\` (coinIds)
- Balances: \`b3os_balance_lookup\` (address, chainIds, limit)
- DeFi positions: \`b3os_defi_lookup\` (address, chainId)
- Tx debugging: \`b3os_debug_transaction\` (txHash, chainId)
- Polymarket: \`b3os_polymarket_lookup\` (query, slug, or marketUrl)
- Any other action: \`b3os_query_action\` (generic fallback — use \`b3os_search_actions\` to find action types first)

### One-Shot Execution (no workflow needed)
- \`b3os_run_action\` for any single action — reads AND writes (queries, swaps, deposits,
  leverage changes, token sends). Faster than building a workflow for one-off operations.
- \`b3os_run_ephemeral\` for multi-step definitions (max 20 nodes, 60s timeout)

---

## Key Gotchas

**Workflow lifecycle:**
- **Workflows start in "draft" status** — must call \`b3os_publish_workflow\` to make them live
- **Fund check on publish** — \`b3os_publish_workflow\` automatically checks wallet balances before publishing. If funds are insufficient, it returns an advisory with the amounts needed and a link to fund wallets. Pass \`skipFundCheck: true\` to bypass.
- **Connectors must be set up in B3OS UI first** — Slack, Discord, Google Sheets, etc.
- **On-chain actions require a funded org wallet** with sufficient balance and gas

**Scheduling:**
- **Cronjob rrule must be two-line format:** \`"DTSTART:YYYYMMDDTHHmmSSZ\\nRRULE:FREQ=..."\`. A bare RRULE without DTSTART will break scheduling. Encode desired time in DTSTART, NOT in BYHOUR/BYMINUTE.
- **DTSTART must use current UTC timestamp** — a future DTSTART means the cron won't fire until then.

**Conditions and expressions:**
- **If condition format:** top-level key MUST be \`$and\` or \`$or\` — a bare comparison won't work.
- **Regex matches** are a map with string keys: use \`{{node.result.matches.1}}\` (dot notation), never \`{{node.result.matches[1]}}\`.
- **code-transform output** is at \`{{nodeId.result.output}}\`, not \`{{nodeId.result}}\`. The function must be named \`transform(input)\`.

**Integrations:**
- **Slack Block Kit \`blocks\` must be a JSON string**, not an object. Stringify the JSON array before setting the field.
- **Slack action results** are nested under \`data.ret\`: use \`{{node.result.data.ret.ts}}\`, NOT \`{{node.result.data.ts}}\`.
- **Google Sheets worksheetId** must be an integer, never a sheet name string.
- **Gmail vs email triggers:** \`gmail-new-email-*\` polls a real Gmail inbox via OAuth. \`email-new-email-*\` creates a disposable inbox. If the user wants to watch their inbox, use \`gmail-*\`.
- **x-new-tweet requires at least one filter** — empty payload is invalid. Must include username or keywords.

**On-chain:**
- **approve-erc20 is for smart contracts only** (DEX routers, DeFi protocols). For sending tokens to a wallet, use \`send-erc20-token\` directly — no approval step needed.
- **Use \`amountFormatted\` in notifications**, \`amount\` for raw precision in on-chain calls.

**Wait nodes:**
- **Wait node timeout:** default 5 min is too short for human approval. Set \`timeoutMs\` to at least 86400000 (24h). Always include a \`timed_out\` branch child.
- **Wait node uses \`waitPayloadSchema\`**, NOT the trigger's \`payloadSchema\`. For slack-new-interaction-event, valid fields are actionId, messageTs, userIds.

**Database:**
- **db-query results are always wrapped in a \`rows\` array** — access as \`{{node.result.rows.0.field}}\`, NEVER \`{{node.result.field}}\`.
- **Use COALESCE for first-run safety:** \`SELECT COALESCE((SELECT spent FROM budgets WHERE id = ?), 0)\` — prevents row[0] IndexOutOfBounds.

**Perps/Trading (Hyperliquid):**
- **Check leverage before trading:** Run \`hyperliquid-get-account\` first to see current leverage and positions. Hyperliquid defaults to 20x cross — aggressive for stocks, recommend 3-5x for trade.xyz assets.
- **Cannot switch margin mode with open position:** \`hyperliquid-update-leverage\` will reject switching between cross/isolated if the user holds an open position on that coin. They must close the position first.
- **update-leverage is idempotent:** If leverage is already at the requested setting, the action returns success with \`skipped: true\` — no extra API call to the exchange.
- **Dex variants:** Pass \`dex: "xyz"\` for trade.xyz (stocks), \`dex: "flx"\` for flx.finance, \`dex: "vntl"\` for vntl.exchange. Omit for standard crypto perps.

**Polymarket:**
- **polymarket-redeem: add an if guard** checking \`{{redeem.result.redeemedAmount}}\` > 0 before downstream actions — redeemedAmount is ZERO for losing outcomes.
- **Minimum bet amounts:** $1 for market orders (FAK/FOK), $5 for limit orders (GTC).
`;
