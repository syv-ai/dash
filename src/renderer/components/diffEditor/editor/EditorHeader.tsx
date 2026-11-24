import { useEffect, useState } from 'react';
import {
  Check,
  Columns2,
  Copy,
  Eye,
  GitCommit,
  GitCompare,
  GitPullRequestArrow,
  History,
  MessageSquare,
  MoreHorizontal,
  WrapText,
} from 'lucide-react';
import type { EditorView } from '../types';
import { Popover, PopoverAnchor, PopoverContent } from '../../ui/Popover';
import { Tooltip } from '../../ui/Tooltip';
import { Segmented } from '../../ui/Segmented';
import { IconButton } from '../../ui/IconButton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '../../ui/DropdownMenu';
import { BranchPicker } from '../BranchPicker';
import { PrPicker } from '../PrPicker';

interface Props {
  cwd: string;
  /** `cwd` is a task's worktree; otherwise compare and blame have no repository to ask. */
  git: boolean;
  filePath: string;
  view: EditorView;
  wordWrap: boolean;
  onToggleWordWrap(): void;
  /** Side-by-side (two columns) instead of the inline diff. Persisted. */
  sideBySide: boolean;
  onToggleSideBySide(): void;
  /** The file differs from its base: a split view has something to show. */
  canSideBySide: boolean;
  /** Inline git-blame toggle (default on, persisted). */
  blameEnabled: boolean;
  onToggleBlame(): void;
  /** Show the Code | Preview toggle (HTML files only). */
  canPreview: boolean;
  /** True when the rendered preview is showing instead of the editor. */
  previewing: boolean;
  onTogglePreview(next: boolean): void;
  /** Switch into branch view with the given base ref (e.g. "origin/main"). */
  onSelectBase(base: string): void;
  /** Leave branch or PR view; switch back to working tree. */
  onExitBranchView(): void;
  /** Resolved repo default (origin/HEAD, else main/master), listed first in the branch picker. */
  defaultBase: string | null;
  /** The project the checkout belongs to; null hides the Pull requests tab. */
  projectId: string | null;
  /** Open PR `number`'s view; resolves false when it couldn't be loaded. */
  onSelectPr(number: number): Promise<boolean>;
  /** The open PR's title, once its review has loaded. */
  prTitle: string | null;
  /** Comments anchored to the open view — shown after the "Showing …" label. */
  commentCount: number;
  backgroundColor: string;
}

export function EditorHeader({
  cwd,
  git,
  filePath,
  view,
  wordWrap,
  onToggleWordWrap,
  sideBySide,
  onToggleSideBySide,
  canSideBySide,
  blameEnabled,
  onToggleBlame,
  canPreview,
  previewing,
  onTogglePreview,
  onSelectBase,
  onExitBranchView,
  defaultBase,
  projectId,
  onSelectPr,
  prTitle,
  commentCount,
  backgroundColor,
}: Props) {
  const isBranch = view.kind === 'branch';
  const isPr = view.kind === 'pr';
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
        : view.kind === 'pr'
          ? {
              label: `Showing PR #${view.number}`,
              tooltip: `PR #${view.number}: ${view.base.slice(0, 7)}…${view.head.slice(0, 7)}`,
              Icon: GitPullRequestArrow,
            }
          : null;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [tab, setTab] = useState<'branches' | 'prs'>('branches');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  function copyPath() {
    void window.electronAPI.clipboardWriteText(filePath);
    setCopied(true);
  }

  // Close the picker when the host switches view (e.g. user clicks a commit
  // row, or picks a PR), so a stale popover doesn't linger anchored to the chip.
  useEffect(() => {
    setPickerOpen(false);
  }, [view]);

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
      active ? 'text-primary' : 'text-muted-fade-60 hover:text-foreground'
    }`;

  // The view toggles: icon buttons, folded into a "More" menu when the pane
  // is narrow (a split group) so the file name keeps its room.
  const toggles = [
    git && {
      key: 'blame',
      tooltip: blameEnabled ? 'Hide git blame' : 'Show git blame',
      label: 'Git blame',
      on: blameEnabled,
      onToggle: onToggleBlame,
      Icon: History,
    },
    canSideBySide && {
      key: 'side',
      tooltip: sideBySide ? 'Show inline diff' : 'Show side by side',
      label: 'Side by side',
      on: sideBySide,
      onToggle: onToggleSideBySide,
      Icon: Columns2,
    },
    {
      key: 'wrap',
      tooltip: wordWrap ? 'Disable word wrap' : 'Enable word wrap',
      label: 'Word wrap',
      on: wordWrap,
      onToggle: onToggleWordWrap,
      Icon: WrapText,
    },
  ].filter((t) => !!t);

  function handleChipClick() {
    // Open on the tab of what's showing: a PR view on its PRs, else branches.
    if (!pickerOpen) setTab(isPr && projectId ? 'prs' : 'branches');
    setPickerOpen((v) => !v);
  }

  return (
    <div
      className="@container/panehead flex items-center justify-between gap-2 px-3 h-9 border-b border-edge/6 shrink-0"
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
            <span className="inline-flex items-center gap-1.5 h-6 text-xs font-medium min-w-0 text-primary">
              <viewMeta.Icon size={12} strokeWidth={1.8} className="shrink-0" />
              <span className="font-mono whitespace-nowrap min-w-0 truncate">{viewMeta.label}</span>
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
        <span className="flex items-center gap-1 min-w-0">
          <span className="text-base font-medium text-foreground truncate">{filePath}</span>
          <Tooltip content={copied ? 'Copied' : 'Copy path'}>
            <button
              type="button"
              onClick={copyPath}
              className={`shrink-0 p-1 rounded-md transition-colors hover:bg-accent/60 ${
                copied ? 'text-[hsl(var(--git-added))]' : 'text-muted-fade-60 hover:text-foreground'
              }`}
            >
              {copied ? <Check size={12} strokeWidth={2} /> : <Copy size={12} strokeWidth={1.8} />}
            </button>
          </Tooltip>
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-1">
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
        {git && (
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverAnchor asChild>
              <div className="inline-flex items-center">
                <Tooltip
                  content={
                    isBranch
                      ? 'Change base branch'
                      : isPr
                        ? 'Change pull request'
                        : 'Compare with a branch or pull request'
                  }
                >
                  <button
                    type="button"
                    onClick={handleChipClick}
                    className={`inline-flex items-center gap-1.5 px-2 h-6 rounded-md text-xs font-mono transition-colors hover:bg-accent/60 ${
                      isBranch || isPr ? 'text-primary' : 'text-muted-fade-60 hover:text-foreground'
                    }`}
                  >
                    {isPr ? (
                      <GitPullRequestArrow size={12} strokeWidth={1.8} className="shrink-0" />
                    ) : (
                      <GitCompare size={12} strokeWidth={1.8} className="shrink-0" />
                    )}
                    {isBranch ? (
                      <span className="truncate max-w-[420px]">base: {view.base}</span>
                    ) : isPr ? (
                      <span className="truncate max-w-[420px]">
                        PR #{view.number}
                        {prTitle ? `: ${prTitle}` : ''}
                      </span>
                    ) : (
                      <span className="whitespace-nowrap @max-[30rem]/panehead:hidden">
                        Compare…
                      </span>
                    )}
                  </button>
                </Tooltip>
              </div>
            </PopoverAnchor>
            <PopoverContent side="bottom" align="end" sideOffset={6} className="p-0">
              <div className="w-[340px] h-[380px] flex flex-col">
                {projectId && (
                  <div className="px-2.5 pt-2.5 pb-1">
                    <Segmented
                      size="sm"
                      value={tab}
                      onChange={setTab}
                      options={[
                        { value: 'branches', label: 'Branches' },
                        { value: 'prs', label: 'Pull requests' },
                      ]}
                    />
                  </div>
                )}
                {tab === 'prs' && projectId ? (
                  <PrPicker
                    projectId={projectId}
                    cwd={cwd}
                    selected={view.kind === 'pr' ? view.number : null}
                    onSelect={onSelectPr}
                    onExit={isPr ? handleExit : undefined}
                  />
                ) : (
                  <BranchPicker
                    cwd={cwd}
                    selectedRef={isBranch ? view.base : null}
                    onSelect={handleSelect}
                    onExit={isBranch ? handleExit : undefined}
                    defaultRef={defaultBase}
                  />
                )}
              </div>
            </PopoverContent>
          </Popover>
        )}
        {toggles.map(({ key, tooltip, on, onToggle, Icon }) => (
          <Tooltip key={key} content={tooltip}>
            <button onClick={onToggle} className={`${iconBtn(on)} @max-[30rem]/panehead:hidden`}>
              <Icon size={14} strokeWidth={1.8} />
            </button>
          </Tooltip>
        ))}
        <div className="hidden @max-[30rem]/panehead:block">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton size="sm" title="View options">
                <MoreHorizontal size={14} strokeWidth={1.8} />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-44">
              {toggles.map(({ key, label, on, onToggle, Icon }) => (
                <DropdownMenuItem key={key} onSelect={onToggle}>
                  <Icon size={13} strokeWidth={1.8} />
                  {label}
                  {on && <DropdownMenuShortcut>On</DropdownMenuShortcut>}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}
