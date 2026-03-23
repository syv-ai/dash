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
import type { ChatContentBlock } from '../../../shared/types';

interface ToolUseBlockProps {
  block: ChatContentBlock & { type: 'tool_use' };
  result?: (ChatContentBlock & { type: 'tool_result' }) | null;
}

export function ToolUseBlock({ block, result }: ToolUseBlockProps) {
  const [expanded, setExpanded] = useState(false);

  const { icon, summary, preview } = formatToolSummary(block, result);

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
        {icon}
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

      {/* Preview (shown when collapsed) */}
      {!expanded && preview && (
        <div className="border-t border-border/40" style={{ background: 'hsl(var(--surface-0))' }}>
          {preview}
        </div>
      )}

      {/* Expanded detail view */}
      {expanded && (
        <div className="border-t border-border/40">{renderExpandedDetail(block, result)}</div>
      )}
    </div>
  );
}

function renderExpandedDetail(
  block: ChatContentBlock & { type: 'tool_use' },
  result?: (ChatContentBlock & { type: 'tool_result' }) | null,
): React.ReactNode {
  const input = block.input as Record<string, any>;

  const lang = input.file_path ? langFromPath(input.file_path) : undefined;

  if (block.name === 'Edit') {
    const oldStr = typeof input.old_string === 'string' ? input.old_string : '';
    const newStr = typeof input.new_string === 'string' ? input.new_string : '';
    return buildFullDiff(oldStr, newStr, lang);
  }

  if (block.name === 'Write') {
    const content = typeof input.content === 'string' ? input.content : '';
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
  }

  if (block.name === 'Bash') {
    const cmd = typeof input.command === 'string' ? input.command : '';
    const output = result?.content || '';
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
            >
              {output}
            </pre>
          </div>
        )}
      </>
    );
  }

  if (block.name === 'Read') {
    const filePath = input.file_path || '';
    const output = result?.content || '';
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
  }

  if (block.name === 'Grep' || block.name === 'Glob') {
    const output = result?.content || '';
    return (
      <>
        <div className="px-3 py-2" style={{ background: 'hsl(var(--surface-0))' }}>
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">
            {block.name === 'Grep' ? 'Search' : 'Pattern'}
          </div>
          <pre className="text-[11px] font-mono text-foreground/70">
            {block.name === 'Grep'
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
            <pre className="text-[11px] font-mono text-foreground/70 whitespace-pre-wrap break-all overflow-x-auto max-h-[400px] overflow-y-auto">
              {output}
            </pre>
          </div>
        )}
      </>
    );
  }

  if (block.name === 'WebFetch') {
    const url = input.url || '';
    const prompt = input.prompt || '';
    const output = result?.content || '';
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
  }

  if (block.name === 'TaskCreate') {
    const subject = input.subject || '';
    const description = input.description || '';
    const output = result?.content || '';
    return (
      <div className="px-3 py-2" style={{ background: 'hsl(var(--surface-0))' }}>
        {subject && (
          <div className="text-[12px] font-medium text-foreground/90 mb-1">{subject}</div>
        )}
        {description && (
          <p className="text-[11px] text-foreground/70 whitespace-pre-wrap">{description}</p>
        )}
        {output && <div className="mt-2 text-[10px] text-muted-foreground">{output}</div>}
      </div>
    );
  }

  if (block.name === 'TaskUpdate') {
    const output = result?.content || '';
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
  }

  if (block.name === 'ToolSearch') {
    const query = input.query || '';
    const output = result?.content || '';
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

  // Default: raw JSON input + result
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

/**
 * Compute diff entries using LCS (Longest Common Subsequence) to correctly
 * identify unchanged lines within the changed section.
 */
function computeDiff(
  oldLines: string[],
  newLines: string[],
): Array<{ type: 'context' | 'removed' | 'added'; lineIdx: number }> {
  // Build LCS table
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

  // Backtrack to produce diff entries
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

function formatToolSummary(
  block: ChatContentBlock & { type: 'tool_use' },
  result?: (ChatContentBlock & { type: 'tool_result' }) | null,
): { icon: React.ReactNode; summary: string; preview: React.ReactNode | null } {
  const iconClass = 'text-muted-foreground flex-shrink-0';
  const iconProps = { size: 12, strokeWidth: 1.8, className: iconClass };
  const input = block.input as Record<string, any>;
  const fileName = (p: string) => p.split('/').pop() || p;

  switch (block.name) {
    case 'Read': {
      const file = input.file_path ? fileName(input.file_path) : 'file';
      const lineInfo = input.offset
        ? ` (lines ${input.offset}–${(input.offset || 0) + (input.limit || 100)})`
        : '';
      return {
        icon: <FileText {...iconProps} />,
        summary: `Read(${file})${lineInfo}`,
        preview: null,
      };
    }

    case 'Edit': {
      const file = input.file_path ? fileName(input.file_path) : 'file';
      const oldStr = typeof input.old_string === 'string' ? input.old_string : '';
      const newStr = typeof input.new_string === 'string' ? input.new_string : '';
      const oldLineCount = oldStr ? oldStr.split('\n').length : 0;
      const newLineCount = newStr ? newStr.split('\n').length : 0;
      const desc = input.replace_all ? ' (all occurrences)' : '';
      const editLang = input.file_path ? langFromPath(input.file_path) : undefined;
      return {
        icon: <FileEdit {...iconProps} />,
        summary: `Edit(${file})${desc}`,
        preview: buildDiffPreview(oldStr, newStr, oldLineCount, newLineCount, editLang),
      };
    }

    case 'Write': {
      const file = input.file_path ? fileName(input.file_path) : 'file';
      const content = typeof input.content === 'string' ? input.content : '';
      const allLines = content.split('\n');
      const totalLines = allLines.length;
      const showLines = allLines.slice(0, 8);
      const remaining = totalLines - showLines.length;
      return {
        icon: <FilePlus {...iconProps} />,
        summary: `Write(${file}) — ${totalLines} lines`,
        preview: (
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
        ),
      };
    }

    case 'Bash': {
      const cmd = typeof input.command === 'string' ? input.command : '';
      const resultContent = result?.content || '';
      const resultLines = resultContent.split('\n');
      const showLines = resultLines.slice(0, 6);
      const remaining = resultLines.length - showLines.length;
      let preview: React.ReactNode | null = null;
      if (resultContent.trim()) {
        preview = (
          <div className="px-3 py-1.5 overflow-hidden max-h-[120px]">
            <pre
              className={`text-[11px] font-mono whitespace-pre-wrap break-all ${
                result?.is_error ? 'text-destructive/80' : 'text-foreground/70'
              }`}
            >
              {showLines.join('\n')}
              {remaining > 0 ? `\n… +${remaining} lines` : ''}
            </pre>
          </div>
        );
      }
      return {
        icon: <Terminal {...iconProps} />,
        summary: cmd.length > 70 ? `$ ${cmd.slice(0, 67)}...` : `$ ${cmd}`,
        preview,
      };
    }

    case 'Grep': {
      const pattern = input.pattern || '';
      const path = input.path ? fileName(input.path) : '';
      return {
        icon: <Search {...iconProps} />,
        summary: `Grep("${pattern}")${path ? ` in ${path}` : ''}`,
        preview: null,
      };
    }

    case 'Glob': {
      const pattern = input.pattern || '';
      return {
        icon: <FolderSearch {...iconProps} />,
        summary: `Glob(${pattern})`,
        preview: null,
      };
    }

    case 'WebFetch': {
      const url = input.url || '';
      const prompt = input.prompt || '';
      return {
        icon: <Globe {...iconProps} />,
        summary: `WebFetch(${url.slice(0, 60)})`,
        preview: prompt ? (
          <div className="px-3 py-1.5">
            <span className="text-[11px] text-muted-foreground">{prompt.slice(0, 120)}</span>
          </div>
        ) : null,
      };
    }

    case 'WebSearch': {
      const query = input.query || '';
      return {
        icon: <Globe {...iconProps} />,
        summary: `WebSearch("${query.slice(0, 60)}")`,
        preview: null,
      };
    }

    case 'Agent': {
      const desc = input.description || input.prompt?.slice(0, 60) || 'subagent';
      const agentType = input.subagent_type || '';
      return {
        icon: <Bot {...iconProps} />,
        summary: agentType ? `Agent(${agentType}): ${desc}` : `Agent: ${desc}`,
        preview: null,
      };
    }

    case 'TaskCreate': {
      const subject = input.subject || '';
      return {
        icon: <ListChecks {...iconProps} />,
        summary: `TaskCreate: ${subject.slice(0, 60)}`,
        preview: input.description ? (
          <div className="px-3 py-1.5">
            <span className="text-[11px] text-muted-foreground">
              {input.description.slice(0, 150)}
            </span>
          </div>
        ) : null,
      };
    }

    case 'TaskUpdate': {
      const status = input.status || '';
      const taskId = input.taskId || '';
      const subject = input.subject || '';
      const label = subject
        ? `TaskUpdate(#${taskId}): ${subject.slice(0, 40)}`
        : `TaskUpdate(#${taskId}) → ${status}`;
      return {
        icon: <CheckCircle2 {...iconProps} />,
        summary: label,
        preview: null,
      };
    }

    case 'ToolSearch': {
      const query = input.query || '';
      return {
        icon: <PackageSearch {...iconProps} />,
        summary: `ToolSearch("${query.slice(0, 60)}")`,
        preview: null,
      };
    }

    default:
      return {
        icon: <Wrench {...iconProps} />,
        summary: `${block.name}`,
        preview: null,
      };
  }
}

function buildDiffPreview(
  oldStr: string,
  newStr: string,
  _oldLineCount: number,
  _newLineCount: number,
  lang?: string,
): React.ReactNode | null {
  if (!oldStr && !newStr) return null;

  const oldLines = oldStr.split('\n');
  const newLines = newStr.split('\n');
  const oldHighlighted = highlightBlock(oldStr, lang).split('\n');
  const newHighlighted = highlightBlock(newStr, lang).split('\n');

  const entries = computeDiff(oldLines, newLines);

  // Show up to 8 diff lines in the preview
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

function formatJson(obj: Record<string, unknown>): string {
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(obj);
  }
}
