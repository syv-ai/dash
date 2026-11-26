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
      <span
        className="flex h-7 items-center gap-1 rounded-md px-2 ring-1 ring-line ring-inset"
        style={{ background }}
      >
        {colors.map((c, i) => (
          <span key={i} className="size-1.5 rounded-full" style={{ background: c }} />
        ))}
      </span>
      <span className="flex items-center gap-1.5 px-0.5">
        <span className="type-body min-w-0 flex-1 truncate">{label}</span>
        {meta && <span className="type-caption shrink-0">{meta}</span>}
      </span>
    </button>
  );
}
