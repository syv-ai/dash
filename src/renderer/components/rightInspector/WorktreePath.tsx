import { useEffect, useMemo, useState } from 'react';
import { Tooltip } from '../ui/Tooltip';
import { Button } from '../ui/Button';
import { cn } from '../../lib/cn';
import { splitForMiddleTruncation, tildePath } from '../../lib/displayPath';

/**
 * The task's folder, quiet and monospace, `~` for home, cut in the middle so
 * its last segment (the worktree's name) always shows. Click copies the full
 * path.
 */
export function WorktreePath({ path, className }: { path: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const [head, tail] = useMemo(
    () => splitForMiddleTruncation(tildePath(path, window.electronAPI.getHomeDir())),
    [path],
  );

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  return (
    <Tooltip content={copied ? 'Copied' : `Copy ${path}`} open={copied || undefined} delay={400}>
      <Button
        variant="ghost"
        size="sm"
        aria-label={`Copy path ${path}`}
        onClick={() => {
          window.electronAPI.clipboardWriteText(path);
          setCopied(true);
        }}
        className={cn('min-w-0', className)}
      >
        <span className="flex min-w-0 text-xs text-ink-3">
          <span className="truncate">{head}</span>
          <span className="shrink-0">{tail}</span>
        </span>
      </Button>
    </Tooltip>
  );
}
