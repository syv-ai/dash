import React, { useRef, useEffect, useCallback } from 'react';
import { ArrowDown, Bot, Loader2, Shield } from 'lucide-react';
import { MessageBubble } from './chat/MessageBubble';
import { ComposeBox } from './chat/ComposeBox';
import { Tooltip } from './ui/Tooltip';
import type { ChatMessage } from '../../shared/types';
import { SLASH_COMMANDS } from './chat/SlashCommandMenu';
import { useChatMessages } from './chat/useChatMessages';
import { useBusyState } from './chat/useBusyState';
import { useThemeBackground } from './chat/useThemeBackground';

/** Built from SLASH_COMMANDS interactive field. */
const INTERACTIVE_COMMANDS = new Set(
  SLASH_COMMANDS.filter((c) => c.interactive).map((c) => c.command),
);

interface ChatPaneProps {
  id: string;
  cwd: string;
  onSwitchToTerminal?: () => void;
}

export function ChatPane({ id, cwd, onSwitchToTerminal }: ChatPaneProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const themeBg = useThemeBackground();

  const {
    messages,
    setMessages,
    toolResults,
    connected,
    hasOlderMessages,
    loadingOlder,
    loadOlderMessages,
    activeSubprocesses,
  } = useChatMessages(id, cwd);

  const {
    isBusy,
    setIsBusy,
    busyStatus,
    setBusyStatus,
    busyElapsed,
    isWaiting,
    setIsWaiting,
    sessionMetrics,
  } = useBusyState(id, setMessages);

  // ── Auto-scroll ──────────────────────────────────────────────
  const [isAtBottom, setIsAtBottom] = React.useState(true);

  useEffect(() => {
    if (isAtBottom && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isBusy, busyStatus, isWaiting, isAtBottom]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setIsAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
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

  // ── Keyboard handling ────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
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
  }, [id, isBusy, isWaiting, setIsBusy, setBusyStatus, setIsWaiting]);

  // ── Send message ─────────────────────────────────────────────
  const handleSend = useCallback(
    (text: string) => {
      const isSlashCommand = text.startsWith('/');

      if (!isSlashCommand) {
        const localMsg: ChatMessage = {
          id: `local-user-${Date.now()}`,
          role: 'user',
          content: [{ type: 'text', text }],
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, localMsg]);
      }

      const sendText = text.replace(/\n+/g, ' ');

      if (isSlashCommand && INTERACTIVE_COMMANDS.has(sendText.split(' ')[0])) {
        onSwitchToTerminal?.();
        setTimeout(() => {
          window.electronAPI.ptyInput({ id, data: sendText + '\r' });
        }, 600);
      } else {
        window.electronAPI.ptyInput({ id, data: sendText });
        setTimeout(() => {
          window.electronAPI.ptyInput({ id, data: '\r' });
        }, 300);
        if (!isSlashCommand) {
          setIsBusy(true);
        }
      }
    },
    [id, onSwitchToTerminal, setMessages, setIsBusy],
  );

  // ── Render ───────────────────────────────────────────────────
  return (
    <div
      className="w-full h-full min-w-0 flex flex-col relative overflow-hidden"
      style={{ background: themeBg }}
    >
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden"
      >
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
          let prevVisibleRole: string | null = null;
          for (let j = idx - 1; j >= 0; j--) {
            const prev = messages[j];
            if (prev.content.some((b) => b.type === 'text' || b.type === 'tool_use')) {
              prevVisibleRole = prev.role;
              break;
            }
          }
          return (
            <MessageBubble
              key={msg.id}
              message={msg}
              allMessages={messages}
              toolResults={toolResults}
              isGroupContinuation={prevVisibleRole === msg.role}
            />
          );
        })}

        <BusyIndicator
          messages={messages}
          isBusy={isBusy}
          busyStatus={busyStatus}
          busyElapsed={busyElapsed}
        />
        <PermissionPrompt id={id} isWaiting={isWaiting} setIsWaiting={setIsWaiting} />
      </div>

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

// ── Sub-components ──────────────────────────────────────────────

function BusyIndicator({
  messages,
  isBusy,
  busyStatus,
  busyElapsed,
}: {
  messages: ChatMessage[];
  isBusy: boolean;
  busyStatus: string | null;
  busyElapsed: number;
}) {
  if (!isBusy || messages.length === 0) return null;

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
      {busyStatus && <span className="text-[11px] text-muted-foreground/50">{busyStatus}</span>}
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
}

function PermissionPrompt({
  id,
  isWaiting,
  setIsWaiting,
}: {
  id: string;
  isWaiting: boolean;
  setIsWaiting: (v: boolean) => void;
}) {
  if (!isWaiting) return null;

  const respond = (data: string) => {
    window.electronAPI.ptyInput({ id, data });
    setIsWaiting(false);
  };

  return (
    <div className="flex gap-3 px-4 py-3 animate-chat-entry">
      <div className="w-6 h-6 rounded-full bg-orange-500/20 flex items-center justify-center shrink-0 mt-0.5">
        <Shield size={12} strokeWidth={2} className="text-orange-500" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[12px] font-semibold text-foreground">Permission required</span>
        </div>
        <p className="text-[12px] text-muted-foreground mb-3">
          Claude wants to perform an action that requires your approval.
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => respond('1')}
            className="px-3 py-1.5 rounded-md text-[11px] font-medium bg-[hsl(var(--git-added))]/15 text-[hsl(var(--git-added))] hover:bg-[hsl(var(--git-added))]/25 transition-colors"
          >
            Allow
          </button>
          <button
            onClick={() => respond('2')}
            className="px-3 py-1.5 rounded-md text-[11px] font-medium bg-amber-400/15 text-amber-400 hover:bg-amber-400/25 transition-colors"
          >
            Allow for session
          </button>
          <button
            onClick={() => respond('3')}
            className="px-3 py-1.5 rounded-md text-[11px] font-medium bg-[hsl(var(--git-deleted))]/15 text-[hsl(var(--git-deleted))] hover:bg-[hsl(var(--git-deleted))]/25 transition-colors"
          >
            Deny
          </button>
          <button
            onClick={() => respond('\x1b')}
            className="px-3 py-1.5 rounded-md text-[11px] font-medium text-muted-foreground hover:bg-accent/60 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
