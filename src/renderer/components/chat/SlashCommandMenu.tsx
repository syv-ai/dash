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
  Zap,
  BarChart3,
  FileText,
  Bug,
  Palette,
  Eye,
  Clipboard,
  GitBranch,
  Globe,
  Puzzle,
  MessageSquare,
  Mic,
  Monitor,
  RefreshCw,
  Lock,
  Layers,
  Map,
} from 'lucide-react';

export interface SlashCommand {
  command: string;
  description: string;
  icon: React.ReactNode | null;
  source?: 'skill' | 'plugin' | 'mcp';
  interactive?: boolean;
}

const ICON_PROPS = { size: 14, strokeWidth: 1.8 };

export const SLASH_COMMANDS: SlashCommand[] = [
  // Most commonly used
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
    interactive: true,
  },
  {
    command: '/cost',
    description: 'Show token usage and cost',
    icon: <DollarSign {...ICON_PROPS} />,
  },
  {
    command: '/model',
    description: 'Switch AI model',
    icon: <Cpu {...ICON_PROPS} />,
    interactive: true,
  },
  {
    command: '/config',
    description: 'Show configuration',
    icon: <Settings {...ICON_PROPS} />,
    interactive: true,
  },
  {
    command: '/memory',
    description: 'View and manage memory',
    icon: <Brain {...ICON_PROPS} />,
    interactive: true,
  },
  {
    command: '/permissions',
    description: 'View and manage permissions',
    icon: <Shield {...ICON_PROPS} />,
    interactive: true,
  },
  {
    command: '/doctor',
    description: 'Run diagnostic checks',
    icon: <Stethoscope {...ICON_PROPS} />,
    interactive: true,
  },
  // Tool & extension management
  {
    command: '/mcp',
    description: 'Manage MCP servers',
    icon: <Globe {...ICON_PROPS} />,
    interactive: true,
  },
  {
    command: '/hooks',
    description: 'View hook configurations',
    icon: <Puzzle {...ICON_PROPS} />,
    interactive: true,
  },
  {
    command: '/skills',
    description: 'List available skills',
    icon: <Layers {...ICON_PROPS} />,
    interactive: true,
  },
  {
    command: '/plugin',
    description: 'Manage plugins',
    icon: <Puzzle {...ICON_PROPS} />,
    interactive: true,
  },
  // Session management
  {
    command: '/resume',
    description: 'Resume a previous session',
    icon: <RefreshCw {...ICON_PROPS} />,
    interactive: true,
  },
  {
    command: '/branch',
    description: 'Create conversation branch',
    icon: <GitBranch {...ICON_PROPS} />,
  },
  {
    command: '/rewind',
    description: 'Rewind to a checkpoint',
    icon: <RefreshCw {...ICON_PROPS} />,
    interactive: true,
  },
  // Mode toggles
  { command: '/plan', description: 'Enter plan/analysis mode', icon: <Map {...ICON_PROPS} /> },
  { command: '/fast', description: 'Toggle fast mode', icon: <Zap {...ICON_PROPS} /> },
  { command: '/vim', description: 'Toggle Vim mode', icon: <TerminalSquare {...ICON_PROPS} /> },
  { command: '/voice', description: 'Toggle voice dictation', icon: <Mic {...ICON_PROPS} /> },
  { command: '/sandbox', description: 'Toggle sandbox mode', icon: <Lock {...ICON_PROPS} /> },
  // Display & theme
  {
    command: '/theme',
    description: 'Change color theme',
    icon: <Palette {...ICON_PROPS} />,
    interactive: true,
  },
  {
    command: '/effort',
    description: 'Set effort level',
    icon: <BarChart3 {...ICON_PROPS} />,
    interactive: true,
  },
  {
    command: '/diff',
    description: 'View interactive diff',
    icon: <Eye {...ICON_PROPS} />,
    interactive: true,
  },
  {
    command: '/context',
    description: 'Show context usage',
    icon: <BarChart3 {...ICON_PROPS} />,
    interactive: true,
  },
  // Info & output
  {
    command: '/usage',
    description: 'Show plan usage and rate limits',
    icon: <BarChart3 {...ICON_PROPS} />,
  },
  { command: '/stats', description: 'Show usage statistics', icon: <BarChart3 {...ICON_PROPS} /> },
  {
    command: '/copy',
    description: 'Copy code block or response',
    icon: <Clipboard {...ICON_PROPS} />,
    interactive: true,
  },
  {
    command: '/export',
    description: 'Export conversation',
    icon: <FileText {...ICON_PROPS} />,
    interactive: true,
  },
  { command: '/release-notes', description: 'Show changelog', icon: <FileText {...ICON_PROPS} /> },
  // Review & analysis
  {
    command: '/review',
    description: 'Review code changes',
    icon: <GitPullRequest {...ICON_PROPS} />,
  },
  {
    command: '/security-review',
    description: 'Security vulnerability scan',
    icon: <Shield {...ICON_PROPS} />,
  },
  // Account
  { command: '/login', description: 'Log in to your account', icon: <LogIn {...ICON_PROPS} /> },
  { command: '/logout', description: 'Log out of your account', icon: <LogOut {...ICON_PROPS} /> },
  // Feedback
  {
    command: '/bug',
    description: 'Report a bug',
    icon: <Bug {...ICON_PROPS} />,
  },
  {
    command: '/feedback',
    description: 'Submit feedback',
    icon: <MessageSquare {...ICON_PROPS} />,
  },
  // Setup
  {
    command: '/terminal-setup',
    description: 'Configure terminal integration',
    icon: <TerminalSquare {...ICON_PROPS} />,
    interactive: true,
  },
  {
    command: '/ide',
    description: 'Manage IDE integration',
    icon: <Monitor {...ICON_PROPS} />,
    interactive: true,
  },
];

interface SlashCommandMenuProps {
  filter: string;
  selectedIndex: number;
  extraCommands?: SlashCommand[];
  onSelect: (command: string) => void;
}

const SOURCE_ICONS: Record<string, React.ReactNode> = {
  skill: <Layers {...ICON_PROPS} />,
  plugin: <Puzzle {...ICON_PROPS} />,
  mcp: <Globe {...ICON_PROPS} />,
};

export function getFilteredCommands(
  filter: string,
  extraCommands: SlashCommand[] = [],
): SlashCommand[] {
  const all = [...SLASH_COMMANDS, ...extraCommands];
  const q = filter.toLowerCase().replace(/^\//, '');
  if (!q) return all;
  return all.filter(
    (cmd) => cmd.command.toLowerCase().includes(q) || cmd.description.toLowerCase().includes(q),
  );
}

export function SlashCommandMenu({
  filter,
  selectedIndex,
  extraCommands,
  onSelect,
}: SlashCommandMenuProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const filtered = getFilteredCommands(filter, extraCommands);

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
            {cmd.icon || (cmd.source && SOURCE_ICONS[cmd.source]) || <Layers {...ICON_PROPS} />}
          </span>
          <div className="flex-1 min-w-0">
            <span className="text-[12px] font-mono font-medium">{cmd.command}</span>
            <span className="text-[11px] text-muted-foreground ml-2">{cmd.description}</span>
          </div>
          {cmd.interactive && (
            <span className="text-[9px] text-muted-foreground/50 flex-shrink-0">TUI</span>
          )}
        </button>
      ))}
    </div>
  );
}
