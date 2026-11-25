import * as React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../../lib/cn';
import { Kbd } from './Kbd';

/** The window's top strip doubles as the macOS titlebar drag region; keep
 *  tooltips out of it so a header button's tooltip flips below. */
const COLLISION_PADDING = { top: 40, right: 8, bottom: 8, left: 8 };

/** One key/value line of a rich tooltip ("Resets" · "Thu 09:00"). */
export interface TooltipRow {
  label: React.ReactNode;
  value: React.ReactNode;
}

/**
 * A rich tooltip: a title line (an optional icon before it, the shortcut's
 * keycaps after it), then running text, then key/value rows, each optional
 * but the title. Still a label: nothing in it can be clicked (that is
 * `HoverCard`'s job).
 */
export interface RichTooltip {
  title: React.ReactNode;
  icon?: LucideIcon;
  /** Keycaps, in order: `['⌘', 'W']` (`getBindingKeys` gives them). */
  shortcut?: readonly string[];
  body?: React.ReactNode;
  rows?: readonly TooltipRow[];
}

/** What a tooltip shows: plain text (or any node), or a rich card. Empty
 *  (`undefined`, `null`, `''`, `false`) shows no tooltip at all. */
export type TooltipContent = React.ReactNode | RichTooltip;

const isEmpty = (content: TooltipContent): boolean =>
  content === undefined || content === null || content === '' || content === false;

export function isRichTooltip(content: TooltipContent): content is RichTooltip {
  return (
    typeof content === 'object' &&
    content !== null &&
    !React.isValidElement(content) &&
    !(Symbol.iterator in content) &&
    'title' in content
  );
}

interface TooltipProps {
  content: TooltipContent;
  side?: 'top' | 'bottom' | 'left' | 'right';
  /** Hover delay in ms before the tooltip shows. */
  delay?: number;
  /** Controlled visibility (e.g. pinned open in the primitives gallery). */
  open?: boolean;
  /** One element; it becomes the trigger (Radix `asChild`), so it must forward
   *  its ref and spread props — a Radix trigger or `IconButton` both do. */
  children: React.ReactElement;
}

/**
 * Hover label for a control (Radix Tooltip, shadcn look): raised, small,
 * rounded-md. Plain text wraps at a readable width and honours `\n`; a
 * `RichTooltip` lays out a titled card (`TooltipCard`). Opens on hover after
 * `delay`, and on keyboard focus — not on programmatic focus, so a dialog that
 * autofocuses a button doesn't pop its tooltip. Empty content keeps it shut;
 * the trigger stays wrapped either way, so content that comes and goes (a
 * count moving into the tip) never remounts, or unfocuses, the child.
 *
 * Wrapping another Radix trigger (`<Tooltip><PopoverTrigger asChild>…`) works,
 * but the tooltip's `data-state` wins on the shared element: style the open
 * state with `aria-expanded:` rather than `data-[state=open]:`.
 */
export function Tooltip({ content, side = 'top', delay = 1000, open, children }: TooltipProps) {
  // Always controlled, so a pinned `open` coming and going, or content
  // emptying, never flips Radix between controlled and uncontrolled.
  const [hovered, setHovered] = React.useState(false);
  const empty = isEmpty(content);
  const rich = isRichTooltip(content);
  return (
    <TooltipPrimitive.Provider delayDuration={delay} skipDelayDuration={300}>
      <TooltipPrimitive.Root open={!empty && (open ?? hovered)} onOpenChange={setHovered}>
        <TooltipPrimitive.Trigger
          asChild
          onFocus={(e) => {
            // Radix skips its own focus handler when this one prevents default.
            if (!e.currentTarget.matches(':focus-visible')) e.preventDefault();
          }}
        >
          {children}
        </TooltipPrimitive.Trigger>
        {!empty && (
          <TooltipPanel
            side={side}
            className={rich ? 'max-w-80 px-3 py-2' : 'max-w-70 px-2 py-1 text-xs text-ink'}
          >
            {rich ? <TooltipCard {...content} /> : content}
          </TooltipPanel>
        )}
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}

/**
 * A rich tooltip's layout, on its own (the gallery shows it pinned): the
 * title in the heading role beside its icon and keycaps, the body in the body
 * role, the rows as a label column (`type-label`) against their values.
 */
export function TooltipCard({ title, icon: Icon, shortcut, body, rows }: RichTooltip) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        {Icon && <Icon size={14} strokeWidth={1.8} className="shrink-0 text-icon" />}
        <span className="min-w-0 type-heading">{title}</span>
        {shortcut && shortcut.length > 0 && (
          <span className="ml-auto flex shrink-0 gap-0.5 pl-2">
            {shortcut.map((key, i) => (
              <Kbd key={i}>{key}</Kbd>
            ))}
          </span>
        )}
      </div>
      {body !== undefined && body !== null && body !== '' && (
        <div className="type-body text-pretty">{body}</div>
      )}
      {rows && rows.length > 0 && (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5">
          {rows.map((row, i) => (
            <React.Fragment key={i}>
              <dt className="type-label">{row.label}</dt>
              <dd className="type-body tabular-nums">{row.value}</dd>
            </React.Fragment>
          ))}
        </dl>
      )}
    </div>
  );
}

function TooltipPanel({
  className,
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        sideOffset={sideOffset}
        collisionPadding={COLLISION_PADDING}
        className={cn(
          'z-[9999] w-max whitespace-pre-line break-words rounded-md bg-raised shadow-raised animate-tooltip-in',
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
}
