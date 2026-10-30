export interface FileHit {
  path: string;
  /** Positions in `path` of the matched characters, for highlighting. */
  indices: number[];
  score: number;
}

const DEFAULT_LIMIT = 200;

function isBoundary(path: string, i: number): boolean {
  if (i === 0) return true;
  const prev = path.charAt(i - 1);
  const cur = path.charAt(i);
  if (prev === '/' || prev === '-' || prev === '_' || prev === '.' || prev === ' ') return true;
  // camelCase hump: lower → Upper
  return prev === prev.toLowerCase() && cur !== cur.toLowerCase();
}

/** Greedy left-to-right subsequence match of `query` against `path` starting at
 *  `from`. Returns the matched indices, or null. */
function match(path: string, query: string, from: number): number[] | null {
  const lower = path.toLowerCase();
  const indices: number[] = [];
  let pos = from;
  for (const ch of query) {
    const at = lower.indexOf(ch, pos);
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
  // Prefer short paths and tight matches.
  s -= (last - first) * 0.5;
  s -= path.length * 0.05;
  return s;
}

/** Fuzzy-find files by path: the query must be a subsequence of the path.
 *  Prefers matches inside the file name, at word starts, and in runs. */
export function searchFiles(paths: string[], query: string, limit = DEFAULT_LIMIT): FileHit[] {
  const q = query.trim().toLowerCase().replace(/\s+/g, '');
  if (!q) return [];
  const hits: FileHit[] = [];
  for (const path of paths) {
    const nameStart = path.lastIndexOf('/') + 1;
    // Try the file name first so `edsb` binds to EditorSidebar, not to letters
    // scattered through the directories.
    const indices = match(path, q, nameStart) ?? match(path, q, 0);
    if (!indices) continue;
    hits.push({ path, indices, score: score(path, indices, nameStart) });
  }
  hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return hits.slice(0, limit);
}
