import type { BlameLine } from '@shared/types';
import { formatRelativeTime } from '@shared/relativeTime';

/** The fields surfaced in the ruler label card, ready to render as rows. */
export interface BlameLabel {
  author: string; // author name, or "Uncommitted changes" for working-tree lines
  age: string; // relative time (e.g. "3d"); '' when uncommitted
  shortSha: string; // 7-char hash; '' when uncommitted
  summary: string; // commit subject; '' when uncommitted
  uncommitted: boolean;
}

/**
 * Structured blame fields for the ruler label. Uncommitted lines collapse to a
 * single phrase. `now` is unix seconds, injectable for deterministic tests.
 */
export function blameLabel(line: BlameLine, now: number): BlameLabel {
  if (line.uncommitted) {
    return { author: 'Uncommitted changes', age: '', shortSha: '', summary: '', uncommitted: true };
  }
  return {
    author: line.author,
    age: formatRelativeTime(line.authorTime, now),
    shortSha: line.shortSha,
    summary: line.summary,
    uncommitted: false,
  };
}

/**
 * The maximal contiguous run of lines around `targetLine` that share the same
 * commit — i.e. where that commit's changes start and end in the file. Returns
 * 1-indexed inclusive bounds, or null if the line has no blame. Assumes `lines`
 * is ascending and gap-free (full-file blame), so it walks outward in O(block).
 */
export function contiguousBlock(
  lines: BlameLine[],
  targetLine: number,
): { start: number; end: number } | null {
  const idx = targetLine - 1;
  const cur = lines[idx];
  if (!cur || cur.line !== targetLine) return null;
  const { sha } = cur;
  let start = idx;
  let end = idx;
  while (
    start > 0 &&
    lines[start - 1]!.sha === sha &&
    lines[start - 1]!.line === lines[start]!.line - 1
  )
    start--;
  while (
    end < lines.length - 1 &&
    lines[end + 1]!.sha === sha &&
    lines[end + 1]!.line === lines[end]!.line + 1
  )
    end++;
  return { start: lines[start]!.line, end: lines[end]!.line };
}
