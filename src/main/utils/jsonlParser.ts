import { computeEnergyFromMessages } from '../../shared/carbon';
import {
  EMPTY_METRICS,
  type ContentBlock,
  type MessageType,
  type ParsedSessionMessage,
  type SessionMetrics,
  type ToolCallInfo,
  type ToolResultInfo,
  type TokenUsage,
} from '../../shared/sessionTypes';

/**
 * Encode a cwd to the directory name Claude Code uses under ~/.claude/projects/.
 * macOS/Linux: only `/` is a path separator, so just hyphenate it.
 * Windows: replace `\`, `/`, AND the drive-letter colon — `C:\Users\foo` becomes
 * `C--Users-foo`. (POSIX paths can technically contain `:`, but stripping it on
 * non-Windows would diverge from Claude Code's encoding for those edge cases.)
 */
export function encodeProjectPath(absolutePath: string): string {
  if (process.platform === 'win32') {
    return absolutePath.replace(/[\\/:]/g, '-');
  }
  return absolutePath.replace(/\//g, '-');
}

export function extractToolCalls(content: ContentBlock[] | string): ToolCallInfo[] {
  if (typeof content === 'string') return [];

  const toolCalls: ToolCallInfo[] = [];
  for (const block of content) {
    if (block.type === 'tool_use' && block.id && block.name) {
      toolCalls.push({
        id: block.id,
        name: block.name,
        input: block.input ?? {},
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

const VALID_TYPES = new Set<MessageType>([
  'user',
  'assistant',
  'system',
  'summary',
  'file-history-snapshot',
  'queue-operation',
]);

/** Tracks unknown entry types we've already warned about so a Claude Code
 *  schema change is logged once per session, not on every line. */
const warnedUnknownTypes = new Set<string>();

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

export function parseJsonlLine(line: string): ParsedSessionMessage | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let entry: ChatHistoryEntry;
  try {
    entry = JSON.parse(trimmed);
  } catch (err) {
    // Lines that look JSON-shaped but fail to parse are likely a real bug
    // (interrupted writes). Lines that are obviously not JSON are common
    // (trailing newlines etc.) and not worth surfacing.
    if (trimmed.startsWith('{')) {
      console.warn('[jsonlParser] failed to parse JSON-shaped line', { err });
    }
    return null;
  }

  if (!entry.uuid) return null;

  const type = entry.type as MessageType;
  if (!VALID_TYPES.has(type)) {
    if (entry.type && !warnedUnknownTypes.has(entry.type)) {
      warnedUnknownTypes.add(entry.type);
      console.warn('[jsonlParser] unknown entry type — Claude Code schema may have changed', {
        type: entry.type,
      });
    }
    return null;
  }

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

/**
 * Claude Code streams multiple assistant entries per API response, all sharing
 * one requestId. Only the last entry has final token counts — keep that one.
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

/** Caller is expected to pass already-deduped messages (see {@link deduplicateByRequestId}). */
export function calculateMetrics(messages: ParsedSessionMessage[]): SessionMetrics {
  if (messages.length === 0) return { ...EMPTY_METRICS };

  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let minTime = Infinity;
  let maxTime = -Infinity;

  for (const msg of messages) {
    const t = new Date(msg.timestamp).getTime();
    if (!isNaN(t)) {
      if (t < minTime) minTime = t;
      if (t > maxTime) maxTime = t;
    }
    if (msg.usage) {
      inputTokens += msg.usage.input_tokens ?? 0;
      outputTokens += msg.usage.output_tokens ?? 0;
      cacheReadTokens += msg.usage.cache_read_input_tokens ?? 0;
    }
  }

  return {
    durationMs: maxTime > minTime ? maxTime - minTime : 0,
    totalTokens: inputTokens + cacheReadTokens + outputTokens,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    messageCount: messages.length,
    energyWh: computeEnergyFromMessages(messages).energyWh,
  };
}
