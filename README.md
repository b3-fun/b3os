<p align="center">
  <img src="assets/b3os-logo.svg" alt="B3OS" width="240" />
</p>

<h3 align="center">Open-Source Actions for B3OS</h3>

<p align="center">
  Build and contribute automation actions for the B3OS workflow platform.
  <br />
  <a href="https://b3os.org"><strong>b3os.org</strong></a> · <a href="CONTRIBUTING.md"><strong>Contributing Guide</strong></a> · <a href="docs/quickstart.md"><strong>Quickstart</strong></a>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License" /></a>
</p>

<p align="center">
  <sub>Powered by</sub>
  <br />
  <a href="https://b3.fun"><img src="assets/b3-logo.svg" alt="B3" width="60" /></a>
</p>

---

## What is B3OS?

[B3OS](https://b3os.org) is a workflow automation platform for blockchain operations. Users build automated workflows triggered by blockchain events, schedules, webhooks, or manual execution — composed from modular **actions**.

**Actions** are the building blocks. Each action is a self-contained TypeScript class that performs a specific operation: fetching token prices, sending messages, executing on-chain transactions, querying APIs, and more.

This repository is the open-source home for community-contributed actions. You can build actions that integrate with any API, blockchain, or service — and make them available to every B3OS user.

## Repository Structure

```
b3os/
├── packages/
│   └── sdk/                      # Action SDK (@b3os/sdk)
│       ├── src/                  # Base classes, types, registry
│       │   ├── base-action.ts
│       │   ├── types.ts
│       │   ├── registry.ts
│       │   └── index.ts
│       └── actions/              # Community-contributed actions
│           ├── hello-world/      # Minimal example action
│           └── generate-id/      # ID generation action
└── docs/                         # Documentation
    └── quickstart.md
```

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/b3-fun/b3os.git
cd b3os
pnpm install
```

### 2. Run the tests

```bash
pnpm test
```

### 3. Create your first action

Every action lives in its own directory under `packages/sdk/actions/` and consists of three files:

```
packages/sdk/actions/my-action/
├── execute.ts        # Action class (extends BaseAction)
├── schema.ts         # Input/output JSON schemas
└── index.ts          # Re-export
```

Here's the simplest possible action:

```typescript
// packages/sdk/actions/my-action/execute.ts
import { BaseAction } from "../../src/base-action";
import { ActionCategory } from "../../src/types";
import type { ActionExecutionParams, ActionResult } from "../../src/types";
import { payloadSchema, resultSchema } from "./schema";

export class MyAction extends BaseAction {
  constructor() {
    super("my-action", {
      name: "My Action",
      description: "Does something useful.",
      payloadSchema,
      resultSchema,
      category: ActionCategory.UTILITY,
      author: "your-github-username",
      tags: ["example"],
      createdBy: "your-github-username",
      operationType: "read",
    });
  }

  async execute(params: ActionExecutionParams): Promise<ActionResult> {
    const { myInput } = params.inputs as { myInput: string };
    return this.createSuccessResult({ output: myInput.toUpperCase() });
  }
}
```

See [the full quickstart guide](docs/quickstart.md) for schemas, testing, and more.

## Anatomy of an Action

| File         | Purpose                                                                                              |
| ------------ | ---------------------------------------------------------------------------------------------------- |
| `execute.ts` | Action class extending `BaseAction`. Contains constructor (metadata) and `execute()` method (logic). |
| `schema.ts`  | JSON Schema definitions for `payloadSchema` (inputs) and `resultSchema` (outputs).                   |
| `index.ts`   | Re-exports the action class.                                                                         |
| `*.test.ts`  | Tests for the action (required for all contributions).                                               |

### Action ID Rules

Your action ID is a kebab-case string used for registration and API routing:

- 3-50 characters, lowercase letters, numbers, and hyphens only
- Must start and end with a letter or number
- Must be unique across all actions

### Categories

| Category            | When to use                                        |
| ------------------- | -------------------------------------------------- |
| `blockchain-data`   | Reading on-chain or off-chain blockchain data      |
| `evm-onchain`       | Executing EVM transactions                         |
| `solana-onchain`    | Executing Solana transactions                      |
| `messaging`         | Sending messages (Slack, Discord, Telegram, email) |
| `social`            | Social platform integrations                       |
| `integration`       | Third-party API integrations                       |
| `utility`           | General-purpose utilities                          |
| `wallet-management` | Wallet operations and management                   |

### Connectors

If your action needs external credentials (API keys, OAuth tokens), declare a connector requirement:

```typescript
super("my-action", {
  // ...
  connector: { type: "slack" }, // Platform injects credentials at runtime
});
```

The B3OS platform resolves the user's connected account and injects credentials into `params.inputs` when the action executes. You don't handle auth yourself.

## Contributing

We welcome contributions from the community. See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide.

**TL;DR:**

1. Fork the repo
2. Create your action in `packages/sdk/actions/your-action/`
3. Add tests
4. Open a PR

## Development

```bash
# Install dependencies
pnpm install

# Run tests
pnpm test

# Watch mode
pnpm test:watch

# Type check
pnpm typecheck

# Format code
pnpm prettier:write

# Full validation (types + tests + formatting)
pnpm validate
```

## License

[MIT](LICENSE)
