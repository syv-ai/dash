import type { ContextUsage } from '../../../shared/types';
import { ProgressRing } from '../ui/ProgressRing';
import { Tooltip } from '../ui/Tooltip';
import { levelCells } from '../rightInspector/UsageSection';
import { usageColor } from '../../lib/usageColor';
import { useSettings } from '../../stores/settingsStore';

/**
 * A live task's session context as a 14px ring at its row's end: the right
 * sidebar's Session level (`levelCells`, so the figures never disagree), its
 * colour ramp, and the same rich tooltip with the percent and tokens.
 * Nothing until the session has replied, or while the setting hides the
 * session level.
 */
export function ContextRing({ usage }: { usage: ContextUsage | undefined }) {
  const showSession = useSettings((s) => s.showUsageInline);
  const [cell] = levelCells({ contextUsage: usage, showSession, showLimits: false, now: 0 });
  if (!cell || cell.pct === null) return null;
  return (
    <Tooltip content={cell.tooltip}>
      <span className="flex">
        <ProgressRing
          value={cell.pct}
          size={14}
          stroke={2}
          color={usageColor(cell.pct)}
          aria-label={cell.aria}
          valueText={`${cell.pct}%`}
        />
      </span>
    </Tooltip>
  );
}
