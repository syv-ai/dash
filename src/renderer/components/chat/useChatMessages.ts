import { useRef, useEffect, useState, useCallback } from 'react';
import type { ChatMessage, ChatContentBlock } from '../../../shared/types';
import type { SubprocessInfo } from './ComposeBox';

interface UseChatMessagesReturn {
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  toolResults: Map<string, ChatContentBlock>;
  connected: boolean;
  hasOlderMessages: boolean;
  loadingOlder: boolean;
  loadOlderMessages: () => Promise<void>;
  activeSubprocesses: SubprocessInfo[];
}

/** Index tool_result blocks from a set of messages into the lookup map. */
function indexToolResults(msgs: ChatMessage[], map: Map<string, ChatContentBlock>): void {
  for (const m of msgs) {
    for (const b of m.content) {
      if (b.type === 'tool_result') {
        map.set(b.tool_use_id, b);
      }
    }
  }
}

export function useChatMessages(id: string, cwd: string): UseChatMessagesReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [connected, setConnected] = useState(false);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const toolResultsRef = useRef(new Map<string, ChatContentBlock>());
  const historyStartIndexRef = useRef(0);

  // Track active background processes and subagents
  const bgTasksRef = useRef(
    new Map<string, { id: string; name: string; summary: string; outputFile?: string }>(),
  );
  const [activeSubprocesses, setActiveSubprocesses] = useState<SubprocessInfo[]>([]);

  useEffect(() => {
    // Subscribe to live JSONL updates — dedup against existing messages in state
    const unsubChat = window.electronAPI.onChatMessages(id, (newMessages) => {
      setMessages((prev) => {
        const existingIds = new Set(prev.map((m) => m.id));

        const toAdd = newMessages.filter((m) => {
          if (existingIds.has(m.id)) return false;
          // Skip user messages that duplicate a locally-added message.
          if (m.role === 'user') {
            const lastUser = [...prev].reverse().find((p) => p.role === 'user');
            if (lastUser && lastUser.id.startsWith('local-user-')) {
              const normalize = (msg: ChatMessage) =>
                msg.content
                  .filter((b) => b.type === 'text')
                  .map((b) => (b as { text: string }).text)
                  .join('')
                  .replace(/\s+/g, ' ')
                  .trim();
              if (normalize(lastUser) === normalize(m)) return false;
            }
          }
          return true;
        });
        if (toAdd.length === 0) return prev;

        indexToolResults(toAdd, toolResultsRef.current);

        // Track background Bash tasks from JSONL
        const bgTasks = bgTasksRef.current;
        let bgChanged = false;
        for (const m of toAdd) {
          for (const block of m.content) {
            if (block.type === 'tool_use' && block.name === 'Bash') {
              const input = block.input as Record<string, any>;
              if (input?.run_in_background && !bgTasks.has(block.id)) {
                const cmd = input.command || '';
                bgTasks.set(block.id, {
                  id: block.id,
                  name: 'Bash',
                  summary: `$ ${cmd.length > 50 ? cmd.slice(0, 47) + '...' : cmd}`,
                });
                bgChanged = true;
              }
            }
            if (block.type === 'tool_result') {
              const existing = bgTasks.get(block.tool_use_id);
              if (existing?.name === 'Bash' && block.content) {
                const fileMatch = block.content.match(/Output is being written to:\s*(\S+)/);
                if (fileMatch) {
                  existing.outputFile = fileMatch[1];
                  bgChanged = true;
                }
              }
            }
            if (block.type === 'text') {
              const text = (block as { text: string }).text;
              const match = text.match(
                /<task-notification>[\s\S]*?<tool-use-id>(.*?)<\/tool-use-id>[\s\S]*?<status>(?:completed|killed)<\/status>/,
              );
              if (match && bgTasks.has(match[1])) {
                bgTasks.delete(match[1]);
                bgChanged = true;
              }
            }
          }
        }
        if (bgChanged) {
          setActiveSubprocesses([...bgTasks.values()]);
        }

        return [...prev, ...toAdd];
      });
    });

    // Subagent lifecycle hooks
    const unsubSubagentStart = window.electronAPI.onHookSubagentStart(id, (data) => {
      const bgTasks = bgTasksRef.current;
      bgTasks.set(data.agentId, {
        id: data.agentId,
        name: 'Agent',
        summary: `Agent(${data.agentType || 'subagent'})`,
      });
      setActiveSubprocesses([...bgTasks.values()]);
    });

    const unsubSubagentStop = window.electronAPI.onHookSubagentStop(id, (data) => {
      const bgTasks = bgTasksRef.current;
      bgTasks.delete(data.agentId);
      setActiveSubprocesses([...bgTasks.values()]);
    });

    // Session rotation (e.g. /clear)
    const unsubSessionStart = window.electronAPI.onHookSessionStart(id, (data) => {
      if (data.source === 'clear' || data.source === 'startup') {
        window.electronAPI.ptyChatResetSession(id);
        if (data.source === 'clear') {
          setMessages([]);
          toolResultsRef.current.clear();
        }
      }
    });

    const unsubExit = window.electronAPI.onPtyExit(id, () => {
      setConnected(false);
    });

    // Initialize: load history, start PTY, start watcher
    (async () => {
      try {
        const historyResp = await window.electronAPI.ptyChatHistory({ cwd, limit: 100 });
        if (historyResp.success && historyResp.data) {
          const { messages: histMsgs, startIndex } = historyResp.data;
          historyStartIndexRef.current = startIndex;
          setHasOlderMessages(startIndex > 0);
          if (histMsgs.length > 0) {
            indexToolResults(histMsgs, toolResultsRef.current);
            setMessages(histMsgs);
          }
        }

        const isDark = document.documentElement.classList.contains('dark');
        await window.electronAPI.ptyStartDirect({
          id,
          cwd,
          cols: 120,
          rows: 40,
          resume: true,
          isDark,
        });
        setConnected(true);

        await window.electronAPI.ptyChatWatch({ id, cwd });
      } catch (err) {
        console.error('[useChatMessages] Failed to start:', err);
      }
    })();

    return () => {
      unsubChat();
      unsubSubagentStart();
      unsubSubagentStop();
      unsubSessionStart();
      unsubExit();
      window.electronAPI.ptyChatUnwatch(id);
    };
  }, [id, cwd]);

  const loadOlderMessages = useCallback(async () => {
    if (loadingOlder || !hasOlderMessages) return;
    setLoadingOlder(true);
    try {
      const resp = await window.electronAPI.ptyChatHistory({
        cwd,
        limit: 100,
        beforeIndex: historyStartIndexRef.current,
      });
      if (resp.success && resp.data) {
        const { messages: olderMsgs, startIndex } = resp.data;
        historyStartIndexRef.current = startIndex;
        setHasOlderMessages(startIndex > 0);
        if (olderMsgs.length > 0) {
          indexToolResults(olderMsgs, toolResultsRef.current);
          setMessages((prev) => [...olderMsgs, ...prev]);
        }
      }
    } catch {
      // Best effort
    }
    setLoadingOlder(false);
  }, [cwd, loadingOlder, hasOlderMessages]);

  return {
    messages,
    setMessages,
    toolResults: toolResultsRef.current,
    connected,
    hasOlderMessages,
    loadingOlder,
    loadOlderMessages,
    activeSubprocesses,
  };
}
