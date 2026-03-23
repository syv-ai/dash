import React from 'react';
import { User, Bot, AlertTriangle } from 'lucide-react';
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
    return (
      <div className="flex items-start gap-2 px-4 py-2 animate-chat-entry">
        <AlertTriangle size={14} strokeWidth={1.8} className="text-orange-500 mt-0.5 shrink-0" />
        <div className="text-[12px] text-orange-600 dark:text-orange-400">
          {getTextContent(message.content)}
        </div>
      </div>
    );
  }

  const isUser = message.role === 'user';

  // Hide messages that contain only tool_result blocks (rendered inline with tool_use)
  const hasVisibleContent = message.content.some(
    (block) => block.type === 'text' || block.type === 'tool_use',
  );
  if (!hasVisibleContent) return null;

  // Continuation messages: no avatar, no header, tighter spacing
  if (isGroupContinuation) {
    return (
      <div className={`flex gap-3 px-4 pb-2 animate-chat-entry ${isUser ? '' : 'bg-surface-0/50'}`}>
        {/* Spacer matching avatar width */}
        <div className="w-6 shrink-0" />
        <div className="flex-1 min-w-0 space-y-1">
          {message.content.map((block, i) =>
            renderContentBlock(block, i, allMessages, toolResults),
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`flex gap-3 px-4 py-3 animate-chat-entry ${isUser ? '' : 'bg-surface-0/50'}`}>
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
    case 'text':
      return <MarkdownRenderer key={key} content={block.text} />;

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

function findToolResult(
  toolUseId: string,
  allMessages: ChatMessage[],
): (ChatContentBlock & { type: 'tool_result' }) | null {
  for (const msg of allMessages) {
    for (const block of msg.content) {
      if (block.type === 'tool_result' && block.tool_use_id === toolUseId) {
        return block;
      }
    }
  }
  return null;
}

function getTextContent(blocks: ChatContentBlock[]): string {
  return blocks
    .filter((b): b is ChatContentBlock & { type: 'text' } => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}
