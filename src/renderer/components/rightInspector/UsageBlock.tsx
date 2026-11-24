import type { ContextUsage, RateLimitInfo, RateLimits } from '../../../shared/types';
import { formatResetTime, formatTokens } from '../../utils/format';
import { useSettings } from '../../stores/settingsStore';
import { Meter, meterToneText, usageTone } from '../ui/Meter';
import { Tooltip } from '../ui/Tooltip';
import { cn } from '../../lib/cn';

interface UsageBlockProps {
  /** The task session's context window use; absent until its first reply. */
  contextUsage?: ContextUsage;
  rateLimits: RateLimits;
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

/**
 * The foot of the task sidebar: the session's context use, prominent, then
 * the account's 5-hour and weekly limits.
 */
export function UsageBlock({ contextUsage, rateLimits }: UsageBlockProps) {
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
    </div>
  );
}
