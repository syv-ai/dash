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
import { Button } from '../../ui/Button';
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
}

/** The folder a path sits in, with its trailing slash ('' at the root). */
function dirname(path: string): string {
  return path.slice(0, path.lastIndexOf('/') + 1);
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
  const folder = dirname(filePath);

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

  // The view toggles: icon buttons, folded into a "More" menu when the pane
  // is narrow (a split group) so the folder path keeps its room.
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
    // Inside the file's sheet, under its tab: the tab names the file, so this
    // row carries only where it lives and what can be done to it.
    <div className="@container/panehead flex h-9 shrink-0 items-center justify-between gap-2 border-b border-line pr-2 pl-4">
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
              <span className="whitespace-nowrap min-w-0 truncate">{viewMeta.label}</span>
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
        {folder && (
          <span className="truncate text-xs text-ink-3" title={filePath}>
            {folder}
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <IconButton size="sm" title={copied ? 'Copied' : `Copy ${filePath}`} onClick={copyPath}>
          {copied ? (
            <Check size={14} strokeWidth={1.8} className="text-loc-add" />
          ) : (
            <Copy size={14} strokeWidth={1.8} />
          )}
        </IconButton>
        {canPreview && (
          <IconButton
            size="sm"
            title={previewing ? 'Show source' : 'Show rendered preview'}
            pressed={previewing}
            onClick={() => onTogglePreview(!previewing)}
          >
            <Eye size={14} strokeWidth={1.8} />
          </IconButton>
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
                  <Button variant="ghost" size="sm" onClick={handleChipClick}>
                    {isPr ? (
                      <GitPullRequestArrow size={14} strokeWidth={1.8} />
                    ) : (
                      <GitCompare size={14} strokeWidth={1.8} />
                    )}
                    {isBranch ? (
                      <span className="truncate max-w-105">base: {view.base}</span>
                    ) : isPr ? (
                      <span className="truncate max-w-105">
                        PR #{view.number}
                        {prTitle ? `: ${prTitle}` : ''}
                      </span>
                    ) : (
                      <span className="whitespace-nowrap @max-[30rem]/panehead:hidden">
                        Compare…
                      </span>
                    )}
                  </Button>
                </Tooltip>
              </div>
            </PopoverAnchor>
            <PopoverContent side="bottom" align="end" sideOffset={6} className="p-0">
              <div className="w-85 h-95 flex flex-col">
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
          <IconButton
            key={key}
            size="sm"
            title={tooltip}
            pressed={on}
            onClick={onToggle}
            className="@max-[30rem]/panehead:hidden"
          >
            <Icon size={14} strokeWidth={1.8} />
          </IconButton>
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
