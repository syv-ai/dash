import { useEffect, useState } from 'react';
import { Code2, Eye, GitCompare, WrapText, X } from 'lucide-react';
import type { EditorView } from '../types';
import { Popover, PopoverAnchor, PopoverContent } from '../../ui/Popover';
import { BranchPicker } from '../BranchPicker';

interface Props {
  cwd: string;
  filePath: string;
  view: EditorView;
  wordWrap: boolean;
  onToggleWordWrap(): void;
  /** Show the Code | Preview toggle (HTML files only). */
  canPreview: boolean;
  /** True when the rendered preview is showing instead of the editor. */
  previewing: boolean;
  onTogglePreview(next: boolean): void;
  onClose(): void;
  /** Switch into branch view with the given base ref (e.g. "origin/main"). */
  onSelectBase(base: string): void;
  /** Leave branch view; switch back to working tree. */
  onExitBranchView(): void;
  /** Resolved repo default; lets the chip enter branch view with one click
   *  in non-branch view. Null when neither origin/HEAD nor main/master is
   *  available — clicking the chip then just opens the picker. */
  defaultBase: string | null;
  backgroundColor: string;
}

export function EditorHeader({
  cwd,
  filePath,
  view,
  wordWrap,
  onToggleWordWrap,
  canPreview,
  previewing,
  onTogglePreview,
  onClose,
  onSelectBase,
  onExitBranchView,
  defaultBase,
  backgroundColor,
}: Props) {
  const isCommit = view.kind === 'commit';
  const isBranch = view.kind === 'branch';
  const [pickerOpen, setPickerOpen] = useState(false);

  // Close the picker when the host switches view (e.g. user clicks a commit
  // row), so a stale popover doesn't linger anchored to the chip.
  useEffect(() => {
    if (!isBranch) setPickerOpen(false);
  }, [view, isBranch]);

  function handleSelect(ref: string) {
    onSelectBase(ref);
    setPickerOpen(false);
  }

  function handleChipClick() {
    if (isBranch) {
      setPickerOpen((v) => !v);
    } else if (defaultBase) {
      // Working/commit view → fast path: clicking the chip enters branch
      // view with the resolved default. The user can re-open the picker
      // afterwards to change branches.
      onSelectBase(defaultBase);
    } else {
      setPickerOpen((v) => !v);
    }
  }

  return (
    <div
      className="flex items-center justify-between px-3 h-9 border-b border-white/6 shrink-0"
      style={{ background: backgroundColor }}
    >
      <div className="flex items-center gap-3 min-w-0">
        <span className="text-[13px] font-medium text-foreground truncate">{filePath}</span>
        {isCommit && (
          <span className="text-[11px] tabular-nums text-muted-foreground/50 font-mono">
            {view.hash.slice(0, 7)}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {canPreview && (
          <div className="flex items-center gap-0.5 rounded-md bg-[hsl(var(--surface-3))] p-0.5">
            <button
              type="button"
              onClick={() => onTogglePreview(false)}
              title="Show source"
              className={`flex items-center gap-1.5 rounded px-2 py-1 text-[11px] font-medium transition-colors ${
                previewing
                  ? 'text-muted-foreground/60 hover:text-foreground'
                  : 'bg-primary/15 text-primary'
              }`}
            >
              <Code2 size={12} strokeWidth={1.8} />
              Code
            </button>
            <button
              type="button"
              onClick={() => onTogglePreview(true)}
              title="Show rendered preview"
              className={`flex items-center gap-1.5 rounded px-2 py-1 text-[11px] font-medium transition-colors ${
                previewing
                  ? 'bg-primary/15 text-primary'
                  : 'text-muted-foreground/60 hover:text-foreground'
              }`}
            >
              <Eye size={12} strokeWidth={1.8} />
              Preview
            </button>
          </div>
        )}
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverAnchor asChild>
            <div className="inline-flex items-center">
              <button
                type="button"
                onClick={handleChipClick}
                title={isBranch ? 'Change base branch' : 'Compare with another branch'}
                className={`inline-flex items-center gap-1.5 px-2 h-6 rounded-md text-[11px] font-mono transition-colors ${
                  isBranch
                    ? 'bg-primary/15 text-primary'
                    : 'text-muted-foreground/60 hover:text-foreground hover:bg-accent/60'
                }`}
              >
                <GitCompare size={12} strokeWidth={1.8} className="shrink-0" />
                {isBranch ? (
                  <span className="truncate max-w-[420px]">base: {view.base}</span>
                ) : (
                  <span className="whitespace-nowrap">Compare with branch…</span>
                )}
              </button>
              {isBranch && (
                <button
                  type="button"
                  onClick={onExitBranchView}
                  title="Exit branch comparison"
                  className="ml-0.5 p-0.5 rounded-md text-muted-foreground/50 hover:text-foreground hover:bg-accent/60 transition-colors"
                >
                  <X size={12} strokeWidth={2} />
                </button>
              )}
            </div>
          </PopoverAnchor>
          <PopoverContent side="bottom" align="end" sideOffset={6} className="p-0">
            <BranchPicker
              cwd={cwd}
              selectedRef={isBranch ? view.base : null}
              onSelect={handleSelect}
            />
          </PopoverContent>
        </Popover>
        <button
          onClick={onToggleWordWrap}
          title={wordWrap ? 'Disable word wrap' : 'Enable word wrap'}
          className={`p-1.5 rounded-md transition-colors ${
            wordWrap
              ? 'bg-primary/15 text-primary'
              : 'text-muted-foreground/60 hover:text-foreground hover:bg-accent/60'
          }`}
        >
          <WrapText size={14} strokeWidth={1.8} />
        </button>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground/50 hover:text-foreground transition-all duration-150"
        >
          <X size={14} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}
