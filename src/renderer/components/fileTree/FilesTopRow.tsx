import * as React from 'react';
import { firstFitting, useFittedDensity } from '../ui/useFittedDensity';

/** What the row shows: its start and end, or (too narrow for both) its start
 *  alone. */
export type FilesTopRowFit = 'both' | 'start';

/** Room the row must have beyond its least natural width (the start at its
 *  most compact, the gap, the end), so the two never run into each other. */
export const FILES_TOP_ROW_COMFORT_PX = 16;

/** Both while the least row (`needs[0]`) plus `FILES_TOP_ROW_COMFORT_PX` fits
 *  `available`, else the start alone: the end (Files' "All files") gives
 *  way whole, as a tree that narrow isn't worth showing. */
export const fitFilesTopRow = (available: number, needs: readonly number[]): FilesTopRowFit =>
  firstFitting(available - FILES_TOP_ROW_COMFORT_PX, needs, ['both'] as const) ?? 'start';

/**
 * A Files pane's top row: what it says at the start (Files' sync text, review
 * Files' tally) and its "All files" switch at the end, over a centred hairline
 * across 80 % of the pane, with room above and below it so the row reads as
 * a band of its own. The start takes the room the end leaves (the sync text
 * fits itself to it). Where even `startLeast` (the start at its most compact;
 * `start` itself by default) and the end don't fit side by side (measured,
 * `fitFilesTopRow`), the end hides and the start keeps the row. Shown while it
 * holds either.
 */
export function FilesTopRow({
  start,
  startLeast = start,
  end,
}: {
  start?: React.ReactNode;
  startLeast?: React.ReactNode;
  end?: React.ReactNode;
}) {
  const { rootRef, sizerRef, density } = useFittedDensity<FilesTopRowFit>(
    fitFilesTopRow,
    'both',
    Boolean(start && end),
  );
  if (!start && !end) return null;
  const showEnd = !start || density === 'both';
  return (
    <div
      ref={rootRef}
      className="type-caption relative flex h-11 shrink-0 items-center justify-between gap-2 px-3"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">{start}</div>
      {showEnd && end}
      <div aria-hidden className="absolute inset-x-1/10 bottom-0 h-px bg-line" />
      {/* The least row, measured. */}
      <div
        ref={sizerRef}
        aria-hidden
        className="invisible absolute inset-x-0 top-0 h-0 overflow-hidden"
      >
        {start && end && (
          <div className="flex w-max items-center gap-2 px-3">
            <div className="flex items-center gap-2">{startLeast}</div>
            {end}
          </div>
        )}
      </div>
    </div>
  );
}
