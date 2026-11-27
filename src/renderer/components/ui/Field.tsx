import * as React from 'react';
import { cn } from '../../lib/cn';
import { InfoTip } from './InfoTip';
import type { TooltipContent } from './Tooltip';

/**
 * Form rows for dialogs (see `Dialog`). `FormSection` titles a group;
 * `SettingRow` is a setting, strictly one row (its name on the left, its
 * control at the end); `Field` is a labelled input (label above). What a
 * row does goes behind an ⓘ (`hint`); only a short, essential line (a
 * consequence, an error) stays in the open (`note`).
 */

/**
 * A titled group of rows: `type-heading` (with its ⓘ), an optional action at
 * the end, then the rows. No card, no fill, no rules: rows are set apart by
 * their height.
 */
export function FormSection({
  title,
  hint,
  action,
  className,
  children,
}: {
  title?: React.ReactNode;
  /** What the section is for, behind an ⓘ beside the title. */
  hint?: TooltipContent;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn('grid content-start', className)}>
      {(title || action) && (
        <header className="flex min-h-6 items-center gap-3 pb-1">
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            {title && <h3 className="type-heading truncate">{title}</h3>}
            {hint && <InfoTip content={hint} />}
          </div>
          {action && <div className="flex shrink-0 items-center gap-1">{action}</div>}
        </header>
      )}
      <div className="grid gap-1">{children}</div>
    </section>
  );
}

/** A visible line under a row: kept short, for what mustn't hide in a tooltip. */
function Note({ children }: { children: React.ReactNode }) {
  // A note can name a setting or a path, one long word: it breaks anywhere so
  // it never widens the column it sits in.
  return <div className="type-caption wrap-anywhere">{children}</div>;
}

/**
 * A labelled input: `type-label` above (with its ⓘ), the control, and a
 * visible `note` under it only when it must be seen (a validation error).
 * A `label` element wraps it, so clicking the label focuses the control;
 * pass `as="div"` when the row holds more than one control.
 */
export function Field({
  label,
  hint,
  note,
  trailing,
  as = 'label',
  fill = false,
  className,
  children,
}: {
  label: React.ReactNode;
  hint?: TooltipContent;
  note?: React.ReactNode;
  /** At the label's end, quiet ("optional", "Drafted by the agent"). */
  trailing?: React.ReactNode;
  as?: 'label' | 'div';
  /** Take the height left in a flex column, the control stretching to its
   *  bottom edge (a summary beside a pane it lines up with). */
  fill?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const Comp = as;
  return (
    <Comp
      className={cn(
        'grid min-w-0 content-start gap-1.5 py-1',
        fill && 'flex-1 grid-rows-[auto_minmax(0,1fr)] content-stretch pb-0',
        className,
      )}
    >
      <span className="flex min-h-4 items-center gap-1.5">
        <span className="type-label min-w-0 truncate">{label}</span>
        {hint && <InfoTip content={hint} />}
        {trailing && <span className="type-caption ml-auto shrink-0 pl-2">{trailing}</span>}
      </span>
      {children}
      {note && <Note>{note}</Note>}
    </Comp>
  );
}

/**
 * A setting, strictly one row: its name (`type-body`) and ⓘ on the left, the
 * `control` at the end. `note` is a short line under it that must stay
 * visible (a consequence); `children` go under the row at full width, for
 * what the setting reveals (a path to copy, a download's progress).
 * `htmlFor` binds the name to the control.
 */
export function SettingRow({
  label,
  hint,
  note,
  control,
  htmlFor,
  disabled,
  children,
}: {
  label: React.ReactNode;
  hint?: TooltipContent;
  note?: React.ReactNode;
  control?: React.ReactNode;
  htmlFor?: string;
  /** Dims the name with the control. */
  disabled?: boolean;
  children?: React.ReactNode;
}) {
  const Label = htmlFor ? 'label' : 'span';
  return (
    <div className="grid gap-2 py-1">
      <div className="flex min-h-7.5 items-center gap-6">
        <div className="grid min-w-0 flex-1 gap-0.5">
          <div className="flex min-w-0 items-center gap-1.5">
            <Label
              htmlFor={htmlFor}
              className={cn(
                'type-body min-w-0 truncate',
                htmlFor && 'cursor-pointer',
                disabled && 'opacity-50',
              )}
            >
              {label}
            </Label>
            {hint && <InfoTip content={hint} />}
          </div>
          {note && <Note>{note}</Note>}
        </div>
        {control && <div className="flex shrink-0 items-center">{control}</div>}
      </div>
      {children}
    </div>
  );
}
