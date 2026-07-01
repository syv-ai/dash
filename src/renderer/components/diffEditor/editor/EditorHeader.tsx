import { useEffect, useState } from 'react';
import { Eye, GitCommit, GitCompare, History, MessageSquare, WrapText, X } from 'lucide-react';
import type { EditorView } from '../types';
import { Popover, PopoverAnchor, PopoverContent } from '../../ui/Popover';
import { Tooltip } from '../../ui/Tooltip';
import { BranchPicker } from '../BranchPicker';

interface Props {
  cwd: string;
  filePath: string;
  view: EditorView;
  wordWrap: boolean;
  onToggleWordWrap(): void;
  /** Inline git-blame toggle (default on, persisted). */
  blameEnabled: boolean;
  onToggleBlame(): void;
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
  /** Comments anchored to the open view — shown after the "Showing …" label. */
  commentCount: number;
  backgroundColor: string;
}

export function EditorHeader({
  cwd,
  filePath,
  view,
  wordWrap,
  onToggleWordWrap,
  blameEnabled,
  onToggleBlame,
  canPreview,
  previewing,
  onTogglePreview,
  onClose,
  onSelectBase,
  onExitBranchView,
  defaultBase,
  commentCount,
  backgroundColor,
}: Props) {
  const isBranch = view.kind === 'branch';
  // "Showing …" pill — only for non-working views (the working tree is the
  // default and needs no callout). Tooltip carries the full ref.
  const viewMeta =
    view.kind === 'branch'
      ? {
          label: `Showing vs ${view.base}`,
          tooltip: `Comparing against ${view.base}`,
          Icon: GitCompare,
        }
      : view.kind === 'commit'
        ? {
            label: `Showing commit ${view.hash.slice(0, 7)}`,
            tooltip: `Commit ${view.hash}`,
            Icon: GitCommit,
          }
        : null;
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

  function handleExit() {
    onExitBranchView();
    setPickerOpen(false);
  }

  // Plain icon button: no persistent fill — an active toggle just tints the
  // icon primary; hover gives a subtle surface for affordance.
  const iconBtn = (active: boolean) =>
    `p-1.5 rounded-md transition-colors hover:bg-accent/60 ${
      active ? 'text-primary' : 'text-muted-foreground/60 hover:text-foreground'
    }`;

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
        {viewMeta && (
          <Tooltip
            content={
              commentCount > 0
                ? `${viewMeta.tooltip} · ${commentCount} comment${commentCount !== 1 ? 's' : ''}`
                : viewMeta.tooltip
            }
          >
            <span className="inline-flex items-center gap-1.5 h-6 text-[11px] font-medium shrink-0 text-primary">
              <viewMeta.Icon size={12} strokeWidth={1.8} className="shrink-0" />
              <span className="font-mono whitespace-nowrap max-w-[260px] truncate">
                {viewMeta.label}
              </span>
              {commentCount > 0 && (
                <>
                  <span className="opacity-40">·</span>
                  <MessageSquare size={11} strokeWidth={2} className="opacity-80 shrink-0" />
                  <span className="tabular-nums">{commentCount}</span>
                </>
              )}
            </span>
          </Tooltip>
        )}
        <span className="text-[13px] font-medium text-foreground truncate">{filePath}</span>
      </div>
      <div className="flex items-center gap-1">
        {canPreview && (
          <Tooltip content={previewing ? 'Show source' : 'Show rendered preview'}>
            <button
              type="button"
              onClick={() => onTogglePreview(!previewing)}
              className={iconBtn(previewing)}
            >
              <Eye size={14} strokeWidth={1.8} />
            </button>
          </Tooltip>
        )}
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverAnchor asChild>
            <div className="inline-flex items-center">
              <Tooltip content={isBranch ? 'Change base branch' : 'Compare with another branch'}>
                <button
                  type="button"
                  onClick={handleChipClick}
                  className={`inline-flex items-center gap-1.5 px-2 h-6 rounded-md text-[11px] font-mono transition-colors hover:bg-accent/60 ${
                    isBranch ? 'text-primary' : 'text-muted-foreground/60 hover:text-foreground'
                  }`}
                >
                  <GitCompare size={12} strokeWidth={1.8} className="shrink-0" />
                  {isBranch ? (
                    <span className="truncate max-w-[420px]">base: {view.base}</span>
                  ) : (
                    <span className="whitespace-nowrap">Compare with branch…</span>
                  )}
                </button>
              </Tooltip>
            </div>
          </PopoverAnchor>
          <PopoverContent side="bottom" align="end" sideOffset={6} className="p-0">
            <BranchPicker
              cwd={cwd}
              selectedRef={isBranch ? view.base : null}
              onSelect={handleSelect}
              onExit={isBranch ? handleExit : undefined}
            />
          </PopoverContent>
        </Popover>
        <Tooltip content={blameEnabled ? 'Hide git blame' : 'Show git blame'}>
          <button onClick={onToggleBlame} className={iconBtn(blameEnabled)}>
            <History size={14} strokeWidth={1.8} />
          </button>
        </Tooltip>
        <Tooltip content={wordWrap ? 'Disable word wrap' : 'Enable word wrap'}>
          <button onClick={onToggleWordWrap} className={iconBtn(wordWrap)}>
            <WrapText size={14} strokeWidth={1.8} />
          </button>
        </Tooltip>
        <Tooltip content="Close">
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-muted-foreground/60 hover:text-foreground hover:bg-accent/60 transition-colors"
          >
            <X size={14} strokeWidth={2} />
          </button>
        </Tooltip>
      </div>
    </div>
  );
}
