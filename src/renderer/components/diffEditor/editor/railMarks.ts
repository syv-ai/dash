import type { DiffComment, PrReviewThread } from '../../../../shared/types';
import { threadHeadline } from '../../review/outline';
import { railBar } from '../../ui/railBar';

/*
 * The review rail's marks, as data: one per PR thread on a line, comment draft
 * and note in the open file, spanning its lines where they sit in the file. Pure, so
 * the placement and paint order are tested without Monaco (D80).
 */

/** What a mark stands for; the rail draws each kind as its own tick. */
export type RailMarkKind = 'resolved' | 'thread' | 'note' | 'comment';

export interface RailMark {
  id: string;
  kind: RailMarkKind;
  /** The line a click reveals. */
  line: number;
  /** The top of its first line, as a fraction of the rail's height (0 top, 1 bottom). */
  at: number;
  /** Its lines' height, as a fraction of the rail's height. */
  size: number;
  /** One line, its accessible name: "L12 · @ana: Rename this". */
  preview: string;
  /** Who wrote it: "@ana", or "Comment" / "Note to agent" for your own. */
  who: string;
  /** Its first line, up to a few lines' worth (the preview cuts it shorter). */
  text: string;
}

/** The editor's geometry the rail maps lines through. */
export interface RailGeometry {
  /** A line's top in the editor's content, view zones and wrapping included. */
  topFor(line: number): number;
  lineHeight: number;
  /** The editor's scroll height. */
  contentHeight: number;
  /** The rail's height (the editor's viewport). */
  railHeight: number;
}

const PREVIEW_CHARS = 64;
/** The hover card's words: a few lines, not a whole essay. */
const TEXT_CHARS = 240;

const clip = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/** Later kinds paint over earlier ones where ticks meet: your own on top. */
const PAINT_ORDER: readonly RailMarkKind[] = ['resolved', 'thread', 'note', 'comment'];

const firstLine = (text: string): string =>
  text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find(Boolean) ?? '';

function preview(line: number, who: string, text: string): string {
  return clip(`L${line} · ${who}: ${text || '(no text)'}`, PREVIEW_CHARS);
}

/**
 * The marks for a file: `threads` drawn on its lines and `comments` (line
 * drafts and notes; reply drafts sit in their thread's card), each spanning
 * its line range (a thread from its `startLine`, when multi-line, to `line`).
 * A file shorter than the rail keeps its marks beside their lines; a longer
 * one is scaled into the rail, as a minimap would.
 */
export function railMarks(
  threads: readonly PrReviewThread[],
  comments: readonly Pick<DiffComment, 'id' | 'kind' | 'startLine' | 'endLine' | 'text'>[],
  geometry: RailGeometry,
): RailMark[] {
  const { topFor, lineHeight, contentHeight, railHeight } = geometry;
  const span = Math.max(contentHeight, railHeight);
  if (span <= 0) return [];
  const frac = (px: number) => Math.min(1, Math.max(0, px / span));
  const place = (first: number, last: number) => {
    const at = frac(topFor(Math.min(first, last)));
    return { at, size: frac(topFor(Math.max(first, last)) + lineHeight) - at };
  };

  const marks: RailMark[] = [];
  for (const t of threads) {
    if (t.line === null) continue;
    const who = `@${t.comments[0]?.author ?? 'ghost'}`;
    const text = clip(threadHeadline(t), TEXT_CHARS);
    marks.push({
      id: t.id,
      kind: t.resolved ? 'resolved' : 'thread',
      line: t.line,
      ...place(t.startLine ?? t.line, t.line),
      preview: preview(t.line, who, text),
      who,
      text,
    });
  }
  for (const c of comments) {
    const who = c.kind === 'note' ? 'Note to agent' : 'Comment';
    const text = clip(firstLine(c.text), TEXT_CHARS);
    marks.push({
      id: c.id,
      kind: c.kind,
      line: c.startLine,
      ...place(c.startLine, c.endLine),
      preview: preview(c.startLine, who, text),
      who,
      text,
    });
  }
  return marks.sort(
    (a, b) => PAINT_ORDER.indexOf(a.kind) - PAINT_ORDER.indexOf(b.kind) || a.line - b.line,
  );
}

/** A diff change, as Monaco's `ILineChange` reports it (an end of 0 marks an
 *  empty side: nothing removed, or nothing added after the start line). */
export interface RailLineChange {
  originalStartLineNumber: number;
  originalEndLineNumber: number;
  modifiedStartLineNumber: number;
  modifiedEndLineNumber: number;
}

/** What a change did: lines added, removed, or replaced by others. */
export type RailChangeKind = 'add' | 'del' | 'mod';

export interface RailChange {
  kind: RailChangeKind;
  /** The modified file's lines it spans; a deletion is the line it follows
   *  (0 at the top of the file), with `endLine` equal to it. */
  startLine: number;
  endLine: number;
  /** Its top and height as fractions of the rail's height; a deletion is a
   *  point (size 0) the rail draws at its least height. */
  at: number;
  size: number;
}

/**
 * The open diff's changes as bars in the review rail's change lane, beside its
 * marks:
 * each spans its lines in the modified file, placed through the editor's
 * geometry as `railMarks` places ticks; a deletion sits at the point the lines
 * left. Changes of one kind whose drawn bars (each at least `RAIL_BAR_MIN_PX`
 * tall) would touch merge into one over both, so a long file draws separate
 * bars, never a pile of overlapping ones, and no bar shrinks to a dot.
 */
export function railChanges(
  changes: readonly RailLineChange[],
  geometry: RailGeometry,
): RailChange[] {
  const { topFor, lineHeight, contentHeight, railHeight } = geometry;
  const span = Math.max(contentHeight, railHeight);
  if (span <= 0 || railHeight <= 0) return [];
  const frac = (px: number) => Math.min(1, Math.max(0, px / span));

  const out: RailChange[] = [];
  for (const c of changes) {
    const kind: RailChangeKind =
      c.modifiedEndLineNumber === 0 ? 'del' : c.originalEndLineNumber === 0 ? 'add' : 'mod';
    const startLine = c.modifiedStartLineNumber;
    const endLine = kind === 'del' ? startLine : Math.max(startLine, c.modifiedEndLineNumber);
    const top =
      kind === 'del' ? (startLine > 0 ? topFor(startLine) + lineHeight : 0) : topFor(startLine);
    const bottom = kind === 'del' ? top : topFor(endLine) + lineHeight;
    const at = frac(top);
    const size = frac(bottom) - at;
    let prev: RailChange | undefined;
    for (let i = out.length - 1; i >= 0 && !prev; i--) if (out[i]!.kind === kind) prev = out[i];
    if (prev) {
      const was = railBar(prev.at, prev.size, railHeight);
      if (railBar(at, size, railHeight).top - (was.top + was.height) < 1) {
        prev.endLine = Math.max(prev.endLine, endLine);
        prev.size = Math.max(prev.size, at + size - prev.at);
        continue;
      }
    }
    out.push({ kind, startLine, endLine, at, size });
  }
  return out;
}
