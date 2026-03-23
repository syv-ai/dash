import React, { useRef, useCallback, useState, useEffect } from 'react';
import { ChevronDown, Loader2, SendHorizonal, Terminal } from 'lucide-react';
import { SlashCommandMenu, getFilteredCommands, type SlashCommand } from './SlashCommandMenu';

export interface SubprocessInfo {
  id: string;
  name: string;
  summary: string;
  outputFile?: string;
}

interface ComposeBoxProps {
  onSend: (text: string) => void;
  disabled?: boolean;
  isBusy?: boolean;
  themeBg?: string;
  cwd?: string;
  placeholder?: string;
  activeSubprocesses?: SubprocessInfo[];
}

export function ComposeBox({
  onSend,
  disabled = false,
  isBusy = false,
  themeBg,
  cwd,
  placeholder = 'Send a message...',
  activeSubprocesses = [],
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
  const [showTasks, setShowTasks] = useState(false);
  const [taskSelectedIndex, setTaskSelectedIndex] = useState(0);
  const [viewingTaskFile, setViewingTaskFile] = useState<string | null>(null);
  const [taskOutput, setTaskOutput] = useState('');
  const taskPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll the viewed task's output file
  useEffect(() => {
    if (!viewingTaskFile) {
      setTaskOutput('');
      if (taskPollRef.current) {
        clearInterval(taskPollRef.current);
        taskPollRef.current = null;
      }
      return;
    }
    const readFile = async () => {
      try {
        const resp = await window.electronAPI.ptyReadFile(viewingTaskFile);
        if (resp.success && resp.data) setTaskOutput(resp.data);
      } catch {
        // File may not exist yet
      }
    };
    readFile();
    taskPollRef.current = setInterval(readFile, 1000);
    return () => {
      if (taskPollRef.current) clearInterval(taskPollRef.current);
    };
  }, [viewingTaskFile]);
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
        const tabIds: Array<'all' | 'commands' | 'skills' | 'plugins' | 'mcp'> = [
          'all',
          'commands',
          'skills',
          'plugins',
          'mcp',
        ];
        // Arrow up/down: navigate items
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
        // Arrow left/right: cycle tabs
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          const currentIdx = tabIds.indexOf(slashTab);
          setSlashTab(tabIds[(currentIdx - 1 + tabIds.length) % tabIds.length]);
          setSlashSelectedIndex(0);
          return;
        }
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          const currentIdx = tabIds.indexOf(slashTab);
          setSlashTab(tabIds[(currentIdx + 1) % tabIds.length]);
          setSlashSelectedIndex(0);
          return;
        }
        // Enter: directly submit the selected command
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          if (filtered[slashSelectedIndex]) {
            onSend(filtered[slashSelectedIndex].command);
            setValue('');
            setShowSlashMenu(false);
          }
          return;
        }
        // Tab: insert command into input for editing/adding arguments
        if (e.key === 'Tab') {
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
      }

      // Enter in tasks panel → view task logs inline
      if (e.key === 'Enter' && !e.shiftKey && showTasks && activeSubprocesses.length > 0) {
        e.preventDefault();
        const task = activeSubprocesses[taskSelectedIndex];
        if (task?.outputFile) {
          setViewingTaskFile((prev) => (prev === task.outputFile ? null : task.outputFile!));
        }
        return;
      }

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
        return;
      }

      // Arrow down at end of input → open/navigate tasks panel
      if (e.key === 'ArrowDown' && activeSubprocesses.length > 0 && !showSlashMenu) {
        const el = textareaRef.current;
        if (el && el.selectionStart === el.value.length) {
          e.preventDefault();
          if (!showTasks) {
            setShowTasks(true);
            setTaskSelectedIndex(0);
          } else {
            setTaskSelectedIndex((prev) => (prev < activeSubprocesses.length - 1 ? prev + 1 : 0));
          }
          return;
        }
      }
      // Arrow up in tasks panel
      if (e.key === 'ArrowUp' && showTasks && !showSlashMenu) {
        e.preventDefault();
        setTaskSelectedIndex((prev) => (prev > 0 ? prev - 1 : activeSubprocesses.length - 1));
        return;
      }
      // Escape closes log view first, then tasks panel
      if (e.key === 'Escape' && (viewingTaskFile || showTasks)) {
        e.preventDefault();
        if (viewingTaskFile) {
          setViewingTaskFile(null);
        } else {
          setShowTasks(false);
        }
        return;
      }
    },
    [
      handleSend,
      handleSlashSelect,
      showSlashMenu,
      showTasks,
      taskSelectedIndex,
      slashSelectedIndex,
      slashTab,
      dynamicCommands,
      value,
      activeSubprocesses,
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
      <div className="mt-1.5 text-[10px] text-muted-foreground flex items-center justify-between px-0.5">
        <div>
          {activeSubprocesses.length > 0 ? (
            <button
              onClick={() => {
                setShowTasks((prev) => !prev);
                setTaskSelectedIndex(0);
              }}
              className="flex items-center gap-1 text-primary hover:text-primary/80 transition-colors"
            >
              <span>
                {activeSubprocesses.length} {activeSubprocesses.length === 1 ? 'task' : 'tasks'}
              </span>
              <ChevronDown
                size={9}
                strokeWidth={2}
                className={`transition-transform duration-150 ${showTasks ? 'rotate-180' : ''}`}
              />
            </button>
          ) : (
            <span />
          )}
        </div>
        <div>
          {isBusy ? (
            'Esc to interrupt'
          ) : (
            <>
              Enter to send, Shift+Enter for new line ·{' '}
              <span className="text-amber-400">Chat UI is experimental</span>
            </>
          )}
        </div>
      </div>
      {showTasks && activeSubprocesses.length > 0 && (
        <div className="mt-1 rounded-md border border-border/40 overflow-hidden">
          {activeSubprocesses.map((task, i) => (
            <div
              key={task.id}
              onClick={() => {
                setTaskSelectedIndex(i);
                if (task.outputFile) {
                  setViewingTaskFile((prev) =>
                    prev === task.outputFile ? null : task.outputFile!,
                  );
                }
              }}
              className={`flex items-center gap-2 px-2.5 py-1.5 text-[10px] cursor-pointer transition-colors ${
                i === taskSelectedIndex
                  ? 'bg-primary/10 text-foreground'
                  : 'text-muted-foreground/70 hover:bg-accent/30'
              }`}
              style={
                i !== taskSelectedIndex ? { background: 'hsl(var(--surface-0) / 0.5)' } : undefined
              }
            >
              <Terminal size={9} strokeWidth={1.8} className="flex-shrink-0" />
              <span className="font-mono truncate">{task.summary}</span>
              <Loader2
                size={9}
                strokeWidth={2}
                className="animate-spin text-amber-400 ml-auto flex-shrink-0"
              />
            </div>
          ))}
          {viewingTaskFile && (
            <div
              className="border-t border-border/40 max-h-[200px] overflow-y-auto"
              style={{ background: 'hsl(var(--surface-0))' }}
            >
              <pre className="px-2.5 py-2 text-[10px] font-mono text-foreground/70 whitespace-pre-wrap break-all">
                {taskOutput || 'Waiting for output...'}
              </pre>
            </div>
          )}
          <div
            className="px-2.5 py-1 text-[9px] text-muted-foreground/40 border-t border-border/30"
            style={{ background: 'hsl(var(--surface-0) / 0.3)' }}
          >
            ↑↓ navigate · Enter to view logs · Esc to close
          </div>
        </div>
      )}
    </div>
  );
}
