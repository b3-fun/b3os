import { BaseAction } from "../../src/base-action";
import { ActionCategory } from "../../src/types";
import type {
  ActionExecutionParams,
  ActionInputs,
  ActionResult,
} from "../../src/types";
import { payloadSchema, resultSchema } from "./schema";

const ALPHANUMERIC_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

/**
 * GenerateIdAction
 *
 * Generates unique identifiers in various formats:
 * - **UUID v4**: Standard 36-character UUID using `crypto.randomUUID()`
 * - **Short ID**: Alphanumeric string of customizable length (4-32 chars)
 *
 * @example
 * ```typescript
 * // Generate UUID
 * const result = await action.execute({
 *   context: { userId: "user-1", executionId: "exec-1", timestamp: new Date() },
 *   inputs: { format: "uuid" },
 *   actionContext: { userId: "user-1" },
 * });
 * // { success: true, data: { id: "550e8400-e29b-41d4-a716-446655440000", format: "uuid" } }
 *
 * // Generate short ID
 * const result = await action.execute({
 *   context: { userId: "user-1", executionId: "exec-1", timestamp: new Date() },
 *   inputs: { format: "shortid", length: 12 },
 *   actionContext: { userId: "user-1" },
 * });
 * // { success: true, data: { id: "a7b3x9k2m4n1", format: "shortid" } }
 * ```
 */
export class GenerateIdAction extends BaseAction {
  constructor() {
    super("generate-id", {
      name: "Generate ID",
      description:
        "Generate unique identifiers (UUID or short ID). " +
        "UUID is standard 36-char format. Short ID is alphanumeric and customizable length. " +
        "Ideal for: order IDs, reference codes, tracking numbers, unique keys.",
      payloadSchema,
      resultSchema,
      category: ActionCategory.UTILITY,
      author: "B3OS",
      tags: ["generator", "random", "string", "id"],
      createdBy: "b3os",
      operationType: "read",
      exampleUsage: {
        inputs: { format: "uuid" },
        actionContext: { userId: "user-1" },
        exampleOutput: {
          id: "550e8400-e29b-41d4-a716-446655440000",
          format: "uuid",
        },
      },
    });
  }

  public validateInputs(inputs: ActionInputs): boolean {
    if (!super.validateInputs(inputs)) {
      return false;
    }

    const format = inputs.format as string | undefined;
    const length = inputs.length as number | undefined;

    if (format !== undefined && format !== "uuid" && format !== "shortid") {
      return false;
    }

    if (length !== undefined) {
      if (typeof length !== "number" || length < 4 || length > 32) {
        return false;
      }
    }

    return true;
  }

  /**
   * Generate a cryptographically secure short ID.
   * Uses rejection sampling to avoid modulo bias.
   */
  private generateShortId(length: number): string {
    const alphabetSize = ALPHANUMERIC_CHARS.length;
    const mask = (2 << (Math.log(alphabetSize - 1) / Math.LN2)) - 1;
    const step = Math.ceil((1.6 * mask * length) / alphabetSize);

    let result = "";
    const randomBytes = new Uint8Array(step);

    while (result.length < length) {
      crypto.getRandomValues(randomBytes);
      for (let i = 0; i < step && result.length < length; i++) {
        const byte = randomBytes[i] & mask;
        if (byte < alphabetSize) {
          result += ALPHANUMERIC_CHARS[byte];
        }
      }
    }

    return result;
  }

  public async execute(params: ActionExecutionParams): Promise<ActionResult> {
    const { format = "uuid", length = 8 } = params.inputs as {
      format?: "uuid" | "shortid";
      length?: number;
    };

    try {
      const id =
        format === "uuid" ? crypto.randomUUID() : this.generateShortId(length);

      return this.createSuccessResult({ id, format });
    } catch (error) {
      return this.createErrorResult(
        "ID_GENERATION_ERROR",
        error instanceof Error ? error.message : "Failed to generate ID",
        error,
      );
    }
  }
}
