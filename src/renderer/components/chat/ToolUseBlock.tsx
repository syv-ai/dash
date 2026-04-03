import React, { useState } from 'react';
import { highlightBlock, langFromPath } from './highlightCode';
import { Loader2 } from 'lucide-react';
import {
  ChevronRight,
  FileText,
  FileEdit,
  FilePlus,
  Terminal,
  Search,
  FolderSearch,
  Globe,
  Bot,
  AlertCircle,
  Wrench,
  ListChecks,
  CheckCircle2,
  PackageSearch,
} from 'lucide-react';
import type { LucideProps } from 'lucide-react';
import type { ChatContentBlock } from '../../../shared/types';

// ── Types ────────────────────────────────────────────────────────

type ToolInput = Record<string, any>;
type ToolResultBlock = (ChatContentBlock & { type: 'tool_result' }) | null | undefined;

interface ToolRenderer {
  icon: React.ComponentType<LucideProps>;
  summary: (input: ToolInput, result: ToolResultBlock) => string;
  preview?: (input: ToolInput, result: ToolResultBlock) => React.ReactNode | null;
  expanded?: (input: ToolInput, result: ToolResultBlock) => React.ReactNode;
}

// ── Helpers ──────────────────────────────────────────────────────

const fileName = (p: string) => p.split('/').pop() || p;

function resultContent(result: ToolResultBlock): string {
  return result?.content || '';
}

function formatJson(obj: Record<string, unknown>): string {
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(obj);
  }
}

// ── Tool Renderers ───────────────────────────────────────────────

const TOOL_RENDERERS: Record<string, ToolRenderer> = {
  Read: {
    icon: FileText,
    summary: (input) => {
      const file = input.file_path ? fileName(input.file_path) : 'file';
      const lineInfo = input.offset
        ? ` (lines ${input.offset}–${(input.offset || 0) + (input.limit || 100)})`
        : '';
      return `Read(${file})${lineInfo}`;
    },
    expanded: (input, result) => {
      const filePath = input.file_path || '';
      const output = resultContent(result);
      const readLang = filePath ? langFromPath(filePath) : undefined;
      const highlighted = output ? highlightBlock(output, readLang) : '';
      const htmlLines = highlighted ? highlighted.split('\n') : [];
      const startLine = input.offset || 1;
      return (
        <div className="overflow-y-auto max-h-[400px]">
          {htmlLines.map((html, i) => (
            <div key={i} className="flex text-[11px] font-mono leading-relaxed">
              <span className="w-10 text-right pr-2 text-muted-foreground/40 select-none flex-shrink-0">
                {startLine + i}
              </span>
              <span
                className="text-foreground/70 whitespace-pre-wrap break-all"
                dangerouslySetInnerHTML={{ __html: html || '&nbsp;' }}
              />
            </div>
          ))}
          {htmlLines.length === 0 && (
            <div className="px-3 py-2 text-[11px] text-muted-foreground">No content</div>
          )}
        </div>
      );
    },
  },

  Edit: {
    icon: FileEdit,
    summary: (input) => {
      const file = input.file_path ? fileName(input.file_path) : 'file';
      const desc = input.replace_all ? ' (all occurrences)' : '';
      return `Edit(${file})${desc}`;
    },
    preview: (input) => {
      const oldStr = typeof input.old_string === 'string' ? input.old_string : '';
      const newStr = typeof input.new_string === 'string' ? input.new_string : '';
      const lang = input.file_path ? langFromPath(input.file_path) : undefined;
      return buildDiffPreview(oldStr, newStr, lang);
    },
    expanded: (input) => {
      const oldStr = typeof input.old_string === 'string' ? input.old_string : '';
      const newStr = typeof input.new_string === 'string' ? input.new_string : '';
      const lang = input.file_path ? langFromPath(input.file_path) : undefined;
      return buildFullDiff(oldStr, newStr, lang);
    },
  },

  Write: {
    icon: FilePlus,
    summary: (input) => {
      const file = input.file_path ? fileName(input.file_path) : 'file';
      const content = typeof input.content === 'string' ? input.content : '';
      return `Write(${file}) — ${content.split('\n').length} lines`;
    },
    preview: (input) => {
      const content = typeof input.content === 'string' ? input.content : '';
      const allLines = content.split('\n');
      const showLines = allLines.slice(0, 8);
      const remaining = allLines.length - showLines.length;
      return (
        <div className="overflow-hidden max-h-[160px]">
          {showLines.map((line, i) => (
            <div
              key={i}
              className="flex text-[11px] font-mono leading-relaxed bg-[hsl(var(--git-added))]/10"
            >
              <span className="w-8 text-right pr-2 text-muted-foreground/50 select-none flex-shrink-0">
                {i + 1}
              </span>
              <span className="text-foreground/70 whitespace-pre-wrap break-all">{line}</span>
            </div>
          ))}
          {remaining > 0 && (
            <div className="px-3 py-1 text-[10px] text-muted-foreground/60">
              … +{remaining} lines
            </div>
          )}
        </div>
      );
    },
    expanded: (input) => {
      const content = typeof input.content === 'string' ? input.content : '';
      const lang = input.file_path ? langFromPath(input.file_path) : undefined;
      const highlighted = highlightBlock(content, lang);
      const htmlLines = highlighted.split('\n');
      return (
        <div className="overflow-y-auto max-h-[400px]">
          {htmlLines.map((html, i) => (
            <div
              key={i}
              className="flex text-[11px] font-mono leading-relaxed bg-[hsl(var(--git-added))]/10"
            >
              <span className="w-10 text-right pr-2 text-muted-foreground/50 select-none flex-shrink-0">
                {i + 1}
              </span>
              <span
                className="text-foreground/70 whitespace-pre-wrap break-all"
                dangerouslySetInnerHTML={{ __html: html || '&nbsp;' }}
              />
            </div>
          ))}
        </div>
      );
    },
  },

  Bash: {
    icon: Terminal,
    summary: (input) => {
      const cmd = typeof input.command === 'string' ? input.command : '';
      return cmd.length > 70 ? `$ ${cmd.slice(0, 67)}...` : `$ ${cmd}`;
    },
    preview: (_input, result) => {
      const output = resultContent(result);
      if (!output.trim()) return null;
      const lines = output.split('\n');
      const showLines = lines.slice(0, 6);
      const remaining = lines.length - showLines.length;
      const previewText = showLines.join('\n') + (remaining > 0 ? `\n… +${remaining} lines` : '');
      return (
        <div className="px-3 py-1.5 overflow-hidden max-h-[120px]">
          <pre
            className={`text-[11px] font-mono whitespace-pre-wrap break-all ${
              result?.is_error ? 'text-destructive/80' : 'text-foreground/70'
            }`}
            dangerouslySetInnerHTML={{
              __html: result?.is_error ? previewText : highlightBlock(previewText),
            }}
          />
        </div>
      );
    },
    expanded: (input, result) => {
      const cmd = typeof input.command === 'string' ? input.command : '';
      const output = resultContent(result);
      const highlighted = highlightBlock(cmd, 'bash');
      return (
        <>
          <div className="px-3 py-2" style={{ background: 'hsl(var(--surface-0))' }}>
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">
              Command
            </div>
            <pre className="text-[11px] font-mono leading-relaxed overflow-x-auto">
              <code dangerouslySetInnerHTML={{ __html: highlighted }} />
            </pre>
          </div>
          {output && (
            <div
              className="px-3 py-2 border-t border-border/40"
              style={{ background: 'hsl(var(--surface-0))' }}
            >
              <div
                className={`text-[10px] font-medium uppercase tracking-wide mb-1 ${
                  result?.is_error ? 'text-destructive' : 'text-muted-foreground'
                }`}
              >
                {result?.is_error ? 'Error' : 'Output'}
              </div>
              <pre
                className={`text-[11px] font-mono whitespace-pre-wrap break-all overflow-x-auto max-h-[400px] overflow-y-auto ${
                  result?.is_error ? 'text-destructive/80' : 'text-foreground/70'
                }`}
                dangerouslySetInnerHTML={{
                  __html: result?.is_error ? output : highlightBlock(output),
                }}
              />
            </div>
          )}
        </>
      );
    },
  },

  Grep: {
    icon: Search,
    summary: (input) => {
      const pattern = input.pattern || '';
      const path = input.path ? fileName(input.path) : '';
      return `Grep("${pattern}")${path ? ` in ${path}` : ''}`;
    },
    expanded: (input, result) => renderSearchExpanded(input, result, 'Search'),
  },

  Glob: {
    icon: FolderSearch,
    summary: (input) => `Glob(${input.pattern || ''})`,
    expanded: (input, result) => renderSearchExpanded(input, result, 'Pattern'),
  },

  WebFetch: {
    icon: Globe,
    summary: (input) => `WebFetch(${(input.url || '').slice(0, 60)})`,
    preview: (input) =>
      input.prompt ? (
        <div className="px-3 py-1.5">
          <span className="text-[11px] text-muted-foreground">{input.prompt.slice(0, 120)}</span>
        </div>
      ) : null,
    expanded: (input, result) => {
      const url = input.url || '';
      const prompt = input.prompt || '';
      const output = resultContent(result);
      return (
        <>
          <div className="px-3 py-2" style={{ background: 'hsl(var(--surface-0))' }}>
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">
              URL
            </div>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] font-mono text-primary hover:underline break-all"
            >
              {url}
            </a>
            {prompt && (
              <>
                <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1 mt-2">
                  Prompt
                </div>
                <p className="text-[11px] text-foreground/70">{prompt}</p>
              </>
            )}
          </div>
          {output && (
            <div
              className="px-3 py-2 border-t border-border/40"
              style={{ background: 'hsl(var(--surface-0))' }}
            >
              <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">
                Response
              </div>
              <pre className="text-[11px] font-mono text-foreground/70 whitespace-pre-wrap break-all overflow-x-auto max-h-[400px] overflow-y-auto">
                {output}
              </pre>
            </div>
          )}
        </>
      );
    },
  },

  WebSearch: {
    icon: Globe,
    summary: (input) => `WebSearch("${(input.query || '').slice(0, 60)}")`,
  },

  Agent: {
    icon: Bot,
    summary: (input) => {
      const desc = input.description || input.prompt?.slice(0, 60) || 'subagent';
      const agentType = input.subagent_type || '';
      return agentType ? `Agent(${agentType}): ${desc}` : `Agent: ${desc}`;
    },
  },

  TaskCreate: {
    icon: ListChecks,
    summary: (input) => `TaskCreate: ${(input.subject || '').slice(0, 60)}`,
    preview: (input) =>
      input.description ? (
        <div className="px-3 py-1.5">
          <span className="text-[11px] text-muted-foreground">
            {input.description.slice(0, 150)}
          </span>
        </div>
      ) : null,
    expanded: (input, result) => {
      const output = resultContent(result);
      return (
        <div className="px-3 py-2" style={{ background: 'hsl(var(--surface-0))' }}>
          {input.subject && (
            <div className="text-[12px] font-medium text-foreground/90 mb-1">{input.subject}</div>
          )}
          {input.description && (
            <p className="text-[11px] text-foreground/70 whitespace-pre-wrap">
              {input.description}
            </p>
          )}
          {output && <div className="mt-2 text-[10px] text-muted-foreground">{output}</div>}
        </div>
      );
    },
  },

  TaskUpdate: {
    icon: CheckCircle2,
    summary: (input) => {
      const taskId = input.taskId || '';
      const subject = input.subject || '';
      const status = input.status || '';
      return subject
        ? `TaskUpdate(#${taskId}): ${subject.slice(0, 40)}`
        : `TaskUpdate(#${taskId}) → ${status}`;
    },
    expanded: (input, result) => {
      const output = resultContent(result);
      return (
        <div className="px-3 py-2" style={{ background: 'hsl(var(--surface-0))' }}>
          <div className="flex gap-3 text-[11px]">
            {input.taskId && (
              <div>
                <span className="text-muted-foreground">Task:</span>{' '}
                <span className="font-mono text-foreground/80">#{input.taskId}</span>
              </div>
            )}
            {input.status && (
              <div>
                <span className="text-muted-foreground">Status:</span>{' '}
                <span
                  className={`font-medium ${
                    input.status === 'completed'
                      ? 'text-[hsl(var(--git-added))]'
                      : input.status === 'in_progress'
                        ? 'text-amber-400'
                        : 'text-foreground/80'
                  }`}
                >
                  {input.status}
                </span>
              </div>
            )}
            {input.subject && (
              <div>
                <span className="text-muted-foreground">Subject:</span>{' '}
                <span className="text-foreground/80">{input.subject}</span>
              </div>
            )}
          </div>
          {output && <div className="mt-1 text-[10px] text-muted-foreground">{output}</div>}
        </div>
      );
    },
  },

  ToolSearch: {
    icon: PackageSearch,
    summary: (input) => `ToolSearch("${(input.query || '').slice(0, 60)}")`,
    expanded: (input, result) => renderQueryExpanded(input.query || '', resultContent(result)),
  },
};

// ── Shared expanded renderers ────────────────────────────────────

function renderSearchExpanded(
  input: ToolInput,
  result: ToolResultBlock,
  label: string,
): React.ReactNode {
  const output = resultContent(result);
  return (
    <>
      <div className="px-3 py-2" style={{ background: 'hsl(var(--surface-0))' }}>
        <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">
          {label}
        </div>
        <pre className="text-[11px] font-mono text-foreground/70">
          {label === 'Search'
            ? `${input.pattern || ''}${input.path ? ` in ${input.path}` : ''}`
            : input.pattern || ''}
        </pre>
      </div>
      {output && (
        <div
          className="px-3 py-2 border-t border-border/40"
          style={{ background: 'hsl(var(--surface-0))' }}
        >
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">
            Results
          </div>
          <pre
            className="text-[11px] font-mono text-foreground/70 whitespace-pre-wrap break-all overflow-x-auto max-h-[400px] overflow-y-auto"
            dangerouslySetInnerHTML={{ __html: highlightBlock(output) }}
          />
        </div>
      )}
    </>
  );
}

function renderQueryExpanded(query: string, output: string): React.ReactNode {
  return (
    <>
      <div className="px-3 py-2" style={{ background: 'hsl(var(--surface-0))' }}>
        <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">
          Query
        </div>
        <pre className="text-[11px] font-mono text-foreground/70">{query}</pre>
      </div>
      {output && (
        <div
          className="px-3 py-2 border-t border-border/40"
          style={{ background: 'hsl(var(--surface-0))' }}
        >
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">
            Result
          </div>
          <pre className="text-[11px] font-mono text-foreground/70 whitespace-pre-wrap break-all overflow-x-auto max-h-[300px] overflow-y-auto">
            {output}
          </pre>
        </div>
      )}
    </>
  );
}

function renderDefaultExpanded(input: ToolInput, result: ToolResultBlock): React.ReactNode {
  return (
    <>
      <div className="px-3 py-2" style={{ background: 'hsl(var(--surface-0))' }}>
        <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">
          Input
        </div>
        <pre className="text-[11px] font-mono text-foreground/70 whitespace-pre-wrap break-all overflow-x-auto max-h-[300px] overflow-y-auto">
          {formatJson(input)}
        </pre>
      </div>
      {result && (
        <div
          className="px-3 py-2 border-t border-border/40"
          style={{ background: 'hsl(var(--surface-0))' }}
        >
          <div
            className={`text-[10px] font-medium uppercase tracking-wide mb-1 ${
              result.is_error ? 'text-destructive' : 'text-muted-foreground'
            }`}
          >
            {result.is_error ? 'Error' : 'Output'}
          </div>
          <pre
            className={`text-[11px] font-mono whitespace-pre-wrap break-all overflow-x-auto max-h-[300px] overflow-y-auto ${
              result.is_error ? 'text-destructive/80' : 'text-foreground/70'
            }`}
          >
            {result.content}
          </pre>
        </div>
      )}
    </>
  );
}

// ── Main Component ───────────────────────────────────────────────

interface ToolUseBlockProps {
  block: ChatContentBlock & { type: 'tool_use' };
  result?: (ChatContentBlock & { type: 'tool_result' }) | null;
}

export function ToolUseBlock({ block, result }: ToolUseBlockProps) {
  const [expanded, setExpanded] = useState(false);

  const renderer = TOOL_RENDERERS[block.name];
  const input = block.input as ToolInput;
  const iconClass = 'text-muted-foreground flex-shrink-0';
  const iconProps = { size: 12, strokeWidth: 1.8, className: iconClass };

  const Icon = renderer?.icon || Wrench;
  const summary = renderer?.summary(input, result) || block.name;
  const preview = renderer?.preview?.(input, result) || null;

  return (
    <div className="my-1.5 rounded-md border border-border/60 overflow-hidden min-w-0">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-accent/30 transition-colors"
        style={{ background: 'hsl(var(--surface-1))' }}
      >
        <ChevronRight
          size={12}
          strokeWidth={2}
          className={`text-muted-foreground transition-transform duration-150 flex-shrink-0 ${expanded ? 'rotate-90' : ''}`}
        />
        <Icon {...iconProps} />
        <span className="text-[12px] font-mono font-medium text-foreground/80 truncate">
          {summary}
        </span>
        <span className="ml-auto flex-shrink-0">
          {!result ? (
            <Loader2 size={11} strokeWidth={2} className="animate-spin text-amber-400" />
          ) : result?.is_error ? (
            <AlertCircle size={12} strokeWidth={2} className="text-destructive" />
          ) : (
            <div className="w-2 h-2 rounded-full bg-[hsl(var(--git-added))] animate-scale-in" />
          )}
        </span>
      </button>

      {!expanded && preview && (
        <div className="border-t border-border/40" style={{ background: 'hsl(var(--surface-0))' }}>
          {preview}
        </div>
      )}

      {expanded && (
        <div className="border-t border-border/40">
          {renderer?.expanded?.(input, result) || renderDefaultExpanded(input, result)}
        </div>
      )}
    </div>
  );
}

// ── Diff rendering ───────────────────────────────────────────────

function computeDiff(
  oldLines: string[],
  newLines: string[],
): Array<{ type: 'context' | 'removed' | 'added'; lineIdx: number }> {
  const m = oldLines.length;
  const n = newLines.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const entries: Array<{ type: 'context' | 'removed' | 'added'; lineIdx: number }> = [];
  let i = m;
  let j = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      entries.push({ type: 'context', lineIdx: j - 1 });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      entries.push({ type: 'added', lineIdx: j - 1 });
      j--;
    } else {
      entries.push({ type: 'removed', lineIdx: i - 1 });
      i--;
    }
  }

  entries.reverse();
  return entries;
}

function buildFullDiff(oldStr: string, newStr: string, lang?: string): React.ReactNode {
  const oldLines = oldStr.split('\n');
  const newLines = newStr.split('\n');
  const oldHighlighted = highlightBlock(oldStr, lang).split('\n');
  const newHighlighted = highlightBlock(newStr, lang).split('\n');
  const entries = computeDiff(oldLines, newLines);

  let oldLineNum = 1;
  let newLineNum = 1;
  const rows: React.ReactNode[] = [];

  for (const entry of entries) {
    if (entry.type === 'context') {
      rows.push(
        <DiffLine
          key={`ctx-${newLineNum}`}
          num={newLineNum}
          type="context"
          html={newHighlighted[entry.lineIdx]}
        />,
      );
      oldLineNum++;
      newLineNum++;
    } else if (entry.type === 'removed') {
      rows.push(
        <DiffLine
          key={`del-${oldLineNum}`}
          num={oldLineNum}
          type="removed"
          html={oldHighlighted[entry.lineIdx]}
        />,
      );
      oldLineNum++;
    } else {
      rows.push(
        <DiffLine
          key={`add-${newLineNum}`}
          num={newLineNum}
          type="added"
          html={newHighlighted[entry.lineIdx]}
        />,
      );
      newLineNum++;
    }
  }

  return <div className="overflow-y-auto max-h-[400px]">{rows}</div>;
}

function DiffLine({
  num,
  type,
  html,
}: {
  num: number;
  type: 'context' | 'added' | 'removed';
  html: string;
}) {
  const bg =
    type === 'added'
      ? 'bg-[hsl(var(--git-added))]/15'
      : type === 'removed'
        ? 'bg-[hsl(var(--git-deleted))]/15'
        : '';
  const marker =
    type === 'added' ? (
      <span className="text-[hsl(var(--git-added))]">+</span>
    ) : type === 'removed' ? (
      <span className="text-[hsl(var(--git-deleted))]">−</span>
    ) : (
      <span className="text-muted-foreground/30"> </span>
    );

  return (
    <div className={`flex text-[11px] font-mono leading-relaxed min-w-0 ${bg}`}>
      <span className="w-10 text-right pr-1 text-muted-foreground/40 select-none flex-shrink-0">
        {num}
      </span>
      <span className="w-4 text-center select-none flex-shrink-0">{marker}</span>
      <span
        className="text-foreground/70 whitespace-pre-wrap break-all min-w-0 overflow-hidden"
        dangerouslySetInnerHTML={{ __html: html || '&nbsp;' }}
      />
    </div>
  );
}

function buildDiffPreview(oldStr: string, newStr: string, lang?: string): React.ReactNode | null {
  if (!oldStr && !newStr) return null;

  const oldLines = oldStr.split('\n');
  const newLines = newStr.split('\n');
  const oldHighlighted = highlightBlock(oldStr, lang).split('\n');
  const newHighlighted = highlightBlock(newStr, lang).split('\n');
  const entries = computeDiff(oldLines, newLines);

  const MAX_PREVIEW = 8;
  const previewEntries = entries.filter((e) => e.type !== 'context').slice(0, MAX_PREVIEW);
  const totalChanged = entries.filter((e) => e.type !== 'context').length;
  const remaining = totalChanged - previewEntries.length;

  return (
    <div className="overflow-hidden max-h-[200px]">
      {previewEntries.map((entry, i) => {
        if (entry.type === 'removed') {
          return (
            <div
              key={`old-${i}`}
              className="flex text-[11px] font-mono leading-relaxed bg-[hsl(var(--git-deleted))]/15"
            >
              <span className="w-6 text-center text-[hsl(var(--git-deleted))] select-none flex-shrink-0">
                −
              </span>
              <span
                className="text-foreground/70 whitespace-pre-wrap break-all"
                dangerouslySetInnerHTML={{ __html: oldHighlighted[entry.lineIdx] || '&nbsp;' }}
              />
            </div>
          );
        }
        return (
          <div
            key={`new-${i}`}
            className="flex text-[11px] font-mono leading-relaxed bg-[hsl(var(--git-added))]/15"
          >
            <span className="w-6 text-center text-[hsl(var(--git-added))] select-none flex-shrink-0">
              +
            </span>
            <span
              className="text-foreground/70 whitespace-pre-wrap break-all"
              dangerouslySetInnerHTML={{ __html: newHighlighted[entry.lineIdx] || '&nbsp;' }}
            />
          </div>
        );
      })}
      {remaining > 0 && (
        <div className="pl-6 text-[10px] text-muted-foreground/60 py-0.5">
          … +{remaining} more changes
        </div>
      )}
    </div>
  );
}
