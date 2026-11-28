import type { ContextUsage, RateLimitInfo, RateLimits } from '../../../shared/types';
import { resetClock } from '../../../shared/rateLimits';
import { formatResetAt, formatTokens, formatTtr, TTR_MEANING } from '../../utils/format';
import {
  LOOK_BACK_MS,
  paceOutlook,
  CLOSE_AT_PCT,
  formatProjection,
  formatRate,
  formatRateFigure,
  pressingPace,
  RATE_UNIT,
  type Pace,
  type PaceOutlook,
  type PressingPace,
  type LimitPaces,
  type LimitKey,
} from '../../lib/pace';
import { quietUsageColor, usageColor } from '../../lib/usageColor';
import { useMinuteClock } from '../../hooks/useMinuteClock';
import { useSettings } from '../../stores/settingsStore';
import { LEVEL_FIGURE, LevelText, type LevelSize } from '../ui/LevelText';
import { ProgressRing } from '../ui/ProgressRing';
import { Tooltip, type RichTooltip } from '../ui/Tooltip';
import { useFittedDensity } from '../ui/useFittedDensity';
import { cn } from '../../lib/cn';
import { fitUsage, USAGE_MEASURED, type UsageDensity } from './usageDensity';

interface UsageSectionProps {
  /** The task session's context window use; absent until its first reply. */
  contextUsage?: ContextUsage;
  /** The account's limits; undefined until a session reports one. */
  rateLimits?: RateLimits;
  paces: LimitPaces;
}

export const LIMIT_LABELS: Record<LimitKey, string> = {
  fiveHour: '5-hour',
  sevenDay: 'Weekly',
};

/*
 * Fixed-width columns, centred as a group with a fixed gap, each a ring (or
 * the pace's figure) over its label and a limit's time to reset: an
 * expanded sidebar leaves them where they are instead of spreading them
 * apart. The row never wraps or overflows: it gives way by its measured
 * width (`fitUsage`), dropping the pace, then the rings and TTRs.
 * Details (the exact reset time) live in tooltips at every density.
 */
const COLUMNS = [
  'grid-cols-[minmax(0,6rem)]',
  'grid-cols-[repeat(2,minmax(0,6rem))]',
  'grid-cols-[repeat(3,minmax(0,6rem))]',
  'grid-cols-[repeat(4,minmax(0,6rem))]',
];

/** One column's content: a level (the session's context, a limit) or the
 *  pace; its caption (a limit's TTR, the pace's look-back) under the label. */
type Cell = { key: string; tooltip: RichTooltip; label: string; caption?: string } & (
  | { kind: 'level'; pct: number | null; aria: string }
  | { kind: 'pace'; rate: string; outlook: PaceOutlook | null }
);

/** A level's column: the session's context, or a limit. */
export type LevelCell = Extract<Cell, { kind: 'level' }>;

/** The pace's figure by its outlook: green, it resets first; amber, close;
 *  red, the limit comes first; plain ink with no projection yet. */
const OUTLOOK_TEXT: Record<PaceOutlook, string> = {
  clear: 'text-state-done',
  close: 'text-warn',
  over: 'text-state-fail',
};

/** One column: the figure on top, its label below, then any caption. Its
 *  tooltip, unless it is a measuring copy (`bare`). */
function Column({ cell, density, bare }: { cell: Cell; density: UsageDensity; bare?: boolean }) {
  const caption = density === 'compact' ? undefined : cell.caption;
  const column = (
    <div className="flex min-w-0 flex-col items-center gap-2">
      <Figure cell={cell} density={density} />
      <span className="flex w-full flex-col items-center">
        <span className="max-w-full truncate type-caption text-ink-2">{cell.label}</span>
        {caption && (
          <span className="max-w-full truncate type-caption tabular-nums">{caption}</span>
        )}
      </span>
    </div>
  );
  return bare ? column : <Tooltip content={cell.tooltip}>{column}</Tooltip>;
}

/** A level as a ring with its percent inside, or (compact) the percent alone,
 *  coloured by how close it is to full; the pace's rate in a ring-sized box. */
function Figure({ cell, density }: { cell: Cell; density: UsageDensity }) {
  if (cell.kind === 'pace') {
    return (
      <span
        className={cn(
          'flex size-16 items-center justify-center',
          cell.outlook ? OUTLOOK_TEXT[cell.outlook] : 'text-ink',
          LEVEL_FIGURE,
        )}
      >
        {cell.rate}
        <span className="text-ink-2">{RATE_UNIT}</span>
      </span>
    );
  }
  if (density === 'compact') return <LevelReading cell={cell} />;
  const { pct, aria } = cell;
  const reading = pct === null ? '—' : `${pct}%`;
  const color = pct === null ? undefined : usageColor(pct);
  return (
    <ProgressRing value={pct} size={64} stroke={6} color={color} aria-label={aria}>
      <span className={cn(LEVEL_FIGURE, pct === null ? 'text-ink-3' : 'text-ink')}>{reading}</span>
    </ProgressRing>
  );
}

/** A level as its percent alone, coloured by how close it is to full: the
 *  compact row's figure, the collapsed sidebar's rail's, and (`sm`, `quiet`)
 *  a task row's context in the left sidebar, plain ink until it nears full
 *  (`quietUsageColor`, T30). */
export function LevelReading({
  cell: { pct, aria },
  size,
  quiet = false,
}: {
  cell: LevelCell;
  size?: LevelSize;
  quiet?: boolean;
}) {
  const ramp = quiet ? quietUsageColor : usageColor;
  return (
    <LevelText
      value={pct}
      color={pct === null ? undefined : ramp(pct)}
      size={size}
      aria-label={aria}
    >
      {pct === null ? '—' : `${pct}%`}
    </LevelText>
  );
}

/** The cells at `density`: the pace only where there is room for it. */
const shown = (cells: Cell[], density: UsageDensity) =>
  density === 'full' ? cells : cells.filter((c) => c.kind !== 'pace');

/**
 * A limit's column. A window missing from the account's limits is one that
 * isn't running: Claude Code drops a window from its status line once its
 * reset time passes (as `mergeRateLimits` drops an expired reading), and the
 * next message starts a new one. Nothing has been used in it, so it reads
 * 0%, not "—" (R16).
 */
export function limitCell(
  limit: LimitKey,
  info: RateLimitInfo | undefined,
  now: number,
): LevelCell {
  const long = LIMIT_LABELS[limit];
  const pct = info ? Math.round(info.usedPercentage) : 0;
  const resetsAt = info?.resetsAt ?? 0;
  const ttr = resetsAt ? formatTtr(resetsAt * 1000 - now) : undefined;
  const used = { label: 'Used', value: `${pct}%` };
  // The account hit it (`withLimitHit`): full, and the caption says when it's back.
  const reached = info?.reached === true;
  const caption = reached && resetsAt ? `Resets ${resetClock(resetsAt, now)}` : ttr;
  const tooltip: RichTooltip = reached
    ? {
        title: `${long} limit reached`,
        body: 'Tasks pause until it resets.',
        rows: [used, ...(resetsAt ? [{ label: 'Resets', value: formatResetAt(resetsAt) }] : [])],
      }
    : info
      ? {
          title: `${long} limit`,
          ...(ttr ? { body: TTR_MEANING } : {}),
          rows: [
            used,
            ...(ttr ? [{ label: 'Resets', value: `${formatResetAt(resetsAt)} (${ttr})` }] : []),
          ],
        }
      : {
          title: `${long} limit`,
          body: 'No window running; the next message starts one.',
          rows: [used],
        };
  return {
    key: limit,
    kind: 'level',
    pct,
    aria: reached ? `${long} limit reached` : `${long} limit used`,
    caption,
    tooltip,
    label: long,
  };
}

function sessionCell(ctx: ContextUsage | null): LevelCell {
  return {
    key: 'session',
    kind: 'level',
    pct: ctx ? Math.round(ctx.percentage) : null,
    aria: 'Session context used',
    label: 'Session',
    tooltip: ctx
      ? {
          title: 'Session context',
          body: "Context used by this task's Claude session.",
          rows: [
            { label: 'Used', value: `${Math.round(ctx.percentage)}%` },
            { label: 'Tokens', value: `${formatTokens(ctx.used)} of ${formatTokens(ctx.total)}` },
          ],
        }
      : {
          title: 'Session context',
          body: "Context used by this task's Claude session, once it has replied.",
        },
  };
}

/**
 * The levels the usage row shows, in its order: the session's context, then
 * the account's limits, each where its setting shows it. The task rail shows
 * the same, so the two never disagree.
 */
export function levelCells({
  contextUsage,
  rateLimits,
  showSession,
  showLimits,
  now,
}: {
  contextUsage?: ContextUsage;
  rateLimits?: RateLimits;
  showSession: boolean;
  showLimits: boolean;
  now: number;
}): LevelCell[] {
  const cells: LevelCell[] = [];
  if (showSession) {
    cells.push(sessionCell(contextUsage && contextUsage.percentage > 0 ? contextUsage : null));
  }
  // Both limits show once the account reports either: a window that isn't
  // running (it reset, and no message has started the next) reads 0%.
  if (showLimits && rateLimits) {
    cells.push(limitCell('fiveHour', rateLimits.fiveHour, now));
    cells.push(limitCell('sevenDay', rateLimits.sevenDay, now));
  }
  return cells;
}

/** How far back the barometer looks: "last 30 min", "last hour". */
function lookBack(key: LimitKey): string {
  const minutes = LOOK_BACK_MS[key] / 60_000;
  if (minutes < 60) return `last ${minutes} min`;
  return minutes === 60 ? 'last hour' : `last ${minutes / 60} hours`;
}

/** The span a limit's average pace covers. */
const AVERAGE_LABELS: Record<LimitKey, string> = {
  fiveHour: 'Average this window',
  sevenDay: 'Average this week',
};

/** A limit's pace as a tooltip row: the barometer, then (on a second line)
 *  the window's average pace and where it leads. */
function paceRow(limit: LimitKey, pace: Pace | undefined) {
  const now =
    pace && pace.perHour !== null
      ? `${formatRate(pace.perHour)} (${lookBack(limit)})`
      : 'not rising, or too few readings yet';
  const average = pace?.projection ? formatProjection(pace.projection) : 'not enough data yet';
  return {
    label: LIMIT_LABELS[limit],
    value: `Now: ${now}\n${AVERAGE_LABELS[limit]}: ${average}`,
  };
}

/** The most pressing limit's barometer, "+6%/h" over its look-back, its
 *  figure coloured by where its window's average pace leads (the unit stays
 *  quiet); both limits in the tooltip. */
function paceCell(paces: LimitPaces, pressing: PressingPace): Cell {
  const keys = (Object.keys(LIMIT_LABELS) as LimitKey[]).filter((k) => k in paces);
  const legend =
    "The colour: where the window's average pace so far, idle time included, leads by the reset. " +
    `Green: the limit resets first. Amber: ${CLOSE_AT_PCT}% or more by the reset. Red: the limit comes first.`;
  // A projection names its TTR.
  const ttr = keys.some((k) => paces[k]?.projection);
  return {
    key: 'pace',
    kind: 'pace',
    rate: formatRateFigure(pressing.perHour),
    outlook: pressing.projection ? paceOutlook(pressing.projection) : null,
    label: 'Pace',
    caption: lookBack(pressing.limit),
    tooltip: {
      title: 'Pace',
      body: ttr ? `${legend} ${TTR_MEANING}` : legend,
      rows: keys.map((k) => paceRow(k, paces[k])),
    },
  };
}

/**
 * The top of the task sidebar: the session's context use, the account's
 * 5-hour and weekly limits as rings, and (opt-in, once there's a rate, D33)
 * how fast the limits are being used.
 */
export function UsageSection({ contextUsage, rateLimits, paces }: UsageSectionProps) {
  const showSession = useSettings((s) => s.showUsageInline);
  const showLimits = useSettings((s) => s.showRateLimits);
  const showPace = useSettings((s) => s.showPace);
  const now = useMinuteClock();

  const pressing = showPace && showLimits && rateLimits ? pressingPace(paces) : null;

  const cells: Cell[] = levelCells({ contextUsage, rateLimits, showSession, showLimits, now });
  if (pressing) cells.push(paceCell(paces, pressing));

  const { rootRef, sizerRef, density } = useFittedDensity<UsageDensity>(
    fitUsage,
    'full',
    cells.map((c) => c.key).join(),
  );
  if (cells.length === 0) return null;
  const live = shown(cells, density);

  return (
    <div className="shrink-0 px-1">
      <div
        ref={rootRef}
        className={cn(
          'relative grid items-start justify-center gap-x-2 pt-6 pb-4',
          COLUMNS[live.length - 1],
        )}
      >
        {live.map((cell) => (
          <Column key={cell.key} cell={cell} density={density} />
        ))}
        {/* The row at each measured density, its columns as wide as its
            widest (as the live grid shares its width out evenly). */}
        <div
          ref={sizerRef}
          aria-hidden
          className="invisible absolute inset-x-0 top-0 h-0 overflow-hidden"
        >
          {USAGE_MEASURED.map((d) => (
            <div key={d} className="grid w-max auto-cols-fr grid-flow-col gap-x-2">
              {shown(cells, d).map((cell) => (
                <Column key={cell.key} cell={cell} density={d} bare />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
