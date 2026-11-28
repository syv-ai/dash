import * as React from 'react';
import { cn } from '../../lib/cn';
import { EASE, MOTION_MS, reducedMotion } from '../../lib/motion';
import {
  areaPath,
  gradientStops,
  linePath,
  nearestIndex,
  plotMax,
  runs,
  xAt,
  yAt,
  type TimelineFrame,
  type TimelinePoint,
} from './timelineGeometry';

export type { TimelinePoint } from './timelineGeometry';

/** Keeps the 2px line and the 4px end dot (with its 2px ring) inside. */
const INSET = 6;

interface TimelineChartProps {
  /** Oldest first. */
  points: readonly TimelinePoint[];
  /** The time span across the plot (ms). */
  from: number;
  to: number;
  /** A level drawn as a straight dashed line across the plot, with its label
   *  above the line's start (the end is the newest point's). */
  threshold?: { value: number; label: string };
  /** The line's colour at a value. Every height wears its own colour, so a
   *  stretch near the threshold reads differently from one well under it.
   *  Neutral ink when left out. */
  colorAt?: (value: number) => string;
  /** Neighbours further apart than this (ms) break the line. */
  gapMs?: number;
  /** Trace each new point in, then beat its end dot once, like a heart
   *  monitor. Only while mounted, nothing between points, and never under
   *  reduced motion. */
  trace?: boolean;
  /** The plot's height in px; it takes its container's width. */
  height?: number;
  /** The point under the pointer, or null as it leaves: the caller shows the
   *  readout (the crosshair finds the time; readers never aim at a 2px line). */
  onHover?: (point: TimelinePoint | null) => void;
  'aria-label': string;
  /** Layout only. */
  className?: string;
}

/** The container's width, followed as it changes. */
function useWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [width, setWidth] = React.useState(0);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(
      ([entry]) => entry && setWidth(Math.round(entry.contentRect.width)),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

/**
 * A single series over time as a hand-rolled SVG line (dataviz marks: a 2px
 * round line, a 10% wash under it, a solid hairline baseline, an r4 end dot
 * with a 2px surface ring, a crosshair on hover), with an optional
 * threshold. No axis ticks: the caller says the span and the values in text.
 */
export function TimelineChart({
  points,
  from,
  to,
  threshold,
  colorAt,
  gapMs = Number.POSITIVE_INFINITY,
  trace = false,
  height = 72,
  onHover,
  'aria-label': ariaLabel,
  className,
}: TimelineChartProps) {
  const boxRef = React.useRef<HTMLDivElement>(null);
  const width = useWidth(boxRef);
  const gradientId = React.useId();
  const [hover, setHover] = React.useState<number | null>(null);

  const frame: TimelineFrame = React.useMemo(
    () => ({ width, height, from, to, max: plotMax(points, threshold?.value), inset: INSET }),
    [width, height, from, to, points, threshold?.value],
  );
  const lineRuns = React.useMemo(() => runs(points, gapMs), [points, gapMs]);
  const stops = React.useMemo(
    () => (colorAt ? gradientStops(frame, colorAt, 24, threshold ? [threshold.value] : []) : null),
    [frame, colorAt, threshold],
  );

  // The newest segment is its own path, so it can be traced in.
  const last = points[points.length - 1];
  const lastRun = lineRuns[lineRuns.length - 1];
  const segment = lastRun && lastRun.length > 1 ? linePath(frame, [lastRun.slice(-2)]) : null;
  const bodyRuns = React.useMemo(
    () => (segment && lastRun ? [...lineRuns.slice(0, -1), lastRun.slice(0, -1)] : lineRuns),
    [lineRuns, lastRun, segment],
  );

  const segmentRef = React.useRef<SVGPathElement>(null);
  const beatRef = React.useRef<SVGCircleElement>(null);
  const tracedAt = React.useRef<number | null>(null);
  React.useEffect(() => {
    if (!trace || !last || width === 0) return;
    // The first point drawn is already there; only a newer one traces in.
    const first = tracedAt.current === null;
    if (tracedAt.current === last.at) return;
    tracedAt.current = last.at;
    if (first || reducedMotion()) return;
    const animations: Animation[] = [];
    const seg = segmentRef.current;
    if (seg) {
      const length = seg.getTotalLength();
      seg.style.strokeDasharray = String(length);
      const a = seg.animate([{ strokeDashoffset: length }, { strokeDashoffset: 0 }], {
        duration: MOTION_MS.slow,
        easing: EASE.settle,
      });
      a.onfinish = () => (seg.style.strokeDasharray = '');
      animations.push(a);
    }
    if (beatRef.current) {
      animations.push(
        beatRef.current.animate(
          [
            { opacity: 0.4, transform: 'scale(1)' },
            { opacity: 0, transform: 'scale(2.5)' },
          ],
          { duration: MOTION_MS.slow * 2, delay: MOTION_MS.slow, easing: EASE.settle },
        ),
      );
    }
    return () => {
      for (const a of animations) a.cancel();
      if (seg) seg.style.strokeDasharray = '';
    };
  }, [trace, last, width]);

  const stroke = stops ? `url(#${gradientId})` : 'hsl(var(--ink-2))';
  const hovered = hover !== null ? points[hover] : undefined;
  const endColor = last ? (colorAt?.(last.value) ?? 'hsl(var(--ink-2))') : undefined;

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (points.length === 0 || width === 0) return;
    const x = e.clientX - e.currentTarget.getBoundingClientRect().left;
    const t = (x - INSET) / Math.max(1, width - 2 * INSET);
    const i = nearestIndex(points, from + t * (to - from));
    if (i === hover) return;
    setHover(i);
    onHover?.(points[i] ?? null);
  }

  function onPointerLeave() {
    setHover(null);
    onHover?.(null);
  }

  return (
    <div ref={boxRef} className={cn('relative w-full', className)} style={{ height }}>
      {width > 0 && (
        <svg
          role="img"
          aria-label={ariaLabel}
          width={width}
          height={height}
          className="block overflow-visible"
          onPointerMove={onPointerMove}
          onPointerLeave={onPointerLeave}
        >
          {stops && (
            <defs>
              <linearGradient
                id={gradientId}
                gradientUnits="userSpaceOnUse"
                x1={0}
                x2={0}
                y1={yAt(frame, frame.max)}
                y2={yAt(frame, 0)}
              >
                {stops.map((s) => (
                  <stop key={s.offset} offset={s.offset} style={{ stopColor: s.color }} />
                ))}
              </linearGradient>
            </defs>
          )}
          <line
            x1={INSET}
            x2={width - INSET}
            y1={yAt(frame, 0)}
            y2={yAt(frame, 0)}
            stroke="hsl(var(--line))"
            strokeWidth={1}
          />
          {threshold && (
            <line
              x1={INSET}
              x2={width - INSET}
              y1={yAt(frame, threshold.value)}
              y2={yAt(frame, threshold.value)}
              stroke="hsl(var(--ink-3))"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
          )}
          <path d={areaPath(frame, lineRuns)} fill={stroke} opacity={0.1} />
          <path
            d={linePath(frame, bodyRuns)}
            fill="none"
            stroke={stroke}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {segment && (
            <path
              ref={segmentRef}
              d={segment}
              fill="none"
              stroke={stroke}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
          {hovered && (
            <line
              x1={xAt(frame, hovered.at)}
              x2={xAt(frame, hovered.at)}
              y1={INSET / 2}
              y2={yAt(frame, 0)}
              stroke="hsl(var(--ink-3))"
              strokeWidth={1}
            />
          )}
          {last && (
            <g
              transform={`translate(${xAt(frame, last.at)} ${yAt(frame, last.value)})`}
              style={{ color: endColor }}
            >
              <circle
                ref={beatRef}
                r={4}
                fill="currentColor"
                opacity={0}
                style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
              />
              <circle r={4} fill="currentColor" stroke="hsl(var(--raised))" strokeWidth={2} />
            </g>
          )}
          {hovered && hovered !== last && (
            <circle
              cx={xAt(frame, hovered.at)}
              cy={yAt(frame, hovered.value)}
              r={4}
              fill={colorAt?.(hovered.value) ?? 'hsl(var(--ink-2))'}
              stroke="hsl(var(--raised))"
              strokeWidth={2}
            />
          )}
        </svg>
      )}
      {threshold && width > 0 && (
        <span
          className="type-caption pointer-events-none absolute left-1.5 -translate-y-full tabular-nums"
          style={{ top: yAt(frame, threshold.value) - 1 }}
        >
          {threshold.label}
        </span>
      )}
    </div>
  );
}
