import React from 'react';
import { User } from 'lucide-react';
import type { ParsedSessionMessage, ContentBlock } from '../../../shared/sessionTypes';

function extractText(content: ContentBlock[] | string): string {
  if (typeof content === 'string') return content;
  return content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

/**
 * Strip system-reminder and local-command tags from user messages.
 */
function sanitizeUserText(text: string): string {
  return text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, '')
    .replace(/<local-command-stdout>[\s\S]*?<\/local-command-stdout>/g, '')
    .replace(/<command-name>[\s\S]*?<\/command-name>/g, '')
    .replace(/<command-message>[\s\S]*?<\/command-message>/g, '')
    .replace(/<command-args>[\s\S]*?<\/command-args>/g, '')
    .trim();
}

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

interface UserMessageProps {
  message: ParsedSessionMessage;
}

export function UserMessage({ message }: UserMessageProps) {
  const rawText = extractText(message.content);
  const text = sanitizeUserText(rawText);

  if (!text) return null;

  return (
    <div className="flex items-start gap-2.5 max-w-[85%]">
      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center mt-0.5">
        <User size={12} strokeWidth={2} className="text-primary" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] text-muted-foreground/60 mb-1">
          {formatTimestamp(message.timestamp)}
        </div>
        <div className="bg-primary/8 border border-primary/15 rounded-xl px-3.5 py-2.5 text-[13px] text-foreground leading-relaxed whitespace-pre-wrap break-words">
          {text}
        </div>
      </div>
    </div>
  );
}
