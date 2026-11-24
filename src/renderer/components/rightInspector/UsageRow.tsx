import { TrendingUp } from 'lucide-react';
import type { ContextUsage, RateLimitInfo, RateLimits } from '../../../shared/types';
import { formatResetTime, formatTokens } from '../../utils/format';
import {
  BURN_WINDOW_MS,
  formatEta,
  formatRate,
  pressingBurn,
  type Burn,
  type LimitBurns,
  type LimitKey,
} from '../../lib/burnRate';
import { useSettings } from '../../stores/settingsStore';
import { Meter, meterToneText, usageTone } from '../ui/Meter';
import { Tooltip } from '../ui/Tooltip';
import { cn } from '../../lib/cn';

interface UsageRowProps {
  /** The task session's context window use; absent until its first reply. */
  contextUsage?: ContextUsage;
  rateLimits: RateLimits;
  burns: LimitBurns;
}

const LIMIT_LABELS: Record<LimitKey, { short: string; long: string }> = {
  fiveHour: { short: '5h', long: '5-hour' },
  sevenDay: { short: 'Wk', long: 'Weekly' },
};

/*
 * The row degrades by its own width (`@container/usage`), never wrapping:
 * below 24rem the inline meters go, below 18rem the limits' labels shorten
 * ("5-hour" → "5h"), below 14rem the burn goes, below 12rem the "Session"
 * label (its number stays first and largest). Details live in tooltips.
 */
const meterCls = 'w-10 @max-[24rem]/usage:hidden';

/** "5-hour 12%" with a tiny meter, tinted past the usage tiers. */
function Limit({ limit, info }: { limit: LimitKey; info: RateLimitInfo }) {
  const { short, long } = LIMIT_LABELS[limit];
  const pct = Math.round(info.usedPercentage);
  const tone = usageTone(pct);
  const resets = info.resetsAt ? formatResetTime(info.resetsAt) : '';
  return (
    <Tooltip content={`${long} limit: ${pct}% used${resets ? `, resets ${resets}` : ''}`}>
      <span className="flex shrink-0 items-center gap-1.5">
        <span>
          <span className="@max-[18rem]/usage:hidden">{long}</span>
          <span className="hidden @max-[18rem]/usage:inline">{short}</span>
        </span>
        <span
          className={cn(
            'font-medium tabular-nums',
            tone === 'neutral' ? 'text-ink-2' : meterToneText[tone],
          )}
        >
          {pct}%
        </span>
        <Meter value={pct} tone={tone} className={meterCls} />
      </span>
    </Tooltip>
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

/** The most pressing limit's burn, "↗ +6%/h"; both limits in the tooltip. */
function BurnRate({ burns }: { burns: LimitBurns }) {
  const pressing = pressingBurn(burns);
  if (!pressing) return null;
  const lines = (Object.keys(LIMIT_LABELS) as LimitKey[])
    .filter((k) => k in burns)
    .map((k) => burnLine(k, burns[k]));
  return (
    <Tooltip content={`Burn rate. ${lines.join('. ')}.`}>
      <span className="flex shrink-0 items-center gap-1 @max-[14rem]/usage:hidden">
        <TrendingUp size={14} strokeWidth={1.8} />
        <span className="font-medium tabular-nums text-ink-2">
          {formatRate(pressing.burn.perHour)}
        </span>
      </span>
    </Tooltip>
  );
}

/**
 * One row at the top of the task sidebar: the session's context use, first
 * and largest, then the account's 5-hour and weekly limits, then (opt-in,
 * once there's a rate) how fast they're being used.
 */
export function UsageRow({ contextUsage, rateLimits, burns }: UsageRowProps) {
  const showSession = useSettings((s) => s.showUsageInline);
  const showLimits = useSettings((s) => s.showRateLimits);
  const showBurn = useSettings((s) => s.showBurnRate);

  const fiveHour = showLimits ? rateLimits.fiveHour : undefined;
  const weekly = showLimits ? rateLimits.sevenDay : undefined;
  if (!showSession && !fiveHour && !weekly) return null;

  const ctx = contextUsage && contextUsage.percentage > 0 ? contextUsage : null;
  const pct = ctx ? Math.round(ctx.percentage) : 0;
  const tone = usageTone(pct);

  return (
    <div className="@container/usage shrink-0 pl-2.5 pr-1">
      <div className="flex h-11 items-center gap-3 overflow-hidden whitespace-nowrap text-sm text-ink-3">
        {showSession && (
          <Tooltip
            content={
              ctx
                ? `Context used by this task's Claude session: ${formatTokens(ctx.used)} of ${formatTokens(ctx.total)}`
                : "Context used by this task's Claude session, once it has replied"
            }
          >
            <span className="flex shrink-0 items-center gap-1.5">
              <span className="text-ink-2 @max-[12rem]/usage:hidden">Session</span>
              <span
                className={cn(
                  'text-base font-semibold tabular-nums',
                  ctx ? meterToneText[tone] : 'text-ink-3',
                )}
              >
                {ctx ? `${pct}%` : '—'}
              </span>
              <Meter
                value={pct}
                tone={tone}
                aria-label="Session context used"
                className={meterCls}
              />
            </span>
          </Tooltip>
        )}
        {fiveHour && <Limit limit="fiveHour" info={fiveHour} />}
        {weekly && <Limit limit="sevenDay" info={weekly} />}
        {showBurn && (fiveHour || weekly) && <BurnRate burns={burns} />}
      </div>
    </div>
  );
}
