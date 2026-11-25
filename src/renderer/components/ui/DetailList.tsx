import * as React from 'react';
import { Check, ChevronRight, Copy } from 'lucide-react';
import { IconButton } from './IconButton';
import { cn } from '../../lib/cn';
import { focusRing } from './styles';

/**
 * A titled block of a details view: a `type-heading` (with an optional action
 * at its end; the action wraps under a long title, which never truncates),
 * then its rows. Sections stack with their own spacing.
 * `collapsible` makes it a band instead: the heading on a filled `well` row
 * between hairlines, a disclosure that folds the rows away. Banded sections
 * stack flush, sharing their rules, so a column of them reads as one list.
 * A `summary` follows the title quietly ("Checks · 1 passing"), as
 * `DockedPanel`'s tabs do, so every titled section counts the same way.
 */
export function DetailSection({
  title,
  summary,
  closedHint,
  action,
  collapsible = false,
  defaultOpen = true,
  open: openProp,
  onOpenChange,
  children,
}: {
  title: React.ReactNode;
  /** Beside the title, quieter ("· 3 comments"); omitted when empty. */
  summary?: string | null;
  /** Collapsible only: shown after the title while the section is folded
   *  (an aggregate the rows would otherwise say). */
  closedHint?: React.ReactNode;
  /** A small control at the label's end ("Edit"). */
  action?: React.ReactNode;
  collapsible?: boolean;
  /** Collapsible only: open on first render (uncontrolled). */
  defaultOpen?: boolean;
  /** Collapsible only: controlled open state, with `onOpenChange`. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}) {
  const [ownOpen, setOwnOpen] = React.useState(defaultOpen);
  const open = openProp ?? ownOpen;
  const setOpen = onOpenChange ?? setOwnOpen;
  const id = React.useId();
  if (!collapsible) {
    return (
      <section className="grid gap-1 px-2.5 pt-4 pb-1">
        <div className="flex min-h-6 flex-wrap items-center gap-x-2 gap-y-1">
          <h3 className="type-heading min-w-0 flex-1">
            {title}
            <Summary text={summary} />
          </h3>
          {action}
        </div>
        {children}
      </section>
    );
  }
  return (
    <section className="not-first:-mt-px">
      <div className="flex min-h-8 flex-wrap items-center gap-x-2 border-y border-line bg-well pr-2.5">
        <h3 className="type-heading flex min-w-0 flex-1 self-stretch">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={id}
            onClick={() => setOpen(!open)}
            className={cn(
              'flex min-h-8 min-w-0 flex-1 items-center gap-1.5 py-1 pl-2.5 text-left',
              focusRing,
            )}
          >
            <ChevronRight
              size={14}
              strokeWidth={1.8}
              className={cn('shrink-0 text-icon transition-transform', open && 'rotate-90')}
            />
            <span>
              {title}
              <Summary text={summary} />
            </span>
            {!open && closedHint}
          </button>
        </h3>
        {action}
      </div>
      <div id={id} className="collapse-grid" data-open={open}>
        {/* The padding sits inside the clipped child, which folds to nothing. */}
        <div>
          <div className="grid gap-1 px-2.5 py-1.5">{children}</div>
        </div>
      </div>
    </section>
  );
}

function Summary({ text }: { text?: string | null }) {
  return text ? <span className="type-caption tabular-nums"> · {text}</span> : null;
}

/**
 * Key/value rows: labels quiet in a fixed column, values in ink taking the
 * rest (truncated; the full value in the tooltip or behind copy).
 */
export function DetailList({ children }: { children: React.ReactNode }) {
  return <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 text-sm">{children}</dl>;
}

export function DetailItem({
  label,
  title,
  copy,
  children,
}: {
  label: React.ReactNode;
  /** Hover text for the value. */
  title?: string;
  /** Text to put on the clipboard from a copy button beside the value. */
  copy?: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <dt className="type-label flex min-h-6 items-center truncate">{label}</dt>
      <dd className="group/detail flex min-h-6 min-w-0 items-center gap-1 text-ink">
        <span className="min-w-0 truncate" title={title}>
          {children}
        </span>
        {copy && <CopyButton text={copy} />}
      </dd>
    </>
  );
}

/** Copies `text`; shows a check for a moment. Visible on the row's hover. */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <span
      className={cn(
        'shrink-0 opacity-0 transition-opacity group-hover/detail:opacity-100 focus-within:opacity-100',
        copied && 'opacity-100',
      )}
    >
      <IconButton
        size="sm"
        title={copied ? 'Copied' : 'Copy'}
        onClick={() => {
          window.electronAPI.clipboardWriteText(text);
          setCopied(true);
        }}
      >
        {copied ? <Check size={14} strokeWidth={1.8} /> : <Copy size={14} strokeWidth={1.8} />}
      </IconButton>
    </span>
  );
}
