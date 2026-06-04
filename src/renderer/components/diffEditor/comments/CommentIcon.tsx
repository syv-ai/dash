import { MessageSquare } from 'lucide-react';
import type { Shade } from './types';

interface Props {
  /** Shade slot for the *expanded* color. Collapsed always renders muted.
   *  Null = stacked anchor → use primary (neutral) when expanded. */
  shade: Shade | null;
  state: 'collapsed' | 'expanded';
  /** Count badge when ≥2 comments stack at the same anchor. */
  count?: number;
  onClick(): void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  title?: string;
}

/** Gutter trigger button. Colored by state: muted when collapsed, shade
 *  color when expanded. Count badge shown when count >= 2. */
export function CommentIcon({
  shade,
  state,
  count,
  onClick,
  onMouseEnter,
  onMouseLeave,
  title,
}: Props) {
  const expanded = state === 'expanded';
  const colorVar = shade === 2 ? '--shade-2' : shade === 1 ? '--shade-1' : '--primary';
  const color = expanded ? `hsl(var(${colorVar}))` : 'hsl(var(--muted-foreground) / 0.8)';
  const showCount = typeof count === 'number' && count >= 2;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      title={title}
      className="inline-flex items-center justify-center gap-[2px] min-w-[20px] h-4 px-[3px] bg-transparent border-0 cursor-pointer rounded transition-colors duration-150 hover:bg-[hsl(var(--primary)/0.14)]"
      style={{ color }}
    >
      <MessageSquare size={12} strokeWidth={2} />
      {showCount && (
        <span className="font-sans text-[9.5px] font-bold leading-none tabular-nums">{count}</span>
      )}
    </button>
  );
}
