import type { ContextUsage, RateLimitInfo, RateLimits } from '../../../shared/types';
import { formatResetAt, formatResetTime, formatTokens } from '../../utils/format';
import {
  BURN_WINDOW_MS,
  burnOutlook,
  CLOSE_AT_PCT,
  formatProjection,
  formatRate,
  pressingBurn,
  type Burn,
  type BurnOutlook,
  type LimitBurns,
  type LimitKey,
} from '../../lib/burnRate';
import { usageColor } from '../../lib/usageColor';
import { useMinuteClock } from '../../hooks/useMinuteClock';
import { useSettings } from '../../stores/settingsStore';
import { LevelText } from '../ui/LevelText';
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
  burns: LimitBurns;
}

const LIMIT_LABELS: Record<LimitKey, string> = {
  fiveHour: '5-hour',
  sevenDay: 'Weekly',
};

/*
 * Fixed-width columns, centred as a group with a fixed gap, each a ring (or
 * the burn's figure) over its label and a limit's reset countdown: an
 * expanded sidebar leaves them where they are instead of spreading them
 * apart. The row never wraps or overflows: it gives way by its measured
 * width (`fitUsage`), dropping the burn rate, then the rings and countdowns.
 * Details (the exact reset time) live in tooltips at every density.
 */
const COLUMNS = [
  'grid-cols-[minmax(0,6rem)]',
  'grid-cols-[repeat(2,minmax(0,6rem))]',
  'grid-cols-[repeat(3,minmax(0,6rem))]',
  'grid-cols-[repeat(4,minmax(0,6rem))]',
];

/** One column's content: a level (the session's context, a limit) or the burn. */
type Cell = { key: string; tooltip: RichTooltip; label: string } & (
  | { kind: 'level'; pct: number | null; aria: string; countdown?: string }
  | { kind: 'burn'; rate: string; outlook: BurnOutlook }
);

/** The burn's figure by its outlook: green, it resets first; amber, close;
 *  red, the limit comes first. */
const OUTLOOK_TEXT: Record<BurnOutlook, string> = {
  clear: 'text-state-done',
  close: 'text-state-needs',
  over: 'text-state-fail',
};

/** One column: the figure on top, its label below, then any caption. Its
 *  tooltip, unless it is a measuring copy (`bare`). */
function Column({ cell, density, bare }: { cell: Cell; density: UsageDensity; bare?: boolean }) {
  const caption =
    cell.kind === 'level' && cell.countdown && density !== 'compact' ? cell.countdown : null;
  const column = (
    <div className="flex min-w-0 flex-col items-center gap-1">
      <Figure cell={cell} density={density} />
      <span className="flex w-full flex-col items-center">
        <span className="max-w-full truncate type-caption text-ink-2">{cell.label}</span>
        {caption && (
          <span className="max-w-full truncate type-caption tabular-nums">resets {caption}</span>
        )}
      </span>
    </div>
  );
  return bare ? column : <Tooltip content={cell.tooltip}>{column}</Tooltip>;
}

/** A level as a ring with its percent inside, or (compact) the percent alone,
 *  coloured by how close it is to full; the burn's rate in a ring-sized box. */
function Figure({ cell, density }: { cell: Cell; density: UsageDensity }) {
  const figure = 'text-sm font-semibold tabular-nums';
  if (cell.kind === 'burn') {
    return (
      <span className={cn('grid size-11 place-items-center', OUTLOOK_TEXT[cell.outlook], figure)}>
        {cell.rate}
      </span>
    );
  }
  const { pct, aria } = cell;
  const reading = pct === null ? '—' : `${pct}%`;
  const color = pct === null ? undefined : usageColor(pct);
  if (density === 'compact') {
    return (
      <LevelText value={pct} color={color} aria-label={aria}>
        {reading}
      </LevelText>
    );
  }
  return (
    <ProgressRing value={pct} size={44} stroke={4} color={color} aria-label={aria}>
      <span className={cn(figure, pct === null ? 'text-ink-3' : 'text-ink')}>{reading}</span>
    </ProgressRing>
  );
}

/** The cells at `density`: the burn only where there is room for it. */
const shown = (cells: Cell[], density: UsageDensity) =>
  density === 'full' ? cells : cells.filter((c) => c.kind !== 'burn');

function limitCell(limit: LimitKey, info: RateLimitInfo | undefined, now: number): Cell {
  const long = LIMIT_LABELS[limit];
  const pct = info ? Math.round(info.usedPercentage) : null;
  const resetsAt = info?.resetsAt ?? 0;
  const countdown = formatResetTime(resetsAt, now);
  const tooltip: RichTooltip = info
    ? {
        title: `${long} limit`,
        rows: [
          { label: 'Used', value: `${pct}%` },
          ...(countdown
            ? [{ label: 'Resets', value: `${formatResetAt(resetsAt)} (${countdown})` }]
            : []),
        ],
      }
    : { title: `${long} limit`, body: 'No window running; the next message starts one.' };
  return {
    key: limit,
    kind: 'level',
    pct,
    aria: `${long} limit used`,
    countdown: countdown || undefined,
    tooltip,
    label: long,
  };
}

function sessionCell(ctx: ContextUsage | null): Cell {
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

/** The trailing window a rate is measured over: "30 min", "2 h". */
function windowLabel(key: LimitKey): string {
  const minutes = BURN_WINDOW_MS[key] / 60_000;
  return minutes < 60 ? `${minutes} min` : `${minutes / 60} h`;
}

/** A limit's burn as a tooltip row: its rate over its window, then where
 *  that pace takes it (on a second line). */
function burnRow(limit: LimitKey, burn: Burn | null | undefined) {
  const label = LIMIT_LABELS[limit];
  if (!burn) return { label, value: 'Not rising, or too few readings yet' };
  return {
    label,
    value: `${formatRate(burn.perHour)} over the last ${windowLabel(limit)}\n${formatProjection(burn)}`,
  };
}

/** The most pressing limit's burn, "+6%/h", coloured by its outlook; both
 *  limits in the tooltip. */
function burnCell(burns: LimitBurns, burn: Burn): Cell {
  const rows = (Object.keys(LIMIT_LABELS) as LimitKey[])
    .filter((k) => k in burns)
    .map((k) => burnRow(k, burns[k]));
  return {
    key: 'burn',
    kind: 'burn',
    rate: formatRate(burn.perHour),
    outlook: burnOutlook(burn),
    label: 'Burn',
    tooltip: {
      title: 'Burn rate',
      body: `Green: the limit resets first. Amber: ${CLOSE_AT_PCT}% or more by the reset. Red: the limit comes first.`,
      rows,
    },
  };
}

/**
 * The top of the task sidebar: the session's context use, the account's
 * 5-hour and weekly limits as rings, and (opt-in, once there's a rate, D33)
 * how fast the limits are being used.
 */
export function UsageSection({ contextUsage, rateLimits, burns }: UsageSectionProps) {
  const showSession = useSettings((s) => s.showUsageInline);
  const showLimits = useSettings((s) => s.showRateLimits);
  const showBurn = useSettings((s) => s.showBurnRate);
  const now = useMinuteClock();

  // Both limits show once the account reports either: a window that isn't
  // running (it reset, and no message has started the next) reads "—".
  const limits = showLimits ? rateLimits : undefined;
  const pressing = showBurn && limits ? pressingBurn(burns) : null;
  const ctx = contextUsage && contextUsage.percentage > 0 ? contextUsage : null;

  const cells: Cell[] = [];
  if (showSession) cells.push(sessionCell(ctx));
  if (limits) {
    cells.push(limitCell('fiveHour', limits.fiveHour, now));
    cells.push(limitCell('sevenDay', limits.sevenDay, now));
  }
  if (pressing) cells.push(burnCell(burns, pressing.burn));

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
          'relative grid items-start justify-center gap-x-2 pt-4 pb-4',
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
