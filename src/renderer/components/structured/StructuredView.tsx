import React, { useEffect, useRef, useState, useMemo } from 'react';
import { Loader2, ArrowDown } from 'lucide-react';
import type {
  ParsedSessionMessage,
  SessionUpdate,
  AssistantTurnData,
  LinkedToolExecution,
  ToolResultInfo,
  ContentBlock,
} from '../../../shared/sessionTypes';
import { AssistantTurn } from './AssistantTurn';

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

function buildAssistantTurns(messages: ParsedSessionMessage[]): AssistantTurnData[] {
  const resultMap = new Map<string, { result: ToolResultInfo; timestamp: string }>();
  for (const msg of messages) {
    if (msg.type === 'user' && msg.toolResults.length > 0) {
      for (const tr of msg.toolResults) {
        resultMap.set(tr.toolUseId, { result: tr, timestamp: msg.timestamp });
      }
    }
  }

  const turns: AssistantTurnData[] = [];
  let current: AssistantTurnData | null = null;

  for (const msg of messages) {
    if (msg.isSidechain) continue;

    // A real (non-meta) user message ends the current assistant turn. Other
    // non-assistant entries (system, meta tool-results, summaries, synthetic
    // assistant messages) don't break a turn — they're noise interleaved by
    // Claude Code.
    if (msg.type === 'user' && !msg.isMeta) {
      if (current) {
        turns.push(current);
        current = null;
      }
      continue;
    }

    if (msg.type !== 'assistant' || msg.model === '<synthetic>') continue;

    if (!current) {
      current = {
        id: msg.uuid,
        thinkingBlocks: [],
        textOutput: '',
        toolExecutions: [],
        usage: msg.usage,
        model: msg.model,
        timestamp: msg.timestamp,
      };
    } else if (msg.usage) {
      current.usage = current.usage
        ? {
            input_tokens: (current.usage.input_tokens ?? 0) + (msg.usage.input_tokens ?? 0),
            output_tokens: (current.usage.output_tokens ?? 0) + (msg.usage.output_tokens ?? 0),
            cache_read_input_tokens:
              (current.usage.cache_read_input_tokens ?? 0) +
              (msg.usage.cache_read_input_tokens ?? 0),
            cache_creation_input_tokens:
              (current.usage.cache_creation_input_tokens ?? 0) +
              (msg.usage.cache_creation_input_tokens ?? 0),
          }
        : msg.usage;
    }

    current.thinkingBlocks.push(...extractThinking(msg.content));

    const text = extractText(msg.content);
    if (text.trim()) {
      current.textOutput += current.textOutput ? `\n${text}` : text;
    }

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
      current.toolExecutions.push(exec);
    }
  }

  if (current) turns.push(current);
  return turns;
}

interface StructuredViewProps {
  taskId: string;
  taskPath: string;
}

export function StructuredView({ taskId, taskPath }: StructuredViewProps) {
  const [messages, setMessages] = useState<ParsedSessionMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [showScrollButton, setShowScrollButton] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    window.electronAPI
      .sessionWatch({ taskId, taskPath })
      .then((res) => {
        if (cancelled) return;
        if (!res.success) {
          setError(res.error ?? 'Failed to start session watcher');
          setLoading(false);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });

    window.electronAPI
      .sessionGetMessages(taskId)
      .then((res) => {
        if (cancelled) return;
        if (!res.success) {
          setError(res.error ?? 'Failed to load session messages');
        } else if (res.data) {
          setMessages(res.data.messages);
        }
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });

    return () => {
      cancelled = true;
      window.electronAPI.sessionUnwatch(taskId);
    };
  }, [taskId, taskPath]);

  useEffect(() => {
    let cancelled = false;
    const unsubscribe = window.electronAPI.onSessionUpdate((update: SessionUpdate) => {
      if (cancelled || update.taskId !== taskId) return;
      if (update.isIncremental) {
        setMessages((prev) => [...prev, ...update.messages]);
      } else {
        setMessages(update.messages);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [taskId]);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, autoScroll]);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const atBottom = scrollHeight - scrollTop - clientHeight < 50;
    setAutoScroll(atBottom);
    setShowScrollButton(!atBottom);
  };

  const scrollToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      setAutoScroll(true);
      setShowScrollButton(false);
    }
  };

  const turns = useMemo(
    () => buildAssistantTurns(messages).filter((t) => t.toolExecutions.length > 0),
    [messages],
  );

  if (error && messages.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-2 px-4 text-center">
        <span className="text-[12px] text-destructive">Couldn't load session</span>
        <span className="text-[10px] text-muted-foreground/60">{error}</span>
      </div>
    );
  }

  if (loading && messages.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-3">
        <Loader2 size={20} strokeWidth={1.8} className="animate-spin" />
        <span className="text-[12px]">Waiting for session data...</span>
      </div>
    );
  }

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
        {turns.map((turn) => (
          <AssistantTurn key={turn.id} turn={turn} taskPath={taskPath} />
        ))}
      </div>

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
