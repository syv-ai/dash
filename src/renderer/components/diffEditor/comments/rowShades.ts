import type { DiffComment, RowSignature, Shade } from './types';

export interface RowDecoration {
  startLine: number;
  endLine: number;
  signature: RowSignature;
}

/** Pure: given comments + shadeMap, compute the minimal set of per-row
 *  decorations needed to paint shade-aware bands. Coalesces consecutive
 *  same-signature rows into a single decoration range for efficiency. */
export function computeRowDecorations(
  comments: ReadonlyArray<DiffComment>,
  shades: ReadonlyMap<string, Shade>,
): RowDecoration[] {
  if (comments.length === 0) return [];

  // Walk every line from the lowest startLine to the highest endLine,
  // computing the row's signature. Coalesce runs.
  let lo = Infinity;
  let hi = -Infinity;
  for (const c of comments) {
    if (c.startLine < lo) lo = c.startLine;
    if (c.endLine > hi) hi = c.endLine;
  }

  const out: RowDecoration[] = [];
  let runStart: number | null = null;
  let runSig: RowSignature | null = null;

  for (let line = lo; line <= hi; line++) {
    const sig = signatureForLine(comments, shades, line);
    if (sig === runSig) continue;
    if (runSig !== null && runStart !== null) {
      out.push({ startLine: runStart, endLine: line - 1, signature: runSig });
    }
    runSig = sig;
    runStart = sig === null ? null : line;
  }
  if (runSig !== null && runStart !== null) {
    out.push({ startLine: runStart, endLine: hi, signature: runSig });
  }
  return out;
}

function signatureForLine(
  comments: ReadonlyArray<DiffComment>,
  shades: ReadonlyMap<string, Shade>,
  line: number,
): RowSignature | null {
  let has1 = false;
  let has2 = false;
  for (const c of comments) {
    if (line < c.startLine || line > c.endLine) continue;
    const s = shades.get(c.id);
    if (s === 1) has1 = true;
    else if (s === 2) has2 = true;
  }
  if (has1 && has2) return '12';
  if (has1) return '1';
  if (has2) return '2';
  return null;
}

/** Returns ids of every comment whose range contains the given line.
 *  Used by hover-ambiguity detection (skip highlight if ≥2). */
export function commentIdsAtLine(comments: ReadonlyArray<DiffComment>, line: number): string[] {
  const out: string[] = [];
  for (const c of comments) {
    if (line >= c.startLine && line <= c.endLine) out.push(c.id);
  }
  return out;
}
