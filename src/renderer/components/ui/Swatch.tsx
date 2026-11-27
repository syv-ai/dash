import * as React from 'react';
import { cn } from '../../lib/cn';
import { focusRing } from './styles';

/**
 * One option of a palette picker (the terminal palette): a strip in the
 * palette's own background with a dot per accent colour, and its name under
 * it. The colours are data (the palette being previewed), so they are
 * inline; the chrome around them is neutral, the current one on the select
 * tint like a selected row.
 */
export function SwatchOption({
  label,
  meta,
  background,
  colors,
  selected,
  onSelect,
}: {
  label: string;
  /** Quiet text after the name ("Auto"). */
  meta?: string;
  background: string;
  colors: string[];
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        'grid gap-1.5 rounded-lg p-1.5 text-left transition-colors hover:bg-hover aria-checked:bg-select',
        focusRing,
      )}
    >
      <SwatchStrip background={background} colors={colors} />
      <span className="flex items-center gap-1.5 px-0.5">
        <span className="type-body min-w-0 flex-1 truncate">{label}</span>
        {meta && <span className="type-caption shrink-0">{meta}</span>}
      </span>
    </button>
  );
}

/**
 * A palette's preview on its own: its background with a dot per accent
 * colour. `sm` fits in a select's row beside the palette's name.
 */
export function SwatchStrip({
  background,
  colors,
  size = 'md',
}: {
  background: string;
  colors: string[];
  size?: 'sm' | 'md';
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex shrink-0 items-center rounded-md ring-1 ring-line ring-inset',
        size === 'sm' ? 'h-4 gap-0.5 rounded-sm px-1' : 'h-7 gap-1 px-2',
      )}
      style={{ background }}
    >
      {colors.map((c, i) => (
        <span key={i} className="size-1.5 rounded-full" style={{ background: c }} />
      ))}
    </span>
  );
}
