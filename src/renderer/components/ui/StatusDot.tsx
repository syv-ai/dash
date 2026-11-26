import { cva } from 'class-variance-authority';
import { cn } from '../../lib/cn';

/** `done`: finished, not yet seen; `idle`: a live session at rest (seen);
 *  `asleep`: no live session (sleeping, or never run). */
export type AgentState = 'needs' | 'fail' | 'work' | 'done' | 'idle' | 'asleep';

const dotVariants = cva('inline-block size-1.5 shrink-0 rounded-full', {
  variants: {
    state: {
      needs: 'bg-state-needs',
      fail: 'bg-state-fail',
      work: 'bg-state-work',
      done: 'bg-state-unseen',
      idle: 'bg-state-done',
      asleep: 'invisible',
    },
    pulse: { true: 'motion-safe:animate-breathe', false: '' },
  },
});

/** The states that want a look, so they breathe. */
const BREATHES: ReadonlySet<AgentState> = new Set(['work', 'needs', 'done']);

/**
 * A task's agent state as a 6px dot — the one place colour means something
 * (S1): working amber, waiting on you purple, finished but unseen blue, a
 * live session at rest green, failed red, sleeping no dot. The first three
 * breathe (not under reduced motion, where their colours still differ);
 * `asleep` holds the dot's place with nothing in it, so names line up. Give
 * it a `label` when nothing beside it says the state in words.
 */
export function StatusDot({
  state,
  pulse = BREATHES.has(state),
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
