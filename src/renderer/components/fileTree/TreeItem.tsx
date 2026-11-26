import * as React from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Columns2,
  Copy,
  FileText,
  FolderOpen,
  Link2,
} from 'lucide-react';
import { cn } from '../../lib/cn';
import { CharColumn } from '../ui/CharColumn';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItems,
  ContextMenuTrigger,
} from '../ui/ContextMenu';
import { CountBadge } from '../ui/CountBadge';
import { HoverSwapSlot } from '../ui/HoverSwapSlot';
import { IconButton } from '../ui/IconButton';
import { IdeIcon } from '../ui/IdeIcon';
import { LineStats } from '../ui/LineStats';
import { ListRow } from '../ui/ListRow';
import { Tooltip } from '../ui/Tooltip';
import { usePreferredIde } from '../../hooks/usePreferredIde';
import { openInIde } from '../../lib/openInIde';
import { absolutePath } from '../diffEditor/editor/fileRef';
import { copyText, revealLabel } from '../diffEditor/fileActions';
import type { OpenOptions } from '../diffEditor/tabs/editorLayout';
import type { FileChangeStatus } from '../../../shared/types';
import type { FileBadges, ItemRow, TreeColumns, TreeRow } from './model';

const STATUS_LETTER: Record<FileChangeStatus, string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  untracked: 'U',
  conflicted: 'C',
  ignored: 'I',
};

export interface TreeItemProps {
  row: ItemRow;
  cwd: string;
  cols: TreeColumns;
  selected: boolean;
  /** Shown quietly: viewed, or ignored. */
  quiet: boolean;
  badges: FileBadges | undefined;
  /** The roving tab stop: the one row Tab lands on. */
  tabStop: boolean;
  /** Hover actions; null: the default (copy the relative path). */
  actions: React.ReactNode;
  /** Space: the row's own toggle (Files' stage); absent, Space opens it. */
  onSpace?: () => void;
  canOpenToSide: boolean;
  /** A file: open it (a click previews, ⌥ to the side). A folder: toggle. */
  onActivate: (opts?: OpenOptions) => void;
  onFocusRow: () => void;
  rowRef: (el: HTMLElement | null) => void;
}

/** A tree row: its nesting, chevron, name, line and status columns, badges,
 *  hover actions and right-click menu. Everything a tree varies comes in as
 *  `actions` (and `badges`). */
export function TreeItem({
  row,
  cwd,
  cols,
  selected,
  quiet,
  badges,
  tabStop,
  actions,
  onSpace,
  canOpenToSide,
  onActivate,
  onFocusRow,
  rowRef,
}: TreeItemProps) {
  const folder = row.kind === 'folder';
  const path = folder ? row.folder.path : row.file.path;
  const Chevron = folder && row.open ? ChevronDown : ChevronRight;
  const change = folder ? row.folder.change : row.file.change;
  // A changed entry's name is gold, as in VS Code (G1): a file, or a folder
  // git lists as one change. A quiet row (viewed, ignored) stays quiet.
  const changed = !!change && change.status !== 'ignored';
  const item = (
    <ListRow
      as="div"
      size="sm"
      ref={rowRef}
      role="treeitem"
      aria-level={row.depth + 1}
      aria-expanded={folder ? row.open : undefined}
      aria-selected={folder ? undefined : selected}
      tabIndex={tabStop ? 0 : -1}
      data-key={row.key}
      selected={selected}
      dimmed={quiet}
      changed={changed}
      indent={row.depth}
      title={folder ? undefined : path}
      className="group/swap relative cursor-pointer"
      onFocus={(e: React.FocusEvent) => e.target === e.currentTarget && onFocusRow()}
      onClick={(e: React.MouseEvent) =>
        onActivate(folder ? undefined : { toSide: e.altKey, preview: true })
      }
      onDoubleClick={folder ? undefined : () => onActivate()}
      onKeyDown={(e: React.KeyboardEvent) => {
        // A control in the row (a tick, an action) handles its own keys.
        if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
        e.preventDefault();
        if (e.key === ' ' && onSpace) onSpace();
        else onActivate(folder ? undefined : { toSide: e.altKey, preview: true });
      }}
      // A file starts where its level's chevrons do (D268).
      leading={folder ? <Chevron size={14} strokeWidth={1.8} /> : undefined}
      trailing={
        <HoverSwapSlot
          rest={<Columns row={row} cols={cols} badges={badges} />}
          actions={actions ?? <CopyPathAction path={path} />}
        />
      }
    >
      {folder ? row.name : row.file.name}
    </ListRow>
  );
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{item}</ContextMenuTrigger>
      <ContextMenuContent>
        {folder ? (
          <FolderMenu cwd={cwd} path={path} open={row.open} onToggle={() => onActivate()} />
        ) : (
          <FileMenu cwd={cwd} path={path} canOpenToSide={canOpenToSide} onOpen={onActivate} />
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** A lazy folder's state in place of its rows: reading, empty, or why not,
 *  under the folder's name. */
export function TreeNote({ row }: { row: Extract<TreeRow, { kind: 'note' }> }) {
  return (
    <ListRow
      as="div"
      size="sm"
      role="presentation"
      dimmed
      indent={row.depth}
      title={row.failed ? row.text : undefined}
      className="cursor-default"
    >
      {row.text}
    </ListRow>
  );
}

/** The row's columns at rest, each as wide as the tree's widest value: the
 *  PR's threads, your comments, lines added and removed (a folder's while
 *  it is closed), a file's status letter (boxed when staged) and, in a
 *  PR's tree, a check once it is viewed. A folder shows no count of its
 *  changes: its lines say as much, and the counts crowded the column. */
function Columns({
  row,
  cols,
  badges,
}: {
  row: ItemRow;
  cols: TreeColumns;
  badges: FileBadges | undefined;
}) {
  let add = 0;
  let del = 0;
  let status: React.ReactNode = null;
  if (row.kind === 'file') {
    const c = row.file.change;
    if (c) {
      add = c.additions;
      del = c.deletions;
      status = STATUS_LETTER[c.status];
    }
  } else if (!row.open) {
    const t = row.folder.tally;
    // New files count too, so the folders sum to the tree's total.
    add = t.add + t.untrackedAdd;
    del = t.del;
  }
  return (
    <span className="flex items-center gap-1.5 text-xs">
      {cols.threads && (
        <span className="flex w-4.5 justify-end">
          {!!badges?.threads && <ThreadBadge count={badges.threads} />}
        </span>
      )}
      {cols.comments && (
        <span className="flex w-4.5 justify-end">
          {!!badges?.comments && <CommentBadge count={badges.comments} />}
        </span>
      )}
      {(cols.add > 0 || cols.del > 0) && (
        <LineStats add={add} del={del} columns={{ add: cols.add, del: cols.del }} />
      )}
      {cols.status && (
        <CharColumn chars={1} align="center">
          {status && badges?.staged ? (
            <StagedLetter staged={badges.staged} letter={status} />
          ) : (
            status
          )}
        </CharColumn>
      )}
      {cols.viewed && (
        <span className="flex w-3.5 justify-center">
          {badges?.viewed && <Check size={12} strokeWidth={1.8} aria-label="Viewed" />}
        </span>
      )}
    </span>
  );
}

/** A whole tree's staged file (it has no Staged section to say so): its
 *  letter in a quiet box, filled when every change is staged, outlined when
 *  some are. The box overhangs the 1ch column, so the columns stay put. */
function StagedLetter({ staged, letter }: { staged: true | 'mixed'; letter: React.ReactNode }) {
  const label = staged === true ? 'Staged' : 'Partly staged';
  return (
    <Tooltip content={label}>
      <span aria-label={label} className="relative inline-block">
        <span
          aria-hidden
          className={cn(
            'absolute -inset-x-0.75 -inset-y-px rounded-sm',
            staged === true ? 'bg-ink/12' : 'ring-1 ring-ink-3 ring-inset',
          )}
        />
        <span className="relative">{letter}</span>
      </span>
    </Tooltip>
  );
}

/** The PR's unresolved threads on a file: outlined, apart from yours. */
function ThreadBadge({ count }: { count: number }) {
  const label = `${count} unresolved thread${count !== 1 ? 's' : ''}`;
  return (
    <Tooltip content={label}>
      <span aria-label={label} className="flex">
        <CountBadge count={count} tone="outline" />
      </span>
    </Tooltip>
  );
}

/** Your notes and comments on a file needing attention. */
function CommentBadge({ count }: { count: number }) {
  const label = `${count} comment${count !== 1 ? 's' : ''}`;
  return (
    <Tooltip content={label}>
      <span aria-label={label} className="flex">
        <CountBadge count={count} />
      </span>
    </Tooltip>
  );
}

function CopyPathAction({ path }: { path: string }) {
  return (
    <IconButton
      title="Copy relative path"
      size="sm"
      onClick={(e) => {
        e.stopPropagation();
        copyText(path, 'relative path');
      }}
    >
      <Copy size={14} strokeWidth={1.8} />
    </IconButton>
  );
}

/** A file's right-click menu. Mounted only while open, so the rows don't each
 *  subscribe to the IDE setting. */
function FileMenu({
  cwd,
  path,
  canOpenToSide,
  onOpen,
}: {
  cwd: string;
  path: string;
  canOpenToSide: boolean;
  onOpen: (opts?: OpenOptions) => void;
}) {
  const { ideId, openLabel } = usePreferredIde();
  const abs = absolutePath(cwd, path);
  return (
    <ContextMenuItems
      items={[
        // A menu open is deliberate: it keeps its tab (a click only previews).
        { label: 'Open', icon: FileText, onSelect: () => onOpen() },
        canOpenToSide && {
          label: 'Open in new pane',
          icon: Columns2,
          onSelect: () => onOpen({ toSide: true }),
        },
        'separator',
        { label: 'Copy path', icon: Link2, onSelect: () => copyText(abs, 'path') },
        {
          label: 'Copy relative path',
          icon: Copy,
          onSelect: () => copyText(path, 'relative path'),
        },
        'separator',
        {
          label: revealLabel(),
          icon: FolderOpen,
          onSelect: () => window.electronAPI.showItemInFolder(abs),
        },
        {
          label: openLabel,
          icon: (
            <span className="inline-flex size-3.5 items-center justify-center">
              <IdeIcon ideId={ideId} size={14} />
            </span>
          ),
          onSelect: () => void openInIde(abs),
        },
      ]}
    />
  );
}

function FolderMenu({
  cwd,
  path,
  open,
  onToggle,
}: {
  cwd: string;
  path: string;
  open: boolean;
  onToggle: () => void;
}) {
  const abs = absolutePath(cwd, path);
  return (
    <ContextMenuItems
      items={[
        open
          ? { label: 'Collapse', icon: ChevronsDownUp, onSelect: onToggle }
          : { label: 'Expand', icon: ChevronsUpDown, onSelect: onToggle },
        'separator',
        { label: 'Copy path', icon: Link2, onSelect: () => copyText(abs, 'path') },
        {
          label: 'Copy relative path',
          icon: Copy,
          onSelect: () => copyText(path, 'relative path'),
        },
        'separator',
        {
          label: revealLabel(),
          icon: FolderOpen,
          onSelect: () => window.electronAPI.showItemInFolder(abs),
        },
      ]}
    />
  );
}
