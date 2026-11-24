import type { DiffComment, PrReviewThread } from '../../../../shared/types';
import { threadHeadline } from '../../review/outline';

/*
 * The review rail's marks, as data: one per PR thread on a line, comment draft
 * and note in the open file, placed where its line sits in the file. Pure, so
 * the placement and paint order are tested without Monaco (D80).
 */

/** What a mark stands for; the rail draws each kind as its own tick. */
export type RailMarkKind = 'resolved' | 'thread' | 'note' | 'comment';

export interface RailMark {
  id: string;
  kind: RailMarkKind;
  /** The line a click reveals. */
  line: number;
  /** Where the line sits, as a fraction of the rail's height (0 top, 1 bottom). */
  at: number;
  /** One line for the hover: "L12 · @ana: Rename this". */
  preview: string;
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

/** Later kinds paint over earlier ones where ticks meet: your own on top. */
const PAINT_ORDER: readonly RailMarkKind[] = ['resolved', 'thread', 'note', 'comment'];

const firstLine = (text: string): string =>
  text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find(Boolean) ?? '';

function preview(line: number, who: string, text: string): string {
  const full = `L${line} · ${who}: ${text || '(no text)'}`;
  return full.length > PREVIEW_CHARS ? `${full.slice(0, PREVIEW_CHARS - 1)}…` : full;
}

/**
 * The marks for a file: `threads` drawn on its lines and `comments` (line
 * drafts and notes; reply drafts sit in their thread's card). A file shorter
 * than the rail keeps its marks beside their lines; a longer one is scaled
 * into the rail, as a minimap would.
 */
export function railMarks(
  threads: readonly PrReviewThread[],
  comments: readonly Pick<DiffComment, 'id' | 'kind' | 'startLine' | 'text'>[],
  geometry: RailGeometry,
): RailMark[] {
  const { topFor, lineHeight, contentHeight, railHeight } = geometry;
  const span = Math.max(contentHeight, railHeight);
  if (span <= 0) return [];
  const at = (line: number) => Math.min(1, Math.max(0, (topFor(line) + lineHeight / 2) / span));

  const marks: RailMark[] = [];
  for (const t of threads) {
    if (t.line === null) continue;
    const author = t.comments[0]?.author ?? 'ghost';
    marks.push({
      id: t.id,
      kind: t.resolved ? 'resolved' : 'thread',
      line: t.line,
      at: at(t.line),
      preview: preview(t.line, `@${author}`, threadHeadline(t)),
    });
  }
  for (const c of comments) {
    marks.push({
      id: c.id,
      kind: c.kind,
      line: c.startLine,
      at: at(c.startLine),
      preview: preview(
        c.startLine,
        c.kind === 'note' ? 'Note to agent' : 'Comment',
        firstLine(c.text),
      ),
    });
  }
  return marks.sort(
    (a, b) => PAINT_ORDER.indexOf(a.kind) - PAINT_ORDER.indexOf(b.kind) || a.line - b.line,
  );
}
