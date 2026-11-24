import type { ReactNode } from 'react';
import type { ContextUsage, RateLimitInfo, RateLimits } from '../../../shared/types';
import { formatResetAt, formatResetTime, formatTokens } from '../../utils/format';
import {
  BURN_WINDOW_MS,
  formatEta,
  formatRate,
  pressingBurn,
  type Burn,
  type LimitBurns,
  type LimitKey,
} from '../../lib/burnRate';
import { usageColor } from '../../lib/usageColor';
import { useMinuteClock } from '../../hooks/useMinuteClock';
import { useSettings } from '../../stores/settingsStore';
import { ProgressRing } from '../ui/ProgressRing';
import { Tooltip } from '../ui/Tooltip';
import { cn } from '../../lib/cn';

interface UsageSectionProps {
  /** The task session's context window use; absent until its first reply. */
  contextUsage?: ContextUsage;
  /** The account's limits; undefined until a session reports one. */
  rateLimits?: RateLimits;
  burns: LimitBurns;
}

const LIMIT_LABELS: Record<LimitKey, { short: string; long: string }> = {
  fiveHour: { short: '5h', long: '5-hour' },
  sevenDay: { short: 'Wk', long: 'Weekly' },
};

/*
 * Fixed-width columns, centred as a group with a fixed gap, each a ring (or
 * the burn's figure) over a short label: an expanded sidebar leaves them where
 * they are instead of spreading them apart. Narrower than the group, the
 * columns shrink alike. The section degrades by its own width
 * (`@container/usage`), never wrapping or overflowing: below 15rem the
 * rings shrink, their "%" goes and the labels shorten ("5-hour" → "5h").
 * A limit's reset countdown is one line that drops its "resets" when its
 * column is too narrow for it. Details (the exact reset time) live in
 * tooltips.
 */
const COLUMNS = [
  'grid-cols-[minmax(0,6rem)]',
  'grid-cols-[repeat(2,minmax(0,6rem))]',
  'grid-cols-[repeat(3,minmax(0,6rem))]',
  'grid-cols-[repeat(4,minmax(0,6rem))]',
];

/** One column: the figure on top, its label below, then any caption. */
function Item({
  tooltip,
  label,
  caption,
  children,
}: {
  tooltip: string;
  label: ReactNode;
  caption?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Tooltip content={tooltip}>
      <div className="flex min-w-0 flex-col items-center gap-1">
        {children}
        <span className="flex w-full flex-col items-center">
          <span className="max-w-full truncate type-caption text-ink-2">{label}</span>
          {caption}
        </span>
      </div>
    </Tooltip>
  );
}

/** When a limit's window resets, under its label: "resets in 3h 12m", one
 *  line; "in 3h 12m" once its column is too narrow for that. */
function ResetCaption({ countdown }: { countdown: string }) {
  return (
    <span className="@container/reset w-full">
      <span className="block truncate text-center type-caption tabular-nums">
        <span className="@max-[5.5rem]/reset:hidden">resets </span>
        {countdown}
      </span>
    </span>
  );
}

/** A usage ring with its percent inside, coloured by how close it is to full. */
function UsageRing({ pct, label }: { pct: number | null; label: string }) {
  return (
    <ProgressRing
      value={pct}
      size={44}
      stroke={4}
      color={pct === null ? undefined : usageColor(pct)}
      aria-label={label}
      className="@max-[15rem]/usage:size-8"
    >
      <span
        className={cn(
          'text-sm font-semibold tabular-nums',
          '@max-[15rem]/usage:text-xs',
          pct === null ? 'text-ink-3' : 'text-ink',
        )}
      >
        {pct === null ? (
          '—'
        ) : (
          <>
            {pct}
            <span className="@max-[15rem]/usage:hidden">%</span>
          </>
        )}
      </span>
    </ProgressRing>
  );
}

function Limit({
  limit,
  info,
  now,
}: {
  limit: LimitKey;
  info: RateLimitInfo | undefined;
  /** The minute clock the countdown reads against. */
  now: number;
}) {
  const { short, long } = LIMIT_LABELS[limit];
  const pct = info ? Math.round(info.usedPercentage) : null;
  const resetsAt = info?.resetsAt ?? 0;
  const countdown = formatResetTime(resetsAt, now);
  const tooltip = info
    ? `${long} limit: ${pct}% used${countdown ? `, resets ${formatResetAt(resetsAt)} (${countdown})` : ''}`
    : `${long} limit: no window running; the next message starts one`;
  return (
    <Item
      tooltip={tooltip}
      caption={countdown && <ResetCaption countdown={countdown} />}
      label={
        <>
          <span className="@max-[15rem]/usage:hidden">{long}</span>
          <span className="hidden @max-[15rem]/usage:inline">{short}</span>
        </>
      }
    >
      <UsageRing pct={pct} label={`${long} limit used`} />
    </Item>
  );
}

/** The trailing window a rate is measured over: "30 min", "2 h". */
function windowLabel(key: LimitKey): string {
  const minutes = BURN_WINDOW_MS[key] / 60_000;
  return minutes < 60 ? `${minutes} min` : `${minutes / 60} h`;
}

function burnLine(limit: LimitKey, burn: Burn | null | undefined): string {
  const { long } = LIMIT_LABELS[limit];
  if (!burn) return `${long}: not rising, or too few readings yet`;
  const eta =
    burn.toLimitMs === null
      ? 'resets before reaching 100 % at this pace'
      : `100 % in ${formatEta(burn.toLimitMs)} at this pace`;
  return `${long}: ${formatRate(burn.perHour)} over the last ${windowLabel(limit)}; ${eta}`;
}

/** The most pressing limit's burn, "+6%/h", in a ring-sized box; both limits in the tooltip. */
function BurnRate({ burns, burn }: { burns: LimitBurns; burn: Burn }) {
  const lines = (Object.keys(LIMIT_LABELS) as LimitKey[])
    .filter((k) => k in burns)
    .map((k) => burnLine(k, burns[k]));
  return (
    <Item tooltip={`Burn rate. ${lines.join('. ')}.`} label="Burn">
      <span
        className={cn(
          'grid size-11 place-items-center text-sm font-semibold tabular-nums text-ink',
          '@max-[15rem]/usage:size-8 @max-[15rem]/usage:text-xs',
        )}
      >
        {formatRate(burn.perHour)}
      </span>
    </Item>
  );
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

  const items: ReactNode[] = [];
  if (showSession) {
    items.push(
      <Item
        key="session"
        tooltip={
          ctx
            ? `Context used by this task's Claude session: ${formatTokens(ctx.used)} of ${formatTokens(ctx.total)}`
            : "Context used by this task's Claude session, once it has replied"
        }
        label="Session"
      >
        <UsageRing pct={ctx ? Math.round(ctx.percentage) : null} label="Session context used" />
      </Item>,
    );
  }
  if (limits) {
    items.push(<Limit key="fiveHour" limit="fiveHour" info={limits.fiveHour} now={now} />);
    items.push(<Limit key="sevenDay" limit="sevenDay" info={limits.sevenDay} now={now} />);
  }
  if (pressing) items.push(<BurnRate key="burn" burns={burns} burn={pressing.burn} />);
  if (items.length === 0) return null;

  return (
    <div className="@container/usage shrink-0 px-1">
      <div
        className={cn(
          'grid items-start justify-center gap-x-2 pt-3 pb-2',
          COLUMNS[items.length - 1],
        )}
      >
        {items}
      </div>
    </div>
  );
}
