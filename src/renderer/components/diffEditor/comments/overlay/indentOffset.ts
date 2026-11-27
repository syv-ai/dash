/**
 * How far a line's text starts past its own left edge: its leading spaces and
 * tabs (each tab to the next stop) times the font's space width. Computed from
 * the text rather than asked of Monaco: `editor.getOffsetForColumn` renders the
 * editor first, which fires its size events into other components while
 * `CommentOverlay` renders. Assumes the editor's monospace font. A line that is
 * all whitespace (or empty) gives 0, so a bubble's tail falls back to the
 * content's left edge.
 */
export function leadingIndentPx(line: string, tabSize: number, spaceWidth: number): number {
  let columns = 0;
  for (const ch of line) {
    if (ch === ' ') columns += 1;
    else if (ch === '\t') columns += tabSize - (columns % tabSize);
    else return columns * spaceWidth;
  }
  return 0;
}
