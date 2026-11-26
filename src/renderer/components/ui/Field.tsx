import * as React from 'react';
import { cn } from '../../lib/cn';

/**
 * Form rows for dialogs (see `Dialog`). `FormSection` titles a group;
 * `Field` is a labelled input (label above, hint below); `SettingRow` is a
 * setting (text on the left, its control at the end of the line, or under
 * the text at full width when `stacked`).
 */

/**
 * A titled group of rows: `type-heading`, an optional `type-caption` line,
 * an optional action at the end. `divided` splits settings rows with
 * hairlines; fields otherwise stack 12px apart. No card, no fill.
 */
export function FormSection({
  title,
  description,
  action,
  divided = false,
  className,
  children,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  divided?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn('grid content-start', className)}>
      {(title || action) && (
        <header className="flex min-h-6 items-end gap-3 pb-1">
          <div className="grid min-w-0 flex-1 gap-0.5">
            {title && <h3 className="type-heading">{title}</h3>}
            {description && <p className="type-caption">{description}</p>}
          </div>
          {action && <div className="flex shrink-0 items-center gap-1">{action}</div>}
        </header>
      )}
      <div className={divided ? 'grid divide-y divide-line' : 'grid gap-3 pt-2'}>{children}</div>
    </section>
  );
}

/**
 * A labelled input: `type-label` above, the control, a `type-caption` hint
 * below. A `label` element wraps it, so clicking the label focuses the
 * control; pass `as="div"` when the row holds more than one control.
 */
export function Field({
  label,
  hint,
  trailing,
  as = 'label',
  className,
  children,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  /** At the label's end, quiet ("optional", "Drafted by the agent"). */
  trailing?: React.ReactNode;
  as?: 'label' | 'div';
  className?: string;
  children: React.ReactNode;
}) {
  const Comp = as;
  return (
    <Comp className={cn('grid min-w-0 content-start gap-1.5', className)}>
      <span className="flex min-h-4 items-center gap-2">
        <span className="type-label min-w-0 flex-1 truncate">{label}</span>
        {trailing && <span className="type-caption shrink-0">{trailing}</span>}
      </span>
      {children}
      {hint && <span className="type-caption">{hint}</span>}
    </Comp>
  );
}

/**
 * A setting: its name (`type-body`) and what it does (`type-caption`) on the
 * left, the `control` at the end of the first line. `children` go under the
 * text at full width (a segmented control, a list, a revealed detail).
 * `htmlFor` binds the name to the control.
 */
export function SettingRow({
  label,
  hint,
  control,
  htmlFor,
  disabled,
  children,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  control?: React.ReactNode;
  htmlFor?: string;
  /** Dims the text with the control. */
  disabled?: boolean;
  children?: React.ReactNode;
}) {
  const Label = htmlFor ? 'label' : 'span';
  return (
    <div className="grid gap-2.5 py-3">
      {/* One line of text centres on the control; with a hint, the name
          lines up with the control's top. */}
      <div className={cn('flex gap-6', hint ? 'items-start' : 'items-center')}>
        <div className={cn('grid min-w-0 flex-1 gap-0.5', disabled && 'opacity-50')}>
          <Label htmlFor={htmlFor} className={cn('type-body', htmlFor && 'cursor-pointer')}>
            {label}
          </Label>
          {hint && <div className="type-caption">{hint}</div>}
        </div>
        {control && <div className="flex min-h-4.5 shrink-0 items-center">{control}</div>}
      </div>
      {children}
    </div>
  );
}
