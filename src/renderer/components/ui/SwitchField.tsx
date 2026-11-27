import * as React from 'react';
import { Lock } from 'lucide-react';
import { SettingRow } from './Field';
import { Switch } from './Switch';
import type { TooltipContent } from './Tooltip';

/**
 * A labelled on/off setting: a `SettingRow` with a `Switch` at its end. The
 * label toggles it too (the ⓘ doesn't).
 */
export function SwitchField({
  label,
  hint,
  helperText,
  checked,
  onCheckedChange,
  disabled,
  locked,
  children,
}: {
  label: string;
  /** What it does, behind an ⓘ beside the label. */
  hint?: TooltipContent;
  /** A short line kept in view under the label: a consequence ("Changing it
   *  restarts the session"). */
  helperText?: React.ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** Not applicable now (it hangs on another setting): the switch and its text dim. */
  disabled?: boolean;
  /** Held where it is for a reason the helper text gives: the switch can't be
   *  toggled but keeps its colours (on still reads as on), a lock beside it,
   *  and the text keeps its ink, since it still describes the task. */
  locked?: boolean;
  /** Under the text at full width (a detail the switch reveals). */
  children?: React.ReactNode;
}) {
  const id = React.useId();
  return (
    <SettingRow
      label={label}
      htmlFor={id}
      disabled={disabled}
      hint={hint}
      note={helperText}
      control={
        <span className="flex items-center gap-2">
          {locked && !disabled && (
            <Lock aria-hidden size={14} strokeWidth={1.8} className="text-icon" />
          )}
          <Switch
            id={id}
            checked={checked}
            onCheckedChange={onCheckedChange}
            disabled={disabled}
            locked={locked}
          />
        </span>
      }
    >
      {children}
    </SettingRow>
  );
}
