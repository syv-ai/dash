import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { Loader2, ArrowDown } from 'lucide-react';
import type {
  ParsedSessionMessage,
  SessionMetrics,
  SessionUpdate,
  DisplayItem,
  AssistantTurnData,
  LinkedToolExecution,
  ToolResultInfo,
  ContentBlock,
} from '../../../shared/sessionTypes';
import { SessionMetricsBar } from './SessionMetricsBar';
import { AssistantTurn } from './AssistantTurn';

// =============================================================================
// Message Grouping Logic
// =============================================================================

function extractText(content: ContentBlock[] | string): string {
  if (typeof content === 'string') return content;
  return content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

function extractThinking(content: ContentBlock[] | string): string[] {
  if (typeof content === 'string') return [];
  return content
    .filter((b): b is { type: 'thinking'; thinking: string } => b.type === 'thinking')
    .map((b) => b.thinking);
}

function buildDisplayItems(messages: ParsedSessionMessage[]): DisplayItem[] {
  // Build a map of tool_use_id -> ToolResultInfo from user messages carrying tool results
  const resultMap = new Map<string, { result: ToolResultInfo; timestamp: string }>();
  for (const msg of messages) {
    if (msg.type === 'user' && msg.toolResults.length > 0) {
      for (const tr of msg.toolResults) {
        resultMap.set(tr.toolUseId, { result: tr, timestamp: msg.timestamp });
      }
    }
  }

  const items: DisplayItem[] = [];
  let currentTurn: AssistantTurnData | null = null;

  function flushTurn() {
    if (currentTurn) {
      items.push({ type: 'assistant-turn', turn: currentTurn });
      currentTurn = null;
    }
  }

  for (const msg of messages) {
    // Skip noise types
    if (
      msg.type === 'system' ||
      msg.type === 'summary' ||
      msg.type === 'file-history-snapshot' ||
      msg.type === 'queue-operation'
    ) {
      continue;
    }

    // Skip sidechain messages
    if (msg.isSidechain) continue;

    // Skip isMeta user messages (tool result carriers)
    if (msg.type === 'user' && msg.isMeta) continue;

    // Real user message
    if (msg.type === 'user' && !msg.isMeta) {
      flushTurn();
      // Filter out user messages that are just system noise
      const text = extractText(msg.content);
      const cleaned = text
        .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
        .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, '')
        .replace(/<local-command-stdout>[\s\S]*?<\/local-command-stdout>/g, '')
        .replace(/<command-name>[\s\S]*?<\/command-name>/g, '')
        .replace(/<command-message>[\s\S]*?<\/command-message>/g, '')
        .replace(/<command-args>[\s\S]*?<\/command-args>/g, '')
        .trim();
      if (cleaned) {
        items.push({ type: 'user', message: msg });
      }
      continue;
    }

    // Assistant message
    if (msg.type === 'assistant') {
      // Skip synthetic messages
      if (msg.model === '<synthetic>') continue;

      if (!currentTurn) {
        currentTurn = {
          id: msg.uuid,
          thinkingBlocks: [],
          textOutput: '',
          toolExecutions: [],
          usage: msg.usage,
          model: msg.model,
          timestamp: msg.timestamp,
        };
      } else if (msg.usage) {
        // Accumulate usage
        if (currentTurn.usage) {
          currentTurn.usage = {
            input_tokens: (currentTurn.usage.input_tokens ?? 0) + (msg.usage.input_tokens ?? 0),
            output_tokens: (currentTurn.usage.output_tokens ?? 0) + (msg.usage.output_tokens ?? 0),
            cache_read_input_tokens:
              (currentTurn.usage.cache_read_input_tokens ?? 0) +
              (msg.usage.cache_read_input_tokens ?? 0),
            cache_creation_input_tokens:
              (currentTurn.usage.cache_creation_input_tokens ?? 0) +
              (msg.usage.cache_creation_input_tokens ?? 0),
          };
        } else {
          currentTurn.usage = msg.usage;
        }
      }

      // Extract thinking
      const thinking = extractThinking(msg.content);
      currentTurn.thinkingBlocks.push(...thinking);

      // Extract text output
      const text = extractText(msg.content);
      if (text.trim()) {
        if (currentTurn.textOutput) currentTurn.textOutput += '\n';
        currentTurn.textOutput += text;
      }

      // Extract tool executions
      for (const tc of msg.toolCalls) {
        const linked = resultMap.get(tc.id);
        const exec: LinkedToolExecution = {
          toolCall: tc,
          result: linked?.result,
          startTime: msg.timestamp,
          endTime: linked?.timestamp,
          durationMs: linked?.timestamp
            ? new Date(linked.timestamp).getTime() - new Date(msg.timestamp).getTime()
            : undefined,
        };
        currentTurn.toolExecutions.push(exec);
      }
    }
  }

  flushTurn();
  return items;
}

// =============================================================================
// Component
// =============================================================================

const EMPTY_METRICS: SessionMetrics = {
  durationMs: 0,
  totalTokens: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  messageCount: 0,
};

interface StructuredViewProps {
  taskId: string;
  taskPath: string;
}

export function StructuredView({ taskId, taskPath }: StructuredViewProps) {
  const [messages, setMessages] = useState<ParsedSessionMessage[]>([]);
  const [metrics, setMetrics] = useState<SessionMetrics>(EMPTY_METRICS);
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [showScrollButton, setShowScrollButton] = useState(false);

  // Start/stop watching
  useEffect(() => {
    setLoading(true);
    window.electronAPI.sessionWatch({ taskId, taskPath });

    // Load initial data
    window.electronAPI.sessionGetMessages(taskId).then((res) => {
      if (res.success && res.data) {
        setMessages(res.data.messages);
        setMetrics(res.data.metrics);
      }
      setLoading(false);
    });

    return () => {
      window.electronAPI.sessionUnwatch(taskId);
    };
  }, [taskId, taskPath]);

  // Subscribe to incremental updates
  useEffect(() => {
    const cleanup = window.electronAPI.onSessionUpdate((update: SessionUpdate) => {
      if (update.taskId !== taskId) return;

      if (update.isIncremental) {
        setMessages((prev) => [...prev, ...update.messages]);
      } else {
        setMessages(update.messages);
      }
      setMetrics(update.metrics);
      setLoading(false);
    });

    return cleanup;
  }, [taskId]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, autoScroll]);

  // Track scroll position
  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const atBottom = scrollHeight - scrollTop - clientHeight < 50;
    setAutoScroll(atBottom);
    setShowScrollButton(!atBottom);
  }, []);

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      setAutoScroll(true);
      setShowScrollButton(false);
    }
  }, []);

  // Build display items
  const displayItems = useMemo(() => buildDisplayItems(messages), [messages]);

  // Loading state
  if (loading && messages.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-3">
        <Loader2 size={20} strokeWidth={1.8} className="animate-spin" />
        <span className="text-[12px]">Waiting for session data...</span>
      </div>
    );
  }

  // Empty state
  if (!loading && messages.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-2">
        <span className="text-[12px]">No session data yet</span>
        <span className="text-[10px] text-muted-foreground/50">
          Start Claude Code to see structured output here
        </span>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-background">
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-2 py-1.5 space-y-0.5"
        onScroll={handleScroll}
      >
        {displayItems
          .filter((item) => item.type === 'assistant-turn')
          .map((item, i) => (
            <AssistantTurn key={`turn-${item.turn.id}-${i}`} turn={item.turn} />
          ))}
      </div>

      {/* Scroll to bottom button */}
      {showScrollButton && (
        <button
          className="absolute bottom-4 right-4 p-2 rounded-full bg-surface-2 border border-border shadow-lg hover:bg-surface-3 transition-colors"
          onClick={scrollToBottom}
        >
          <ArrowDown size={14} strokeWidth={2} className="text-foreground" />
        </button>
      )}
    </div>
  );
}
