import { isPrComment } from '../../../shared/diffComments';
import type {
  CiState,
  DiffComment,
  FileChange,
  PrCheck,
  PrFile,
  PrReviewThread,
} from '../../../shared/types';
import type { TextRange } from '../../stores/editorTabsStore';
import type { FileBadges } from '../diffEditor/EditorTree';
import { threadLocation } from '../../utils/prReviewNotices';
import { isInlineThread } from '../diffEditor/prReview/prViewPolicy';
import { editorTreeOrder } from '../diffEditor/treeOrder';

/*
 * The Review view's outline, as data: which PR it is about, the files with
 * their viewed marks and counts, the threads in their groups, the person's
 * drafts and the task's notes. Pure, so the rules are tested without a DOM.
 */

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

/** The PR's files in outline order (as the review Files tree lists them), each with its mark and counts. */
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
    .sort((a, b) => editorTreeOrder(a.path, b.path))
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

/** The PR's files as the Files tree lists changes (the Changes tab). */
export const prFileChanges = (files: readonly PrFile[]): FileChange[] =>
  files.map(({ path, status, oldPath, additions, deletions }) => ({
    path,
    status,
    staged: false,
    additions,
    deletions,
    ...(oldPath ? { oldPath } : {}),
  }));

/** The tree's per-file badges from the outline's rows: unresolved threads,
 *  and the person's draft comments. */
export function treeBadges(rows: readonly FileRow[]): Map<string, FileBadges> {
  const m = new Map<string, FileBadges>();
  for (const r of rows) {
    if (r.threads > 0 || r.drafts > 0)
      m.set(r.file.path, { threads: r.threads, comments: r.drafts });
  }
  return m;
}

/** The paths of the rows marked viewed. */
export const viewedPaths = (rows: readonly FileRow[]): Set<string> =>
  new Set(rows.filter((r) => r.viewed).map((r) => r.file.path));

// ── Threads ──

/** A row of the Comments tab: a PR thread with the person's draft replies to
 *  it, or one of their own draft line comments (a thread still to start). */
export type CommentItem =
  | { kind: 'thread'; thread: PrReviewThread; replies: DiffComment[] }
  | { kind: 'draft'; draft: DiffComment };

export interface CommentGroups {
  /** Open threads (on the code or off it) and the person's draft comments. */
  unresolved: CommentItem[];
  resolved: CommentItem[];
}

/** Where a row sits for ordering: its file, then its line; a thread off the
 *  code (no line) leads its file. */
const itemPlace = (i: CommentItem): { path: string; line: number } =>
  i.kind === 'thread'
    ? { path: i.thread.path, line: i.thread.line ?? 0 }
    : { path: i.draft.filePath, line: i.draft.startLine };

/**
 * The Comments tab's groups, each by file and line: open threads with the
 * person's draft comments among them, and resolved threads. A draft reply
 * goes with its thread; one whose thread is gone stands as its own draft row.
 */
export function commentGroups(
  threads: readonly PrReviewThread[],
  drafts: readonly DiffComment[],
): CommentGroups {
  const known = new Set(threads.map((t) => t.id));
  const replies = new Map<string, DiffComment[]>();
  const own: CommentItem[] = [];
  for (const c of drafts) {
    if (c.replyTo && known.has(c.replyTo)) {
      const list = replies.get(c.replyTo);
      if (list) list.push(c);
      else replies.set(c.replyTo, [c]);
    } else own.push({ kind: 'draft', draft: c });
  }
  const item = (t: PrReviewThread): CommentItem => ({
    kind: 'thread',
    thread: t,
    replies: replies.get(t.id) ?? [],
  });
  const byPlace = (a: CommentItem, b: CommentItem) => {
    const pa = itemPlace(a);
    const pb = itemPlace(b);
    return editorTreeOrder(pa.path, pb.path) || pa.line - pb.line;
  };
  return {
    unresolved: [...threads.filter((t) => !t.resolved).map(item), ...own].sort(byPlace),
    resolved: threads
      .filter((t) => t.resolved)
      .map(item)
      .sort(byPlace),
  };
}

/** A thread drawn on a line of the code. */
type LineThread = PrReviewThread & { line: number };

/** The first open thread on the code in the Comments tab's order (by file,
 *  then line): what re-picking a narrow Comments opens at. Null with none. */
export function firstOpenThread(threads: readonly PrReviewThread[]): LineThread | null {
  return (
    threads
      .filter((t): t is LineThread => !t.resolved && isInlineThread(t))
      .sort((a, b) => editorTreeOrder(a.path, b.path) || a.line - b.line)[0] ?? null
  );
}

/** The lines a thread on the code sits on, to reveal and select. */
export const threadRange = (t: LineThread): TextRange => ({
  startLineNumber: t.startLine ?? t.line,
  startColumn: 1,
  endLineNumber: t.line,
  endColumn: 1,
});

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

/** A folded thread's tally: "2 replies · 1 draft · Resolved", each part
 *  only when it applies ('' for a lone open comment). */
export function threadTally(t: PrReviewThread, drafts: number): string {
  const replies = Math.max(0, t.comments.length - 1);
  return [
    replies > 0 ? `${replies} ${replies === 1 ? 'reply' : 'replies'}` : '',
    drafts > 0 ? `${drafts} ${drafts === 1 ? 'draft' : 'drafts'}` : '',
    t.resolved ? 'Resolved' : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Where a thread sits, split for a narrow row: the file's name with its
 *  line(s) ("a.ts:3-5", "a.ts (outdated)"), and its folder ("" at the root). */
export function threadPlace(t: PrReviewThread): { name: string; dir: string } {
  const slash = t.path.lastIndexOf('/');
  return {
    name: threadLocation({ ...t, path: t.path.slice(slash + 1) }),
    dir: slash > 0 ? t.path.slice(0, slash) : '',
  };
}

/** Where a draft comment sits, split as `threadPlace` splits a thread's:
 *  "a.ts:3" or "a.ts:3-5", and its folder. */
export function draftPlace(c: Pick<DiffComment, 'filePath' | 'startLine' | 'endLine'>): {
  name: string;
  dir: string;
} {
  const slash = c.filePath.lastIndexOf('/');
  const lines = c.startLine === c.endLine ? `${c.startLine}` : `${c.startLine}-${c.endLine}`;
  return {
    name: `${c.filePath.slice(slash + 1)}:${lines}`,
    dir: slash > 0 ? c.filePath.slice(0, slash) : '',
  };
}

// ── Drafts and notes ──

/** `items` grouped by file, files in tree order, each file's by line. */
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
    .sort(([a], [b]) => editorTreeOrder(a, b))
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

/**
 * Review mode's comment counts (D171): Comments counts the rows of its
 * Unresolved group (open threads, on the code or off it, and the person's
 * new draft comments; a draft reply sits in its thread's row), which the
 * view switch's tab shows too; Notes counts the task's unsent notes, as its
 * To send does.
 */
export function reviewTally(
  threads: readonly PrReviewThread[],
  comments: readonly DiffComment[],
  byFile: Readonly<Record<string, DiffComment[]>>,
): { comments: number; notes: number } {
  return {
    comments: commentGroups(threads, comments).unresolved.length,
    notes: trayNotes(byFile).unsent.length,
  };
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
  editorTreeOrder(a.path, b.path) || a.line - b.line;

/**
 * Every thread drawn on a line and every draft on lines (notes and comments;
 * a reply sits with its thread), in outline order: files in tree order, then line.
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

const CHECK_ORDER = ['failing', 'pending', 'passing', 'skipped'] as const;

/** "1 failing · 3 passing · 4 skipped": every state with checks in it, the
 *  ones that need a look first; null with no checks. */
export function checksSummary(checks: readonly PrCheck[]): string | null {
  const n = { passing: 0, failing: 0, pending: 0, skipped: 0 };
  for (const c of checks) n[c.state]++;
  const parts = CHECK_ORDER.filter((k) => n[k] > 0).map((k) => `${n[k]} ${k}`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** The checks as one state, as a PR's CI is rolled up: failing if any fails,
 *  else pending if any still runs, else passing (skipped ones pass); null with
 *  no checks. */
export function checksRollup(checks: readonly Pick<PrCheck, 'state'>[]): CiState | null {
  if (checks.length === 0) return null;
  if (checks.some((c) => c.state === 'failing')) return 'failing';
  if (checks.some((c) => c.state === 'pending')) return 'pending';
  return 'passing';
}
