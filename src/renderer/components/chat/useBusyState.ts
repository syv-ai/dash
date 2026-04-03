import { useRef, useEffect, useState } from 'react';
import type { ChatMessage, SessionMetrics } from '../../../shared/types';
import { formatToolStatus } from '../../../shared/formatToolStatus';

interface UseBusyStateReturn {
  isBusy: boolean;
  setIsBusy: React.Dispatch<React.SetStateAction<boolean>>;
  busyStatus: string | null;
  setBusyStatus: React.Dispatch<React.SetStateAction<string | null>>;
  busyElapsed: number;
  isWaiting: boolean;
  setIsWaiting: React.Dispatch<React.SetStateAction<boolean>>;
  sessionMetrics: SessionMetrics | null;
}

export function useBusyState(
  id: string,
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
): UseBusyStateReturn {
  const [isBusy, setIsBusy] = useState(false);
  const [busyStatus, setBusyStatus] = useState<string | null>(null);
  const [busyElapsed, setBusyElapsed] = useState(0);
  const busyStartRef = useRef(0);
  const [isWaiting, setIsWaiting] = useState(false);
  const [sessionMetrics, setSessionMetrics] = useState<SessionMetrics | null>(null);

  useEffect(() => {
    const unsubMetrics = window.electronAPI.onChatMetrics(id, (metrics) => {
      setSessionMetrics(metrics);
    });

    // JSONL-based tool status (fallback for when hooks aren't available)
    const unsubStatus = window.electronAPI.onChatStatus(id, (status) => {
      setBusyStatus(status);
      if (status) setIsBusy(true);
    });

    // Hook-based events — fire instantly via HookServer
    const unsubPreToolUse = window.electronAPI.onHookPreToolUse(id, (data) => {
      setIsBusy(true);
      setBusyStatus(formatToolStatus(data.toolName, data.toolInput));
    });

    const unsubPostToolUse = window.electronAPI.onHookPostToolUse(id, () => {
      setBusyStatus(null);
    });

    const unsubPostToolUseFailure = window.electronAPI.onHookPostToolUseFailure(id, () => {
      setBusyStatus(null);
    });

    const unsubStop = window.electronAPI.onHookStop(id, () => {
      setIsBusy(false);
      setBusyStatus(null);
      setIsWaiting(false);
    });

    const unsubStopFailure = window.electronAPI.onHookStopFailure(id, (data) => {
      setIsBusy(false);
      setBusyStatus(null);
      const errorMsg: ChatMessage = {
        id: `error-${Date.now()}`,
        role: 'system',
        content: [
          {
            type: 'text',
            text: `API Error: ${data.error}${data.errorDetails ? ` — ${data.errorDetails}` : ''}`,
          },
        ],
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    });

    // Track PTY activity state (needed for permission prompts)
    const unsubActivity = window.electronAPI.onPtyActivity(
      (states: Record<string, 'busy' | 'idle' | 'waiting'>) => {
        const state = states[id];
        if (state === 'waiting') {
          setIsBusy(false);
          setIsWaiting(true);
        } else if (state === 'idle') {
          setIsWaiting(false);
        }
      },
    );

    const unsubExit = window.electronAPI.onPtyExit(id, () => {
      setIsBusy(false);
      setBusyStatus(null);
    });

    // Clear busy when assistant text arrives from JSONL
    const unsubChat = window.electronAPI.onChatMessages(id, (newMessages) => {
      const hasAssistantText = newMessages.some(
        (m) => m.role === 'assistant' && m.content.some((b) => b.type === 'text'),
      );
      if (hasAssistantText) {
        setIsBusy(false);
        setBusyStatus(null);
      }
    });

    return () => {
      unsubMetrics();
      unsubStatus();
      unsubPreToolUse();
      unsubPostToolUse();
      unsubPostToolUseFailure();
      unsubStop();
      unsubStopFailure();
      unsubActivity();
      unsubExit();
      unsubChat();
    };
  }, [id, setMessages]);

  // Track busy elapsed time
  useEffect(() => {
    if (isBusy) {
      busyStartRef.current = Date.now();
      setBusyElapsed(0);
      const timer = setInterval(() => {
        setBusyElapsed(Math.floor((Date.now() - busyStartRef.current) / 1000));
      }, 1000);
      return () => clearInterval(timer);
    } else {
      setBusyElapsed(0);
    }
  }, [isBusy]);

  return {
    isBusy,
    setIsBusy,
    busyStatus,
    setBusyStatus,
    busyElapsed,
    isWaiting,
    setIsWaiting,
    sessionMetrics,
  };
}
