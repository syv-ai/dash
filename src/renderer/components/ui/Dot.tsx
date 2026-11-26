import { cva } from 'class-variance-authority';
import { cn } from '../../lib/cn';

/** `neutral`: a state worth showing with no colour; `fail`: something broke. */
export type DotTone = 'neutral' | 'fail';

const dotVariants = cva('inline-block size-1.5 shrink-0 rounded-full', {
  variants: {
    tone: { neutral: 'bg-icon', fail: 'bg-state-fail' },
    pulse: { true: 'motion-safe:animate-breathe', false: '' },
  },
});

/**
 * A 6px status dot for things that aren't an agent (a language server).
 * Colour means agent state (StatusDot), so this draws neutral, red only for
 * a failure, and breathes while something is in progress (H4). Give it a
 * `label` when nothing beside it says the state in words.
 */
export function Dot({
  tone,
  pulse = false,
  label,
  className,
}: {
  tone: DotTone;
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
      className={cn(dotVariants({ tone, pulse }), className)}
    />
  );
}
