import React from 'react';

interface TopbarProps {
  isMac?: boolean;
}

/**
 * Minimal drag region. On macOS we keep a slim strip so the traffic-light cluster
 * (close/min/max) has a draggable surface to sit on. On Linux the window has its
 * own decorations, so nothing is needed here.
 */
export function Topbar({ isMac = false }: TopbarProps) {
  if (!isMac) return null;
  return (
    <header
      className="h-[32px] flex-shrink-0 titlebar-drag"
      style={{ background: 'hsl(var(--surface-1))' }}
    />
  );
}
