import React, { useRef, useCallback, useState } from 'react';
import { SendHorizonal } from 'lucide-react';

interface ComposeBoxProps {
  onSend: (text: string) => void;
  disabled?: boolean;
  isBusy?: boolean;
  placeholder?: string;
}

export function ComposeBox({
  onSend,
  disabled = false,
  isBusy = false,
  placeholder = 'Send a message...',
}: ComposeBoxProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState('');

  const handleSend = useCallback(() => {
    const text = value.trim();
    if (!text || disabled) return;
    // When busy, only allow slash commands
    if (isBusy && !text.startsWith('/')) return;
    onSend(text);
    setValue('');
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [value, disabled, isBusy, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
    // Auto-resize textarea
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }, []);

  return (
    <div className="border-t border-border/60 p-3" style={{ background: 'hsl(var(--surface-1))' }}>
      <div className="flex items-end gap-2 rounded-lg border border-border/80 bg-background px-3 py-2 focus-within:border-primary/50 transition-colors">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          className="flex-1 resize-none bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none leading-relaxed max-h-[200px]"
        />
        <button
          onClick={handleSend}
          disabled={disabled || !value.trim() || (isBusy && !value.trim().startsWith('/'))}
          className="p-1 rounded-md text-primary hover:bg-primary/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors shrink-0"
        >
          <SendHorizonal size={16} strokeWidth={2} />
        </button>
      </div>
      <div className="mt-1.5 text-[10px] text-muted-foreground/50 text-center">
        {isBusy ? 'Esc to interrupt' : 'Enter to send, Shift+Enter for new line'}
      </div>
    </div>
  );
}
