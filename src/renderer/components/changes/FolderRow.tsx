import { useState } from 'react';
import { ChevronDown, ChevronRight, Undo2, EyeOff } from 'lucide-react';
import { ListRow } from '../ui/ListRow';
import { IconButton } from '../ui/IconButton';
import { Popover, PopoverTrigger, PopoverContent, PopoverArrow } from '../ui/Popover';
import { cn } from '../../lib/cn';
import { Checkbox } from '../ui/Checkbox';
import { LineStats } from '../ui/LineStats';
import { rowKeys } from './FileRow';
import { DiscardFolderConfirm } from './DiscardFolderConfirm';
import type { NodeAggregate } from './buildTree';

interface FolderRowProps {
  displayName: string;
  agg: NodeAggregate;
  indent: number;
  open: boolean;
  onToggleOpen: () => void;
  onToggleStage: () => void;
  canDiscard: boolean;
  /** Full repo-relative path of the folder, used to strip prefixes off file paths in the confirm popover. */
  folderBasePath: string;
  /** Full paths of every file the discard button will remove. */
  discardPaths: string[];
  onDiscard: () => void;
  canIgnore: boolean;
  onAddToGitignore: () => void;
}

/** A folder in the changes tree: stage-all checkbox, chevron, name, file
 *  count (and its line stats while closed); on hover, discard its changes
 *  (after a confirm) or .gitignore a wholly untracked folder. */
export function FolderRow({
  displayName,
  agg,
  indent,
  open,
  onToggleOpen,
  onToggleStage,
  canDiscard,
  folderBasePath,
  discardPaths,
  onDiscard,
  canIgnore,
  onAddToGitignore,
}: FolderRowProps) {
  const [discardOpen, setDiscardOpen] = useState(false);
  const hasActions = canDiscard || canIgnore;
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <ListRow
      as="div"
      size="sm"
      {...rowKeys(onToggleOpen)}
      onClick={onToggleOpen}
      aria-expanded={open}
      indent={indent}
      className="cursor-pointer"
      leading={
        <>
          <Checkbox
            checked={agg.stageState}
            onChange={onToggleStage}
            aria-label={agg.stageState === true ? 'Unstage folder' : 'Stage folder'}
          />
          <Chevron size={14} strokeWidth={1.8} className="ml-2 text-icon" />
        </>
      }
      trailing={
        <>
          <span
            className={cn(
              'flex items-center gap-2',
              hasActions && (discardOpen ? 'hidden' : 'group-hover/row:hidden'),
            )}
          >
            {/* New files count too, so the folders sum to the panel's total. */}
            {!open && <LineStats add={agg.add + agg.untrackedAdd} del={agg.del} />}
            <span className="tabular-nums">{agg.count}</span>
          </span>
          {hasActions && (
            <span
              className={cn(
                'items-center gap-0.5',
                discardOpen ? 'flex' : 'hidden group-hover/row:flex',
              )}
            >
              {canIgnore && (
                <IconButton
                  title="Add folder to .gitignore"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddToGitignore();
                  }}
                >
                  <EyeOff size={14} strokeWidth={1.8} />
                </IconButton>
              )}
              {canDiscard && (
                <Popover open={discardOpen} onOpenChange={setDiscardOpen}>
                  <PopoverTrigger asChild>
                    <IconButton
                      title="Discard folder changes"
                      size="sm"
                      variant="destructive"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Undo2 size={14} strokeWidth={1.8} />
                    </IconButton>
                  </PopoverTrigger>
                  <PopoverContent
                    side="left"
                    align="end"
                    sideOffset={8}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <DiscardFolderConfirm
                      folderName={displayName}
                      folderBasePath={folderBasePath}
                      paths={discardPaths}
                      onClose={() => setDiscardOpen(false)}
                      onConfirm={() => {
                        onDiscard();
                        setDiscardOpen(false);
                      }}
                    />
                    <PopoverArrow />
                  </PopoverContent>
                </Popover>
              )}
            </span>
          )}
        </>
      }
    >
      <span className="text-sm text-ink-2">{displayName}/</span>
    </ListRow>
  );
}
