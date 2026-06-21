import React from 'react';
import { CountBadge } from './CountBadge';

/**
 * Canonical segmented control: a recessed track with a sliding raised pill behind
 * the active option. Edges read via elevation (sunken track / raised pill), not
 * hairlines. Use anywhere a small set of mutually exclusive views/options is
 * switched inline (Settings tabs, the Extensions Installed/Browse switch, etc.).
 */
export function Segmented<T extends string | number | null>({
  value,
  options,
  onChange,
  fullWidth = true,
  size = 'md',
}: {
  value: T;
  options: Array<{ value: T; label: string; icon?: React.ReactNode; count?: number }>;
  onChange: (v: T) => void;
  fullWidth?: boolean;
  size?: 'sm' | 'md';
}) {
  const activeIdx = options.findIndex((o) => o.value === value);
  const pad = size === 'sm' ? 'py-[5px] text-[11px]' : 'py-[7px] text-[12px]';
  const slot = 100 / options.length;
  return (
    <div
      className={`relative ${fullWidth ? 'flex w-full' : 'inline-flex'} p-[3px] rounded-lg border border-border/50`}
      style={{ background: 'hsl(var(--surface-1))' }}
    >
      {activeIdx >= 0 && (
        <span
          aria-hidden
          className="absolute top-[3px] bottom-[3px] rounded-md transition-all duration-[220ms] ease-[cubic-bezier(0.16,1,0.3,1)] shadow-[0_1px_2px_hsl(0_0%_0%/0.18),inset_0_1px_0_hsl(0_0%_100%/0.06)]"
          style={{
            background: 'hsl(var(--surface-3))',
            border: '1px solid hsl(var(--primary) / 0.28)',
            left: `calc(${slot * activeIdx}% + 3px)`,
            width: `calc(${slot}% - 6px)`,
          }}
        />
      )}
      {options.map((opt, i) => {
        const active = i === activeIdx;
        return (
          <button
            key={String(opt.value)}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`relative z-10 flex items-center justify-center gap-1.5 px-3 ${pad} ${fullWidth ? 'flex-1' : ''} rounded-md font-medium transition-colors duration-150 ${
              active ? 'text-foreground' : 'text-foreground/55 hover:text-foreground/80'
            }`}
          >
            {opt.icon}
            <span className="truncate">{opt.label}</span>
            {opt.count != null && <CountBadge count={opt.count} />}
          </button>
        );
      })}
    </div>
  );
}
