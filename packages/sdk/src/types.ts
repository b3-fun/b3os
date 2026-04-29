/**
 * Action context provided for action execution.
 * Contains userId, organizationId, and other action-specific context.
 */
export interface ActionContext {
  userId: string;
  organizationId?: string;
  [key: string]: unknown;
}

/**
 * Category of action for classification.
 */
export enum ActionCategory {
  EVM_ONCHAIN = "evm-onchain",
  BLOCKCHAIN_DATA = "blockchain-data",
  MESSAGING = "messaging",
  SOCIAL = "social",
  INTEGRATION = "integration",
  UTILITY = "utility",
  WALLET_MANAGEMENT = "wallet-management",
  SOLANA_ONCHAIN = "solana-onchain",
}

/**
 * Execution context provided with each action.
 * Contains user information and request metadata.
 */
export interface ExecutionContext {
  userId: string;
  executionId: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

/**
 * Inputs for action execution.
 */
export interface ActionInputs {
  [key: string]: unknown;
}

/**
 * Category of action error, used for grouping and humanization.
 */
export type ActionErrorCategory =
  | "funds"
  | "amount"
  | "config"
  | "auth"
  | "network"
  | "service"
  | "onchain"
  | "validation"
  | "internal";

export const ACTION_ERROR_CATEGORIES: ReadonlySet<ActionErrorCategory> =
  new Set([
    "funds",
    "amount",
    "config",
    "auth",
    "network",
    "service",
    "onchain",
    "validation",
    "internal",
  ]);

/**
 * Result of an action execution.
 */
export type ActionResult<T = unknown> =
  | {
      success: true;
      data: T;
      executionTime?: number;
      transactionHash?: string;
      metadata?: Record<string, unknown>;
    }
  | {
      success: false;
      error: {
        code: string;
        message: string;
        details?: unknown;
        category?: ActionErrorCategory;
        displayMessage?: string;
        remediation?: string;
        retryable?: boolean;
      };
      executionTime?: number;
    };

/**
 * Parameters for action execution.
 */
export interface ActionExecutionParams {
  context: ExecutionContext;
  inputs: ActionInputs;
  actionContext: ActionContext;
}

/**
 * JSON Schema property definition.
 */
export interface SchemaProperty {
  type?: string | string[];
  description?: string;
  enum?: unknown[];
  enumNames?: string[];
  minimum?: number;
  maximum?: number;
  default?: unknown;
  pattern?: string;
  format?: string;
  exclusiveMaximum?: number;
  oneOf?: Array<{
    type: string;
    description?: string;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

/**
 * JSON Schema definition for action inputs or outputs.
 */
export interface SchemaDefinition {
  type: "object";
  required?: string[];
  properties: {
    [key: string]: SchemaProperty;
  };
  additionalProperties?: boolean;
  anyOf?: Array<{ required: string[] }>;
}

/**
 * Connector requirement for actions that need external credentials.
 *
 * When an action declares a connector requirement, the B3OS platform
 * resolves the user's connected account and injects credentials into
 * the action's inputs at runtime.
 *
 * @example
 * ```typescript
 * connector: { type: "slack" }
 * ```
 */
export interface ConnectorRequirement {
  type: string;
}

/**
 * Comprehensive metadata about an action.
 */
export interface ActionMetadata {
  /** Display name */
  name: string;
  /** What the action does */
  description: string;
  /** JSON Schema for input payload */
  payloadSchema: SchemaDefinition;
  /** JSON Schema for result */
  resultSchema: SchemaDefinition;
  /** Required connector (e.g., slack, discord) */
  connector?: ConnectorRequirement;
  /** Category for organization */
  category?: ActionCategory;
  /** Creator of the action */
  author?: string;
  /** Searchable tags */
  tags?: string[];
  /** Logo URL for the action */
  logoUrl?: string;
  /** Organization or creator attribution */
  createdBy?: string;
  /** External documentation link */
  documentationUrl?: string;
  /** Whether action reads or writes data */
  operationType?: "read" | "write";
  /** Example usage with sample inputs and outputs */
  exampleUsage?: {
    inputs: ActionInputs;
    actionContext?: ActionContext;
    exampleOutput?: unknown;
  };
}

/**
 * Base interface that all actions must implement.
 */
export interface Action {
  /**
   * Unique action identifier used for registration and API routing.
   *
   * **Format Requirements:**
   * - Must use kebab-case (lowercase with hyphens)
   * - Length: 3-50 characters
   * - Characters allowed: a-z, 0-9, and hyphens (-)
   * - Must start and end with a letter or number
   * - Must be unique across all registered actions
   */
  readonly actionId: string;

  /** Metadata about the action */
  readonly metadata: ActionMetadata;

  /** Validate inputs before execution */
  validateInputs(inputs: ActionInputs): Promise<boolean> | boolean;

  /** Execute the action */
  execute(params: ActionExecutionParams): Promise<ActionResult>;

  /** Optional cleanup method called when action is unregistered */
  cleanup?(): Promise<void> | void;
}
