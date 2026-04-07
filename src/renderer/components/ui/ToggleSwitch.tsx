import React from 'react';

export function ToggleSwitch({
  enabled,
  onToggle,
  label,
}: {
  enabled: boolean;
  onToggle: (value: boolean) => void;
  label: string;
}) {
  return (
    <button
      onClick={() => onToggle(!enabled)}
      className={`flex items-center gap-3 w-full px-4 py-3 rounded-lg text-[13px] border transition-all duration-150 ${
        enabled
          ? 'border-primary/40 bg-primary/8 text-foreground ring-1 ring-primary/20'
          : 'border-border/60 text-foreground/60 hover:bg-accent/40 hover:text-foreground'
      }`}
    >
      <div
        className={`w-8 h-[18px] rounded-full relative transition-colors duration-150 flex-shrink-0 ${
          enabled ? 'bg-primary' : 'bg-border'
        }`}
      >
        <div
          className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow-sm transition-transform duration-150 ${
            enabled ? 'translate-x-[16px]' : 'translate-x-[2px]'
          }`}
        />
      </div>
      {label}
    </button>
  );
}
