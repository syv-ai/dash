import { cva } from 'class-variance-authority';
import { cn } from '../../lib/cn';

export type AgentState = 'needs' | 'fail' | 'work' | 'done' | 'idle';

const dotVariants = cva('inline-block size-1.5 shrink-0 rounded-full', {
  variants: {
    state: {
      needs: 'bg-state-needs',
      fail: 'bg-state-fail',
      work: 'bg-state-work',
      done: 'bg-state-done',
      idle: 'bg-ink-3',
    },
    pulse: { true: 'motion-safe:animate-breathe', false: '' },
  },
});

/**
 * A task's agent state as a 6px dot — the one place colour means something.
 * `work` breathes by default (not under reduced motion). Give it a `label`
 * when nothing beside it says the state in words.
 */
export function StatusDot({
  state,
  pulse = state === 'work',
  label,
  className,
}: {
  state: AgentState;
  pulse?: boolean;
  label?: string;
  /** Layout only. */
  className?: string;
}) {
  return (
    <span
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      data-state={state}
      className={cn(dotVariants({ state, pulse }), className)}
    />
  );
}
