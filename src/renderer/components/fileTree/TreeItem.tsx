import * as React from 'react';
import {
  Bot,
  Check,
  ChevronsDownUp,
  ChevronsUpDown,
  Columns2,
  Copy,
  FileText,
  FolderOpen,
  Link2,
  MessageSquare,
} from 'lucide-react';
import { cn } from '../../lib/cn';
import { CharColumn } from '../ui/CharColumn';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItems,
  ContextMenuTrigger,
  type ContextMenuAction,
} from '../ui/ContextMenu';
import { Button } from '../ui/Button';
import { CountBadge } from '../ui/CountBadge';
import { HoverSwapSlot } from '../ui/HoverSwapSlot';
import { IconButton } from '../ui/IconButton';
import { IdeIcon } from '../ui/IdeIcon';
import { LineStats } from '../ui/LineStats';
import { ListRow, type LIST_ROW_PX } from '../ui/ListRow';
import { Tooltip } from '../ui/Tooltip';
import { TreeRow, type TreeRowContext } from '../ui/Tree';
import { usePreferredIde } from '../../hooks/usePreferredIde';
import { openInIde } from '../../lib/openInIde';
import { absolutePath } from '../diffEditor/editor/fileRef';
import { copyText, revealLabel } from '../diffEditor/fileActions';
import type { OpenOptions } from '../diffEditor/tabs/editorLayout';
import type { DiffCommentKind, FileChangeStatus } from '../../../shared/types';
import {
  isChanged,
  rowColumns,
  type FileBadges,
  type ItemRow,
  type TreeColumns,
  type TreeRow as FileTreeRow,
} from './model';

/** Every file tree's row size (Files, a PR's files, the Agent tab's
 *  scratchpad): its height is `LIST_ROW_PX[FILE_ROW]`. */
export const FILE_ROW: keyof typeof LIST_ROW_PX = 'xs';

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
  /** From `Tree`: the row's node, selection, tab stop and focus wiring. */
  ctx: TreeRowContext;
  cwd: string;
  cols: TreeColumns;
  /** Shown quietly: viewed, or ignored. */
  quiet: boolean;
  badges: FileBadges | undefined;
  /** Hover actions; null: the default (copy the relative path). */
  actions: React.ReactNode;
  /** Space: the row's own toggle (Files' stage); absent, Space opens it. */
  onSpace?: () => void;
  canOpenToSide: boolean;
  /** A file: open it (a click previews, ⌥ to the side). A folder: toggle. */
  onActivate: (opts?: OpenOptions) => void;
  /** Open one of a file's notes in the editor (its badge opens the first);
   *  absent: the badge only counts. */
  onOpenComment?: (path: string, commentId: string) => void;
}

/** A file tree's row (a `TreeRow`): its name, line and status columns,
 *  badges, hover actions and right-click menu. Everything a file tree varies
 *  comes in as `actions` (and `badges`). */
export function TreeItem({
  row,
  ctx,
  cwd,
  cols,
  quiet,
  badges,
  actions,
  onSpace,
  canOpenToSide,
  onActivate,
  onOpenComment,
}: TreeItemProps) {
  const folder = row.kind === 'folder';
  const path = folder ? row.folder.path : row.file.path;
  const values = rowValues(row, cols, badges);
  // A file starts where its level's chevrons do (D268): no leading slot.
  const item = (
    <TreeRow
      ctx={ctx}
      size={FILE_ROW}
      dimmed={quiet}
      changed={isChanged(row)}
      title={folder ? undefined : path}
      className="group/swap relative cursor-pointer"
      onActivate={(e) => onActivate(folder ? undefined : { toSide: e.altKey, preview: true })}
      onSpace={onSpace}
      onDoubleClick={folder ? undefined : () => onActivate()}
      trailing={
        <>
          {values && (
            <Badges path={path} cols={values.cols} badges={badges} onOpenComment={onOpenComment} />
          )}
          <HoverSwapSlot
            rest={values && <Values values={values} badges={badges} />}
            actions={actions ?? <CopyPathAction path={path} />}
          />
        </>
      }
    >
      {folder ? row.name : row.file.name}
    </TreeRow>
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
export function TreeNote({ row }: { row: Extract<FileTreeRow, { kind: 'note' }> }) {
  return (
    <ListRow
      as="div"
      size={FILE_ROW}
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

/** What a row shows in its columns: its lines (a folder's while closed),
 *  its status letter, and which of the tree's columns it fills
 *  (`rowColumns`); null: none. */
function rowValues(row: ItemRow, treeCols: TreeColumns, badges: FileBadges | undefined) {
  let add = 0;
  let del = 0;
  let status: string | null = null;
  if (row.kind === 'file') {
    const c = row.file.change;
    if (c) {
      add = c.additions;
      del = c.deletions;
      status = STATUS_LETTER[c.status];
    }
  } else {
    // A new folder reads as new, as its files do.
    if (row.folder.untracked) status = STATUS_LETTER.untracked;
    if (!row.open) {
      const t = row.folder.tally;
      // New files count too, so the folders sum to the tree's total.
      add = t.add + t.untrackedAdd;
      del = t.del;
    }
  }
  const cols = rowColumns(treeCols, {
    threads: !!badges?.threads,
    comments: !!badges?.comments,
    add: add > 0,
    del: del > 0,
    status: !!status,
    viewed: !!badges?.viewed,
  });
  return cols && { cols, add, del, status };
}

/** The row's badges, each as wide as the tree's widest: the PR's threads and
 *  your notes or comments. They stay on hover (they aren't values the row's
 *  actions stand in for), and your notes' badge opens the first. */
function Badges({
  path,
  cols,
  badges,
  onOpenComment,
}: {
  path: string;
  cols: TreeColumns;
  badges: FileBadges | undefined;
  onOpenComment?: (path: string, commentId: string) => void;
}) {
  if (!cols.threads && !cols.comments) return null;
  const first = badges?.firstComment;
  return (
    <span className="flex items-center gap-1.5 text-xs">
      {cols.threads && (
        <span className="flex w-4.5 justify-end">
          {!!badges?.threads && <ThreadBadge count={badges.threads} />}
        </span>
      )}
      {cols.comments && (
        <span className="flex min-w-4.5 justify-end">
          {!!badges?.comments && (
            <CommentBadge
              count={badges.comments}
              kind={badges.commentKind ?? 'comment'}
              onOpen={first && onOpenComment ? () => onOpenComment(path, first) : undefined}
            />
          )}
        </span>
      )}
    </span>
  );
}

/** The row's values at rest, each as wide as the tree's widest value: lines
 *  added and removed (a folder's while it is closed), a file's status letter
 *  (boxed when staged; an untracked folder's U) and, in a PR's tree, a check
 *  once it is viewed. A folder shows no count of its changes: its lines say
 *  as much, and the counts crowded the column. Blank columns before the
 *  row's first value aren't drawn (`rowColumns`), so its name runs up to
 *  that value. */
function Values({
  values: { cols, add, del, status },
  badges,
}: {
  values: NonNullable<ReturnType<typeof rowValues>>;
  badges: FileBadges | undefined;
}) {
  const lines = cols.add > 0 || cols.del > 0;
  if (!lines && !cols.status && !cols.viewed) return null;
  return (
    <span className="flex items-center gap-1.5 text-xs">
      {lines && <LineStats add={add} del={del} columns={{ add: cols.add, del: cols.del }} />}
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

/** Your notes (or a PR's draft comments) on a file needing attention: their
 *  icon, as the editor's gutter shows them, and how many. With `onOpen`, a
 *  button that opens the first. */
function CommentBadge({
  count,
  kind,
  onOpen,
}: {
  count: number;
  kind: DiffCommentKind;
  onOpen?: () => void;
}) {
  const label = `${count} ${kind}${count !== 1 ? 's' : ''}`;
  const Icon = kind === 'note' ? Bot : MessageSquare;
  const content = (
    <>
      <Icon size={14} strokeWidth={1.8} className="text-icon" />
      <span className="tabular-nums">{count}</span>
    </>
  );
  return (
    <Tooltip content={label}>
      {onOpen ? (
        <Button
          variant="ghost"
          size="xs"
          aria-label={`${label}: open the first`}
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
          // The row's own keys (Enter opens it, Space its toggle) stay off
          // the button's.
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
          }}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          {content}
        </Button>
      ) : (
        <span aria-label={label} className="flex items-center gap-0.5 px-1">
          {content}
        </span>
      )}
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

/** "Open in Cursor" (or the chosen IDE's name) for a file or folder at `abs`,
 *  as the task header and task menus name it. With no IDE known it still reads
 *  "Open in IDE", and main says why it can't. The menus that use it mount only
 *  while open, so the rows don't each subscribe to the IDE setting. */
function useOpenInIdeItem(abs: string): ContextMenuAction {
  const { ideId, openLabel } = usePreferredIde();
  return {
    label: openLabel,
    icon: (
      <span className="inline-flex size-3.5 items-center justify-center">
        <IdeIcon ideId={ideId} size={14} />
      </span>
    ),
    onSelect: () => void openInIde(abs),
  };
}

/** A file's right-click menu. */
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
  const abs = absolutePath(cwd, path);
  const openInIdeItem = useOpenInIdeItem(abs);
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
        openInIdeItem,
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
  const openInIdeItem = useOpenInIdeItem(abs);
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
        openInIdeItem,
      ]}
    />
  );
}
