import type { PrReview } from '../../../../shared/types';

/*
 * @mentions in the reply composer, as data: who can be tagged, which `@…`
 * the caret is in, and the text once a name is picked. Pure, so the rules
 * are tested without a DOM. Mentions are plain `@name` text: GitHub links
 * `@login` itself; ADO's `@<GUID>` form isn't written (D196).
 */

/** Placeholder authors that aren't people to tag. */
const NOBODY = new Set(['ghost', 'Unknown', '']);

/**
 * The PR's participants, each once: its author, its reviewers, its
 * assignees, then everyone who commented (threads and conversation) — the
 * PR's own people first, the rest in the order they spoke.
 */
export function mentionCandidates(
  review: Pick<PrReview, 'author' | 'reviewers' | 'assignees' | 'threads' | 'conversation'>,
): string[] {
  const names = [
    review.author,
    ...review.reviewers.map((r) => r.name),
    ...review.assignees,
    ...review.threads.flatMap((t) => t.comments.map((c) => c.author)),
    ...review.conversation.map((c) => c.author),
  ];
  return [...new Set(names.filter((n) => !NOBODY.has(n)))];
}

/** The `@…` being typed at `caret`: where its `@` is and what follows it. */
export interface MentionQuery {
  start: number;
  query: string;
}

/**
 * The mention the caret is in, or null: an `@` at the text's start or after
 * a space or opening bracket (so `a@b.c` isn't one), then name characters
 * (letters, digits, `-`, `_`, `.`) up to the caret.
 */
export function mentionAt(text: string, caret: number): MentionQuery | null {
  const before = text.slice(0, caret);
  const m = /(^|[\s([{])@([\w.-]*)$/u.exec(before);
  if (!m) return null;
  return { start: caret - m[2]!.length - 1, query: m[2]! };
}

/** The candidates matching `query`, names that start with it first, then
 *  those containing it; case-insensitive, at most `limit`. */
export function filterMentions(candidates: readonly string[], query: string, limit = 8): string[] {
  const q = query.toLowerCase();
  const starts = candidates.filter((c) => c.toLowerCase().startsWith(q));
  const contains = candidates.filter(
    (c) => !c.toLowerCase().startsWith(q) && c.toLowerCase().includes(q),
  );
  return [...starts, ...contains].slice(0, limit);
}

/** `text` with the mention at `at` (typed up to `caret`) replaced by
 *  `@name ` and the caret after it. */
export function insertMention(
  text: string,
  at: MentionQuery,
  caret: number,
  name: string,
): { text: string; caret: number } {
  const inserted = `@${name} `;
  // A space already after the caret isn't doubled.
  const rest = text.slice(caret).replace(/^ /, '');
  return { text: text.slice(0, at.start) + inserted + rest, caret: at.start + inserted.length };
}
