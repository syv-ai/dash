import React from 'react';
import { Switch } from './Switch';

/**
 * Full-row button-style toggle. The whole row is clickable.
 * For inline switches inside settings rows, use `Switch` directly.
 */
export function ToggleSwitch({
  enabled,
  onToggle,
  label,
  disabled,
}: {
  enabled: boolean;
  onToggle: (value: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={() => onToggle(!enabled)}
      disabled={disabled}
      className={`flex items-center gap-3 w-full px-4 py-3 rounded-lg text-[13px] border transition-all duration-150 ${
        disabled ? 'opacity-50 cursor-not-allowed' : ''
      } ${
        enabled
          ? 'border-primary/40 bg-primary/8 text-foreground ring-1 ring-primary/20'
          : 'border-border/60 text-foreground/60 hover:bg-accent/40 hover:text-foreground'
      }`}
    >
      <Switch enabled={enabled} onToggle={onToggle} disabled={disabled} />
      {label}
    </button>
  );
}
