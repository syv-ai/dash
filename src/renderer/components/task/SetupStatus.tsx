import { Loader2, CircleAlert } from 'lucide-react';
import { useSetup } from '../../stores/setupStore';
import { Tooltip } from '../ui/Tooltip';

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
  const openLog = useSetup((s) => s.openLog);
  if (!run || run.status === 'succeeded') return null;

  const running = run.status === 'running';
  const tone = running ? 'text-muted-foreground' : 'text-destructive';
  const shape =
    variant === 'pill'
      ? `px-2 py-[3px] rounded-full font-mono ${running ? 'bg-foreground/5 hover:bg-foreground/10' : 'bg-destructive/10 hover:bg-destructive/15'}`
      : 'hover:text-foreground';
  return (
    <Tooltip
      content={running ? 'Setup script running: view output' : (run.error ?? 'Setup failed')}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          void openLog(worktreePath);
        }}
        className={`inline-flex items-center gap-1 shrink-0 text-[11px] transition-colors ${tone} ${shape}`}
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
