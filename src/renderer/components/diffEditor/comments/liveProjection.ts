import type { LiveComment } from './types';

export interface LineRangeLite {
  startLine: number;
  endLine: number;
}
export type RangeReader = (decorationId: string) => LineRangeLite | null;

/** Return a new array where each comment's start/end is overwritten with its
 *  live decoration range. Comments whose decoration can't be read keep their
 *  prior range (the decoration was likely removed; reconciliation handles it). */
export function projectRanges(
  comments: ReadonlyArray<LiveComment>,
  read: RangeReader,
): LiveComment[] {
  return comments.map((c) => {
    const r = read(c.decorationId);
    return r ? { ...c, startLine: r.startLine, endLine: r.endLine } : c;
  });
}

/** The shape of a Monaco content-change event we care about (subset of
 *  IModelContentChangedEvent), kept minimal so it's unit-testable. */
export interface ContentChangeLite {
  isFlush: boolean;
  changes: ReadonlyArray<{ rangeOffset: number; text: string }>;
}

/** True when an edit replaced the model's ENTIRE text in one operation — i.e.
 *  a file (re)load. `@monaco-editor/react` pushes new `modified` content with
 *  `executeEdits(fullRange, { forceMoveMarkers: true })`, which collapses every
 *  comment decoration onto the last line; `setValue` (commit view) fires a
 *  flush. Either way the decoration ranges are now garbage and the caller must
 *  re-anchor comments from the store rather than read them back. An incremental
 *  edit (typing, paste) is never a full replace, so live tracking is preserved.
 *
 *  Signature of the lib's edit: a single change at offset 0 whose inserted text
 *  IS the whole post-edit document. */
export function isFullModelReplace(e: ContentChangeLite, currentValue: string): boolean {
  if (e.isFlush) return true;
  if (e.changes.length !== 1) return false;
  const only = e.changes[0]!;
  return only.rangeOffset === 0 && only.text === currentValue;
}

/** True when both arrays have the same ids in the same order with identical
 *  ranges. Used to avoid publishing a new reference when nothing moved. */
export function rangesEqual(a: ReadonlyArray<LiveComment>, b: ReadonlyArray<LiveComment>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (x.id !== y.id || x.startLine !== y.startLine || x.endLine !== y.endLine) return false;
  }
  return true;
}
