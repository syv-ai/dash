import React from 'react';

/**
 * Canonical switch primitive. Use this anywhere a binary on/off control is needed
 * inline (settings rows, inline toggles, modal options). For full-row button-style
 * toggles, wrap in `ToggleSwitch`.
 */
export function Switch({
  enabled,
  onToggle,
  disabled,
  size = 'md',
  'aria-label': ariaLabel,
}: {
  enabled: boolean;
  onToggle: (value: boolean) => void;
  disabled?: boolean;
  size?: 'sm' | 'md';
  'aria-label'?: string;
}) {
  const dims =
    size === 'sm' ? { w: 28, h: 16, puck: 12, travel: 12 } : { w: 32, h: 18, puck: 14, travel: 14 };
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onToggle(!enabled);
      }}
      className={`relative inline-flex items-center rounded-full flex-shrink-0 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 focus-visible:ring-offset-[hsl(var(--surface-2))] ${
        enabled ? 'bg-primary' : 'bg-border'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
      style={{
        width: dims.w,
        height: dims.h,
        boxShadow: enabled
          ? 'inset 0 1px 1px hsl(0 0% 0% / 0.18)'
          : 'inset 0 1px 1px hsl(0 0% 0% / 0.12)',
      }}
    >
      <span
        aria-hidden
        className="absolute rounded-full bg-white shadow-[0_1px_2px_hsl(0_0%_0%/0.3),0_0_0_0.5px_hsl(0_0%_0%/0.05)] transition-transform duration-200 ease-[cubic-bezier(0.4,0,0.2,1)]"
        style={{
          width: dims.puck,
          height: dims.puck,
          top: (dims.h - dims.puck) / 2,
          left: (dims.h - dims.puck) / 2,
          transform: enabled ? `translateX(${dims.travel}px)` : 'translateX(0)',
        }}
      />
    </button>
  );
}
