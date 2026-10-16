import React from 'react';
import { Switch } from './Switch';

/**
 * A labelled on/off field for dialogs and forms: the label (and optional hint
 * lines) on the left, a `Switch` on the right. Settings rows use the settings
 * modal's own row instead.
 */
export function SwitchField({
  label,
  hint,
  helperText,
  enabled,
  onToggle,
  disabled,
}: {
  label: string;
  hint?: React.ReactNode;
  /** A second, fainter line under the hint (e.g. "Applies the next time…"). */
  helperText?: React.ReactNode;
  enabled: boolean;
  onToggle: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex-1 min-w-0">
        <span className="block text-[12px] font-medium text-fg-fade-70">{label}</span>
        {hint && <p className="mt-1 text-[11px] leading-relaxed text-muted-fade-50">{hint}</p>}
        {helperText && <p className="mt-0.5 text-[11px] text-muted-fade-40">{helperText}</p>}
      </div>
      <div className="shrink-0 pt-0.5">
        <Switch enabled={enabled} onToggle={onToggle} disabled={disabled} aria-label={label} />
      </div>
    </div>
  );
}
