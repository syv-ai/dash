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

type TabId = 'all' | 'commands' | 'skills' | 'plugins' | 'mcp';

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'all', label: 'All', icon: null },
  { id: 'commands', label: 'Commands', icon: <TerminalSquare {...ICON_PROPS} /> },
  { id: 'skills', label: 'Skills', icon: <Layers {...ICON_PROPS} /> },
  { id: 'plugins', label: 'Plugins', icon: <Puzzle {...ICON_PROPS} /> },
  { id: 'mcp', label: 'MCP', icon: <Globe {...ICON_PROPS} /> },
];

interface SlashCommandMenuProps {
  filter: string;
  selectedIndex: number;
  extraCommands?: SlashCommand[];
  onSelect: (command: string) => void;
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

const SOURCE_ICONS: Record<string, React.ReactNode> = {
  skill: <Layers {...ICON_PROPS} />,
  plugin: <Puzzle {...ICON_PROPS} />,
  mcp: <Globe {...ICON_PROPS} />,
};

const TAB_TO_SOURCE: Record<TabId, string | undefined> = {
  all: undefined,
  commands: undefined,
  skills: 'skill',
  plugins: 'plugin',
  mcp: 'mcp',
};

function filterByTab(commands: SlashCommand[], tab: TabId): SlashCommand[] {
  if (tab === 'all') return commands;
  if (tab === 'commands') return commands.filter((c) => !c.source);
  const source = TAB_TO_SOURCE[tab];
  return commands.filter((c) => c.source === source);
}

export function getFilteredCommands(
  filter: string,
  extraCommands: SlashCommand[] = [],
  tab: TabId = 'all',
): SlashCommand[] {
  const all = [...SLASH_COMMANDS, ...extraCommands];
  const tabFiltered = filterByTab(all, tab);
  const q = filter.toLowerCase().replace(/^\//, '');
  if (!q) return tabFiltered;
  return tabFiltered.filter(
    (cmd) => cmd.command.toLowerCase().includes(q) || cmd.description.toLowerCase().includes(q),
  );
}

export function SlashCommandMenu({
  filter,
  selectedIndex,
  extraCommands,
  onSelect,
  activeTab,
  onTabChange,
}: SlashCommandMenuProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const allCommands = [...SLASH_COMMANDS, ...(extraCommands || [])];
  const filtered = getFilteredCommands(filter, extraCommands, activeTab);

  // Count items per tab for badges
  const q = filter.toLowerCase().replace(/^\//, '');
  const textFiltered = q
    ? allCommands.filter(
        (c) => c.command.toLowerCase().includes(q) || c.description.toLowerCase().includes(q),
      )
    : allCommands;
  const tabCounts: Record<TabId, number> = {
    all: textFiltered.length,
    commands: textFiltered.filter((c) => !c.source).length,
    skills: textFiltered.filter((c) => c.source === 'skill').length,
    plugins: textFiltered.filter((c) => c.source === 'plugin').length,
    mcp: textFiltered.filter((c) => c.source === 'mcp').length,
  };

  // Scroll selected item into view
  useEffect(() => {
    if (listRef.current) {
      const items = listRef.current.querySelectorAll('[data-cmd-item]');
      const selected = items[selectedIndex] as HTMLElement;
      selected?.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  if (filtered.length === 0 && tabCounts.all === 0) return null;

  return (
    <div
      className="absolute bottom-full left-0 right-0 mb-1 mx-3 rounded-lg border border-border/80 shadow-lg z-20 flex flex-col"
      style={{ background: 'hsl(var(--popover))' }}
    >
      {/* Tab bar */}
      <div className="flex items-center gap-0.5 px-2 pt-2 pb-1 border-b border-border/40">
        {TABS.map((tab) => {
          const count = tabCounts[tab.id];
          if (tab.id !== 'all' && tab.id !== 'commands' && count === 0) return null;
          return (
            <button
              key={tab.id}
              onMouseDown={(e) => {
                e.preventDefault();
                onTabChange(tab.id);
              }}
              className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors ${
                activeTab === tab.id
                  ? 'bg-primary/15 text-primary'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
              }`}
            >
              {tab.label}
              {count > 0 && (
                <span
                  className={`text-[9px] ${
                    activeTab === tab.id ? 'text-primary/70' : 'text-muted-foreground/50'
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Command list */}
      <div ref={listRef} className="h-[200px] overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="px-3 py-3 text-[11px] text-muted-foreground/50 text-center">
            No commands found
          </div>
        ) : (
          filtered.map((cmd, i) => (
            <button
              key={cmd.command}
              data-cmd-item
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
              <div className="flex-1 min-w-0 truncate">
                <span className="text-[12px] font-mono font-medium">{cmd.command}</span>
                <span className="text-[11px] text-muted-foreground ml-2">{cmd.description}</span>
              </div>
              {cmd.interactive && (
                <span className="text-[9px] text-muted-foreground/50 flex-shrink-0">TUI</span>
              )}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
