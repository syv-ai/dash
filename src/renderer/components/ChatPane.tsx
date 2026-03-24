import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { ArrowDown, Bot, Loader2, Shield } from 'lucide-react';
import { MessageBubble } from './chat/MessageBubble';
import { ComposeBox, type SubprocessInfo } from './chat/ComposeBox';
import { Tooltip } from './ui/Tooltip';
import type { ChatMessage, SessionMetrics } from '../../shared/types';
import { resolveTheme } from '../terminal/terminalThemes';

// Slash commands that open interactive TUI menus/dialogs requiring keyboard input
const INTERACTIVE_COMMANDS = new Set([
  '/agents',
  '/chrome',
  '/color',
  '/compact',
  '/config',
  '/context',
  '/doctor',
  '/copy',
  '/diff',
  '/effort',
  '/export',
  '/hooks',
  '/ide',
  '/init',
  '/install-github-app',
  '/install-slack-app',
  '/keybindings',
  '/memory',
  '/mcp',
  '/model',
  '/permissions',
  '/plugin',
  '/pr-comments',
  '/remote-control',
  '/rc',
  '/rewind',
  '/checkpoint',
  '/resume',
  '/continue',
  '/skills',
  '/statusline',
  '/tasks',
  '/terminal-setup',
  '/theme',
]);

/** Format a human-readable status string from a tool_use hook event. */
function formatToolStatus(toolName: string, input: Record<string, unknown>): string {
  const fileName = (p: string) => p.split('/').pop() || p;
  switch (toolName) {
    case 'Read':
      return input?.file_path ? `Reading ${fileName(input.file_path as string)}` : 'Reading';
    case 'Edit':
      return input?.file_path ? `Editing ${fileName(input.file_path as string)}` : 'Editing';
    case 'Write':
      return input?.file_path ? `Writing ${fileName(input.file_path as string)}` : 'Writing';
    case 'Bash':
      return input?.command
        ? `Running \`${(input.command as string).slice(0, 60)}\``
        : 'Running command';
    case 'Glob':
      return input?.pattern ? `Searching for ${input.pattern}` : 'Searching files';
    case 'Grep':
      return input?.pattern ? `Searching for "${input.pattern}"` : 'Searching content';
    case 'Agent':
      return (input?.description as string) || 'Running subagent';
    case 'WebFetch':
      return input?.url ? `Fetching ${(input.url as string).slice(0, 50)}` : 'Fetching web page';
    case 'WebSearch':
      return input?.query ? `Searching "${(input.query as string).slice(0, 50)}"` : 'Searching web';
    default:
      return `Running ${toolName}`;
  }
}

interface ChatPaneProps {
  id: string;
  cwd: string;
  onSwitchToTerminal?: () => void;
}

export function ChatPane({ id, cwd, onSwitchToTerminal }: ChatPaneProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [busyStatus, setBusyStatus] = useState<string | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [connected, setConnected] = useState(false);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const busyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const historyStartIndexRef = useRef(0);
  // Map of tool_use_id -> tool_result block for O(1) lookup
  const toolResultsRef = useRef(new Map<string, ChatMessage['content'][0]>());
  const [busyElapsed, setBusyElapsed] = useState(0);
  const busyStartRef = useRef(0);
  const [isWaiting, setIsWaiting] = useState(false);
  const [sessionMetrics, setSessionMetrics] = useState<SessionMetrics | null>(null);

  // Track active background processes and subagents
  const bgTasksRef = useRef(
    new Map<string, { id: string; name: string; summary: string; outputFile?: string }>(),
  );
  const [activeSubprocesses, setActiveSubprocesses] = useState<SubprocessInfo[]>([]);

  // Resolve terminal theme background for the chat UI to match the TUI.
  // Re-resolve when theme changes (localStorage) or dark/light toggles.
  const [themeBg, setThemeBg] = useState(() => {
    const themeId = localStorage.getItem('terminalTheme') || 'default';
    const isDark = document.documentElement.classList.contains('dark');
    return resolveTheme(themeId, isDark).background || (isDark ? '#1a1a1a' : '#ffffff');
  });

  useEffect(() => {
    const updateThemeBg = () => {
      const themeId = localStorage.getItem('terminalTheme') || 'default';
      const isDark = document.documentElement.classList.contains('dark');
      setThemeBg(resolveTheme(themeId, isDark).background || (isDark ? '#1a1a1a' : '#ffffff'));
    };

    // Listen for localStorage changes (theme selection)
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'terminalTheme') updateThemeBg();
    };
    window.addEventListener('storage', onStorage);

    // Watch for dark/light class changes on <html>
    const observer = new MutationObserver(updateThemeBg);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    // Also poll briefly since same-window localStorage.setItem doesn't fire 'storage'
    const interval = setInterval(updateThemeBg, 1000);

    return () => {
      window.removeEventListener('storage', onStorage);
      observer.disconnect();
      clearInterval(interval);
    };
  }, []);

  // Initialize PTY + JSONL watcher
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

        // Index tool_results for O(1) lookup by ToolUseBlock
        for (const m of toAdd) {
          for (const b of m.content) {
            if (b.type === 'tool_result') {
              toolResultsRef.current.set(b.tool_use_id, b);
            }
          }
        }

        // Only clear busy when an assistant message with text arrives
        const hasAssistantText = toAdd.some(
          (m) => m.role === 'assistant' && m.content.some((b) => b.type === 'text'),
        );
        if (hasAssistantText) {
          setIsBusy(false);
          setBusyStatus(null);
          if (busyTimerRef.current) clearTimeout(busyTimerRef.current);
        }

        // Track background Bash tasks from JSONL (these don't trigger subagent hooks)
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
            // Extract output file path from tool_result
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
            // Background task completed (task-notification XML)
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

    const unsubMetrics = window.electronAPI.onChatMetrics(id, (metrics) => {
      setSessionMetrics(metrics);
    });

    // JSONL-based tool status (fallback, will be superseded by hooks when available)
    const unsubStatus = window.electronAPI.onChatStatus(id, (status) => {
      setBusyStatus(status);
      if (status) {
        setIsBusy(true);
      }
    });

    // ── Hook-based events ───────────────────────────────────
    // These fire instantly via HookServer, replacing JSONL polling for tool status.

    const unsubPreToolUse = window.electronAPI.onHookPreToolUse(id, (data) => {
      setIsBusy(true);
      setBusyStatus(formatToolStatus(data.toolName, data.toolInput));
    });

    const unsubPostToolUse = window.electronAPI.onHookPostToolUse(id, (_data) => {
      // Tool completed — status will update on next PreToolUse or Stop
      setBusyStatus(null);
    });

    const unsubPostToolUseFailure = window.electronAPI.onHookPostToolUseFailure(id, (_data) => {
      setBusyStatus(null);
    });

    const unsubStop = window.electronAPI.onHookStop(id, (_data) => {
      setIsBusy(false);
      setBusyStatus(null);
      setIsWaiting(false);
    });

    const unsubStopFailure = window.electronAPI.onHookStopFailure(id, (data) => {
      setIsBusy(false);
      setBusyStatus(null);
      // Show API error as a system message in chat
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

    const unsubSessionStart = window.electronAPI.onHookSessionStart(id, (data) => {
      // Session rotated (e.g. /clear) — tell the watcher to switch to the new file
      if (data.source === 'clear' || data.source === 'startup') {
        window.electronAPI.ptyChatResetSession(id);
        if (data.source === 'clear') {
          setMessages([]);
          toolResultsRef.current.clear();
        }
      }
    });

    // Track PTY activity state (still needed for permission prompts)
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
      setConnected(false);
    });

    (async () => {
      try {
        // Load the most recent 100 messages from conversation history
        const historyResp = await window.electronAPI.ptyChatHistory({ cwd, limit: 100 });
        if (historyResp.success && historyResp.data) {
          const { messages: histMsgs, totalCount, startIndex } = historyResp.data;
          historyStartIndexRef.current = startIndex;
          setHasOlderMessages(startIndex > 0);
          if (histMsgs.length > 0) {
            for (const m of histMsgs) {
              for (const b of m.content) {
                if (b.type === 'tool_result') {
                  toolResultsRef.current.set(b.tool_use_id, b);
                }
              }
            }
            setMessages(histMsgs);
          }
        }

        // Ensure PTY is running (reattaches if alive, starts fresh if not)
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

        // Start watching the JSONL file for live updates
        await window.electronAPI.ptyChatWatch({ id, cwd });
      } catch (err) {
        console.error('[ChatPane] Failed to start:', err);
      }
    })();

    return () => {
      unsubChat();
      unsubMetrics();
      unsubStatus();
      unsubPreToolUse();
      unsubPostToolUse();
      unsubPostToolUseFailure();
      unsubStop();
      unsubStopFailure();
      unsubSubagentStart();
      unsubSubagentStop();
      unsubSessionStart();
      unsubActivity();
      unsubExit();
      if (busyTimerRef.current) clearTimeout(busyTimerRef.current);
      window.electronAPI.ptyChatUnwatch(id);
      // Don't kill the PTY — it's shared with terminal mode
    };
  }, [id, cwd]);

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

  // Auto-scroll to bottom when new messages arrive or status changes
  useEffect(() => {
    if (isAtBottom && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isBusy, busyStatus, isWaiting, isAtBottom]);

  // Load older messages when scrolling to top
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
          for (const m of olderMsgs) {
            for (const b of m.content) {
              if (b.type === 'tool_result') {
                toolResultsRef.current.set(b.tool_use_id, b);
              }
            }
          }
          // Prepend older messages and maintain scroll position
          const el = scrollRef.current;
          const prevHeight = el?.scrollHeight || 0;
          setMessages((prev) => [...olderMsgs, ...prev]);
          // After render, adjust scroll to keep current position
          requestAnimationFrame(() => {
            if (el) {
              el.scrollTop = el.scrollHeight - prevHeight;
            }
          });
        }
      }
    } catch {
      // Best effort
    }
    setLoadingOlder(false);
  }, [cwd, loadingOlder, hasOlderMessages]);

  // Track scroll position + lazy load older messages at top
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setIsAtBottom(atBottom);
    // Load older messages when scrolled near the top
    if (el.scrollTop < 100 && hasOlderMessages && !loadingOlder) {
      loadOlderMessages();
    }
  }, [hasOlderMessages, loadingOlder, loadOlderMessages]);

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      setIsAtBottom(true);
    }
  }, []);

  // Keyboard handling: ESC to interrupt, arrow keys + Enter for permission prompts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // When waiting for permission, forward navigation keys to the TUI
      if (isWaiting) {
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          window.electronAPI.ptyInput({ id, data: '\x1b[A' });
          return;
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          window.electronAPI.ptyInput({ id, data: '\x1b[B' });
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          window.electronAPI.ptyInput({ id, data: '\r' });
          setIsWaiting(false);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          window.electronAPI.ptyInput({ id, data: '\x1b' });
          setIsWaiting(false);
          return;
        }
        // Number keys for direct selection
        if (e.key >= '1' && e.key <= '9') {
          e.preventDefault();
          window.electronAPI.ptyInput({ id, data: e.key });
          setIsWaiting(false);
          return;
        }
        return;
      }
      if (e.key === 'Escape' && isBusy) {
        e.preventDefault();
        window.electronAPI.ptyInput({ id, data: '\x03' });
        setIsBusy(false);
        setBusyStatus(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [id, isBusy, isWaiting]);

  // Send user message or slash command via PTY stdin
  const handleSend = useCallback(
    (text: string) => {
      const isSlashCommand = text.startsWith('/');

      // Show user messages locally; slash commands will appear via JSONL watcher as cards
      if (!isSlashCommand) {
        const localMsg: ChatMessage = {
          id: `local-user-${Date.now()}`,
          role: 'user',
          content: [{ type: 'text', text }],
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, localMsg]);
      }

      // Collapse newlines to spaces for PTY — the TUI interprets \n as submit
      const sendText = text.replace(/\n+/g, ' ');

      if (isSlashCommand && INTERACTIVE_COMMANDS.has(sendText.split(' ')[0])) {
        // Interactive commands need the TUI — switch first, then send
        onSwitchToTerminal?.();
        setTimeout(() => {
          window.electronAPI.ptyInput({ id, data: sendText + '\r' });
        }, 600);
      } else {
        // Regular messages and non-interactive commands: send immediately
        window.electronAPI.ptyInput({ id, data: sendText });
        setTimeout(() => {
          window.electronAPI.ptyInput({ id, data: '\r' });
        }, 300);
        if (!isSlashCommand) {
          setIsBusy(true);
        }
      }
    },
    [id, onSwitchToTerminal],
  );

  return (
    <div
      className="w-full h-full min-w-0 flex flex-col relative overflow-hidden"
      style={{ background: themeBg }}
    >
      {/* Message list */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden"
      >
        {/* Lazy load indicator at top */}
        {loadingOlder && (
          <div className="flex items-center justify-center py-3">
            <Loader2 size={14} strokeWidth={2} className="animate-spin text-muted-foreground/40" />
            <span className="ml-2 text-[11px] text-muted-foreground/50">
              Loading older messages...
            </span>
          </div>
        )}
        {hasOlderMessages && !loadingOlder && (
          <div className="flex items-center justify-center py-2">
            <button
              onClick={loadOlderMessages}
              className="text-[11px] text-muted-foreground/50 hover:text-muted-foreground transition-colors"
            >
              ↑ Load older messages
            </button>
          </div>
        )}

        {messages.length === 0 && connected && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="text-[13px] text-muted-foreground/60 mb-1">
                {isBusy ? 'Waiting for response...' : 'Chat mode active'}
              </div>
              <div className="text-[11px] text-muted-foreground/40">
                Messages will appear here as Claude responds
              </div>
            </div>
          </div>
        )}

        {messages.length === 0 && !connected && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <Loader2 size={20} className="animate-spin text-muted-foreground/40 mx-auto mb-2" />
              <div className="text-[13px] text-muted-foreground/60">Connecting...</div>
            </div>
          </div>
        )}

        {messages.map((msg, idx) => {
          // Find the previous VISIBLE message for grouping
          // (skip tool_result-only messages that render as null)
          let prevVisibleRole: string | null = null;
          for (let j = idx - 1; j >= 0; j--) {
            const prev = messages[j];
            const hasVisible = prev.content.some((b) => b.type === 'text' || b.type === 'tool_use');
            if (hasVisible) {
              prevVisibleRole = prev.role;
              break;
            }
          }
          return (
            <MessageBubble
              key={msg.id}
              message={msg}
              allMessages={messages}
              toolResults={toolResultsRef.current}
              isGroupContinuation={prevVisibleRole === msg.role}
            />
          );
        })}

        {/* Inline status — shows as new Claude message or continuation */}
        {isBusy &&
          messages.length > 0 &&
          (() => {
            // Check if last visible message is from assistant
            let lastVisibleRole: string | null = null;
            for (let j = messages.length - 1; j >= 0; j--) {
              const m = messages[j];
              if (m.content.some((b) => b.type === 'text' || b.type === 'tool_use')) {
                lastVisibleRole = m.role;
                break;
              }
            }
            const isContinuation = lastVisibleRole === 'assistant';

            const dots = (
              <div className="flex items-center gap-2 text-muted-foreground/60">
                <div className="flex gap-0.5">
                  <div
                    className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce"
                    style={{ animationDelay: '0ms' }}
                  />
                  <div
                    className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce"
                    style={{ animationDelay: '150ms' }}
                  />
                  <div
                    className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce"
                    style={{ animationDelay: '300ms' }}
                  />
                </div>
                {busyStatus && (
                  <span className="text-[11px] text-muted-foreground/50">{busyStatus}</span>
                )}
                {busyElapsed > 0 && (
                  <span className="text-[10px] font-mono text-muted-foreground/40">
                    {busyElapsed >= 60
                      ? `${Math.floor(busyElapsed / 60)}:${String(busyElapsed % 60).padStart(2, '0')}`
                      : `${busyElapsed}s`}
                  </span>
                )}
              </div>
            );

            if (isContinuation) {
              return (
                <div className="flex gap-3 px-4 pb-3 pt-3 animate-chat-entry">
                  <div className="w-6 shrink-0" />
                  {dots}
                </div>
              );
            }

            return (
              <div className="flex gap-3 px-4 py-3 bg-surface-0/50 animate-chat-entry">
                <div className="w-6 h-6 rounded-full bg-accent/80 flex items-center justify-center shrink-0 mt-0.5">
                  <Bot size={13} strokeWidth={2} className="text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-[12px] font-semibold text-foreground">Claude</span>
                  </div>
                  {dots}
                </div>
              </div>
            );
          })()}

        {/* Permission prompt — shown when the TUI is waiting for user approval */}
        {isWaiting && (
          <div className="flex gap-3 px-4 py-3 animate-chat-entry">
            <div className="w-6 h-6 rounded-full bg-orange-500/20 flex items-center justify-center shrink-0 mt-0.5">
              <Shield size={12} strokeWidth={2} className="text-orange-500" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[12px] font-semibold text-foreground">
                  Permission required
                </span>
              </div>
              <p className="text-[12px] text-muted-foreground mb-3">
                Claude wants to perform an action that requires your approval.
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    window.electronAPI.ptyInput({ id, data: '1' });
                    setIsWaiting(false);
                  }}
                  className="px-3 py-1.5 rounded-md text-[11px] font-medium bg-[hsl(var(--git-added))]/15 text-[hsl(var(--git-added))] hover:bg-[hsl(var(--git-added))]/25 transition-colors"
                >
                  Allow
                </button>
                <button
                  onClick={() => {
                    window.electronAPI.ptyInput({ id, data: '2' });
                    setIsWaiting(false);
                  }}
                  className="px-3 py-1.5 rounded-md text-[11px] font-medium bg-amber-400/15 text-amber-400 hover:bg-amber-400/25 transition-colors"
                >
                  Allow for session
                </button>
                <button
                  onClick={() => {
                    window.electronAPI.ptyInput({ id, data: '3' });
                    setIsWaiting(false);
                  }}
                  className="px-3 py-1.5 rounded-md text-[11px] font-medium bg-[hsl(var(--git-deleted))]/15 text-[hsl(var(--git-deleted))] hover:bg-[hsl(var(--git-deleted))]/25 transition-colors"
                >
                  Deny
                </button>
                <button
                  onClick={() => {
                    window.electronAPI.ptyInput({ id, data: '\x1b' });
                    setIsWaiting(false);
                  }}
                  className="px-3 py-1.5 rounded-md text-[11px] font-medium text-muted-foreground hover:bg-accent/60 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Scroll to bottom button */}
      {!isAtBottom && (
        <Tooltip content="Scroll to bottom">
          <button
            onClick={scrollToBottom}
            className="absolute bottom-[100px] right-4 z-10 w-8 h-8 rounded-full bg-accent/80 hover:bg-accent text-foreground/70 hover:text-foreground flex items-center justify-center shadow-md backdrop-blur-sm transition-all duration-150 hover:scale-105"
          >
            <ArrowDown size={16} strokeWidth={2} />
          </button>
        </Tooltip>
      )}

      {/* Compose box */}
      <ComposeBox
        onSend={handleSend}
        disabled={!connected}
        isBusy={isBusy}
        themeBg={themeBg}
        cwd={cwd}
        placeholder={
          isBusy ? 'Type / for commands, or press Esc to interrupt...' : 'Send a message...'
        }
        activeSubprocesses={activeSubprocesses}
        sessionMetrics={sessionMetrics}
      />
    </div>
  );
}
