import * as React from 'react';

/**
 * Whether this window loaded less than `windowMs` ago (app start or a
 * reload). It turns false once, on time, and stays false: the deadline for
 * a placeholder whose value may never come (a skeleton must not pulse for
 * good).
 */
export function useStartupWindow(windowMs: number): boolean {
  const [open, setOpen] = React.useState(() => performance.now() < windowMs);
  React.useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => setOpen(false), Math.max(0, windowMs - performance.now()));
    return () => clearTimeout(timer);
  }, [open, windowMs]);
  return open;
}
