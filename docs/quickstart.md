# Quickstart: Build Your First B3OS Action

This guide walks you through creating a B3OS action from scratch in about 5 minutes.

## Prerequisites

- Node.js 20+
- Git

## Setup

```bash
git clone https://github.com/b3-fun/b3os.git
cd b3os
npm install
```

## What you'll build

A `reverse-string` action that takes a string and returns it reversed. Simple, but it covers every concept you need.

## Step 1: Create the directory

```bash
mkdir -p actions/reverse-string
```

## Step 2: Define the schema

The schema tells B3OS what your action accepts and returns.

```typescript
// actions/reverse-string/schema.ts
import type { SchemaDefinition } from "../../src/types";

export const payloadSchema: SchemaDefinition = {
  type: "object",
  required: ["text"],
  properties: {
    text: {
      type: "string",
      description: "The text to reverse",
    },
  },
  additionalProperties: false,
};

export const resultSchema: SchemaDefinition = {
  type: "object",
  required: ["reversed"],
  properties: {
    reversed: {
      type: "string",
      description: "The reversed text",
    },
    length: {
      type: "number",
      description: "Character count of the input",
    },
  },
  additionalProperties: false,
};
```

## Step 3: Implement the action

```typescript
// actions/reverse-string/execute.ts
import { BaseAction } from "../../src/base-action";
import { ActionCategory } from "../../src/types";
import type { ActionExecutionParams, ActionResult } from "../../src/types";
import { payloadSchema, resultSchema } from "./schema";

export class ReverseStringAction extends BaseAction {
  constructor() {
    super("reverse-string", {
      name: "Reverse String",
      description:
        "Reverse a text string. " +
        "Returns the reversed string and its length. " +
        "Ideal for: text manipulation, encoding, fun utilities.",
      payloadSchema,
      resultSchema,
      category: ActionCategory.UTILITY,
      author: "your-username",
      tags: ["string", "text", "reverse"],
      createdBy: "your-username",
      operationType: "read",
      exampleUsage: {
        inputs: { text: "hello" },
        exampleOutput: { reversed: "olleh", length: 5 },
      },
    });
  }

  async execute(params: ActionExecutionParams): Promise<ActionResult> {
    const { text } = params.inputs as { text: string };

    const reversed = text.split("").reverse().join("");

    return this.createSuccessResult({
      reversed,
      length: text.length,
    });
  }
}
```

## Step 4: Add the re-export

```typescript
// actions/reverse-string/index.ts
export { ReverseStringAction } from "./execute";
```

## Step 5: Write a test

```typescript
// actions/reverse-string/reverse-string.test.ts
import { describe, expect, it } from "vitest";
import { ReverseStringAction } from "./execute";

const makeParams = (inputs: Record<string, unknown>) => ({
  context: {
    userId: "test-user",
    executionId: "test-1",
    timestamp: new Date(),
  },
  inputs,
  actionContext: { userId: "test-user" },
});

describe("ReverseStringAction", () => {
  const action = new ReverseStringAction();

  it("reverses a string", async () => {
    const result = await action.execute(makeParams({ text: "hello" }));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.reversed).toBe("olleh");
      expect(result.data.length).toBe(5);
    }
  });

  it("handles empty string", async () => {
    const result = await action.execute(makeParams({ text: "" }));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.reversed).toBe("");
    }
  });

  it("requires text input", () => {
    expect(action.validateInputs({})).toBe(false);
    expect(action.validateInputs({ text: "hello" })).toBe(true);
  });
});
```

## Step 6: Run it

```bash
# Run just your test
npx vitest run actions/reverse-string

# Run all tests
npm test

# Full validation
npm run validate
```

## What's next?

- Read the [CONTRIBUTING.md](../CONTRIBUTING.md) for the full contribution guide
- Browse [existing actions](../actions/) for more examples
- Look at the [action types](../src/types.ts) for the complete API reference
- Open a PR with your action!
