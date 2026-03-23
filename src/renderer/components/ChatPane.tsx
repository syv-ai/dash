import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { ArrowDown, Bot, Loader2 } from 'lucide-react';
import { MessageBubble } from './chat/MessageBubble';
import { ComposeBox } from './chat/ComposeBox';
import { Tooltip } from './ui/Tooltip';
import type { ChatMessage } from '../../shared/types';
import { resolveTheme } from '../terminal/terminalThemes';

// Slash commands that open interactive TUI menus/dialogs requiring keyboard input
const INTERACTIVE_COMMANDS = new Set([
  '/agents',
  '/chrome',
  '/color',
  '/compact',
  '/config',
  '/context',
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

        return [...prev, ...toAdd];
      });
    });

    const unsubStatus = window.electronAPI.onChatStatus(id, (status) => {
      setBusyStatus(status);
      if (status) {
        setIsBusy(true);
      }
    });

    // Track PTY activity state for accurate busy detection
    const unsubActivity = window.electronAPI.onPtyActivity(
      (states: Record<string, 'busy' | 'idle' | 'waiting'>) => {
        const state = states[id];
        if (state === 'idle') {
          setIsBusy(false);
          setBusyStatus(null);
        } else if (state === 'busy') {
          setIsBusy(true);
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
      unsubStatus();
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
  }, [messages, isBusy, busyStatus, isAtBottom]);

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

  // ESC to interrupt the agent (sends Ctrl+C to PTY)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isBusy) {
        e.preventDefault();
        window.electronAPI.ptyInput({ id, data: '\x03' });
        setIsBusy(false);
        setBusyStatus(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [id, isBusy]);

  // Send user message or slash command via PTY stdin
  const handleSend = useCallback(
    (text: string) => {
      const isSlashCommand = text.startsWith('/');

      // Always show what was sent (both messages and slash commands)
      const localMsg: ChatMessage = {
        id: `local-user-${Date.now()}`,
        role: 'user',
        content: [{ type: 'text', text }],
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, localMsg]);

      // Collapse newlines to spaces for PTY — the TUI interprets \n as submit
      const sendText = text.replace(/\n+/g, ' ');

      // Write text first, then submit with \r after a delay.
      // The TUI detects rapid character input as a paste ("[ Pasted text ]")
      // and needs time to process it before the submit \r arrives.
      window.electronAPI.ptyInput({ id, data: sendText });
      setTimeout(() => {
        window.electronAPI.ptyInput({ id, data: '\r' });
      }, 300);

      if (isSlashCommand && INTERACTIVE_COMMANDS.has(sendText.split(' ')[0])) {
        // Switch to TUI for interactive commands that need menu/dialog input
        setTimeout(() => onSwitchToTerminal?.(), 400);
      } else if (!isSlashCommand) {
        setIsBusy(true);
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
      />
    </div>
  );
}
