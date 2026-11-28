/*
 * The pure half of `ui/TimelineChart`: scales, paths, the line's colour
 * gradient and the hover's nearest point. No DOM, so it is tested in node.
 */

export interface TimelinePoint {
  /** When (ms). */
  at: number;
  value: number;
}

/** The plot: its size in px, the time span across it, and the value at its top
 *  (the bottom is 0). `inset` keeps a 2px line and its end dot inside. */
export interface TimelineFrame {
  width: number;
  height: number;
  from: number;
  to: number;
  max: number;
  inset: number;
}

export function xAt(f: TimelineFrame, at: number): number {
  const span = f.to - f.from;
  const t = span > 0 ? (at - f.from) / span : 1;
  return f.inset + Math.max(0, Math.min(1, t)) * (f.width - 2 * f.inset);
}

export function yAt(f: TimelineFrame, value: number): number {
  const t = f.max > 0 ? Math.max(0, Math.min(1, value / f.max)) : 0;
  return f.inset + (1 - t) * (f.height - 2 * f.inset);
}

/** The value at the plot's top: headroom over the higher of the data and the
 *  threshold, so the threshold line never sits on the edge. */
export function plotMax(points: readonly TimelinePoint[], threshold?: number): number {
  let top = threshold ?? 0;
  for (const p of points) top = Math.max(top, p.value);
  return top > 0 ? top * 1.2 : 1;
}

/** The points split where two neighbours are further apart than `gapMs`, so
 *  a stretch with no samples draws as no line, not a straight guess. */
export function runs(points: readonly TimelinePoint[], gapMs: number): TimelinePoint[][] {
  const out: TimelinePoint[][] = [];
  let run: TimelinePoint[] = [];
  for (const p of points) {
    const prev = run[run.length - 1];
    if (prev && p.at - prev.at > gapMs) {
      out.push(run);
      run = [];
    }
    run.push(p);
  }
  if (run.length) out.push(run);
  return out;
}

const r1 = (n: number): string => String(Math.round(n * 10) / 10);

/** An SVG path through each run (`M … L …`), one decimal per coordinate. */
export function linePath(f: TimelineFrame, rs: readonly TimelinePoint[][]): string {
  return rs
    .map((run) =>
      run.map((p, i) => `${i ? 'L' : 'M'}${r1(xAt(f, p.at))} ${r1(yAt(f, p.value))}`).join(''),
    )
    .join('');
}

/** Each run closed down to the baseline, for the wash under the line. */
export function areaPath(f: TimelineFrame, rs: readonly TimelinePoint[][]): string {
  const base = r1(yAt(f, 0));
  return rs
    .map((run) => {
      const first = run[0];
      const last = run[run.length - 1];
      if (!first || !last || run.length < 2) return '';
      const line = run.map((p) => `L${r1(xAt(f, p.at))} ${r1(yAt(f, p.value))}`).join('');
      return `M${r1(xAt(f, first.at))} ${base}${line}L${r1(xAt(f, last.at))} ${base}Z`;
    })
    .join('');
}

export interface GradientStop {
  /** 0 at the plot's top, 1 at its bottom. */
  offset: number;
  color: string;
}

/**
 * A vertical gradient that gives every height its own colour (`colorAt` of
 * the value there), so each stretch of the line wears the colour of its
 * level. `samples` even steps from top to bottom (the browser blends between
 * them in sRGB, so enough steps keep `colorAt`'s own blend), plus `exact`
 * values (a threshold) placed precisely.
 */
export function gradientStops(
  f: TimelineFrame,
  colorAt: (value: number) => string,
  samples = 24,
  exact: readonly number[] = [],
): GradientStop[] {
  const top = yAt(f, f.max);
  const span = yAt(f, 0) - top;
  const values = new Set<number>(exact.filter((v) => v >= 0 && v <= f.max));
  for (let i = 0; i < samples; i++) values.add((f.max * i) / (samples - 1));
  return [...values]
    .map((v) => ({ offset: span > 0 ? (yAt(f, v) - top) / span : 0, color: colorAt(v) }))
    .sort((a, b) => a.offset - b.offset);
}

/** The index of the point nearest `at` in time (points oldest first), or -1. */
export function nearestIndex(points: readonly TimelinePoint[], at: number): number {
  if (points.length === 0) return -1;
  const atOf = (i: number): number => points[i]?.at ?? 0;
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (atOf(mid) < at) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && at - atOf(lo - 1) <= atOf(lo) - at) return lo - 1;
  return lo;
}
