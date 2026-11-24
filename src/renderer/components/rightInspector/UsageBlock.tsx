import type { ContextUsage, RateLimitInfo, RateLimits } from '../../../shared/types';
import { formatResetTime, formatTokens } from '../../utils/format';
import {
  BURN_WINDOW_MS,
  formatEta,
  formatRate,
  type Burn,
  type LimitBurns,
  type LimitKey,
} from '../../lib/burnRate';
import { useSettings } from '../../stores/settingsStore';
import { Meter, meterToneText, usageTone } from '../ui/Meter';
import { Tooltip } from '../ui/Tooltip';
import { cn } from '../../lib/cn';

interface UsageBlockProps {
  /** The task session's context window use; absent until its first reply. */
  contextUsage?: ContextUsage;
  rateLimits: RateLimits;
  burns: LimitBurns;
}

/** "5-hour 2%", tinted past the usage tiers, with the reset time on hover. */
function Limit({ label, info }: { label: string; info: RateLimitInfo }) {
  const pct = Math.round(info.usedPercentage);
  const tone = usageTone(pct);
  const resets = info.resetsAt ? formatResetTime(info.resetsAt) : '';
  return (
    <Tooltip content={resets ? `${label} limit resets ${resets}` : `${label} limit`}>
      <span>
        {label}
        <span
          className={cn(
            'ml-1 font-medium tabular-nums',
            tone === 'neutral' ? 'text-ink-2' : meterToneText[tone],
          )}
        >
          {pct}%
        </span>
      </span>
    </Tooltip>
  );
}

const BURN_LABELS: Record<LimitKey, { short: string; long: string }> = {
  fiveHour: { short: '5h', long: '5-hour' },
  sevenDay: { short: 'Wk', long: 'Weekly' },
};

/** The trailing window a rate is measured over: "30 min", "2 h". */
function windowLabel(key: LimitKey): string {
  const minutes = BURN_WINDOW_MS[key] / 60_000;
  return minutes < 60 ? `${minutes} min` : `${minutes / 60} h`;
}

/** "5h +6%/h · limit in ~9h", or "5h —" while there's too little data. */
function BurnRate({ limit, burn }: { limit: LimitKey; burn: Burn | null }) {
  const { short, long } = BURN_LABELS[limit];
  const tooltip = !burn
    ? `${long} limit: not rising, or too few readings yet`
    : `${long} limit: ${formatRate(burn.perHour)} over the last ${windowLabel(limit)}; ${
        burn.toLimitMs === null
          ? 'it resets before reaching 100 % at this pace'
          : `100 % in ${formatEta(burn.toLimitMs)} at this pace`
      }`;
  return (
    <Tooltip content={tooltip}>
      <span className="whitespace-nowrap">
        {short}
        <span className="ml-1 font-medium text-ink-2 tabular-nums">
          {burn ? formatRate(burn.perHour) : '—'}
        </span>
        {burn &&
          (burn.toLimitMs === null
            ? ' · resets first'
            : ` · limit in ${formatEta(burn.toLimitMs)}`)}
      </span>
    </Tooltip>
  );
}

/**
 * The foot of the task sidebar: the session's context use, prominent, then
 * the account's 5-hour and weekly limits and how fast they are being used.
 */
export function UsageBlock({ contextUsage, rateLimits, burns }: UsageBlockProps) {
  const showSession = useSettings((s) => s.showUsageInline);
  const showLimits = useSettings((s) => s.showRateLimits);

  const fiveHour = showLimits ? rateLimits.fiveHour : undefined;
  const weekly = showLimits ? rateLimits.sevenDay : undefined;
  if (!showSession && !fiveHour && !weekly) return null;

  const ctx = contextUsage && contextUsage.percentage > 0 ? contextUsage : null;
  const pct = ctx ? Math.round(ctx.percentage) : 0;
  const tone = usageTone(pct);

  return (
    <div className="grid shrink-0 gap-2 px-1.5 pt-3 pb-3">
      {showSession && (
        <Tooltip
          content={
            ctx
              ? `Context used by this task's Claude session: ${formatTokens(ctx.used)} of ${formatTokens(ctx.total)}`
              : "Context used by this task's Claude session, once it has replied"
          }
        >
          <div className="grid gap-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm text-ink-2">Session</span>
              <span
                className={cn(
                  'text-lg font-semibold tabular-nums',
                  ctx ? meterToneText[tone] : 'text-ink-3',
                )}
              >
                {ctx ? `${pct}%` : '—'}
              </span>
            </div>
            <Meter value={pct} tone={tone} aria-label="Session context used" />
          </div>
        </Tooltip>
      )}
      {(fiveHour || weekly) && (
        <div className="flex gap-4 text-sm text-ink-3">
          {fiveHour && <Limit label="5-hour" info={fiveHour} />}
          {weekly && <Limit label="Weekly" info={weekly} />}
        </div>
      )}
      {(fiveHour || weekly) && (
        // Wraps in a narrow sidebar rather than clipping the projection.
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-3">
          <span>Burn</span>
          {fiveHour && <BurnRate limit="fiveHour" burn={burns.fiveHour ?? null} />}
          {weekly && <BurnRate limit="sevenDay" burn={burns.sevenDay ?? null} />}
        </div>
      )}
    </div>
  );
}
