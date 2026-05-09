import React, { useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  ChevronRight,
  FileText,
  FilePenLine,
  FilePlus,
  TerminalSquare,
  GitBranch,
  FolderOpen,
  Search,
  Wrench,
  Globe,
} from 'lucide-react';
import type { LinkedToolExecution } from '../../../shared/sessionTypes';
import { BashViewer } from './viewers/BashViewer';
import { ReadViewer } from './viewers/ReadViewer';
import { EditViewer } from './viewers/EditViewer';
import { WriteViewer } from './viewers/WriteViewer';
import { TaskViewer } from './viewers/TaskViewer';
import { DefaultViewer } from './viewers/DefaultViewer';

type ToolCategory = 'read' | 'write' | 'shell' | 'search' | 'agent' | 'web' | 'default';

const TOOL_CATEGORY: Record<string, ToolCategory> = {
  Read: 'read',
  'MultiTool::ReadFile': 'read',
  Edit: 'write',
  'MultiTool::EditFile': 'write',
  Write: 'write',
  'MultiTool::CreateFile': 'write',
  Bash: 'shell',
  'MultiTool::BashCommand': 'shell',
  Task: 'agent',
  Agent: 'agent',
  ListFiles: 'search',
  'MultiTool::ListDirectory': 'search',
  Glob: 'search',
  SearchFiles: 'search',
  'MultiTool::SearchFiles': 'search',
  Grep: 'search',
  WebSearch: 'web',
  WebFetch: 'web',
};

const CATEGORY_STYLES: Record<ToolCategory, { border: string; icon: string; bg: string }> = {
  read: { border: 'border-l-blue-400', icon: 'text-blue-400', bg: 'bg-blue-400/5' },
  write: { border: 'border-l-amber-400', icon: 'text-amber-400', bg: 'bg-amber-400/5' },
  shell: { border: 'border-l-green-400', icon: 'text-green-400', bg: 'bg-green-400/5' },
  search: { border: 'border-l-purple-400', icon: 'text-purple-400', bg: 'bg-purple-400/5' },
  agent: { border: 'border-l-cyan-400', icon: 'text-cyan-400', bg: 'bg-cyan-400/5' },
  web: { border: 'border-l-rose-400', icon: 'text-rose-400', bg: 'bg-rose-400/5' },
  default: {
    border: 'border-l-muted-foreground/40',
    icon: 'text-muted-foreground/60',
    bg: 'bg-surface-0',
  },
};

const TOOL_ICONS: Record<string, LucideIcon> = {
  Read: FileText,
  'MultiTool::ReadFile': FileText,
  Edit: FilePenLine,
  'MultiTool::EditFile': FilePenLine,
  Write: FilePlus,
  'MultiTool::CreateFile': FilePlus,
  Bash: TerminalSquare,
  'MultiTool::BashCommand': TerminalSquare,
  Task: GitBranch,
  Agent: GitBranch,
  ListFiles: FolderOpen,
  'MultiTool::ListDirectory': FolderOpen,
  Glob: FolderOpen,
  SearchFiles: Search,
  'MultiTool::SearchFiles': Search,
  Grep: Search,
  WebSearch: Globe,
  WebFetch: Globe,
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

function getToolSummary(exec: LinkedToolExecution): string {
  const { toolCall } = exec;
  const input = toolCall.input;

  switch (toolCall.name) {
    case 'Read':
    case 'MultiTool::ReadFile':
    case 'Edit':
    case 'MultiTool::EditFile':
    case 'Write':
    case 'MultiTool::CreateFile':
      return (
        String(input.file_path ?? input.filePath ?? '')
          .split('/')
          .pop() ?? ''
      );
    case 'Bash':
    case 'MultiTool::BashCommand':
      return String(input.command ?? '')
        .replace(/\n/g, ' ')
        .slice(0, 80);
    case 'Task':
    case 'Agent':
      return String(input.description ?? input.prompt ?? '').slice(0, 80);
    case 'Glob':
    case 'ListFiles':
    case 'MultiTool::ListDirectory':
      return String(input.pattern ?? input.path ?? '').slice(0, 80);
    case 'Grep':
    case 'SearchFiles':
    case 'MultiTool::SearchFiles':
      return String(input.pattern ?? input.query ?? '').slice(0, 80);
    default:
      return '';
  }
}

function getViewer(exec: LinkedToolExecution): React.ReactNode {
  switch (exec.toolCall.name) {
    case 'Bash':
    case 'MultiTool::BashCommand':
      return <BashViewer exec={exec} />;
    case 'Read':
    case 'MultiTool::ReadFile':
      return <ReadViewer exec={exec} />;
    case 'Edit':
    case 'MultiTool::EditFile':
      return <EditViewer exec={exec} />;
    case 'Write':
    case 'MultiTool::CreateFile':
      return <WriteViewer exec={exec} />;
    case 'Task':
    case 'Agent':
      return <TaskViewer exec={exec} />;
    default:
      return <DefaultViewer exec={exec} />;
  }
}

function getToolLabel(name: string): string {
  return name.replace('MultiTool::', '');
}

interface ToolCallCardProps {
  exec: LinkedToolExecution;
}

export function ToolCallCard({ exec }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);
  const { toolCall, result, durationMs } = exec;

  const category = TOOL_CATEGORY[toolCall.name] ?? 'default';
  const styles = CATEGORY_STYLES[category];
  const Icon = TOOL_ICONS[toolCall.name] ?? Wrench;
  const summary = getToolSummary(exec);

  const statusDot = !result
    ? 'bg-amber-400 animate-pulse'
    : result.isError
      ? 'bg-destructive'
      : 'bg-green-500';

  return (
    <div className={`border-l-2 ${styles.border} rounded-r ${styles.bg}`}>
      <button
        className="w-full flex items-center gap-1.5 px-2 py-1 text-left hover:bg-foreground/[0.03] transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <ChevronRight
          size={10}
          strokeWidth={2.5}
          className={`text-muted-foreground/30 transition-transform flex-shrink-0 ${expanded ? 'rotate-90' : ''}`}
        />
        <Icon size={12} strokeWidth={1.8} className={`flex-shrink-0 ${styles.icon}`} />
        <span className={`text-[10px] font-semibold ${styles.icon} flex-shrink-0`}>
          {getToolLabel(toolCall.name)}
        </span>
        {summary && (
          <span className="text-[10px] text-muted-foreground/50 truncate min-w-0 flex-1 font-mono">
            {summary}
          </span>
        )}
        <div className="flex items-center gap-1 flex-shrink-0 ml-auto">
          {durationMs != null && durationMs > 0 && (
            <span className="text-[9px] text-muted-foreground/40 font-mono">
              {formatDuration(durationMs)}
            </span>
          )}
          <div
            className={`w-2 h-2 rounded-full ring-1 ring-foreground/10 ${statusDot}`}
            aria-label={!result ? 'in progress' : result.isError ? 'error' : 'success'}
          />
        </div>
      </button>
      {expanded && (
        <div className="border-t border-border/20 px-2 py-1.5 text-[11px]">{getViewer(exec)}</div>
      )}
    </div>
  );
}
