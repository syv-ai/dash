import * as React from 'react';

/**
 * A Files pane's top row: what it says at the start (Files' sync text, review
 * Files' tally) and its "Show filetree" switch at the end, over a centred hairline
 * across 80 % of the pane, with room above and below it so the row reads as
 * a band of its own. The start takes the room the end leaves (the sync text
 * fits itself to it). Shown while it holds either.
 */
export function FilesTopRow({ start, end }: { start?: React.ReactNode; end?: React.ReactNode }) {
  if (!start && !end) return null;
  return (
    <div className="type-caption relative flex h-11 shrink-0 items-center justify-between gap-2 px-3">
      <div className="flex min-w-0 flex-1 items-center gap-2">{start}</div>
      {end}
      <div aria-hidden className="absolute inset-x-1/10 bottom-0 h-px bg-line" />
    </div>
  );
}
