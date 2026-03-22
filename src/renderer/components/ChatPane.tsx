import React, { useRef, useEffect, useState, useCallback } from 'react';
import { ArrowDown, Loader2 } from 'lucide-react';
import { MessageBubble } from './chat/MessageBubble';
import { ComposeBox } from './chat/ComposeBox';
import { Tooltip } from './ui/Tooltip';
import type { ChatMessage } from '../../shared/types';

interface ChatPaneProps {
  id: string;
  cwd: string;
}

export function ChatPane({ id, cwd }: ChatPaneProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [connected, setConnected] = useState(false);
  const busyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Initialize PTY + JSONL watcher
  useEffect(() => {
    // Track message IDs to avoid duplicates between history and live updates
    const seenIds = new Set<string>();

    // Subscribe to live JSONL updates
    const unsubChat = window.electronAPI.onChatMessages(id, (newMessages) => {
      setMessages((prev) => {
        const toAdd = newMessages.filter((m) => {
          if (seenIds.has(m.id)) return false;
          // Skip user messages that duplicate a locally-added message
          if (m.role === 'user') {
            const lastUser = [...prev].reverse().find((p) => p.role === 'user');
            if (lastUser && lastUser.id.startsWith('local-user-')) {
              const localText = lastUser.content
                .filter((b) => b.type === 'text')
                .map((b) => (b as { text: string }).text)
                .join('');
              const newText = m.content
                .filter((b) => b.type === 'text')
                .map((b) => (b as { text: string }).text)
                .join('');
              if (localText === newText) return false;
            }
          }
          return true;
        });
        if (toAdd.length === 0) return prev;
        for (const m of toAdd) seenIds.add(m.id);

        // If we get an assistant message, mark busy then schedule idle
        const hasAssistant = toAdd.some((m) => m.role === 'assistant');
        if (hasAssistant) {
          setIsBusy(false);
          if (busyTimerRef.current) clearTimeout(busyTimerRef.current);
        }

        return [...prev, ...toAdd];
      });
    });

    const unsubExit = window.electronAPI.onPtyExit(id, () => {
      setIsBusy(false);
      setConnected(false);
    });

    (async () => {
      try {
        // Load existing conversation history
        const historyResp = await window.electronAPI.ptyChatHistory(cwd);
        if (historyResp.success && historyResp.data && historyResp.data.length > 0) {
          for (const m of historyResp.data) seenIds.add(m.id);
          setMessages(historyResp.data);
        }

        // The PTY is already running (started by TerminalPane or previous mount).
        // Just start watching the JSONL file for live updates.
        setConnected(true);
        await window.electronAPI.ptyChatWatch({ id, cwd });
      } catch (err) {
        console.error('[ChatPane] Failed to start:', err);
      }
    })();

    return () => {
      unsubChat();
      unsubExit();
      if (busyTimerRef.current) clearTimeout(busyTimerRef.current);
      window.electronAPI.ptyChatUnwatch(id);
      // Don't kill the PTY — it's shared with terminal mode
    };
  }, [id, cwd]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (isAtBottom && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isAtBottom]);

  // Track scroll position
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setIsAtBottom(atBottom);
  }, []);

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
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [id, isBusy]);

  // Send user message or slash command via PTY stdin
  const handleSend = useCallback(
    (text: string) => {
      const isSlashCommand = text.startsWith('/');

      if (!isSlashCommand) {
        // Add user message to chat immediately
        const localMsg: ChatMessage = {
          id: `local-user-${Date.now()}`,
          role: 'user',
          content: [{ type: 'text', text }],
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, localMsg]);
      }

      window.electronAPI.ptyInput({ id, data: text + '\r' });

      if (!isSlashCommand) {
        setIsBusy(true);
      }
    },
    [id],
  );

  return (
    <div className="w-full h-full flex flex-col bg-background relative">
      {/* Message list */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto overflow-x-hidden"
      >
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

        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} allMessages={messages} />
        ))}

        {/* Busy indicator */}
        {isBusy && messages.length > 0 && (
          <div className="flex items-center gap-2 px-4 py-3">
            <div className="w-6 h-6 rounded-full bg-accent/80 flex items-center justify-center">
              <Loader2 size={12} strokeWidth={2} className="animate-spin text-muted-foreground" />
            </div>
            <span className="text-[12px] text-muted-foreground animate-pulse">
              Claude is thinking...
            </span>
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
        placeholder={
          isBusy ? 'Type / for commands, or press Esc to interrupt...' : 'Send a message...'
        }
      />
    </div>
  );
}
