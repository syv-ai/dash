import { isPrComment } from '../../../shared/diffComments';
import type { DiffComment, PrCheck, PrFile, PrRef, PrReviewThread } from '../../../shared/types';
import { isInlineThread } from '../diffEditor/prReview/prViewPolicy';

/*
 * The Review view's outline, as data: which PR it is about, the files with
 * their viewed marks and counts, the threads in their groups, the person's
 * drafts and the task's notes. Pure, so the rules are tested without a DOM.
 */

// ── The review target ──

/**
 * The PR the task reviews: the one picked for it, else its own open PR.
 * `stored` and `own` are undefined while they load; the result is undefined
 * until it can be told.
 */
export function effectiveTarget(
  stored: PrRef | null | undefined,
  own: PrRef | null | undefined,
): PrRef | null | undefined {
  if (stored) return stored;
  if (own) return own;
  return stored === undefined || own === undefined ? undefined : null;
}

// ── Files and viewed marks ──

/** git's null object id: what a deleted file (no blob at head) is viewed at,
 *  as `git diff --raw` names a missing side. */
export const DELETED_BLOB = '0'.repeat(40);

/** The blob a viewed mark of `file` stores. */
export const viewedBlob = (file: Pick<PrFile, 'blob'>): string => file.blob ?? DELETED_BLOB;

/** A file is viewed while its mark names its blob at the current head: a push
 *  that changes it un-views it (D6). */
export const isViewed = (file: PrFile, marks: Readonly<Record<string, string>>): boolean =>
  marks[file.path] === viewedBlob(file);

export interface FileRow {
  file: PrFile;
  viewed: boolean;
  /** Its unresolved threads. */
  threads: number;
  /** The person's comments on it (drafts the review will post). */
  drafts: number;
}

/** The PR's files in outline order (by path), each with its mark and counts. */
export function fileRows(
  files: readonly PrFile[],
  threads: readonly PrReviewThread[],
  marks: Readonly<Record<string, string>>,
  drafts: readonly DiffComment[],
): FileRow[] {
  const count = (paths: string[]) => {
    const m = new Map<string, number>();
    for (const p of paths) m.set(p, (m.get(p) ?? 0) + 1);
    return m;
  };
  const open = count(threads.filter((t) => !t.resolved).map((t) => t.path));
  const mine = count(drafts.filter(isPrComment).map((c) => c.filePath));
  return [...files]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((file) => ({
      file,
      viewed: isViewed(file, marks),
      threads: open.get(file.path) ?? 0,
      drafts: mine.get(file.path) ?? 0,
    }));
}

/** The first unviewed file after `from` in outline order, wrapping around;
 *  null when every other file is viewed. */
export function nextUnviewed(rows: readonly FileRow[], from: string | null): string | null {
  const at = rows.findIndex((r) => r.file.path === from);
  for (let i = 1; i <= rows.length; i++) {
    const row = rows[(at + i) % rows.length]!;
    if (!row.viewed && row.file.path !== from) return row.file.path;
  }
  return null;
}

// ── Threads ──

export interface ThreadGroups {
  /** Open, and drawn on their lines. */
  unresolved: PrReviewThread[];
  /** Open, with no line to sit on: outdated, on the whole file, or on a removed line. */
  offCode: PrReviewThread[];
  resolved: PrReviewThread[];
}

const byPlace = (a: PrReviewThread, b: PrReviewThread) =>
  a.path.localeCompare(b.path) || (a.line ?? 0) - (b.line ?? 0);

/** The PR's threads in the outline's three groups, each by file and line. */
export function threadGroups(threads: readonly PrReviewThread[]): ThreadGroups {
  const sorted = [...threads].sort(byPlace);
  return {
    unresolved: sorted.filter((t) => !t.resolved && isInlineThread(t)),
    offCode: sorted.filter((t) => !t.resolved && !isInlineThread(t)),
    resolved: sorted.filter((t) => t.resolved),
  };
}

/** A thread's first comment's first line of text: what its row shows. */
export function threadHeadline(t: PrReviewThread): string {
  const body = t.comments[0]?.body ?? '';
  return (
    body
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find(Boolean) ?? ''
  );
}

/** Per thread id, the person's draft replies to it. */
export function replyDraftCounts(drafts: readonly DiffComment[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of drafts) if (c.replyTo) m.set(c.replyTo, (m.get(c.replyTo) ?? 0) + 1);
  return m;
}

// ── Drafts and notes ──

/** `items` grouped by file, files by path, each file's by line. */
export function groupByPath<T extends Pick<DiffComment, 'filePath' | 'startLine'>>(
  items: readonly T[],
): [string, T[]][] {
  const m = new Map<string, T[]>();
  for (const c of items) {
    const list = m.get(c.filePath);
    if (list) list.push(c);
    else m.set(c.filePath, [c]);
  }
  return [...m.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, list]) => [path, [...list].sort((a, b) => a.startLine - b.startLine)]);
}

/** The person's comments and replies for the PR whose draft scope is `scope`. */
export function reviewComments(
  byFile: Readonly<Record<string, DiffComment[]>>,
  scope: string,
): DiffComment[] {
  return Object.values(byFile)
    .flat()
    .filter((c) => c.viewScope === scope && isPrComment(c));
}

/** The task's notes across every view: those still to send, and those sent. */
export function trayNotes(byFile: Readonly<Record<string, DiffComment[]>>): {
  unsent: DiffComment[];
  sent: DiffComment[];
} {
  const notes = Object.values(byFile)
    .flat()
    .filter((c) => !isPrComment(c));
  return { unsent: notes.filter((c) => !c.sent), sent: notes.filter((c) => c.sent) };
}

/** "L3" or "L3–7". */
export const lineLabel = (c: Pick<DiffComment, 'startLine' | 'endLine'>): string =>
  c.startLine === c.endLine ? `L${c.startLine}` : `L${c.startLine}–${c.endLine}`;

// ── Navigation (⌥F9 / ⇧⌥F9) ──

/** A place next/previous thread lands on. */
export interface NavStop {
  path: string;
  line: number;
  /** The thread's or draft's id. */
  id: string;
}

const comparePlace = (a: Omit<NavStop, 'id'>, b: Omit<NavStop, 'id'>) =>
  a.path.localeCompare(b.path) || a.line - b.line;

/**
 * Every thread drawn on a line and every draft on lines (notes and comments;
 * a reply sits with its thread), in outline order: files by path, then line.
 */
export function navStops(
  threads: readonly PrReviewThread[],
  drafts: readonly Pick<DiffComment, 'id' | 'filePath' | 'startLine' | 'replyTo'>[],
): NavStop[] {
  return [
    ...threads.filter(isInlineThread).map((t) => ({ path: t.path, line: t.line!, id: t.id })),
    ...drafts
      .filter((c) => c.replyTo == null)
      .map((c) => ({ path: c.filePath, line: c.startLine, id: c.id })),
  ].sort(comparePlace);
}

/**
 * The stop after (`dir` 1) or before (-1) the cursor at `at`: on in the same
 * file, then across files in outline order, wrapping round. Null when there
 * are none.
 */
export function nextStop(
  stops: readonly NavStop[],
  at: Omit<NavStop, 'id'>,
  dir: 1 | -1,
): NavStop | null {
  if (stops.length === 0) return null;
  if (dir === 1) return stops.find((s) => comparePlace(s, at) > 0) ?? stops[0]!;
  return [...stops].reverse().find((s) => comparePlace(s, at) < 0) ?? stops[stops.length - 1]!;
}

// ── Header ──

/** Checks by state, skipped ones left out. */
export function checkCounts(checks: readonly PrCheck[]): {
  passing: number;
  failing: number;
  pending: number;
} {
  const n = { passing: 0, failing: 0, pending: 0 };
  for (const c of checks) if (c.state !== 'skipped') n[c.state]++;
  return n;
}
