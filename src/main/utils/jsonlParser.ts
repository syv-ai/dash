import type {
  ContentBlock,
  MessageType,
  ParsedSessionMessage,
  SessionMetrics,
  ToolCallInfo,
  ToolResultInfo,
  TokenUsage,
} from '../../shared/sessionTypes';

// =============================================================================
// Path Encoding
// =============================================================================

/**
 * Encode an absolute path to the format Claude Code uses for project directories.
 * e.g. /Users/foo/bar → -Users-foo-bar
 */
export function encodeProjectPath(absolutePath: string): string {
  return absolutePath.replace(/\//g, '-');
}

// =============================================================================
// Tool Extraction
// =============================================================================

export function extractToolCalls(content: ContentBlock[] | string): ToolCallInfo[] {
  if (typeof content === 'string') return [];

  const toolCalls: ToolCallInfo[] = [];
  for (const block of content) {
    if (block.type === 'tool_use' && block.id && block.name) {
      toolCalls.push({
        id: block.id,
        name: block.name,
        input: block.input ?? {},
        isTask: block.name === 'Task' || block.name === 'Agent',
      });
    }
  }
  return toolCalls;
}

export function extractToolResults(content: ContentBlock[] | string): ToolResultInfo[] {
  if (typeof content === 'string') return [];

  const results: ToolResultInfo[] = [];
  for (const block of content) {
    if (block.type === 'tool_result' && block.tool_use_id) {
      results.push({
        toolUseId: block.tool_use_id,
        content: block.content ?? '',
        isError: block.is_error ?? false,
      });
    }
  }
  return results;
}

// =============================================================================
// Line Parsing
// =============================================================================

const VALID_TYPES = new Set<MessageType>([
  'user',
  'assistant',
  'system',
  'summary',
  'file-history-snapshot',
  'queue-operation',
]);

interface ChatHistoryEntry {
  uuid?: string;
  parentUuid?: string;
  type?: string;
  timestamp?: string;
  message?: {
    role?: string;
    content?: ContentBlock[] | string;
    usage?: TokenUsage;
    model?: string;
  };
  cwd?: string;
  gitBranch?: string;
  agentId?: string;
  isSidechain?: boolean;
  isMeta?: boolean;
  requestId?: string;
  userType?: string;
}

/**
 * Parse a single JSONL line into a ParsedSessionMessage.
 * Returns null for invalid or unsupported entries.
 */
export function parseJsonlLine(line: string): ParsedSessionMessage | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let entry: ChatHistoryEntry;
  try {
    entry = JSON.parse(trimmed);
  } catch {
    return null;
  }

  if (!entry.uuid) return null;

  const type = entry.type as MessageType;
  if (!VALID_TYPES.has(type)) return null;

  let content: ContentBlock[] | string = '';
  let role: string | undefined;
  let usage: TokenUsage | undefined;
  let model: string | undefined;

  if (entry.type === 'user' || entry.type === 'assistant') {
    content = entry.message?.content ?? '';
    role = entry.message?.role;
    if (entry.type === 'assistant') {
      usage = entry.message?.usage;
      model = entry.message?.model;
    }
  }

  const toolCalls = extractToolCalls(content);
  const toolResults = extractToolResults(content);

  return {
    uuid: entry.uuid,
    parentUuid: entry.parentUuid ?? null,
    type,
    timestamp: entry.timestamp ?? new Date().toISOString(),
    role,
    content,
    usage,
    model,
    cwd: entry.cwd,
    gitBranch: entry.gitBranch,
    agentId: entry.agentId,
    isSidechain: entry.isSidechain ?? false,
    isMeta: entry.isMeta ?? false,
    toolCalls,
    toolResults,
    requestId: entry.requestId,
  };
}

// =============================================================================
// Deduplication
// =============================================================================

/**
 * Deduplicate streaming assistant entries by requestId.
 * Claude Code writes multiple entries per API response during streaming,
 * each with the same requestId. Only the last entry per requestId has final token counts.
 */
export function deduplicateByRequestId(messages: ParsedSessionMessage[]): ParsedSessionMessage[] {
  const lastIndexByRequestId = new Map<string, number>();
  for (let i = 0; i < messages.length; i++) {
    const rid = messages[i].requestId;
    if (rid) {
      lastIndexByRequestId.set(rid, i);
    }
  }

  if (lastIndexByRequestId.size === 0) return messages;

  return messages.filter((msg, i) => {
    if (!msg.requestId) return true;
    return lastIndexByRequestId.get(msg.requestId) === i;
  });
}

// =============================================================================
// Metrics Calculation
// =============================================================================

const EMPTY_METRICS: SessionMetrics = {
  durationMs: 0,
  totalTokens: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  messageCount: 0,
};

export function calculateMetrics(messages: ParsedSessionMessage[]): SessionMetrics {
  if (messages.length === 0) return { ...EMPTY_METRICS };

  const deduped = deduplicateByRequestId(messages);

  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;

  const timestamps = messages.map((m) => new Date(m.timestamp).getTime()).filter((t) => !isNaN(t));

  let minTime = 0;
  let maxTime = 0;
  if (timestamps.length > 0) {
    minTime = timestamps[0];
    maxTime = timestamps[0];
    for (let i = 1; i < timestamps.length; i++) {
      if (timestamps[i] < minTime) minTime = timestamps[i];
      if (timestamps[i] > maxTime) maxTime = timestamps[i];
    }
  }

  for (const msg of deduped) {
    if (msg.usage) {
      inputTokens += msg.usage.input_tokens ?? 0;
      outputTokens += msg.usage.output_tokens ?? 0;
      cacheReadTokens += msg.usage.cache_read_input_tokens ?? 0;
    }
  }

  return {
    durationMs: maxTime - minTime,
    totalTokens: inputTokens + cacheReadTokens + outputTokens,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    messageCount: messages.length,
  };
}
