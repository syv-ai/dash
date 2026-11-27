import * as React from 'react';
import { Info } from 'lucide-react';
import { cn } from '../../lib/cn';
import { focusRing } from './styles';
import { Tooltip, type TooltipContent } from './Tooltip';

/**
 * An explanation behind an ⓘ beside a label or heading: the `Tooltip` shows
 * on hover (quickly: the reader is asking) and on keyboard focus. Short,
 * essential warnings stay in the open; what a setting does goes here.
 *
 * A focusable `span`, not a `<button>`: inside a `<label>` a button would
 * become the label's control (and steal its click), a span never does, and a
 * click on it is kept from reaching the label.
 */
export function InfoTip({
  content,
  label = 'More info',
  side = 'top',
  className,
}: {
  /** Plain text, or a `RichTooltip` card. */
  content: TooltipContent;
  /** The icon's accessible name; the tooltip describes it. */
  label?: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
}) {
  return (
    <Tooltip content={content} side={side} delay={150}>
      <span
        role="img"
        tabIndex={0}
        aria-label={label}
        onClick={(e) => e.preventDefault()}
        className={cn(
          'inline-flex shrink-0 cursor-help rounded-full text-icon transition-colors hover:text-ink',
          focusRing,
          className,
        )}
      >
        <Info size={14} strokeWidth={1.8} aria-hidden />
      </span>
    </Tooltip>
  );
}

