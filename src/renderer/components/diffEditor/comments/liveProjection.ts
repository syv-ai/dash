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
