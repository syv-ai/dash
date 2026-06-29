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

/** A single content edit, reduced to the fields needed to decide whether it
 *  deleted a comment's anchor block. Mirrors Monaco's IModelContentChange
 *  (range + replacement text). */
export interface EditChange {
  startLine: number;
  startColumn: number;
  endLine: number;
  text: string;
}

/** True when an incremental edit deletes EVERY line a whole-line comment is
 *  anchored to, leaving no line to re-anchor on. Only a *pure deletion* (empty
 *  replacement) whose removed range starts at/before the comment's first line
 *  (at column 1) and extends past its last line qualifies: replacing the block
 *  with new text is an edit (the comment keeps that line as a single anchor),
 *  and any surviving boundary line keeps the comment. A deletion ending exactly
 *  on the comment's last line (e.g. an end-of-file block) is conservatively
 *  kept — far better to leave a stale comment than to drop a valid one. */
export function isWholeBlockDeleted(
  commentStart: number,
  commentEnd: number,
  change: EditChange,
): boolean {
  if (change.text.length > 0) return false;
  const coversStart =
    change.startLine < commentStart ||
    (change.startLine === commentStart && change.startColumn === 1);
  const coversEnd = change.endLine > commentEnd;
  return coversStart && coversEnd;
}

/** Ids of the comments whose whole anchor block was deleted by `changes`.
 *  Comment ranges and change ranges are both in pre-edit model coordinates. */
export function commentsDeletedByEdit(
  comments: ReadonlyArray<{ id: string; startLine: number; endLine: number }>,
  changes: ReadonlyArray<EditChange>,
): string[] {
  const ids: string[] = [];
  for (const c of comments) {
    if (changes.some((ch) => isWholeBlockDeleted(c.startLine, c.endLine, ch))) ids.push(c.id);
  }
  return ids;
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
