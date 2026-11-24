import type * as React from 'react';
import { motion } from 'motion/react';
import { EyeOff, Undo2 } from 'lucide-react';
import { ListRow } from '../ui/ListRow';
import { Checkbox } from '../ui/Checkbox';
import { IconButton } from '../ui/IconButton';
import { Button } from '../ui/Button';
import { LineStats } from '../ui/LineStats';
import { cn } from '../../lib/cn';
import { ROW_TRANSITION, rowEnterExit } from './motionConfig';
import type { FileChange, FileChangeStatus } from '../../../shared/types';

interface FileRowProps {
  file: FileChange;
  /** Tree depth (see ListRow's `indent`). */
  indent: number;
  onToggleStage: (file: FileChange) => void;
  onViewDiff: (file: FileChange) => void;
  onDiscard: (file: FileChange) => void;
  onAddToGitignore: (path: string) => void;
  /** Animate in, out and on layout changes. Off in the virtualized list, where rows are recycled. */
  animated?: boolean;
}

const STATUS_LABEL: Record<FileChangeStatus, string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  untracked: 'U',
  conflicted: 'C',
  // The Changes panel is fed by `git status`, which never emits 'ignored' — the
  // key exists only to satisfy the exhaustive record type.
  ignored: 'I',
};

function basename(p: string): string {
  const i = p.lastIndexOf('/');
  return i === -1 ? p : p.slice(i + 1);
}

/** Enter/Space act like a click on a `div` row (it holds buttons, so it can't be one). */
export function rowKeys(action: () => void) {
  return {
    role: 'button',
    tabIndex: 0,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        action();
      }
    },
  } as const;
}

/** A changed file in the tree: stage checkbox, name, line stats and its git
 *  letter; on hover, discard (or .gitignore an untracked file). Click opens
 *  its diff. */
export function FileRow({
  file,
  indent,
  onToggleStage,
  onViewDiff,
  onDiscard,
  onAddToGitignore,
  animated = true,
}: FileRowProps) {
  const canDiscard = !file.staged && file.status !== 'deleted';
  const canIgnore = file.status === 'untracked';
  const hasActions = canDiscard || canIgnore;
  const row = (
    <ListRow
      as="div"
      size="sm"
      {...rowKeys(() => onViewDiff(file))}
      onClick={() => onViewDiff(file)}
      indent={indent}
      className="cursor-pointer"
      leading={
        <>
          <Checkbox
            checked={file.staged}
            onChange={() => onToggleStage(file)}
            aria-label={file.staged ? 'Unstage' : 'Stage'}
          />
          {/* The folder chevron's slot, so names line up across levels. */}
          <span className="ml-2 w-3.5" />
        </>
      }
      trailing={
        <>
          <span className={cn('flex items-center gap-2', hasActions && 'group-hover/row:hidden')}>
            <LineStats add={file.additions} del={file.deletions} />
            <span className="w-3 text-center text-xs">{STATUS_LABEL[file.status]}</span>
          </span>
          {hasActions && (
            <span className="hidden items-center gap-0.5 group-hover/row:flex">
              {canIgnore && (
                <IconButton
                  title="Add to .gitignore"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddToGitignore(file.path);
                  }}
                >
                  <EyeOff size={14} strokeWidth={1.8} />
                </IconButton>
              )}
              {canDiscard && (
                <IconButton
                  title="Discard changes"
                  size="sm"
                  variant="destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDiscard(file);
                  }}
                >
                  <Undo2 size={14} strokeWidth={1.8} />
                </IconButton>
              )}
            </span>
          )}
        </>
      }
    >
      <span className="text-sm">{basename(file.path)}</span>
    </ListRow>
  );
  if (!animated) return row;
  return (
    <motion.div layout {...rowEnterExit} transition={ROW_TRANSITION} className="overflow-hidden">
      {row}
    </motion.div>
  );
}

/** "+N more in this folder · Show all" under a truncated folder. */
export function MoreRow({ hidden, onShowAll }: { hidden: number; onShowAll: () => void }) {
  return (
    <div className="flex h-7 items-center gap-2 pr-1 pl-2.5 text-sm text-ink-3">
      <span className="flex-1">+{hidden} more in this folder</span>
      <Button variant="ghost" size="sm" onClick={onShowAll}>
        Show all
      </Button>
    </div>
  );
}
