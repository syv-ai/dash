import { useEffect, useState, type ReactNode } from 'react';
import {
  Check,
  Columns2,
  Copy,
  Eye,
  GitCommit,
  History,
  MessageSquare,
  MoreHorizontal,
  WrapText,
} from 'lucide-react';
import type { EditorView } from '../types';
import { Tooltip } from '../../ui/Tooltip';
import { IconButton } from '../../ui/IconButton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '../../ui/DropdownMenu';

interface Props {
  /** The file is in a task's worktree; otherwise blame has no repository to ask. */
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
  /** Comments anchored to the open commit — shown after the "Showing …" label. */
  commentCount: number;
  /** A PR view's reading controls (thread steps, Viewed), ahead of the toggles. */
  reviewActions?: ReactNode;
}

/** The folder a path sits in, with its trailing slash ('' at the root). */
function dirname(path: string): string {
  return path.slice(0, path.lastIndexOf('/') + 1);
}

export function EditorHeader({
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
  commentCount,
  reviewActions,
}: Props) {
  // "Showing …" pill — only for a commit view: the working tree needs no
  // callout, and a branch or PR comparison is named by the Compare button.
  // Tooltip carries the full hash.
  const viewMeta =
    view.kind === 'commit'
      ? { label: `Showing commit ${view.hash.slice(0, 7)}`, hash: view.hash, Icon: GitCommit }
      : null;
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

  return (
    // Inside the file's sheet, under its tab: the tab names the file, so this
    // row carries only where it lives and what can be done to it.
    <div className="@container/panehead flex h-9 shrink-0 items-center justify-between gap-2 border-b border-line pr-2 pl-4">
      <div className="flex items-center gap-3 min-w-0">
        {viewMeta && (
          <Tooltip
            content={{
              icon: viewMeta.Icon,
              title: 'Commit',
              body: viewMeta.hash,
              rows: commentCount > 0 ? [{ label: 'Comments', value: commentCount }] : undefined,
            }}
          >
            <span className="inline-flex items-center gap-1.5 h-6 text-xs font-medium min-w-0 text-primary">
              <viewMeta.Icon size={12} strokeWidth={1.8} className="shrink-0" />
              <span className="whitespace-nowrap min-w-0 truncate">{viewMeta.label}</span>
              {commentCount > 0 && (
                <>
                  <span className="opacity-40">·</span>
                  <MessageSquare size={11} strokeWidth={2} className="text-icon shrink-0" />
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
        {reviewActions}
        <IconButton
          size="sm"
          title={copied ? 'Copied' : 'Copy path'}
          description={copied ? undefined : filePath}
          onClick={copyPath}
        >
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
