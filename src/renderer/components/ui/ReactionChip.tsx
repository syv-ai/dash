import { cn } from '../../lib/cn';
import { focusRing } from './styles';
import { Tooltip } from './Tooltip';

/**
 * One reaction on a comment, as a toggle: its emoji and count, pressed (the
 * select tint and an ink ring) when the viewer gave it. Neutral, not a
 * forge's blue: colour means agent state. `name` is its tooltip and, with
 * the count, its accessible name.
 */
export function ReactionChip({
  emoji,
  name,
  count,
  pressed,
  disabled = false,
  onToggle,
}: {
  emoji: string;
  name: string;
  count: number;
  pressed: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  const label = `${name} · ${count}${pressed ? ' · you reacted' : ''}`;
  return (
    <Tooltip content={pressed ? `${name}: click to take yours back` : name}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={pressed}
        disabled={disabled}
        onClick={onToggle}
        className={cn(
          'inline-flex h-6 shrink-0 items-center gap-1 rounded-full border px-2 text-xs tabular-nums transition-colors disabled:opacity-40',
          pressed
            ? 'border-ink-3 bg-select text-ink'
            : 'border-line text-ink-2 hover:bg-hover hover:text-ink',
          focusRing,
        )}
      >
        <span aria-hidden className="text-sm leading-none">
          {emoji}
        </span>
        {count}
      </button>
    </Tooltip>
  );
}
