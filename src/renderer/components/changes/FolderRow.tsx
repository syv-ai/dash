import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Undo2, EyeOff } from 'lucide-react';
import { Tooltip } from '../ui/Tooltip';
import { Popover, PopoverTrigger, PopoverContent, PopoverArrow } from '../ui/Popover';
import { Checkbox } from './FileRow';
import { DiscardFolderConfirm } from './DiscardFolderConfirm';
import type { NodeAggregate } from './buildTree';
import type { FileChangeStatus } from '../../../shared/types';

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
  // A folder is only tinted when the folder itself was renamed/moved (agg.status
  // === 'renamed'); changes to its contents don't tint it. Otherwise the name is
  // a muted foreground — dimmer than full white, but kept warm so it never reads
  // as the grey untracked tint.
  const nameTint = agg.status !== 'mixed' ? FOLDER_TINT[agg.status] : 'text-foreground/75';
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
      className="group relative flex items-center gap-2 px-2 py-1 rounded-md text-[12.5px] cursor-pointer hover:bg-[hsl(var(--surface-2)/0.6)] min-h-[24px] transition-colors duration-150"
    >
      <Checkbox checked={agg.stageState} onChange={onToggleStage} />
      {Array.from({ length: indent }, (_, i) => (
        <span key={i} className="w-1 h-full relative inline-block shrink-0">
          <span className="absolute left-px top-[-2px] bottom-[-2px] w-px bg-[hsl(var(--border)/0.5)]" />
        </span>
      ))}
      <span className="shrink-0 w-[14px] h-[14px] inline-flex items-center justify-center text-muted-foreground/55">
        {open ? (
          <ChevronDown size={12} strokeWidth={1.8} />
        ) : (
          <ChevronRight size={12} strokeWidth={1.8} />
        )}
      </span>
      <span className={`flex-1 min-w-0 font-mono text-[11.5px] truncate font-medium ${nameTint}`}>
        {displayName}/
      </span>
      <span className="font-mono text-[10px] font-semibold tabular-nums shrink-0 text-muted-foreground/70">
        {agg.count}
      </span>
      {!open && (
        <span className="font-mono text-[10px] flex gap-1.5 shrink-0 group-hover:invisible">
          {agg.add || agg.del ? (
            <>
              {agg.add ? (
                <span className="text-[hsl(var(--git-added)/0.75)]">+{agg.add}</span>
              ) : null}
              {agg.del ? (
                <span className="text-[hsl(var(--git-deleted)/0.75)]">−{agg.del}</span>
              ) : null}
            </>
          ) : agg.untrackedAdd ? (
            <span className="text-muted-foreground/70">+{agg.untrackedAdd}</span>
          ) : null}
        </span>
      )}
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
