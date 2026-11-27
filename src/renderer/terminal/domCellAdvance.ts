/**
 * The DOM renderer's real per-column advance, for sizing a shell terminal's
 * grid (see `TerminalSessionManager.measureDomCellWidth`). It is read from a
 * probe run of glyphs laid out inside `.xterm-rows`, so it inherits the rows'
 * font and letter-spacing, and never from a row's width over the column count:
 * a row read before xterm re-rendered a resize divides a stale width by the
 * new columns, and the fit that follows feeds the wrong advance back in (a
 * fixed point at 2 columns, or thousands).
 */

/** How many glyphs the probe lays out: enough to average sub-pixel advance. */
export const PROBE_GLYPHS = 100;

/** The advance from a probe `width` px wide holding `glyphs` glyphs, or
 *  undefined for a read that can't be right: a probe not laid out (0), or
 *  one more than 2x off the cell xterm reports (the drift is a few percent). */
export function domCellAdvance(
  width: number,
  glyphs: number,
  cellWidth: number,
): number | undefined {
  const advance = width / glyphs;
  if (!Number.isFinite(advance) || advance <= 0) return undefined;
  if (advance < cellWidth / 2 || advance > cellWidth * 2) return undefined;
  return advance;
}

/** The advance to keep: the new read when it moves by 0.05px or more, else
 *  undefined (keep the old one, no re-fit), so measuring converges. */
export function nextDomCellWidth(
  prev: number | undefined,
  read: number | undefined,
): number | undefined {
  if (read === undefined) return undefined;
  if (prev !== undefined && Math.abs(prev - read) < 0.05) return undefined;
  return read;
}
