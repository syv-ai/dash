import React, { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import { X, FileText, MessageSquare, Send } from 'lucide-react';
import type { DiffResult, DiffLine, DiffHunk } from '../../shared/types';
import { sessionRegistry } from '../terminal/SessionRegistry';

// ── Internal Types ──────────────────────────────────────────

interface LineAddress {
  hunkIndex: number;
  lineIndex: number;
  lineNumber: number; // newLineNumber ?? oldLineNumber
}

interface DiffComment {
  id: string;
  startAddress: LineAddress;
  endAddress: LineAddress;
  comment: string;
  lines: DiffLine[];
}

interface SelectionState {
  anchor: LineAddress;
  current: LineAddress;
  active: boolean; // true while dragging
}

interface PopoverState {
  top: number;
  left: number;
  startAddress: LineAddress;
  endAddress: LineAddress;
  lines: DiffLine[];
}

// ── Helpers ─────────────────────────────────────────────────

function buildLineIndex(hunks: DiffHunk[]): Map<string, number> {
  const map = new Map<string, number>();
  let i = 0;
  for (let hi = 0; hi < hunks.length; hi++) {
    for (let li = 0; li < hunks[hi].lines.length; li++) {
      map.set(`${hi}-${li}`, i++);
    }
  }
  return map;
}

function getLineNumber(line: DiffLine): number {
  return line.newLineNumber ?? line.oldLineNumber ?? 0;
}

function getLanguageFromPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const langMap: Record<string, string> = {
    ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
    py: 'python', rb: 'ruby', go: 'go', rs: 'rust',
    java: 'java', kt: 'kotlin', swift: 'swift',
    css: 'css', scss: 'scss', html: 'html',
    json: 'json', yaml: 'yaml', yml: 'yaml',
    md: 'markdown', sql: 'sql', sh: 'bash',
    c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp',
    cs: 'csharp', php: 'php', lua: 'lua',
  };
  return langMap[ext] || ext || '';
}

/** Resolve flat indices for a range, returning [lo, hi] in order */
function resolveRange(
  lineIndex: Map<string, number>,
  a: LineAddress,
  b: LineAddress,
): [number, number] | null {
  const ai = lineIndex.get(`${a.hunkIndex}-${a.lineIndex}`);
  const bi = lineIndex.get(`${b.hunkIndex}-${b.lineIndex}`);
  if (ai === undefined || bi === undefined) return null;
  return ai <= bi ? [ai, bi] : [bi, ai];
}

/** Get ordered start/end addresses (so start is always before end in the file) */
function orderedAddresses(
  lineIndex: Map<string, number>,
  a: LineAddress,
  b: LineAddress,
): [LineAddress, LineAddress] {
  const ai = lineIndex.get(`${a.hunkIndex}-${a.lineIndex}`) ?? 0;
  const bi = lineIndex.get(`${b.hunkIndex}-${b.lineIndex}`) ?? 0;
  return ai <= bi ? [a, b] : [b, a];
}

/** Collect DiffLine objects between two addresses */
function collectLines(
  hunks: DiffHunk[],
  lineIndex: Map<string, number>,
  start: LineAddress,
  end: LineAddress,
): DiffLine[] {
  const range = resolveRange(lineIndex, start, end);
  if (!range) return [];
  const [lo, hi] = range;
  const result: DiffLine[] = [];
  for (let hunkIdx = 0; hunkIdx < hunks.length; hunkIdx++) {
    for (let lineIdx = 0; lineIdx < hunks[hunkIdx].lines.length; lineIdx++) {
      const flat = lineIndex.get(`${hunkIdx}-${lineIdx}`);
      if (flat !== undefined && flat >= lo && flat <= hi) {
        result.push(hunks[hunkIdx].lines[lineIdx]);
      }
    }
  }
  return result;
}

// ── Component ───────────────────────────────────────────────

interface DiffViewerProps {
  diff: DiffResult | null;
  loading: boolean;
  activeTaskId: string | null;
  onClose: () => void;
}

export function DiffViewer({ diff, loading, activeTaskId, onClose }: DiffViewerProps) {
  const [comments, setComments] = useState<DiffComment[]>([]);
  const [selection, setSelection] = useState<SelectionState | null>(null);
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const [popoverText, setPopoverText] = useState('');
  const contentRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const lineIndex = useMemo(
    () => (diff?.hunks ? buildLineIndex(diff.hunks) : new Map<string, number>()),
    [diff?.hunks],
  );

  // ── Selection helpers ───────────────────────────────────

  const isLineInSelection = useCallback(
    (hi: number, li: number): boolean => {
      if (!selection) return false;
      const range = resolveRange(lineIndex, selection.anchor, selection.current);
      if (!range) return false;
      const flat = lineIndex.get(`${hi}-${li}`);
      return flat !== undefined && flat >= range[0] && flat <= range[1];
    },
    [selection, lineIndex],
  );

  const isLineCommented = useCallback(
    (hi: number, li: number): boolean => {
      const flat = lineIndex.get(`${hi}-${li}`);
      if (flat === undefined) return false;
      return comments.some((c) => {
        const range = resolveRange(lineIndex, c.startAddress, c.endAddress);
        return range !== null && flat >= range[0] && flat <= range[1];
      });
    },
    [comments, lineIndex],
  );

  const isFirstLineOfComment = useCallback(
    (hi: number, li: number): boolean => {
      return comments.some(
        (c) => c.startAddress.hunkIndex === hi && c.startAddress.lineIndex === li,
      );
    },
    [comments],
  );

  // ── Mouse selection handlers ────────────────────────────

  const findLineFromPoint = useCallback(
    (x: number, y: number): LineAddress | null => {
      const el = document.elementFromPoint(x, y);
      if (!el) return null;
      const row = (el as HTMLElement).closest('[data-hunk]') as HTMLElement | null;
      if (!row) return null;
      const hi = parseInt(row.dataset.hunk!, 10);
      const li = parseInt(row.dataset.line!, 10);
      if (isNaN(hi) || isNaN(li)) return null;
      const line = diff?.hunks[hi]?.lines[li];
      if (!line) return null;
      return { hunkIndex: hi, lineIndex: li, lineNumber: getLineNumber(line) };
    },
    [diff],
  );

  const handleGutterMouseDown = useCallback(
    (e: React.MouseEvent, hi: number, li: number) => {
      e.preventDefault();
      // Close any open popover when starting a new selection
      if (popover) {
        setPopover(null);
        setPopoverText('');
      }
      const line = diff?.hunks[hi]?.lines[li];
      if (!line) return;
      const addr: LineAddress = { hunkIndex: hi, lineIndex: li, lineNumber: getLineNumber(line) };
      setSelection({ anchor: addr, current: addr, active: true });
    },
    [diff, popover],
  );

  // Document-level mousemove/mouseup during active drag
  useEffect(() => {
    if (!selection?.active) return;

    function handleMouseMove(e: MouseEvent) {
      const addr = findLineFromPoint(e.clientX, e.clientY);
      if (addr) {
        setSelection((prev) => (prev ? { ...prev, current: addr } : null));
      }
    }

    function handleMouseUp(e: MouseEvent) {
      setSelection((prev) => {
        if (!prev) return null;
        // Finalize: mark as not active
        const final = { ...prev, active: false };

        // Show popover near the end of selection
        const addr = findLineFromPoint(e.clientX, e.clientY) ?? prev.current;
        final.current = addr;

        // Position popover
        const row = document.querySelector(
          `[data-hunk="${addr.hunkIndex}"][data-line="${addr.lineIndex}"]`,
        ) as HTMLElement | null;
        if (row && contentRef.current && diff) {
          const rowRect = row.getBoundingClientRect();
          const containerRect = contentRef.current.getBoundingClientRect();
          const [startAddr, endAddr] = orderedAddresses(lineIndex, prev.anchor, addr);
          const lines = collectLines(diff.hunks, lineIndex, startAddr, endAddr);

          setPopover({
            top: rowRect.bottom - containerRect.top + contentRef.current.scrollTop + 4,
            left: Math.min(rowRect.left - containerRect.left + 100, containerRect.width - 340),
            startAddress: startAddr,
            endAddress: endAddr,
            lines,
          });
          setPopoverText('');
          // Focus textarea after render
          requestAnimationFrame(() => textareaRef.current?.focus());
        }

        return final;
      });
    }

    // Prevent text selection during drag
    contentRef.current?.classList.add('select-none');
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      contentRef.current?.classList.remove('select-none');
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [selection?.active, findLineFromPoint, diff, lineIndex]);

  // ── Popover actions ─────────────────────────────────────

  function handleAddComment() {
    if (!popover || !popoverText.trim()) return;
    const newComment: DiffComment = {
      id: crypto.randomUUID(),
      startAddress: popover.startAddress,
      endAddress: popover.endAddress,
      comment: popoverText.trim(),
      lines: popover.lines,
    };
    setComments((prev) => [...prev, newComment]);
    setPopover(null);
    setPopoverText('');
    setSelection(null);
  }

  function handleCancelComment() {
    setPopover(null);
    setPopoverText('');
    setSelection(null);
  }

  // Close popover on scroll
  useEffect(() => {
    const container = contentRef.current;
    if (!container || !popover) return;
    function onScroll() {
      setPopover(null);
      setPopoverText('');
      setSelection(null);
    }
    container.addEventListener('scroll', onScroll);
    return () => container.removeEventListener('scroll', onScroll);
  }, [popover]);

  // Close popover on click outside
  useEffect(() => {
    if (!popover) return;
    function handleClickOutside(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setPopover(null);
        setPopoverText('');
        setSelection(null);
      }
    }
    // Delay to avoid catching the mouseup that opened the popover
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 50);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [popover]);

  // ── Add to Prompt ───────────────────────────────────────

  function handleAddToPrompt() {
    if (!diff || !activeTaskId || comments.length === 0) return;

    const lang = getLanguageFromPath(diff.filePath);
    const sections = comments.map((c) => {
      const startLine = c.startAddress.lineNumber;
      const endLine = c.endAddress.lineNumber;
      const lineRange =
        startLine === endLine ? `Line ${startLine}` : `Lines ${startLine}-${endLine}`;
      const code = c.lines.map((l) => l.content).join('\n');
      return `${lineRange}:\n\`\`\`${lang}\n${code}\n\`\`\`\n${c.comment}`;
    });

    const prompt = `Comments on file ${diff.filePath}:\n\n${sections.join('\n\n---\n\n')}`;

    const session = sessionRegistry.get(activeTaskId);
    if (session) {
      session.writeInput(prompt);
    }

    onClose();
  }

  // ── Close on backdrop click ─────────────────────────────

  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }

  if (!diff && !loading) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop animate-fade-in"
      onClick={handleBackdropClick}
    >
      <div
        className="bg-card border border-border/60 rounded-xl shadow-2xl shadow-black/40 w-[92vw] max-w-5xl h-[85vh] flex flex-col animate-scale-in overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 h-12 border-b border-border/60 flex-shrink-0"
          style={{ background: 'hsl(var(--surface-2))' }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <FileText
              size={14}
              className="text-muted-foreground/50 flex-shrink-0"
              strokeWidth={1.8}
            />
            <span className="text-[13px] font-medium text-foreground truncate">
              {diff?.filePath || 'Loading...'}
            </span>
            {diff && !diff.isBinary && (diff.additions > 0 || diff.deletions > 0) && (
              <div className="flex gap-2 text-[11px] font-mono flex-shrink-0 tabular-nums">
                {diff.additions > 0 && (
                  <span className="text-[hsl(var(--git-added))]">+{diff.additions}</span>
                )}
                {diff.deletions > 0 && (
                  <span className="text-[hsl(var(--git-deleted))]">-{diff.deletions}</span>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            {comments.length > 0 && (
              <button
                onClick={handleAddToPrompt}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium bg-primary/15 text-primary hover:bg-primary/25 transition-all duration-150 animate-fade-in"
              >
                <Send size={11} strokeWidth={2} />
                Add {comments.length} comment{comments.length !== 1 ? 's' : ''} to prompt
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground/50 hover:text-foreground transition-all duration-150"
            >
              <X size={14} strokeWidth={2} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div ref={contentRef} className="flex-1 overflow-auto font-mono text-[12px] leading-[20px] relative">
          {loading && (
            <div className="flex items-center justify-center h-full">
              <div className="flex items-center gap-3">
                <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                <span className="text-[13px] text-muted-foreground/50">Loading diff...</span>
              </div>
            </div>
          )}

          {diff?.isBinary && (
            <div className="flex items-center justify-center h-full">
              <span className="text-[13px] text-muted-foreground/40">
                Binary file — cannot display diff
              </span>
            </div>
          )}

          {diff && !diff.isBinary && diff.hunks.length === 0 && (
            <div className="flex items-center justify-center h-full">
              <span className="text-[13px] text-muted-foreground/40">No differences</span>
            </div>
          )}

          {diff &&
            !diff.isBinary &&
            diff.hunks.map((hunk, hi) => (
              <div key={hi}>
                {/* Hunk header */}
                <div className="diff-hunk px-5 py-1.5 text-[hsl(var(--git-renamed))]/70 border-y border-border/20 sticky top-0 backdrop-blur-sm text-[11px]">
                  {hunk.header}
                </div>

                {/* Lines */}
                {hunk.lines.map((line, li) => {
                  const isAdd = line.type === 'add';
                  const isDel = line.type === 'delete';
                  const selected = isLineInSelection(hi, li);
                  const commented = isLineCommented(hi, li);
                  const commentStart = isFirstLineOfComment(hi, li);

                  return (
                    <div
                      key={`${hi}-${li}`}
                      data-hunk={hi}
                      data-line={li}
                      className={[
                        'flex',
                        selected
                          ? 'diff-line-selected'
                          : isAdd
                            ? 'diff-add'
                            : isDel
                              ? 'diff-delete'
                              : '',
                        commented && !selected ? 'diff-line-commented' : '',
                        'transition-colors duration-75',
                      ].join(' ')}
                    >
                      {/* Comment indicator */}
                      {commentStart && !selected && (
                        <span className="w-0 relative">
                          <MessageSquare
                            size={10}
                            strokeWidth={2}
                            className="absolute -left-0.5 top-[5px] text-primary/60"
                          />
                        </span>
                      )}

                      {/* Old line number */}
                      <span
                        className="w-14 flex-shrink-0 text-right pr-3 text-muted-foreground/20 select-none border-r border-border/10 tabular-nums diff-gutter-clickable"
                        onMouseDown={(e) => handleGutterMouseDown(e, hi, li)}
                      >
                        {line.oldLineNumber ?? ''}
                      </span>
                      {/* New line number */}
                      <span
                        className="w-14 flex-shrink-0 text-right pr-3 text-muted-foreground/20 select-none border-r border-border/10 tabular-nums diff-gutter-clickable"
                        onMouseDown={(e) => handleGutterMouseDown(e, hi, li)}
                      >
                        {line.newLineNumber ?? ''}
                      </span>
                      {/* Marker */}
                      <span
                        className={`w-8 flex-shrink-0 text-center select-none ${
                          isAdd
                            ? 'text-[hsl(var(--git-added))]/60'
                            : isDel
                              ? 'text-[hsl(var(--git-deleted))]/60'
                              : 'text-muted-foreground/15'
                        }`}
                      >
                        {isAdd ? '+' : isDel ? '-' : ' '}
                      </span>
                      {/* Content */}
                      <span
                        className={`flex-1 pr-5 whitespace-pre ${
                          isAdd
                            ? 'text-[hsl(var(--git-added))]/80'
                            : isDel
                              ? 'text-[hsl(var(--git-deleted))]/80'
                              : 'text-foreground/70'
                        }`}
                      >
                        {line.content}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}

          {/* Comment popover */}
          {popover && (
            <div
              ref={popoverRef}
              className="absolute z-10 w-[320px] bg-card border border-border/60 rounded-lg shadow-xl shadow-black/30 overflow-hidden animate-scale-in"
              style={{ top: popover.top, left: Math.max(8, popover.left) }}
            >
              <div className="p-3">
                <textarea
                  ref={textareaRef}
                  value={popoverText}
                  onChange={(e) => setPopoverText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && e.metaKey) {
                      e.preventDefault();
                      handleAddComment();
                    }
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      handleCancelComment();
                    }
                  }}
                  placeholder="Add a comment..."
                  rows={3}
                  className="w-full text-[12px] bg-background/60 border border-border/60 rounded-md px-2.5 py-1.5 resize-none placeholder:text-muted-foreground/30 focus:outline-none focus:border-primary/40 font-sans"
                />
                <div className="flex gap-2 justify-end mt-2">
                  <button
                    onClick={handleCancelComment}
                    className="px-3 py-1.5 rounded-md text-[11px] text-muted-foreground/60 hover:text-foreground hover:bg-accent/60 transition-all duration-150"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleAddComment}
                    disabled={!popoverText.trim()}
                    className="px-3 py-1.5 rounded-md text-[11px] font-medium bg-primary/15 text-primary hover:bg-primary/25 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-150"
                  >
                    Add comment
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
