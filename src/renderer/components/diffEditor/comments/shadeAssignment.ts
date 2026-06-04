import type { DiffComment, Shade } from './types';

/** Greedy interval-graph 2-coloring. Sorts by (startLine, id) for stability,
 *  then for each comment picks the smallest unused shade among partial-
 *  overlap neighbors. Same-anchor (identical range) comments don't count
 *  as overlap — bubble stacking handles their differentiation.
 *
 *  Returns Map<commentId, 1 | 2>. Limitation: 3+ way mutual overlap requires
 *  3+ colors; this algorithm degrades by reusing shades, which is
 *  acceptable for v1. */
export function assignShades(comments: ReadonlyArray<DiffComment>): Map<string, Shade> {
  const sorted = [...comments].sort(
    (a, b) => a.startLine - b.startLine || a.id.localeCompare(b.id),
  );
  const out = new Map<string, Shade>();
  for (const c of sorted) {
    const used = new Set<Shade>();
    for (const other of sorted) {
      if (other.id === c.id) continue;
      const shade = out.get(other.id);
      if (shade === undefined) continue;
      if (partiallyOverlaps(c, other)) used.add(shade);
    }
    out.set(c.id, used.has(1) ? (used.has(2) ? 1 : 2) : 1);
  }
  return out;
}

function partiallyOverlaps(a: DiffComment, b: DiffComment): boolean {
  if (a.startLine === b.startLine && a.endLine === b.endLine) return false;
  return a.startLine <= b.endLine && b.startLine <= a.endLine;
}
