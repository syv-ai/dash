import * as React from 'react';
import { Switch } from './Switch';

/**
 * A labelled on/off field for dialogs and forms: the label (and optional hint
 * lines) on the left, a `Switch` on the right. The whole label is clickable.
 */
export function SwitchField({
  label,
  hint,
  helperText,
  checked,
  onCheckedChange,
  disabled,
}: {
  label: string;
  hint?: React.ReactNode;
  /** A second, fainter line under the hint (e.g. "Applies the next time…"). */
  helperText?: React.ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const id = React.useId();
  return (
    <div className="flex items-start gap-3">
      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
        <span className="block text-sm font-medium text-ink">{label}</span>
        {hint && <span className="mt-1 block text-xs leading-relaxed text-ink-2">{hint}</span>}
        {helperText && <span className="mt-0.5 block text-xs text-ink-3">{helperText}</span>}
      </label>
      <Switch
        id={id}
        className="mt-0.5"
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
      />
    </div>
  );
}
