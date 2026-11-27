import { cva } from 'class-variance-authority';
import { cn } from '../../lib/cn';

/** `done`: finished, not yet seen; `idle`: a live session at rest (seen);
 *  `asleep`: no live session (sleeping, or never run). */
export type AgentState = 'needs' | 'fail' | 'work' | 'done' | 'idle' | 'asleep';

const dotVariants = cva('inline-block shrink-0 rounded-full', {
  variants: {
    // md: a task's own dot (rows, the rail, the finder); sm: a roll-up
    // beside other values (a collapsed project's), smaller than its tasks' (T20).
    size: { md: 'size-2', sm: 'size-1.5' },
    state: {
      needs: 'bg-state-needs',
      fail: 'bg-state-fail',
      work: 'bg-state-work',
      done: 'bg-state-unseen',
      idle: 'bg-state-done',
      asleep: 'invisible',
    },
    // Work and needs breathe until they change; unseen breathes a few
    // times, then holds (D59).
    breath: {
      on: 'motion-safe:animate-breathe',
      few: 'motion-safe:animate-breathe-few',
      none: '',
    },
  },
});

/** How each state breathes: the ones that want a look do. */
function breathOf(state: AgentState): 'on' | 'few' | 'none' {
  if (state === 'work' || state === 'needs') return 'on';
  if (state === 'done') return 'few';
  return 'none';
}

/**
 * A task's agent state as an 8px dot (6px `sm`) — the one place colour means something
 * (S1): working amber, waiting on you purple, finished but unseen blue, a
 * live session at rest green, failed red, sleeping no dot. Working and
 * waiting breathe; finished-unseen breathes a few times, then holds (D59;
 * none under reduced motion, where their colours still differ);
 * `asleep` holds the dot's place with nothing in it, so names line up. Give
 * it a `label` when nothing beside it says the state in words.
 */
export function StatusDot({
  state,
  size = 'md',
  label,
  className,
}: {
  state: AgentState;
  /** `md` (8px) for a task; `sm` (6px) for a roll-up of several. */
  size?: 'sm' | 'md';
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
      className={cn(dotVariants({ state, size, breath: breathOf(state) }), className)}
    />
  );
}
