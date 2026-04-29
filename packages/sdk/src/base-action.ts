import {
  ACTION_ERROR_CATEGORIES,
  Action,
  ActionErrorCategory,
  ActionExecutionParams,
  ActionInputs,
  ActionMetadata,
  ActionResult,
} from "./types";

/**
 * Optional rich-error metadata accepted by `createErrorResult`.
 */
interface ErrorExtras {
  category?: ActionErrorCategory;
  displayMessage?: string;
  remediation?: string;
  retryable?: boolean;
  details?: unknown;
}

/**
 * Abstract base class for B3OS actions.
 *
 * Extend this class to create a new action. You must implement the
 * `execute` method and provide metadata via the constructor.
 *
 * ## Action ID Requirements
 *
 * The `actionId` is a unique identifier used to register and route requests to your action.
 *
 * **Format:**
 * - Kebab-case (lowercase with hyphens)
 * - 3-50 characters long
 * - Only lowercase letters, numbers, and hyphens
 * - Must start and end with a letter or number
 *
 * @example
 * ```typescript
 * export class MyAction extends BaseAction {
 *   constructor() {
 *     super("my-action", {
 *       name: "My Action",
 *       description: "Does something useful",
 *       payloadSchema,
 *       resultSchema,
 *       category: ActionCategory.UTILITY,
 *     });
 *   }
 *
 *   async execute(params: ActionExecutionParams): Promise<ActionResult> {
 *     const { myInput } = params.inputs as { myInput: string };
 *     return this.createSuccessResult({ output: myInput.toUpperCase() });
 *   }
 * }
 * ```
 */
export abstract class BaseAction implements Action {
  public readonly actionId: string;
  public readonly metadata: ActionMetadata;

  constructor(actionId: string, metadata: ActionMetadata) {
    this.validateActionId(actionId);
    this.actionId = actionId;
    this.metadata = metadata;
  }

  private validateActionId(actionId: string): void {
    if (!actionId || typeof actionId !== "string") {
      throw new Error("actionId must be a non-empty string");
    }

    if (actionId.length < 3 || actionId.length > 50) {
      throw new Error(
        `actionId "${actionId}" must be between 3 and 50 characters long. Current length: ${actionId.length}`,
      );
    }

    const kebabCaseRegex = /^[a-z0-9]+(-[a-z0-9]+)*$/;
    if (!kebabCaseRegex.test(actionId)) {
      throw new Error(
        `actionId "${actionId}" must be in kebab-case format (lowercase letters, numbers, and hyphens only). ` +
          `Must start and end with a letter or number. ` +
          `Examples: "send-token", "swap-tokens", "get-balance"`,
      );
    }

    if (actionId.includes("--")) {
      throw new Error(
        `actionId "${actionId}" cannot contain consecutive hyphens`,
      );
    }
  }

  /**
   * Default input validation. Override in subclasses for custom validation.
   * Checks required fields from the payload schema.
   */
  public validateInputs(inputs: ActionInputs): boolean {
    if (typeof inputs !== "object" || inputs === null) {
      return false;
    }

    const required = this.metadata.payloadSchema?.required;
    if (required && required.length > 0) {
      for (const field of required) {
        if (!(field in inputs)) {
          return false;
        }
      }
    }

    return true;
  }

  /** Must be implemented by subclasses */
  public abstract execute(params: ActionExecutionParams): Promise<ActionResult>;

  /** Optional cleanup — override in subclasses */
  public cleanup?(): void | Promise<void>;

  /**
   * Create an error result with optional rich metadata.
   *
   * @param code - Error code (e.g., "INVALID_INPUT", "API_ERROR")
   * @param message - Human-readable error message
   * @param detailsOrExtras - Either raw details or an extras object with
   *   `category`, `displayMessage`, `remediation`, `retryable`, and/or `details`
   */
  protected createErrorResult(
    code: string,
    message: string,
    detailsOrExtras?: unknown | ErrorExtras,
  ): ActionResult<never> {
    const extras = isExtrasObject(detailsOrExtras)
      ? detailsOrExtras
      : undefined;
    const legacyDetails = extras ? extras.details : detailsOrExtras;

    return {
      success: false,
      error: {
        code,
        message,
        ...(legacyDetails !== undefined && { details: legacyDetails }),
        ...(extras?.category && { category: extras.category }),
        ...(extras?.displayMessage && {
          displayMessage: extras.displayMessage,
        }),
        ...(extras?.remediation && { remediation: extras.remediation }),
        ...(extras?.retryable !== undefined && { retryable: extras.retryable }),
      },
    };
  }

  /** Create a success result */
  protected createSuccessResult<T>(
    data: T,
    metadata?: Record<string, unknown>,
  ): ActionResult<T> {
    return {
      success: true,
      data,
      metadata,
    };
  }
}

function isExtrasObject(value: unknown): value is ErrorExtras {
  if (value === null || value === undefined) return false;
  if (typeof value !== "object") return false;
  if (Array.isArray(value)) return false;
  if (value instanceof Error) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.stack === "string") return false;
  if (typeof v.name === "string" && typeof v.message === "string") return false;
  const hasCanonicalCategory =
    typeof v.category === "string" &&
    ACTION_ERROR_CATEGORIES.has(v.category as ActionErrorCategory);
  return (
    hasCanonicalCategory ||
    typeof v.displayMessage === "string" ||
    typeof v.remediation === "string" ||
    typeof v.retryable === "boolean"
  );
}
