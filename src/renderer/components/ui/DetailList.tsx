import * as React from 'react';
import { Check, Copy } from 'lucide-react';
import { DisclosureChevron } from './DisclosureChevron';
import { IconButton } from './IconButton';
import { cn } from '../../lib/cn';
import { focusRing } from './styles';

/**
 * A titled block of a details view: a `type-heading` (with an optional action
 * at its end; the action wraps under a long title, which never truncates),
 * then its rows. Sections stack with their own spacing.
 * `collapsible` makes it a band instead: the app's one drawer inside a view
 * (D273), the heading on a faint fill (`hover`, an overlay that reads on any
 * surface; no rules), a disclosure that folds the rows away (`.collapse-grid`,
 * `DisclosureChevron`). Keep its open state with `useSectionOpen`. Banded
 * sections stack 4px apart, so two folded bands never fuse.
 * A `summary` follows the title quietly ("Checks · 1 passing").
 * Rows sit in one `minmax(0, 1fr)` column (`grid-cols-1`), never an `auto`
 * one, so a truncating row ellipsizes at the pane's edge instead of widening it.
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
      <section className="grid grid-cols-1 gap-1.5 px-3 pt-5 pb-2">
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
    <section className="not-first:mt-1">
      <div className="flex min-h-9 flex-wrap items-center gap-x-2 bg-hover pr-3">
        <h3 className="type-heading flex min-w-0 flex-1 self-stretch">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={id}
            onClick={() => setOpen(!open)}
            className={cn(
              'flex min-h-9 min-w-0 flex-1 items-center gap-2 py-1.5 pl-3 text-left',
              focusRing,
            )}
          >
            <DisclosureChevron open={open} />
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
          <div className="grid grid-cols-1 gap-1.5 px-3 py-2.5">{children}</div>
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
  return (
    <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-sm">{children}</dl>
  );
}

export function DetailItem({
  label,
  title,
  copy,
  mono = false,
  trailing,
  children,
}: {
  label: React.ReactNode;
  /** Hover text for the value. */
  title?: string;
  /** Text to put on the clipboard from a copy button beside the value. */
  copy?: string;
  /** The value is code (command text): set in the code font. */
  mono?: boolean;
  /** A mark after the value (a caution chip), never truncated. */
  trailing?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <>
      <dt className="type-label flex min-h-6 items-center truncate">{label}</dt>
      <dd className="group/detail flex min-h-6 min-w-0 items-center gap-1 text-ink">
        <span className={cn('min-w-0 truncate', mono && 'font-mono')} title={title}>
          {children}
        </span>
        {trailing}
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
