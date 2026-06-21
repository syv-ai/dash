import React from 'react';

/**
 * Small primary-tinted count pill — the canonical way to show a numeric badge
 * next to a label (sidebar scopes, segmented tabs, section headers). Layout
 * (e.g. `ml-auto` to push it to a row's end) is the caller's concern via
 * `className`; the pill itself only owns its shape and color.
 */
export function CountBadge({ count, className = '' }: { count: number; className?: string }) {
  return (
    <span
      className={`inline-flex min-w-[18px] items-center justify-center rounded-full bg-primary/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-primary ${className}`}
    >
      {count}
    </span>
  );
}
