import { BaseAction } from "../../packages/sdk/src/base-action";
import { ActionCategory } from "../../packages/sdk/src/types";
import type {
  ActionExecutionParams,
  ActionResult,
} from "../../packages/sdk/src/types";
import { payloadSchema, resultSchema } from "./schema";

/**
 * HelloWorldAction
 *
 * The simplest possible B3OS action. Use this as a starting point
 * when creating your own actions.
 *
 * @example
 * ```typescript
 * const result = await action.execute({
 *   context: { userId: "user-1", executionId: "exec-1", timestamp: new Date() },
 *   inputs: { name: "B3OS" },
 *   actionContext: { userId: "user-1" },
 * });
 * // { success: true, data: { message: "Hello, B3OS!", timestamp: "2026-..." } }
 * ```
 */
export class HelloWorldAction extends BaseAction {
  constructor() {
    super("hello-world", {
      name: "Hello World",
      description:
        "A simple greeting action. Returns a personalized hello message. " +
        "Use this as a template when building your first B3OS action.",
      payloadSchema,
      resultSchema,
      category: ActionCategory.UTILITY,
      author: "B3OS",
      tags: ["example", "starter", "greeting"],
      createdBy: "b3os",
      operationType: "read",
      exampleUsage: {
        inputs: { name: "B3OS" },
        actionContext: { userId: "user-1" },
        exampleOutput: {
          message: "Hello, B3OS!",
          timestamp: "2026-01-01T00:00:00.000Z",
        },
      },
    });
  }

  public async execute(params: ActionExecutionParams): Promise<ActionResult> {
    const { name = "World" } = params.inputs as { name?: string };

    return this.createSuccessResult({
      message: `Hello, ${name}!`,
      timestamp: new Date().toISOString(),
    });
  }
}
