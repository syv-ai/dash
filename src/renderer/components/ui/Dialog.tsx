import * as React from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/cn';
import { IconButton } from './IconButton';
import { InfoTip } from './InfoTip';
import { ListRow } from './ListRow';
import { Modal, useModalClose, useModalTitleId } from './Modal';
import type { TooltipContent } from './Tooltip';

/**
 * The dialog pattern, built on `Modal` (which keeps the overlay, the Esc
 * stack, `canClose` and the close animation). A dialog is a header, a body
 * that scrolls, and, when it commits something, a footer:
 *
 *   <Dialog size="md" onClose={…}>
 *     <DialogHeader title="Project settings" description="…" />
 *     <DialogBody>…FormSection / Field / SettingRow…</DialogBody>
 *     <DialogFooter><Button variant="ghost">Cancel</Button><Button>Save</Button></DialogFooter>
 *   </Dialog>
 *
 * The card is `dialog` (a step under `raised`, so menus and tooltips over it
 * lift off), rounded-2xl, no border; header and footer are set apart by
 * space, not rules (`divided` adds a rule where a long body scrolls under
 * them). Explanations sit behind an ⓘ (`hint`), not in captions. A dialog
 * that applies changes live has no footer.
 */

const SIZES = {
  /** 420: confirms, deletes. */
  sm: 'w-105',
  /** 480: small forms (project and task settings). */
  md: 'w-120',
  /** 640: wizards. */
  lg: 'w-160',
  /** 760: new task, review sheets. */
  xl: 'w-190',
  /** 960 × 86vh: a nav column plus content (`NavDialog`). */
  nav: 'w-240 h-[86vh] max-h-190',
} as const;

export type DialogSize = keyof typeof SIZES;

export function Dialog({
  size = 'md',
  onClose,
  canClose,
  elevated,
  overflow,
  anchor,
  role,
  children,
}: {
  size?: DialogSize;
  onClose: () => void;
  canClose?: () => boolean | Promise<boolean>;
  elevated?: boolean;
  overflow?: 'hidden' | 'visible';
  /** `top` for a dialog that grows as you fill it in (see `Modal`). */
  anchor?: 'center' | 'top';
  /** `alertdialog` for a confirm (see `Modal`). */
  role?: 'dialog' | 'alertdialog';
  children: React.ReactNode;
}) {
  return (
    <Modal
      role={role}
      onClose={onClose}
      canClose={canClose}
      elevated={elevated}
      overflow={overflow}
      anchor={anchor}
      size={cn('max-h-[86vh] max-w-[94vw]', SIZES[size])}
    >
      {children}
    </Modal>
  );
}

/** The close ✕; animated through the enclosing Modal. */
export function DialogClose({ disabled }: { disabled?: boolean }) {
  const close = useModalClose();
  return (
    <IconButton title="Close" onClick={close} disabled={disabled}>
      <X size={14} strokeWidth={1.8} />
    </IconButton>
  );
}

/**
 * The dialog's title (`type-title`) with an optional ⓘ (`hint`), an optional
 * line under it that names what the dialog acts on (`description`: a path, a
 * task), optional icon actions, and the close button.
 */
export function DialogHeader({
  title,
  hint,
  description,
  actions,
  closeDisabled,
  divided = false,
}: {
  title: React.ReactNode;
  /** What the dialog is for, behind an ⓘ beside the title. */
  hint?: TooltipContent;
  /** What it acts on (a path, a name); explanations go in `hint`. */
  description?: React.ReactNode;
  /** Icon buttons before the close button. */
  actions?: React.ReactNode;
  /** While something runs that closing would cut short (a create). */
  closeDisabled?: boolean;
  /** A rule under the header, for a body that scrolls under it. */
  divided?: boolean;
}) {
  const titleId = useModalTitleId();
  return (
    <header
      className={cn(
        'flex shrink-0 items-start gap-3 pt-4 pr-3 pb-3 pl-5',
        divided && 'border-b border-line',
      )}
    >
      <div className="grid min-w-0 flex-1 gap-0.5 pt-1">
        <TitleLine id={titleId} title={title} hint={hint} />
        {description && <p className="type-caption truncate">{description}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {actions}
        <DialogClose disabled={closeDisabled} />
      </div>
    </header>
  );
}

/** A dialog or section title with its ⓘ. */
function TitleLine({
  id,
  title,
  hint,
}: {
  /** Set when this title names the dialog (useModalTitleId). */
  id?: string;
  title: React.ReactNode;
  hint?: TooltipContent;
}) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <h2 id={id} className="type-title truncate">
        {title}
      </h2>
      {hint && <InfoTip content={hint} side="bottom" />}
    </div>
  );
}

/** The scrolling middle: 20px sides, its blocks 20px apart. */
export function DialogBody({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'scrollbar-thin-hover grid min-h-0 flex-1 content-start gap-5 overflow-y-auto px-5 pt-1 pb-5',
        className,
      )}
      {...props}
    />
  );
}

/**
 * The actions: end-aligned, the secondary (`ghost` Cancel) first and the one
 * `primary` last; `start` holds a left-hand action (Back, Stop waiting) and
 * `status` a line above them (an error).
 */
export function DialogFooter({
  start,
  status,
  divided = false,
  children,
}: {
  start?: React.ReactNode;
  status?: React.ReactNode;
  /** A rule above the footer, for a body that scrolls under it. */
  divided?: boolean;
  children: React.ReactNode;
}) {
  return (
    <footer className={cn('grid shrink-0 gap-2 px-5 pt-3 pb-4', divided && 'border-t border-line')}>
      {status}
      <div className="flex items-center justify-end gap-2">
        {start && <div className="mr-auto flex items-center gap-2">{start}</div>}
        {children}
      </div>
    </footer>
  );
}

export interface NavDialogItem<T extends string> {
  id: T;
  label: string;
  icon: React.ReactNode;
  /** After the label, never truncated (an "update ready" dot). */
  badge?: React.ReactNode;
}

/**
 * A dialog with a nav column (Settings): the column is `dialog-well`, sunk one step
 * from the card and set apart by tone, as the main view's sidebars are; the
 * title sits at its top, then grouped `ListRow`s (the current one on the
 * select tint). The content column titles the current section and scrolls,
 * its text capped at a readable width. Use inside `<Dialog size="nav">`.
 */
export function NavDialogLayout<T extends string>({
  title,
  groups,
  value,
  onChange,
  heading,
  hint,
  actions,
  navFooter,
  children,
}: {
  title: string;
  groups: Array<{ label: string; items: Array<NavDialogItem<T>> }>;
  value: T;
  onChange: (id: T) => void;
  /** The current section's name. */
  heading: React.ReactNode;
  /** What the section holds, behind an ⓘ beside its name. */
  hint?: TooltipContent;
  /** The section's own actions, before the close button (Reset all). */
  actions?: React.ReactNode;
  /** Pinned under the nav (a version). */
  navFooter?: React.ReactNode;
  children: React.ReactNode;
}) {
  const titleId = useModalTitleId();
  return (
    <div className="flex min-h-0 flex-1">
      <nav aria-label={title} className="flex w-52 shrink-0 flex-col bg-dialog-well">
        <h2 id={titleId} className="type-title px-5 pt-5 pb-3">
          {title}
        </h2>
        <div className="scrollbar-thin-hover grid min-h-0 flex-1 content-start gap-4 overflow-y-auto px-2.5 pb-3">
          {groups.map((group) => (
            <div key={group.label} className="grid gap-0.5">
              <h3 className="type-subheading px-2.5 pt-1 pb-1">{group.label}</h3>
              {group.items.map((item) => (
                <ListRow
                  key={item.id}
                  size="sm"
                  selected={item.id === value}
                  leading={item.icon}
                  badges={item.badge}
                  onClick={() => onChange(item.id)}
                >
                  {item.label}
                </ListRow>
              ))}
            </div>
          ))}
        </div>
        {navFooter && <div className="type-caption px-5 py-3 tabular-nums">{navFooter}</div>}
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-start gap-3 pt-4 pr-3 pb-2 pl-8">
          <div className="min-w-0 flex-1 pt-1">
            <TitleLine title={heading} hint={hint} />
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {actions}
            <DialogClose />
          </div>
        </header>
        {/* Keyed so a section change starts at the top and fades in. */}
        <div
          key={value}
          className="scrollbar-thin-hover min-h-0 flex-1 overflow-y-auto px-8 pt-3 pb-8"
        >
          <div className="grid max-w-150 animate-fade-in gap-5">{children}</div>
        </div>
      </div>
    </div>
  );
}
