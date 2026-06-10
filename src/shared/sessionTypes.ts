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

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

export type MessageType =
  | 'user'
  | 'assistant'
  | 'system'
  | 'summary'
  | 'file-history-snapshot'
  | 'queue-operation';

export interface ToolCallInfo {
  id: string;
  name: string;
  input: Record<string, unknown>;
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
  timestamp: string;
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

export interface SessionMetrics {
  durationMs: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  messageCount: number;
  /**
   * Estimated energy use in watt-hours (model-aware, cache-weighted). Grid-intensity
   * independent — convert to carbon in the renderer with the user's intensity. See
   * src/shared/carbon.ts.
   */
  energyWh: number;
}

export const EMPTY_METRICS: SessionMetrics = {
  durationMs: 0,
  totalTokens: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  messageCount: 0,
  energyWh: 0,
};

export interface SessionUpdate {
  sessionId: string;
  taskId: string;
  messages: ParsedSessionMessage[];
  metrics: SessionMetrics;
  isIncremental: boolean;
}

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
