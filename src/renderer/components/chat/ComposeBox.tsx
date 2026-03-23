import React, { useRef, useCallback, useState, useEffect } from 'react';
import { SendHorizonal } from 'lucide-react';
import { SlashCommandMenu, getFilteredCommands, type SlashCommand } from './SlashCommandMenu';

interface ComposeBoxProps {
  onSend: (text: string) => void;
  disabled?: boolean;
  isBusy?: boolean;
  themeBg?: string;
  cwd?: string;
  placeholder?: string;
}

export function ComposeBox({
  onSend,
  disabled = false,
  isBusy = false,
  themeBg,
  cwd,
  placeholder = 'Send a message...',
}: ComposeBoxProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState('');
  const [dynamicCommands, setDynamicCommands] = useState<SlashCommand[]>([]);

  // Load dynamic commands (skills, plugins, MCP) on mount
  useEffect(() => {
    if (!cwd) return;
    (async () => {
      try {
        const resp = await window.electronAPI.ptyDiscoverCommands(cwd);
        if (resp.success && resp.data) {
          const mapped: SlashCommand[] = resp.data.map((cmd) => ({
            command: cmd.command,
            description: cmd.description,
            icon: null, // Will use source-based default in SlashCommandMenu
            source: cmd.source,
            interactive: cmd.interactive,
          }));
          setDynamicCommands(mapped);
        }
      } catch {
        // Best effort
      }
    })();
  }, [cwd]);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0);
  const [slashTab, setSlashTab] = useState<'all' | 'commands' | 'skills' | 'plugins' | 'mcp'>(
    'all',
  );

  const handleSend = useCallback(() => {
    const text = value.trim();
    if (!text || disabled) return;
    // When busy, only allow slash commands
    if (isBusy && !text.startsWith('/')) return;
    onSend(text);
    setValue('');
    setShowSlashMenu(false);
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [value, disabled, isBusy, onSend]);

  const handleSlashSelect = useCallback((command: string) => {
    // Insert command into input so user can add arguments before sending
    setValue(command + ' ');
    setShowSlashMenu(false);
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (showSlashMenu) {
        const filtered = getFilteredCommands(value, dynamicCommands, slashTab);
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSlashSelectedIndex((prev) => (prev > 0 ? prev - 1 : filtered.length - 1));
          return;
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSlashSelectedIndex((prev) => (prev < filtered.length - 1 ? prev + 1 : 0));
          return;
        }
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          if (filtered[slashSelectedIndex]) {
            handleSlashSelect(filtered[slashSelectedIndex].command);
          }
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          e.nativeEvent.stopImmediatePropagation();
          setShowSlashMenu(false);
          return;
        }
        if (e.key === 'Tab') {
          e.preventDefault();
          const tabIds: Array<'all' | 'commands' | 'skills' | 'plugins' | 'mcp'> = [
            'all',
            'commands',
            'skills',
            'plugins',
            'mcp',
          ];
          const currentIdx = tabIds.indexOf(slashTab);
          const nextIdx = e.shiftKey
            ? (currentIdx - 1 + tabIds.length) % tabIds.length
            : (currentIdx + 1) % tabIds.length;
          setSlashTab(tabIds[nextIdx]);
          setSlashSelectedIndex(0);
          return;
        }
      }

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [
      handleSend,
      handleSlashSelect,
      showSlashMenu,
      slashSelectedIndex,
      slashTab,
      dynamicCommands,
      value,
    ],
  );

  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    setValue(newValue);

    // Show slash menu when typing starts with /
    if (newValue.startsWith('/') && !newValue.includes(' ')) {
      setShowSlashMenu(true);
      setSlashSelectedIndex(0);
      setSlashTab('all');
    } else {
      setShowSlashMenu(false);
    }

    // Auto-resize textarea
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }, []);

  return (
    <div
      className="border-t border-border/60 p-3 relative"
      style={{ background: themeBg || 'hsl(var(--surface-1))' }}
    >
      {showSlashMenu && (
        <SlashCommandMenu
          filter={value}
          selectedIndex={slashSelectedIndex}
          extraCommands={dynamicCommands}
          onSelect={handleSlashSelect}
          activeTab={slashTab}
          onTabChange={(tab) => {
            setSlashTab(tab);
            setSlashSelectedIndex(0);
          }}
        />
      )}
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
        {isBusy
          ? 'Esc to interrupt'
          : 'Enter to send, Shift+Enter for new line · Chat UI is experimental'}
      </div>
    </div>
  );
}
