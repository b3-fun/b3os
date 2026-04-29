import {
  Action,
  ActionExecutionParams,
  ActionResult,
  SchemaDefinition,
  SchemaProperty,
} from "./types";

/**
 * Registry for managing and executing B3OS actions.
 *
 * @example
 * ```typescript
 * const registry = new ActionRegistry();
 * registry.register(new HelloWorldAction());
 * registry.register(new GenerateIdAction());
 *
 * const result = await registry.execute("hello-world", {
 *   context: { userId: "user-1", executionId: "exec-1", timestamp: new Date() },
 *   inputs: { name: "B3OS" },
 *   actionContext: { userId: "user-1" },
 * });
 * ```
 */
export class ActionRegistry {
  private actions: Map<string, Action> = new Map();

  /** Register a new action */
  public register(action: Action): void {
    if (this.actions.has(action.actionId)) {
      throw new Error(
        `Action with id "${action.actionId}" is already registered`,
      );
    }
    this.actions.set(action.actionId, action);
  }

  /** Unregister an action */
  public unregister(actionId: string): boolean {
    const action = this.actions.get(actionId);
    if (action?.cleanup) {
      action.cleanup();
    }
    return this.actions.delete(actionId);
  }

  /** Get an action by ID */
  public get(actionId: string): Action | undefined {
    return this.actions.get(actionId);
  }

  /** Get all registered actions */
  public getAll(): Action[] {
    return Array.from(this.actions.values());
  }

  /** Get all registered action IDs */
  public getAllIds(): string[] {
    return Array.from(this.actions.keys());
  }

  /** Check if an action is registered */
  public has(actionId: string): boolean {
    return this.actions.has(actionId);
  }

  /** Execute an action by ID */
  public async execute(
    actionId: string,
    params: ActionExecutionParams,
  ): Promise<ActionResult> {
    const action = this.actions.get(actionId);

    if (!action) {
      return {
        success: false,
        error: {
          code: "ACTION_NOT_FOUND",
          message: `Action "${actionId}" not found`,
        },
      };
    }

    try {
      // Coerce input types based on schema before validation
      const coercedInputs = this.coerceInputTypes(
        params.inputs,
        action.metadata.payloadSchema,
      );

      const inputsValid = await action.validateInputs(coercedInputs);

      if (!inputsValid) {
        return {
          success: false,
          error: {
            code: "INVALID_INPUTS",
            message: "Input validation failed",
          },
        };
      }

      const startTime = Date.now();
      const result = await action.execute({
        ...params,
        inputs: coercedInputs,
      });
      const executionTime = Date.now() - startTime;

      return {
        ...result,
        executionTime,
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: "EXECUTION_ERROR",
          message:
            error instanceof Error ? error.message : "Unknown error occurred",
          details: error,
        },
      };
    }
  }

  /** Clear all registered actions */
  public clear(): void {
    this.actions.forEach((action) => {
      if (action.cleanup) {
        action.cleanup();
      }
    });
    this.actions.clear();
  }

  /** Get registry statistics */
  public getStats(): {
    totalActions: number;
    categories: Record<string, number>;
  } {
    const categories: Record<string, number> = {};
    for (const action of this.actions.values()) {
      const category = action.metadata.category || "uncategorized";
      categories[category] = (categories[category] || 0) + 1;
    }
    return {
      totalActions: this.actions.size,
      categories,
    };
  }

  /**
   * Coerce input types based on action schema before validation.
   * Handles common mismatches (e.g., number passed as string or vice versa).
   */
  private coerceInputTypes(
    inputs: Record<string, unknown>,
    schema: SchemaDefinition,
  ): Record<string, unknown> {
    const properties = schema.properties;
    if (!properties) return inputs;

    const coerced = { ...inputs };
    for (const [key, value] of Object.entries(coerced)) {
      const propSchema: SchemaProperty | undefined = properties[key];
      if (!propSchema || value === undefined || value === null) continue;

      const expectedType = propSchema.type;
      if (typeof expectedType !== "string") continue;

      if (expectedType === "string" && typeof value === "number") {
        coerced[key] = String(value);
      }
      if (expectedType === "string" && typeof value === "boolean") {
        coerced[key] = String(value);
      }
      if (expectedType === "number" && typeof value === "string") {
        const num = Number(value);
        if (!isNaN(num)) coerced[key] = num;
      }
    }
    return coerced;
  }
}
