// =============================================================================
// Content Blocks (from Claude Code JSONL entries)
// =============================================================================

export interface TextContent {
  type: 'text';
  text: string;
}

export interface ThinkingContent {
  type: 'thinking';
  thinking: string;
}

export interface ToolUseContent {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultContent {
  type: 'tool_result';
  tool_use_id: string;
  content: string | ContentBlock[];
  is_error?: boolean;
}

export interface ImageContent {
  type: 'image';
  source: Record<string, unknown>;
}

export type ContentBlock =
  | TextContent
  | ThinkingContent
  | ToolUseContent
  | ToolResultContent
  | ImageContent;

// =============================================================================
// Token Usage
// =============================================================================

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

// =============================================================================
// Message Types
// =============================================================================

export type MessageType =
  | 'user'
  | 'assistant'
  | 'system'
  | 'summary'
  | 'file-history-snapshot'
  | 'queue-operation';

// =============================================================================
// Parsed Session Message (sent over IPC)
// =============================================================================

export interface ToolCallInfo {
  id: string;
  name: string;
  input: Record<string, unknown>;
  isTask: boolean;
}

export interface ToolResultInfo {
  toolUseId: string;
  content: string | ContentBlock[];
  isError: boolean;
}

export interface ParsedSessionMessage {
  uuid: string;
  parentUuid: string | null;
  type: MessageType;
  timestamp: string; // ISO string for IPC serialization
  role?: string;
  content: ContentBlock[] | string;
  usage?: TokenUsage;
  model?: string;
  cwd?: string;
  gitBranch?: string;
  agentId?: string;
  isSidechain: boolean;
  isMeta: boolean;
  toolCalls: ToolCallInfo[];
  toolResults: ToolResultInfo[];
  requestId?: string;
}

// =============================================================================
// Session Metrics
// =============================================================================

export interface SessionMetrics {
  durationMs: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  messageCount: number;
}

// =============================================================================
// Session Update (pushed to renderer via IPC)
// =============================================================================

export interface SessionUpdate {
  sessionId: string;
  taskId: string;
  messages: ParsedSessionMessage[];
  metrics: SessionMetrics;
  isIncremental: boolean;
}

// =============================================================================
// Display types (used in renderer for grouping)
// =============================================================================

export interface LinkedToolExecution {
  toolCall: ToolCallInfo;
  result?: ToolResultInfo;
  startTime: string;
  endTime?: string;
  durationMs?: number;
}

export interface AssistantTurnData {
  id: string;
  thinkingBlocks: string[];
  textOutput: string;
  toolExecutions: LinkedToolExecution[];
  usage?: TokenUsage;
  model?: string;
  timestamp: string;
}

export type DisplayItem =
  | { type: 'user'; message: ParsedSessionMessage }
  | { type: 'assistant-turn'; turn: AssistantTurnData };
