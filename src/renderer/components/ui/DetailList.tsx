import * as React from 'react';
import { Check, ChevronRight, Copy } from 'lucide-react';
import { IconButton } from './IconButton';
import { cn } from '../../lib/cn';
import { focusRing } from './styles';

/**
 * A titled block of a details view: a `type-heading` (with an optional action
 * at its end), then its rows. Sections stack with their own spacing.
 * `collapsible` makes the heading a disclosure that folds the rows away.
 */
export function DetailSection({
  title,
  action,
  collapsible = false,
  defaultOpen = true,
  children,
}: {
  title: React.ReactNode;
  /** A small control at the label's end ("Edit"). */
  action?: React.ReactNode;
  collapsible?: boolean;
  /** Collapsible only: open on first render. */
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  if (!collapsible) {
    return (
      <section className="grid gap-1 px-2.5 pt-4 pb-1">
        <div className="flex h-6 items-center gap-2">
          <h3 className="type-heading min-w-0 flex-1 truncate">{title}</h3>
          {action}
        </div>
        {children}
      </section>
    );
  }
  return (
    <section className="px-2.5 pt-4 pb-1">
      <div className="flex h-6 items-center gap-2">
        <h3 className="type-heading min-w-0 flex-1">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className={cn('flex max-w-full items-center gap-1 rounded-sm', focusRing)}
          >
            <ChevronRight
              size={14}
              strokeWidth={1.8}
              className={cn('shrink-0 text-icon transition-transform', open && 'rotate-90')}
            />
            <span className="truncate">{title}</span>
          </button>
        </h3>
        {action}
      </div>
      <div className="collapse-grid" data-open={open}>
        <div className="grid gap-1 pt-1">{children}</div>
      </div>
    </section>
  );
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
