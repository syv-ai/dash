import { Loader2, CircleAlert } from 'lucide-react';
import { useSetup } from '../../stores/setupStore';
import { Tooltip } from '../ui/Tooltip';
import { badgeVariants } from '../ui/Badge';
import { cn } from '../../lib/cn';

/**
 * "Setting up…" while a task's worktree setup runs, "Setup failed" after a
 * failed run (until the next one). Nothing otherwise. Clicking it opens the
 * setup output. `pill` is the task header's look; `inline` fits a sidebar row.
 */
export function SetupStatus({
  worktreePath,
  variant,
}: {
  worktreePath: string;
  variant: 'pill' | 'inline';
}) {
  const run = useSetup((s) => s.runs[worktreePath]);
  const showSetup = useSetup((s) => s.showSetup);
  if (!run || run.status === 'succeeded') return null;

  const running = run.status === 'running';
  const className =
    variant === 'pill'
      ? cn(
          badgeVariants({ tone: running ? 'neutral' : 'fail' }),
          'transition-colors',
          running ? 'hover:bg-select' : 'hover:bg-state-fail/20',
        )
      : cn(
          'inline-flex shrink-0 items-center gap-1 text-xs transition-colors',
          running ? 'text-ink-2 hover:text-ink' : 'text-state-fail',
        );
  return (
    <Tooltip
      content={running ? 'Setup script running: show output' : (run.error ?? 'Setup failed')}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          showSetup(worktreePath);
        }}
        className={className}
      >
        {running ? (
          <Loader2 size={11} strokeWidth={2} className="animate-spin" />
        ) : (
          <CircleAlert size={11} strokeWidth={2} />
        )}
        {running ? 'Setting up…' : 'Setup failed'}
      </button>
    </Tooltip>
  );
}
