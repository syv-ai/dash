import { cva } from 'class-variance-authority';
import { cn } from '../../lib/cn';

/** `neutral`: a state worth showing with no colour; `fail`: something broke. */
export type DotTone = 'neutral' | 'fail';

const dotVariants = cva('inline-block shrink-0 rounded-full', {
  variants: {
    tone: { neutral: 'bg-icon', fail: 'bg-state-fail' },
    // sm: beside a label (a tab, a status line); md: a panel's own status
    // beside its title, StatusDot's task size.
    size: { sm: 'size-1.5', md: 'size-2' },
    pulse: { true: 'motion-safe:animate-breathe', false: '' },
  },
  defaultVariants: { size: 'sm' },
});

/**
 * A 6px status dot for things that aren't an agent (a language server).
 * Colour means agent state (StatusDot), so this draws neutral, red only for
 * a failure, and breathes while something is in progress (H4). Give it a
 * `label` when nothing beside it says the state in words.
 * `color` paints it from a logged ramp instead (the system health popover's
 * `memoryColor`, D62), the one way past the two tones.
 */
export function Dot({
  tone,
  size,
  color,
  pulse = false,
  label,
  className,
}: {
  tone: DotTone;
  size?: 'sm' | 'md';
  /** A computed colour from a logged ramp (`memoryColor`); replaces the tone's. */
  color?: string;
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
      className={cn(dotVariants({ tone, size, pulse }), className)}
      style={color ? { backgroundColor: color } : undefined}
    />
  );
}
