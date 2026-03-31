import React, { useState, useCallback } from 'react';
import { User, Bot, AlertTriangle, TerminalSquare, Minimize2, Copy, Check } from 'lucide-react';
import type { ChatMessage, ChatContentBlock } from '../../../shared/types';
import { MarkdownRenderer } from './MarkdownRenderer';
import { ToolUseBlock } from './ToolUseBlock';

interface MessageBubbleProps {
  message: ChatMessage;
  /** All messages in the conversation, for finding tool results. */
  allMessages: ChatMessage[];
  /** Map of tool_use_id -> tool_result block for fast lookup. */
  toolResults?: Map<string, ChatContentBlock>;
  /** True if the previous message has the same role (group continuation). */
  isGroupContinuation?: boolean;
}

export function MessageBubble({
  message,
  allMessages,
  toolResults,
  isGroupContinuation = false,
}: MessageBubbleProps) {
  if (message.role === 'system') {
    const sysText = getTextContent(message.content);
    // Render command cards for system-level slash command entries (e.g., /doctor)
    if (sysText.includes('<command-name>')) {
      // Render using the text block handler which creates the card
      return (
        <div className="flex gap-3 px-4 py-3 animate-chat-entry">
          <div className="w-6 shrink-0" />
          <div className="flex-1 min-w-0 space-y-1">
            {message.content.map((block, i) =>
              renderContentBlock(block, i, allMessages, toolResults),
            )}
          </div>
        </div>
      );
    }
    // Hide system messages that are command stdout (displayed by the command card)
    // or other internal XML
    if (sysText.includes('<local-command-stdout>') || sysText.includes('<local-command-caveat>')) {
      return null;
    }
    return (
      <div className="flex items-start gap-2 px-4 py-2 animate-chat-entry">
        <AlertTriangle size={14} strokeWidth={1.8} className="text-orange-500 mt-0.5 shrink-0" />
        <div className="text-[12px] text-orange-600 dark:text-orange-400">{sysText}</div>
      </div>
    );
  }

  const isUser = message.role === 'user';

  // Hide messages that contain only tool_result blocks (rendered inline with tool_use)
  const hasVisibleContent = message.content.some(
    (block) => block.type === 'text' || block.type === 'tool_use',
  );
  if (!hasVisibleContent) return null;

  const textForCopy = getTextContent(message.content);

  // Continuation messages: no avatar, no header, tighter spacing
  if (isGroupContinuation) {
    return (
      <div
        className={`group/msg relative flex gap-3 px-4 pb-2 animate-chat-entry ${isUser ? '' : 'bg-surface-0/50'}`}
      >
        {/* Spacer matching avatar width */}
        <div className="w-6 shrink-0" />
        <div className="flex-1 min-w-0 space-y-1">
          {message.content.map((block, i) =>
            renderContentBlock(block, i, allMessages, toolResults),
          )}
        </div>
        {textForCopy && <MessageActions text={textForCopy} />}
      </div>
    );
  }

  return (
    <div
      className={`group/msg relative flex gap-3 px-4 py-3 animate-chat-entry ${isUser ? '' : 'bg-surface-0/50'}`}
    >
      {/* Avatar */}
      <div
        className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
          isUser ? 'bg-primary/10 text-primary' : 'bg-accent/80 text-muted-foreground'
        }`}
      >
        {isUser ? <User size={13} strokeWidth={2} /> : <Bot size={13} strokeWidth={2} />}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-[12px] font-semibold text-foreground">
            {isUser ? 'You' : 'Claude'}
          </span>
          {message.model && (
            <span className="text-[10px] text-muted-foreground font-mono">{message.model}</span>
          )}
          {message.costUsd !== undefined && (
            <span className="text-[10px] text-muted-foreground">${message.costUsd.toFixed(4)}</span>
          )}
        </div>

        <div className="space-y-1">
          {message.content.map((block, i) =>
            renderContentBlock(block, i, allMessages, toolResults),
          )}
        </div>
      </div>
      {textForCopy && <MessageActions text={textForCopy} />}
    </div>
  );
}

function renderContentBlock(
  block: ChatContentBlock,
  key: number,
  allMessages: ChatMessage[],
  toolResults?: Map<string, ChatContentBlock>,
): React.ReactNode {
  switch (block.type) {
    case 'text': {
      // Filter out Claude Code internal XML messages
      const text = block.text;
      if (text.includes('<task-notification>')) {
        return <TaskNotification key={key} xml={text} />;
      }
      if (text.includes('<compact-summary>')) {
        return <CompactSummary key={key} xml={text} />;
      }
      // Show slash commands/skills as elegant cards
      if (text.includes('<command-name>')) {
        const cmdMatch = text.match(/<command-name>(.*?)<\/command-name>/);
        // Search for stdout: same block, sibling blocks, or subsequent messages
        let stdout: string | undefined;
        const stdoutMatch = text.match(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/);
        if (stdoutMatch) {
          stdout = stdoutMatch[1]?.trim();
        } else {
          // Search all messages for the stdout that follows this command
          const thisMsg = allMessages.find((m) => m.content.some((b) => b === block));
          const thisIdx = thisMsg ? allMessages.indexOf(thisMsg) : -1;
          // Check sibling blocks in same message, then next few messages
          const searchMessages =
            thisIdx >= 0 ? [thisMsg!, ...allMessages.slice(thisIdx + 1, thisIdx + 4)] : [];
          for (const msg of searchMessages) {
            for (const b of msg.content) {
              if (b.type === 'text') {
                const m = b.text.match(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/);
                if (m) {
                  stdout = m[1]?.trim();
                  break;
                }
              }
            }
            if (stdout) break;
          }
        }
        if (cmdMatch) {
          const cmd = cmdMatch[1].startsWith('/') ? cmdMatch[1] : `/${cmdMatch[1]}`;
          return (
            <div key={key} className="my-1.5 rounded-md border border-border/60 overflow-hidden">
              <div
                className="flex items-center gap-2 px-3 py-2"
                style={{ background: 'hsl(var(--surface-1))' }}
              >
                <TerminalSquare
                  size={12}
                  strokeWidth={1.8}
                  className="text-muted-foreground flex-shrink-0"
                />
                <span className="text-[12px] font-mono font-medium text-foreground/80">{cmd}</span>
                <div className="w-2 h-2 rounded-full bg-[hsl(var(--git-added))] ml-auto flex-shrink-0" />
              </div>
              {stdout && (
                <div
                  className="px-3 py-1.5 text-[11px] text-muted-foreground/70 border-t border-border/40"
                  style={{ background: 'hsl(var(--surface-0))' }}
                >
                  {stdout}
                </div>
              )}
            </div>
          );
        }
      }
      // Hide internal caveat/stdout XML
      if (
        text.includes('<local-command-caveat>') ||
        text.includes('<local-command-stdout>') ||
        (text.startsWith('<') && text.includes('</') && !text.includes('\n'))
      ) {
        return null;
      }
      return <MarkdownRenderer key={key} content={text} />;
    }

    case 'tool_use': {
      const result =
        (toolResults?.get(block.id) as (ChatContentBlock & { type: 'tool_result' }) | undefined) ??
        null;
      return <ToolUseBlock key={key} block={block} result={result} />;
    }

    case 'tool_result':
      // Tool results are rendered inline with their tool_use blocks, skip standalone
      return null;

    default:
      return null;
  }
}

function TaskNotification({ xml }: { xml: string }): React.ReactElement | null {
  // Parse key fields from the XML
  const getTag = (tag: string) => {
    const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
    return match ? match[1].trim() : null;
  };

  const status = getTag('status');
  const summary = getTag('summary');
  const totalTokens = getTag('total_tokens');
  const toolUses = getTag('tool_uses');
  const durationMs = getTag('duration_ms');

  if (!summary) return null;

  const duration = durationMs
    ? Number(durationMs) >= 60000
      ? `${(Number(durationMs) / 60000).toFixed(1)}m`
      : `${(Number(durationMs) / 1000).toFixed(1)}s`
    : null;

  return (
    <div className="my-1.5 rounded-md border border-border/60 overflow-hidden">
      <div
        className="flex items-center gap-2 px-3 py-2"
        style={{ background: 'hsl(var(--surface-1))' }}
      >
        <Bot size={12} strokeWidth={1.8} className="text-muted-foreground flex-shrink-0" />
        <span className="text-[12px] font-medium text-foreground/80 truncate">{summary}</span>
        {status === 'completed' && (
          <div className="w-2 h-2 rounded-full bg-[hsl(var(--git-added))] ml-auto flex-shrink-0" />
        )}
      </div>
      {(totalTokens || duration || toolUses) && (
        <div
          className="flex items-center gap-3 px-3 py-1.5 text-[10px] text-muted-foreground/60 border-t border-border/40"
          style={{ background: 'hsl(var(--surface-0))' }}
        >
          {duration && <span>{duration}</span>}
          {totalTokens && <span>{Number(totalTokens).toLocaleString()} tokens</span>}
          {toolUses && <span>{toolUses} tool uses</span>}
        </div>
      )}
    </div>
  );
}

function MessageActions({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [text]);

  return (
    <div className="absolute top-1 right-2 opacity-0 group-hover/msg:opacity-100 transition-opacity duration-100">
      <button
        onClick={handleCopy}
        className="p-1 rounded-md hover:bg-accent/60 text-muted-foreground/50 hover:text-muted-foreground transition-colors"
        title="Copy message"
      >
        {copied ? (
          <Check size={12} strokeWidth={2} className="text-[hsl(var(--git-added))]" />
        ) : (
          <Copy size={12} strokeWidth={2} />
        )}
      </button>
    </div>
  );
}

function CompactSummary({ xml }: { xml: string }): React.ReactElement {
  const match = xml.match(/<compact-summary>([\s\S]*?)<\/compact-summary>/);
  const summary = match?.[1]?.trim() || 'Conversation compacted to save context';

  return (
    <div className="my-3 mx-4 flex items-center gap-3">
      <div className="flex-1 border-t border-border/40" />
      <div className="flex items-center gap-1.5 px-3 py-1 rounded-full border border-border/40 bg-surface-1/50">
        <Minimize2 size={11} strokeWidth={1.8} className="text-muted-foreground/60" />
        <span className="text-[10px] text-muted-foreground/60">{summary}</span>
      </div>
      <div className="flex-1 border-t border-border/40" />
    </div>
  );
}

function getTextContent(blocks: ChatContentBlock[]): string {
  return blocks
    .filter((b): b is ChatContentBlock & { type: 'text' } => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}
