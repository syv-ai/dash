import { useEffect, useRef, useState } from 'react';
import { GitCommitHorizontal, Upload, X } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent, PopoverArrow } from '../ui/Popover';
import { Button } from '../ui/Button';
import { IconButton } from '../ui/IconButton';
import { CircleCheck } from '../ui/CircleCheck';
import { Textarea } from '../ui/Textarea';
import { Kbd } from '../ui/Kbd';
import { Tooltip } from '../ui/Tooltip';
import { LineStats } from '../ui/LineStats';
import { useGit } from '../../stores/gitStore';
import type { CommitRun } from './useCommitRun';

/**
 * The labelled Commit button and its message popover: commit the staged
 * files (⌘↵), or push what is already committed. The run itself is shown by
 * the changes panel, through `run`.
 */
export function CommitPopover({
  run,
  labelClassName,
}: {
  run: CommitRun;
  /** Layout only: e.g. a container query that hides the label where room
   *  is short (the tooltip and accessible name keep it). */
  labelClassName?: string;
}) {
  const gitStatus = useGit((s) => s.gitStatus);
  const onPush = useGit((s) => s.push);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [allowEmpty, setAllowEmpty] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => textareaRef.current?.focus(), 30);
    return () => clearTimeout(id);
  }, [open]);

  const staged = gitStatus?.files.filter((f) => f.staged) ?? [];
  const adds = staged.reduce((n, f) => n + (f.additions ?? 0), 0);
  const dels = staged.reduce((n, f) => n + (f.deletions ?? 0), 0);
  const ahead = gitStatus?.ahead ?? 0;
  const running = run.state.status === 'running';

  async function commit() {
    const trimmed = message.trim();
    if (!trimmed || staged.length === 0) return;
    setCommitting(true);
    setError(null);
    try {
      await run.start(
        trimmed,
        allowEmpty,
        staged.map((f) => f.path),
      );
      setMessage('');
      setAllowEmpty(false);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCommitting(false);
    }
  }

  async function push() {
    setPushing(true);
    setError(null);
    try {
      await onPush();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPushing(false);
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <Tooltip content="Commit staged files">
        <PopoverTrigger asChild>
          <Button
            variant="secondary"
            size="sm"
            aria-label="Commit"
            disabled={staged.length === 0 || running}
          >
            <GitCommitHorizontal size={14} strokeWidth={1.8} />
            <span className={labelClassName}>Commit</span>
          </Button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent
        side="left"
        align="start"
        sideOffset={12}
        onInteractOutside={(e) => e.preventDefault()}
        className="h-110 w-100"
      >
        <div className="flex h-full flex-col gap-2.5 p-3.5">
          <div className="flex shrink-0 items-baseline justify-between">
            <h4 className="type-heading">
              Commit{' '}
              <span className="tabular-nums text-ink-2">
                {staged.length} {staged.length === 1 ? 'file' : 'files'}
              </span>
            </h4>
            <span className="text-xs">
              <LineStats add={adds} del={dels} />
            </span>
          </div>
          {error && (
            <div className="flex shrink-0 items-start gap-1.5 rounded-md bg-state-fail/12 px-2 py-1.5 text-xs text-state-fail">
              <span className="min-w-0 flex-1 wrap-break-word">{error}</span>
              <IconButton
                title="Dismiss"
                size="sm"
                variant="destructive"
                onClick={() => setError(null)}
              >
                <X size={14} strokeWidth={1.8} />
              </IconButton>
            </div>
          )}
          <Textarea
            ref={textareaRef}
            value={message}
            onChange={(e) => {
              setMessage(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key !== 'Escape') e.stopPropagation();
              if (e.key === 'Enter' && e.metaKey) {
                e.preventDefault();
                void commit();
              }
            }}
            placeholder="Describe the change…"
            className="min-h-0 flex-1 resize-none"
          />
          <CircleCheck
            checked={allowEmpty}
            onChange={setAllowEmpty}
            label={
              <Tooltip content="Pass --allow-empty to git. Useful for marker / sync commits.">
                <span>Allow empty commit</span>
              </Tooltip>
            }
            className="shrink-0"
          />
          <div className="flex shrink-0 items-center gap-2">
            <span className="flex items-center gap-1 text-xs text-ink-3">
              <Kbd>⌘</Kbd>
              <Kbd>↵</Kbd>
              <span className="ml-0.5">to commit</span>
            </span>
            <div className="ml-auto flex gap-1.5">
              {ahead > 0 && (
                <Button variant="secondary" onClick={() => void push()} disabled={pushing}>
                  <Upload size={14} strokeWidth={1.8} />
                  {pushing ? 'Pushing…' : `Push ${ahead}`}
                </Button>
              )}
              <Button onClick={() => void commit()} disabled={!message.trim() || committing}>
                {committing ? 'Committing…' : 'Commit'}
              </Button>
            </div>
          </div>
        </div>
        <PopoverArrow />
      </PopoverContent>
    </Popover>
  );
}
