import React, { useState } from 'react';
import { Folder, FolderOpen, Undo2, EyeOff } from 'lucide-react';
import { Tooltip } from '../ui/Tooltip';
import { Popover, PopoverTrigger, PopoverContent, PopoverArrow } from '../ui/Popover';
import { Checkbox } from './FileRow';
import { DiscardFolderConfirm } from './DiscardFolderConfirm';
import type { NodeAggregate } from './buildTree';
import type { FileChangeStatus } from '../../../shared/types';

function FolderUntracked({ size = 13 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3.5 6.25A2.25 2.25 0 0 1 5.75 4h4.1l1.7 1.75h6.7A2.25 2.25 0 0 1 20.5 8v9.75A2.25 2.25 0 0 1 18.25 20H5.75A2.25 2.25 0 0 1 3.5 17.75z" />
      <path d="M9 9v5.7a3 3 0 0 0 6 0V9" />
    </svg>
  );
}

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

const FOLDER_TINT: Record<FileChangeStatus, string> = {
  modified: 'text-[hsl(var(--git-modified)/0.85)]',
  added: 'text-[hsl(var(--git-added)/0.85)]',
  deleted: 'text-[hsl(var(--git-deleted)/0.85)]',
  renamed: 'text-[hsl(var(--git-renamed)/0.85)]',
  untracked: 'text-[hsl(var(--git-untracked))]',
  conflicted: 'text-[hsl(var(--git-conflicted)/0.85)]',
};

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
  const allUntracked = agg.status === 'untracked';
  // Folder icon color follows the aggregate status (untracked stays grey,
  // added stays green, etc.). Mixed-status folders fall back to neutral.
  // Open vs closed is signalled by the icon shape + indented children, not
  // by a separate tint, so the status color is preserved when expanded.
  const folderTint = agg.status !== 'mixed' ? FOLDER_TINT[agg.status] : 'text-muted-foreground/75';
  const nameClass = allUntracked
    ? 'text-[hsl(var(--git-untracked))]' + (open ? '' : ' italic')
    : 'text-foreground';
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onToggleOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggleOpen();
        }
      }}
      className="group relative flex items-center gap-2 px-2 py-1 rounded-md text-[12.5px] cursor-pointer hover:bg-[hsl(var(--surface-2)/0.6)] min-h-[24px]"
    >
      <Checkbox checked={agg.stageState} onChange={onToggleStage} />
      {Array.from({ length: indent }, (_, i) => (
        <span key={i} className="w-2 h-full relative inline-block flex-shrink-0">
          <span className="absolute left-[3px] top-[-2px] bottom-[-2px] w-px bg-[hsl(var(--border)/0.5)]" />
        </span>
      ))}
      <span
        className={`flex-shrink-0 w-[14px] h-[14px] inline-flex items-center justify-center ${folderTint}`}
      >
        {allUntracked ? (
          <FolderUntracked size={13} />
        ) : open ? (
          <FolderOpen size={13} strokeWidth={1.8} />
        ) : (
          <Folder size={13} strokeWidth={1.8} />
        )}
      </span>
      <span className={`flex-1 min-w-0 font-mono text-[11.5px] truncate font-medium ${nameClass}`}>
        {displayName}/
      </span>
      <span className="min-w-[18px] h-[16px] flex items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary tabular-nums px-1 flex-shrink-0">
        {agg.count}
      </span>
      <span className="font-mono text-[10px] flex gap-1.5 flex-shrink-0 group-hover:invisible">
        {agg.add || agg.del ? (
          <>
            {agg.add ? <span className="text-[hsl(var(--git-added)/0.75)]">+{agg.add}</span> : null}
            {agg.del ? (
              <span className="text-[hsl(var(--git-deleted)/0.75)]">−{agg.del}</span>
            ) : null}
          </>
        ) : agg.untrackedAdd ? (
          <span className="text-muted-foreground/70">+{agg.untrackedAdd}</span>
        ) : null}
      </span>
      {(canDiscard || canIgnore) && (
        <div
          className={`absolute right-2 top-1/2 -translate-y-1/2 items-center gap-1 ${
            discardOpen ? 'flex' : 'hidden group-hover:flex'
          }`}
        >
          {canIgnore && (
            <Tooltip content="Add folder to .gitignore">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onAddToGitignore();
                }}
                aria-label="Add folder to .gitignore"
                className="flex items-center justify-center w-[22px] h-[22px] rounded-md bg-[hsl(var(--surface-3))] border border-[hsl(var(--border)/0.5)] text-muted-foreground hover:bg-[hsl(var(--git-untracked)/0.18)] hover:border-[hsl(var(--git-untracked)/0.5)] hover:text-foreground"
              >
                <EyeOff size={11} strokeWidth={2.4} />
              </button>
            </Tooltip>
          )}
          {canDiscard && (
            <Popover open={discardOpen} onOpenChange={setDiscardOpen}>
              <Tooltip content="Discard folder changes">
                <PopoverTrigger asChild>
                  <button
                    onClick={(e) => e.stopPropagation()}
                    aria-label="Discard folder changes"
                    className="flex items-center justify-center w-[22px] h-[22px] rounded-md bg-[hsl(var(--surface-3))] border border-[hsl(var(--border)/0.5)] text-muted-foreground hover:bg-destructive/12 hover:border-destructive/50 hover:text-destructive data-[state=open]:bg-destructive/12 data-[state=open]:border-destructive/50 data-[state=open]:text-destructive"
                  >
                    <Undo2 size={11} strokeWidth={2.4} />
                  </button>
                </PopoverTrigger>
              </Tooltip>
              <PopoverContent side="left" align="end" sideOffset={8}>
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
        </div>
      )}
    </div>
  );
}
