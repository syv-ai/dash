import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';

/** Status dot for an add-on: green active, amber pending, red error, grey off. */
export function StatusOrb({ state }: { state: 'active' | 'inactive' | 'pending' | 'error' }) {
  const palette: Record<typeof state, { dot: string; halo: string }> = {
    active: { dot: 'hsl(var(--git-added))', halo: 'hsl(var(--git-added) / 0.55)' },
    pending: { dot: 'hsl(var(--git-modified))', halo: 'hsl(var(--git-modified) / 0.55)' },
    error: { dot: 'hsl(var(--destructive))', halo: 'hsl(var(--destructive) / 0.55)' },
    inactive: { dot: 'hsl(var(--border))', halo: 'transparent' },
  };
  const c = palette[state];
  return (
    <span
      className="inline-block w-[8px] h-[8px] rounded-full shrink-0"
      style={{
        background: c.dot,
        boxShadow: state === 'inactive' ? 'none' : `0 0 0 1px ${c.halo}, 0 0 8px ${c.halo}`,
      }}
    />
  );
}

export function AddOnAccordion({
  title,
  subtitle,
  status,
  statusLabel,
  defaultOpen = false,
  children,
}: {
  title: string;
  subtitle?: string;
  status: 'active' | 'inactive' | 'pending' | 'error';
  statusLabel: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section
      className="rounded-xl border border-border/40 overflow-hidden"
      style={{ background: 'hsl(var(--surface-2))' }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-accent/20 transition-colors duration-150"
        aria-expanded={open}
      >
        <StatusOrb state={status} />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-[13px] font-medium text-foreground">{title}</span>
            <span className="text-[10.5px] text-fg-fade-45 uppercase tracking-wide">
              {statusLabel}
            </span>
          </div>
          {subtitle && (
            <p className="text-[11px] text-fg-fade-50 mt-0.5 leading-relaxed">{subtitle}</p>
          )}
        </div>
        <ChevronDown
          size={14}
          strokeWidth={1.8}
          className={`text-fg-fade-40 shrink-0 transition-transform duration-200 ${
            open ? 'rotate-180' : 'rotate-0'
          }`}
        />
      </button>
      {open && (
        <div className="border-t border-border/30 px-4 py-4 animate-fade-in">{children}</div>
      )}
    </section>
  );
}
