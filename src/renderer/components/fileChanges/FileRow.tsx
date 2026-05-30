import React from 'react';
import { Undo2, EyeOff } from 'lucide-react';
import { Tooltip } from '../ui/Tooltip';
import type { FileChange, FileChangeStatus } from '../../../shared/types';

interface FileRowProps {
  file: FileChange;
  /** Render N indent guides to the left, after the checkbox column. */
  indent: number;
  onToggleStage: (file: FileChange) => void;
  onViewDiff: (file: FileChange) => void;
  onDiscard: (file: FileChange) => void;
  onAddToGitignore: (path: string) => void;
}

const STATUS_LABEL: Record<FileChangeStatus, string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  untracked: 'U',
  conflicted: 'C',
};

const STATUS_CLASS: Record<FileChangeStatus, string> = {
  modified: 'text-[hsl(var(--git-modified))]',
  added: 'text-[hsl(var(--git-added))]',
  deleted: 'text-[hsl(var(--git-deleted))]',
  renamed: 'text-[hsl(var(--git-renamed))]',
  untracked: 'text-[hsl(var(--git-untracked))]',
  conflicted: 'text-[hsl(var(--git-conflicted))]',
};

function basename(p: string): string {
  const i = p.lastIndexOf('/');
  return i === -1 ? p : p.slice(i + 1);
}

export function FileRow({
  file,
  indent,
  onToggleStage,
  onViewDiff,
  onDiscard,
  onAddToGitignore,
}: FileRowProps) {
  const canDiscard = !file.staged && file.status !== 'deleted';
  const canIgnore = file.status === 'untracked';
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onViewDiff(file)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onViewDiff(file);
        }
      }}
      title="Click to open diff"
      className="group relative flex items-center gap-2 px-2 py-1 rounded-md text-[12.5px] cursor-pointer hover:bg-[hsl(var(--surface-2)/0.6)] min-h-[24px]"
    >
      <Checkbox checked={file.staged} onChange={() => onToggleStage(file)} />
      {Array.from({ length: indent }, (_, i) => (
        <span key={i} className="w-2 h-full relative inline-block flex-shrink-0">
          <span className="absolute left-[3px] top-[-2px] bottom-[-2px] w-px bg-[hsl(var(--border)/0.5)]" />
        </span>
      ))}
      <span
        className={`font-mono text-[10px] font-semibold w-3.5 text-center flex-shrink-0 ${STATUS_CLASS[file.status]}`}
      >
        {STATUS_LABEL[file.status]}
      </span>
      <span className="flex-1 min-w-0 font-mono text-[11.5px] truncate text-foreground">
        {basename(file.path)}
      </span>
      <span className="font-mono text-[10.5px] flex gap-1.5 flex-shrink-0 group-hover:invisible">
        {file.additions ? (
          <span
            className={
              file.status === 'untracked' ? 'text-muted-foreground' : 'text-[hsl(var(--git-added))]'
            }
          >
            +{file.additions}
          </span>
        ) : null}
        {file.deletions ? (
          <span className="text-[hsl(var(--git-deleted))]">−{file.deletions}</span>
        ) : null}
      </span>
      {(canDiscard || canIgnore) && (
        <div className="absolute right-2 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center gap-1">
          {canIgnore && (
            <Tooltip content="Add to .gitignore">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onAddToGitignore(file.path);
                }}
                aria-label="Add to .gitignore"
                className="flex items-center justify-center w-[22px] h-[22px] rounded-md bg-[hsl(var(--surface-3))] border border-[hsl(var(--border)/0.5)] text-muted-foreground hover:bg-[hsl(var(--git-untracked)/0.18)] hover:border-[hsl(var(--git-untracked)/0.5)] hover:text-foreground"
              >
                <EyeOff size={11} strokeWidth={2.4} />
              </button>
            </Tooltip>
          )}
          {canDiscard && (
            <Tooltip content="Discard changes">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDiscard(file);
                }}
                aria-label="Discard changes"
                className="flex items-center justify-center w-[22px] h-[22px] rounded-md bg-[hsl(var(--surface-3))] border border-[hsl(var(--border)/0.5)] text-muted-foreground hover:bg-destructive/12 hover:border-destructive/50 hover:text-destructive"
              >
                <Undo2 size={11} strokeWidth={2.4} />
              </button>
            </Tooltip>
          )}
        </div>
      )}
    </div>
  );
}

interface CheckboxProps {
  checked: boolean | 'mixed';
  onChange: () => void;
}

export function Checkbox({ checked, onChange }: CheckboxProps) {
  const isMixed = checked === 'mixed';
  const isChecked = checked === true;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      aria-checked={isMixed ? 'mixed' : isChecked}
      role="checkbox"
      className={[
        'flex-shrink-0 w-[14px] h-[14px] rounded border-[1.4px] inline-flex items-center justify-center transition-colors',
        isChecked
          ? 'bg-primary border-primary text-primary-foreground'
          : isMixed
            ? 'bg-primary/55 border-primary/70 text-primary-foreground'
            : 'bg-transparent border-border text-transparent hover:border-foreground/40',
      ].join(' ')}
    >
      {isChecked ? (
        <svg
          viewBox="0 0 24 24"
          width="10"
          height="10"
          fill="none"
          stroke="currentColor"
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : isMixed ? (
        <svg
          viewBox="0 0 24 24"
          width="8"
          height="2"
          fill="none"
          stroke="currentColor"
          strokeWidth={3}
          strokeLinecap="round"
        >
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      ) : null}
    </button>
  );
}
