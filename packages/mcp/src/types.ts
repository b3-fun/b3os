// ── API Response Wrappers ──

export interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

export interface PaginatedData<T> {
  items: T[];
  limit: number;
  offset: number;
  hasMore: boolean;
}

// ── Organization ──

export interface Organization {
  id: string;
  slug: string;
  name: string;
  description: string;
  photo?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

// ── Wallet ──

export interface Wallet {
  id: string;
  organizationId: string;
  address: string;
  name: string;
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
}

// ── Connector ──

export interface Connector {
  id: string;
  name: string;
  type: string;
  provider?: string;
}

// ── Workflow ──

export interface Workflow {
  id: string;
  version: number;
  organizationId: string;
  name: string;
  description: string;
  status: "draft" | "active" | "paused" | "archived";
  type: string;
  definition: WorkflowDefinition;
  maxRuns: number;
  remainRuns: number;
  cooldownMs: number;
  lastTriggeredAt?: string;
  createdBy?: string;
  createdAt: string;
  updatedBy?: string;
  updatedAt: string;
  hasDraft?: boolean;
  hasLiveVersion?: boolean;
}

export interface WorkflowDefinition {
  nodes: Record<string, WorkflowNode>;
}

export interface WorkflowNode {
  type: string;
  description?: string;
  connector?: { type: string; id?: string };
  payload: Record<string, unknown>;
  children: string[];
  branch?: string;
}

// ── Run ──

export interface ExecutionNode {
  type: string;
  status: "pending" | "running" | "success" | "failure" | "skipped" | "waiting";
  input?: Record<string, unknown>;
  result?: Record<string, unknown>;
  startedAt?: string;
  finishedAt?: string;
}

export interface Run {
  id: string;
  organizationId: string;
  workflowId: string;
  workflowVersion: number;
  status: "running" | "success" | "failure" | "waiting" | "cancelled";
  executionState: Record<string, ExecutionNode>;
  triggerSource?: string;
  triggeredBy?: string;
  startedAt?: string;
  finishedAt?: string;
}

// ── Telegram ──

export interface TelegramChat {
  id: string;
  chatId: number;
  chatType: string;
  chatTitle?: string;
  chatUsername?: string;
  connectorId?: string;
  connectorName?: string;
  verifiedAt: string;
}

// ── Slack ──

export interface SlackChannel {
  id: string;
  name: string;
  is_private?: boolean;
  is_archived?: boolean;
  num_members?: number;
}

// ── Action Test ──

export interface ActionTestResult {
  result?: {
    data?: {
      ret?: Record<string, unknown>;
    };
  };
}

// ── Catalog ──

export interface ActionDefinition {
  type: string;
  name: string;
  description: string;
  payloadSchema: Record<string, unknown>;
  resultSchema: Record<string, unknown>;
  logoUrl: string;
  createdBy: string;
  documentationUrl: string;
  connector?: { type: string };
  category: string;
  tags: string[];
  requiresGas: boolean;
}

export interface TriggerDefinition {
  type: string;
  name: string;
  description: string;
  payloadSchema: Record<string, unknown>;
  resultSchema: Record<string, unknown>;
  logoUrl: string;
  createdBy: string;
  documentationUrl: string;
  connector?: { type: string };
  tags: string[];
}

// ── Search ──

export interface SearchHit {
  id: string;
  type: string;
  name: string;
  description: string;
  category?: string;
  tags?: string[];
  score: number;
}

export interface SearchResults {
  results: SearchHit[];
  totalHits: number;
}
