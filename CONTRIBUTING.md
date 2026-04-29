# Contributing to B3OS

Thanks for your interest in contributing to B3OS! This guide walks you through creating and submitting a new action.

## Table of Contents

- [Getting Started](#getting-started)
- [Creating an Action](#creating-an-action)
  - [Step 1: Scaffold your action](#step-1-scaffold-your-action)
  - [Step 2: Define your schemas](#step-2-define-your-schemas)
  - [Step 3: Implement your action](#step-3-implement-your-action)
  - [Step 4: Write tests](#step-4-write-tests)
  - [Step 5: Validate](#step-5-validate)
- [Action Guidelines](#action-guidelines)
- [Schema Guidelines](#schema-guidelines)
- [Error Handling](#error-handling)
- [Connectors](#connectors)
- [Submitting a Pull Request](#submitting-a-pull-request)
- [Code Review Process](#code-review-process)

---

## Getting Started

1. **Fork** this repository
2. **Clone** your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/b3os.git
   cd b3os
   ```
3. **Install** dependencies:
   ```bash
   pnpm install
   ```
4. **Verify** everything works:
   ```bash
   pnpm validate
   ```

## Creating an Action

### Step 1: Scaffold your action

Create a new directory under `packages/sdk/actions/` with your action's kebab-case ID:

```bash
mkdir -p packages/sdk/actions/my-action
touch packages/sdk/actions/my-action/{execute,schema,index}.ts
touch packages/sdk/actions/my-action/my-action.test.ts
```

Your directory should look like:

```
packages/sdk/actions/my-action/
├── execute.ts          # Action class
├── schema.ts           # Input/output schemas
├── index.ts            # Re-export
└── my-action.test.ts   # Tests
```

### Step 2: Define your schemas

Schemas define what your action accepts and returns using [JSON Schema](https://json-schema.org/). The B3OS canvas uses these to render input forms and validate data.

```typescript
// packages/sdk/actions/my-action/schema.ts
import type { SchemaDefinition } from "../../src/types";

export const payloadSchema: SchemaDefinition = {
  type: "object",
  required: ["url"],
  properties: {
    url: {
      type: "string",
      description: "The URL to fetch data from",
      pattern: "^https?://",
    },
    timeout: {
      type: "number",
      description: "Request timeout in milliseconds",
      default: 5000,
      minimum: 1000,
      maximum: 30000,
    },
  },
  additionalProperties: false,
};

export const resultSchema: SchemaDefinition = {
  type: "object",
  required: ["status", "data"],
  properties: {
    status: {
      type: "number",
      description: "HTTP status code",
    },
    data: {
      type: "string",
      description: "Response body",
    },
  },
  additionalProperties: false,
};
```

### Step 3: Implement your action

Extend `BaseAction` and implement the `execute` method:

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
      description:
        "Fetch data from a URL. " +
        "Returns the HTTP status and response body. " +
        "Ideal for: health checks, API polling, data retrieval.",
      payloadSchema,
      resultSchema,
      category: ActionCategory.INTEGRATION,
      author: "your-github-username",
      tags: ["http", "fetch", "api"],
      createdBy: "your-github-username",
      operationType: "read",
      exampleUsage: {
        inputs: { url: "https://api.example.com/data" },
        actionContext: { userId: "user-1" },
        exampleOutput: { status: 200, data: '{"ok": true}' },
      },
    });
  }

  async execute(params: ActionExecutionParams): Promise<ActionResult> {
    const { url, timeout = 5000 } = params.inputs as {
      url: string;
      timeout?: number;
    };

    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(timeout),
      });
      const data = await response.text();

      return this.createSuccessResult({
        status: response.status,
        data,
      });
    } catch (error) {
      return this.createErrorResult(
        "FETCH_ERROR",
        error instanceof Error ? error.message : "Request failed",
        {
          category: "network",
          displayMessage: `Failed to fetch ${url}`,
          retryable: true,
        },
      );
    }
  }
}
```

Then re-export:

```typescript
// packages/sdk/actions/my-action/index.ts
export { MyAction } from "./execute";
```

### Step 4: Write tests

Every action must have tests. Use the `makeParams` helper pattern:

```typescript
// packages/sdk/actions/my-action/my-action.test.ts
import { describe, expect, it } from "vitest";
import { MyAction } from "./execute";

const makeParams = (inputs: Record<string, unknown> = {}) => ({
  context: {
    userId: "test-user",
    executionId: "test-exec-1",
    timestamp: new Date(),
  },
  inputs,
  actionContext: { userId: "test-user" },
});

describe("MyAction", () => {
  const action = new MyAction();

  it("has correct metadata", () => {
    expect(action.actionId).toBe("my-action");
    expect(action.metadata.name).toBe("My Action");
    expect(action.metadata.category).toBe("integration");
  });

  it("validates required inputs", () => {
    expect(action.validateInputs({})).toBe(false); // missing required 'url'
    expect(action.validateInputs({ url: "https://example.com" })).toBe(true);
  });

  it("executes successfully", async () => {
    const result = await action.execute(
      makeParams({ url: "https://httpbin.org/get" }),
    );
    expect(result.success).toBe(true);
  });
});
```

### Step 5: Validate

Before submitting, run the full validation suite:

```bash
pnpm validate
```

This runs type checking, tests, and formatting checks in one command.

## Action Guidelines

### Naming

- **Action ID**: kebab-case, 3-50 chars (e.g., `get-token-price`, `send-slack-message`)
- **Name**: Title case, human-readable (e.g., "Get Token Price", "Send Slack Message")
- **Description**: Three-part structure:
  1. Core function (active verb)
  2. Key details (what it returns, constraints)
  3. Use cases ("Ideal for: ...")

### Do

- Keep actions focused — one action, one responsibility
- Use descriptive error codes (`RATE_LIMITED`, `TOKEN_NOT_FOUND`, not `ERROR`)
- Include `exampleUsage` in metadata with realistic sample inputs/outputs
- Add tags that help users discover your action
- Handle edge cases (empty inputs, API errors, timeouts)

### Don't

- Don't bundle multiple unrelated operations in one action
- Don't hardcode secrets or API keys (use connectors)
- Don't use `any` type — use proper types or `unknown`
- Don't execute side effects in `validateInputs()` — validation must be pure
- Don't swallow errors silently — return them via `createErrorResult`

## Schema Guidelines

Schemas use [JSON Schema](https://json-schema.org/) format. Key rules:

- Always set `additionalProperties: false` on both payload and result schemas
- Use `required` array for mandatory fields
- Add `description` to every property — these appear in the B3OS canvas UI
- Use `default` for optional fields with sensible defaults
- Use `enum` for fields with a fixed set of values
- Use `pattern` for string validation (e.g., `"^0x[a-fA-F0-9]{40}$"` for Ethereum addresses)
- Use `minimum`/`maximum` for numeric bounds

### Type mapping

| Data type                | Schema `type`                            | Notes                                                        |
| ------------------------ | ---------------------------------------- | ------------------------------------------------------------ |
| Text                     | `"string"`                               | Default for most fields                                      |
| Number                   | `"number"`                               | Use for prices, counts, etc.                                 |
| Boolean                  | `"boolean"`                              |                                                              |
| Token amounts (on-chain) | `"string"` with `format: "token-amount"` | Always in smallest unit (wei, etc.) — avoids BigInt overflow |

## Error Handling

Use `createErrorResult` for all error paths. You can optionally add structured metadata:

```typescript
// Basic error
return this.createErrorResult("NOT_FOUND", "Token not found");

// Rich error with metadata
return this.createErrorResult("RATE_LIMITED", "API rate limit exceeded", {
  category: "network", // groups errors in the UI
  displayMessage: "Too many requests. Please wait and try again.",
  remediation: "Reduce the workflow trigger frequency to avoid rate limits.",
  retryable: true,
});
```

### Error categories

| Category     | When to use                             |
| ------------ | --------------------------------------- |
| `funds`      | Insufficient balance or funds           |
| `amount`     | Invalid amount (too small, too large)   |
| `config`     | Missing or invalid configuration        |
| `auth`       | Authentication or authorization failure |
| `network`    | Network errors, timeouts, rate limits   |
| `service`    | External service errors                 |
| `onchain`    | Blockchain transaction errors           |
| `validation` | Input validation failures               |
| `internal`   | Unexpected internal errors              |

## Connectors

If your action integrates with a service that requires authentication, declare a connector:

```typescript
super("my-slack-action", {
  // ...
  connector: { type: "slack" },
});
```

At runtime, the B3OS platform resolves the user's connected account and merges credentials into `params.inputs`. Your action reads them like any other input:

```typescript
async execute(params: ActionExecutionParams): Promise<ActionResult> {
  const { botToken, channelId, message } = params.inputs as {
    botToken: string;    // injected by platform from connector
    channelId: string;   // user-provided
    message: string;     // user-provided
  };
  // ...
}
```

You never handle OAuth flows, token storage, or credential management — the platform does that.

## Submitting a Pull Request

1. **Create a branch** from `main`:

   ```bash
   git checkout -b add-my-action
   ```

2. **Make your changes** following the guidelines above.

3. **Run validation**:

   ```bash
   pnpm validate
   ```

4. **Push** and open a PR against `main`.

5. **Fill out the PR template** — especially the action details and test plan.

### PR title format

- Adding a new action: `Add {action-name} action`
- Fixing a bug: `Fix {action-name}: {brief description}`
- Updating SDK: `Update SDK: {brief description}`

## Code Review Process

All contributions go through code review before merging. Here's what reviewers look for:

1. **Correctness** — Does the action do what it claims? Are edge cases handled?
2. **Schema quality** — Are inputs/outputs well-defined with descriptions and constraints?
3. **Test coverage** — Are there tests for the happy path, validation, and error cases?
4. **Security** — No hardcoded secrets, no unsafe operations, proper input validation
5. **Code quality** — TypeScript types, no `any`, clean error handling

Typical turnaround is a few days. We may suggest changes — this is collaborative, not adversarial.

---

Questions? Open a [discussion](https://github.com/b3-fun/b3os/discussions) or ask in the PR.
