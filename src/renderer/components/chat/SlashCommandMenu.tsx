import React, { useEffect, useRef } from 'react';
import {
  HelpCircle,
  Trash2,
  Minimize2,
  Settings,
  DollarSign,
  Stethoscope,
  LogIn,
  LogOut,
  Brain,
  Cpu,
  Shield,
  GitPullRequest,
  TerminalSquare,
} from 'lucide-react';

export interface SlashCommand {
  command: string;
  description: string;
  icon: React.ReactNode;
}

const ICON_PROPS = { size: 14, strokeWidth: 1.8 };

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    command: '/help',
    description: 'Show available commands',
    icon: <HelpCircle {...ICON_PROPS} />,
  },
  {
    command: '/clear',
    description: 'Clear conversation history',
    icon: <Trash2 {...ICON_PROPS} />,
  },
  {
    command: '/compact',
    description: 'Compact conversation to save context',
    icon: <Minimize2 {...ICON_PROPS} />,
  },
  { command: '/config', description: 'Show configuration', icon: <Settings {...ICON_PROPS} /> },
  {
    command: '/cost',
    description: 'Show token usage and cost',
    icon: <DollarSign {...ICON_PROPS} />,
  },
  {
    command: '/doctor',
    description: 'Run diagnostic checks',
    icon: <Stethoscope {...ICON_PROPS} />,
  },
  { command: '/login', description: 'Log in to your account', icon: <LogIn {...ICON_PROPS} /> },
  { command: '/logout', description: 'Log out of your account', icon: <LogOut {...ICON_PROPS} /> },
  { command: '/memory', description: 'View and manage memory', icon: <Brain {...ICON_PROPS} /> },
  { command: '/model', description: 'Switch AI model', icon: <Cpu {...ICON_PROPS} /> },
  {
    command: '/permissions',
    description: 'View and manage permissions',
    icon: <Shield {...ICON_PROPS} />,
  },
  {
    command: '/review',
    description: 'Review code changes',
    icon: <GitPullRequest {...ICON_PROPS} />,
  },
  {
    command: '/terminal-setup',
    description: 'Configure terminal integration',
    icon: <TerminalSquare {...ICON_PROPS} />,
  },
];

interface SlashCommandMenuProps {
  filter: string;
  selectedIndex: number;
  onSelect: (command: string) => void;
}

export function getFilteredCommands(filter: string): SlashCommand[] {
  const q = filter.toLowerCase().replace(/^\//, '');
  if (!q) return SLASH_COMMANDS;
  return SLASH_COMMANDS.filter(
    (cmd) => cmd.command.toLowerCase().includes(q) || cmd.description.toLowerCase().includes(q),
  );
}

export function SlashCommandMenu({ filter, selectedIndex, onSelect }: SlashCommandMenuProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const filtered = getFilteredCommands(filter);

  // Scroll selected item into view
  useEffect(() => {
    if (listRef.current) {
      const selected = listRef.current.children[selectedIndex] as HTMLElement;
      selected?.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  if (filtered.length === 0) return null;

  return (
    <div
      ref={listRef}
      className="absolute bottom-full left-0 right-0 mb-1 mx-3 max-h-[240px] overflow-y-auto rounded-lg border border-border/80 shadow-lg z-20"
      style={{ background: 'hsl(var(--popover))' }}
    >
      {filtered.map((cmd, i) => (
        <button
          key={cmd.command}
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(cmd.command);
          }}
          className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${
            i === selectedIndex
              ? 'bg-primary/10 text-foreground'
              : 'text-foreground/80 hover:bg-accent/50'
          }`}
        >
          <span className={i === selectedIndex ? 'text-primary' : 'text-muted-foreground'}>
            {cmd.icon}
          </span>
          <div className="flex-1 min-w-0">
            <span className="text-[12px] font-mono font-medium">{cmd.command}</span>
            <span className="text-[11px] text-muted-foreground ml-2">{cmd.description}</span>
          </div>
        </button>
      ))}
    </div>
  );
}
