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
    <div className="my-1.5 rounded-md border border-border/60 overflow-hidden">
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

function buildFullDiff(oldStr: string, newStr: string, lang?: string): React.ReactNode {
  const oldLines = oldStr.split('\n');
  const newLines = newStr.split('\n');

  // Highlight both versions as complete blocks, then split into lines.
  // This gives highlight.js full context for multi-line token handling.
  const oldHighlighted = highlightBlock(oldStr, lang).split('\n');
  const newHighlighted = highlightBlock(newStr, lang).split('\n');

  // Simple diff: find common prefix and suffix
  let prefixLen = 0;
  while (
    prefixLen < oldLines.length &&
    prefixLen < newLines.length &&
    oldLines[prefixLen] === newLines[prefixLen]
  ) {
    prefixLen++;
  }

  let suffixLen = 0;
  while (
    suffixLen < oldLines.length - prefixLen &&
    suffixLen < newLines.length - prefixLen &&
    oldLines[oldLines.length - 1 - suffixLen] === newLines[newLines.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  let lineNum = 1;
  const rows: React.ReactNode[] = [];

  // Common prefix (context) — use old highlighted (same as new for these lines)
  for (let i = 0; i < prefixLen; i++) {
    rows.push(
      <DiffLine key={`ctx-pre-${lineNum}`} num={lineNum} type="context" html={oldHighlighted[i]} />,
    );
    lineNum++;
  }
  // Removed lines
  for (let i = prefixLen; i < oldLines.length - suffixLen; i++) {
    rows.push(
      <DiffLine key={`del-${lineNum}`} num={lineNum} type="removed" html={oldHighlighted[i]} />,
    );
    lineNum++;
  }
  // Added lines
  let addLineNum = prefixLen + 1;
  for (let i = prefixLen; i < newLines.length - suffixLen; i++) {
    rows.push(
      <DiffLine key={`add-${addLineNum}`} num={addLineNum} type="added" html={newHighlighted[i]} />,
    );
    addLineNum++;
  }
  // Common suffix (context)
  for (let i = newLines.length - suffixLen; i < newLines.length; i++) {
    rows.push(
      <DiffLine
        key={`ctx-suf-${addLineNum}`}
        num={addLineNum}
        type="context"
        html={newHighlighted[i]}
      />,
    );
    addLineNum++;
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
    <div className={`flex text-[11px] font-mono leading-relaxed ${bg}`}>
      <span className="w-10 text-right pr-1 text-muted-foreground/40 select-none flex-shrink-0">
        {num}
      </span>
      <span className="w-4 text-center select-none flex-shrink-0">{marker}</span>
      <span
        className="text-foreground/70 whitespace-pre-wrap break-all"
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

    case 'WebFetch':
    case 'WebSearch': {
      const query = input.query || input.url || '';
      return {
        icon: <Globe {...iconProps} />,
        summary: `${block.name}(${query.slice(0, 60)})`,
        preview: null,
      };
    }

    case 'Agent': {
      const desc = input.description || input.prompt?.slice(0, 60) || 'subagent';
      return {
        icon: <Bot {...iconProps} />,
        summary: `Agent: ${desc}`,
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
  oldLineCount: number,
  newLineCount: number,
  lang?: string,
): React.ReactNode | null {
  if (!oldStr && !newStr) return null;

  const oldHtml = highlightBlock(oldStr, lang).split('\n').slice(0, 4);
  const newHtml = highlightBlock(newStr, lang).split('\n').slice(0, 4);
  const oldRemaining = oldLineCount - oldHtml.length;
  const newRemaining = newLineCount - newHtml.length;

  return (
    <div className="overflow-hidden max-h-[200px]">
      {oldHtml.map((html, i) => (
        <div
          key={`old-${i}`}
          className="flex text-[11px] font-mono leading-relaxed bg-[hsl(var(--git-deleted))]/15"
        >
          <span className="w-6 text-center text-[hsl(var(--git-deleted))] select-none flex-shrink-0">
            −
          </span>
          <span
            className="text-foreground/70 whitespace-pre-wrap break-all"
            dangerouslySetInnerHTML={{ __html: html || '&nbsp;' }}
          />
        </div>
      ))}
      {oldRemaining > 0 && (
        <div className="pl-6 text-[10px] text-muted-foreground/60 bg-[hsl(var(--git-deleted))]/8 py-0.5">
          … +{oldRemaining} lines removed
        </div>
      )}
      {newHtml.map((html, i) => (
        <div
          key={`new-${i}`}
          className="flex text-[11px] font-mono leading-relaxed bg-[hsl(var(--git-added))]/15"
        >
          <span className="w-6 text-center text-[hsl(var(--git-added))] select-none flex-shrink-0">
            +
          </span>
          <span
            className="text-foreground/70 whitespace-pre-wrap break-all"
            dangerouslySetInnerHTML={{ __html: html || '&nbsp;' }}
          />
        </div>
      ))}
      {newRemaining > 0 && (
        <div className="pl-6 text-[10px] text-muted-foreground/60 bg-[hsl(var(--git-added))]/8 py-0.5">
          … +{newRemaining} lines added
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
