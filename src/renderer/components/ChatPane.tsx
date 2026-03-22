import React, { useRef, useEffect, useState, useCallback } from 'react';
import { ArrowDown, Loader2 } from 'lucide-react';
import { ChatStreamParser } from '../chat/ChatStreamParser';
import { MessageBubble } from './chat/MessageBubble';
import { ComposeBox } from './chat/ComposeBox';
import { Tooltip } from './ui/Tooltip';
import type { ChatMessage } from '../../shared/types';

interface ChatPaneProps {
  id: string;
  cwd: string;
  autoApprove?: boolean;
}

export function ChatPane({ id, cwd, autoApprove }: ChatPaneProps) {
  const parserRef = useRef<ChatStreamParser | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isWaiting, setIsWaiting] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [connected, setConnected] = useState(false);

  // Initialize parser and PTY connection
  useEffect(() => {
    const parser = new ChatStreamParser();
    parserRef.current = parser;

    const unsubMessages = parser.onChange(() => {
      setMessages([...parser.getMessages()]);
    });

    const unsubWaiting = parser.onWaitingChange((waiting) => {
      setIsWaiting(waiting);
      if (waiting) setIsBusy(false);
    });

    // Connect to PTY
    const unsubData = window.electronAPI.onPtyData(id, (data: string) => {
      parser.feed(data);
      setIsBusy(true);
    });

    const unsubExit = window.electronAPI.onPtyExit(id, () => {
      setIsBusy(false);
      setConnected(false);
    });

    // Start PTY in chat mode
    (async () => {
      try {
        const isDark = document.documentElement.classList.contains('dark');
        const result = await window.electronAPI.ptyStartDirect({
          id,
          cwd,
          cols: 120,
          rows: 40,
          autoApprove,
          resume: true,
          isDark,
          chatMode: true,
        });

        if (result.success) {
          setConnected(true);
          if (result.data?.reattached) {
            // Reattached to existing PTY — messages will flow via onPtyData
            setIsBusy(true);
          }
        }
      } catch (err) {
        console.error('[ChatPane] Failed to start PTY:', err);
      }
    })();

    return () => {
      unsubMessages();
      unsubWaiting();
      unsubData();
      unsubExit();
      window.electronAPI.ptyKill(id);
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

  // Send user message via PTY stdin
  const handleSend = useCallback(
    (text: string) => {
      window.electronAPI.ptyInput({ id, data: text + '\n' });
      setIsBusy(true);
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
        {isBusy && !isWaiting && messages.length > 0 && (
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
        disabled={!connected || isBusy}
        placeholder={isBusy ? 'Waiting for Claude to finish...' : 'Send a message...'}
      />
    </div>
  );
}
