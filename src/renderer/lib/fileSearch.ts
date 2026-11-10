export interface FileHit {
  path: string;
  /** Positions in `path` of the matched characters, for highlighting. */
  indices: number[];
  score: number;
}

export interface FileSearchResult {
  /** The best `limit` matches, best first. */
  hits: FileHit[];
  /** How many paths matched in all, `hits` included. */
  total: number;
}

export const DEFAULT_LIMIT = 200;

function isBoundary(path: string, i: number): boolean {
  if (i === 0) return true;
  const prev = path.charAt(i - 1);
  const cur = path.charAt(i);
  if (prev === '/' || prev === '-' || prev === '_' || prev === '.' || prev === ' ') return true;
  // camelCase hump: lower → Upper
  return prev === prev.toLowerCase() && cur !== cur.toLowerCase();
}

/** Greedy left-to-right subsequence match of the query against `lower` (the
 *  path, lowercased), the first letter taken at `start`. Returns the matched
 *  indices, or null. */
function match(lower: string, query: string, start: number): number[] | null {
  const indices: number[] = [start];
  let pos = start + 1;
  for (let k = 1; k < query.length; k++) {
    const at = lower.indexOf(query.charAt(k), pos);
    if (at === -1) return null;
    indices.push(at);
    pos = at + 1;
  }
  return indices;
}

function score(path: string, indices: number[], nameStart: number): number {
  let s = 0;
  const first = indices[0] ?? 0;
  const last = indices[indices.length - 1] ?? first;
  const inName = first >= nameStart;
  // A match wholly inside the file name is worth far more than one that
  // needed the directory part.
  if (inName) s += 100;
  else if (last >= nameStart) s += 20;
  for (let k = 0; k < indices.length; k++) {
    const i = indices[k] ?? 0;
    if (isBoundary(path, i)) s += 8;
    if (k > 0 && i === (indices[k - 1] ?? -2) + 1) s += 5;
  }
  if (inName && first === nameStart) s += 20;
  // The whole query as one unbroken run that starts a word (`Store` in
  // `uiStore.ts`) beats a scattered match, even one that starts at the file name.
  if (last - first === indices.length - 1 && isBoundary(path, first)) s += 20;
  // Prefer short paths and tight matches.
  s -= (last - first) * 0.5;
  s -= path.length * 0.05;
  return s;
}

/** Lowercases `s` without ever changing its length: a character whose
 *  lowercase is longer (`İ` becomes two units) stays as it is, so indices into
 *  the result are indices into `s`. */
export function lowerKeepingLength(s: string): string {
  const fast = s.toLowerCase();
  if (fast.length === s.length) return fast;
  let out = '';
  for (const c of s) {
    const l = c.toLowerCase();
    out += l.length === c.length ? l : c;
  }
  return out;
}

/** Few starts keep a long path cheap. */
const MAX_STARTS = 8;

/** The best-scoring of a few greedy alignments of `q` with its first letter at
 *  or after `from`, or null when it doesn't fit. It is not a search for the
 *  best alignment overall. Starts tried: the leftmost occurrence of the first
 *  letter, then later occurrences on a word boundary, at most MAX_STARTS in
 *  all. A later start can't fit where the leftmost one failed, so that failure
 *  ends the search. */
function bestAlignment(
  path: string,
  lower: string,
  q: string,
  from: number,
  nameStart: number,
): { indices: number[]; score: number } | null {
  const ch = q.charAt(0);
  let start = lower.indexOf(ch, from);
  let best: { indices: number[]; score: number } | null = null;
  for (let tried = 0; start !== -1 && tried < MAX_STARTS; ) {
    const indices = match(lower, q, start);
    if (!indices) break;
    const s = score(path, indices, nameStart);
    if (!best || s > best.score) best = { indices, score: s };
    tried++;
    do start = lower.indexOf(ch, start + 1);
    while (start !== -1 && !isBoundary(path, start));
  }
  return best;
}

/** Fuzzy-find files by path: the query must be a subsequence of the path.
 *  Prefers matches inside the file name, at word starts, and in runs. */
export function searchFiles(
  paths: string[],
  query: string,
  limit = DEFAULT_LIMIT,
): FileSearchResult {
  const q = lowerKeepingLength(query.trim().replace(/\s+/g, ''));
  if (!q) return { hits: [], total: 0 };
  const hits: FileHit[] = [];
  for (const path of paths) {
    const nameStart = path.lastIndexOf('/') + 1;
    const lower = lowerKeepingLength(path);
    // Try the file name first so `edsb` binds to EditorSidebar, not to letters
    // scattered through the directories; only if it doesn't fit there, use the
    // whole path. The leftmost match is a start too, so if it fails none can fit.
    const best =
      bestAlignment(path, lower, q, nameStart, nameStart) ??
      bestAlignment(path, lower, q, 0, nameStart);
    if (best) hits.push({ path, indices: best.indices, score: best.score });
  }
  hits.sort((a, b) => b.score - a.score || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { hits: hits.slice(0, limit), total: hits.length };
}

/** The count line under the search box: every match, and how many are listed
 *  when the cap cut the list short. */
export function describeHitCount({ hits, total }: FileSearchResult): string {
  const files = total === 1 ? '1 file' : `${total} files`;
  return hits.length < total ? `${hits.length} of ${files}` : files;
}
