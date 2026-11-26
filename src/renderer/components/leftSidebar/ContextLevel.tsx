import type { ContextUsage } from '../../../shared/types';
import { Tooltip } from '../ui/Tooltip';
import { LevelReading, levelCells } from '../rightInspector/UsageSection';
import { useSettings } from '../../stores/settingsStore';

/**
 * A live task's session context as its percent at the row's end: the right
 * sidebar's Session level (`levelCells`, so the figures never disagree) read
 * as the narrow limits row reads it (`LevelReading`, coloured by how full it
 * is), a size down for a list row, with the same rich tooltip (percent,
 * tokens). The card sets the column it sits in. Nothing until the session
 * has replied, or while the setting hides the session level.
 */
export function ContextLevel({ usage }: { usage: ContextUsage | undefined }) {
  const showSession = useSettings((s) => s.showUsageInline);
  const [cell] = levelCells({ contextUsage: usage, showSession, showLimits: false, now: 0 });
  if (!cell || cell.pct === null) return null;
  return (
    <Tooltip content={cell.tooltip}>
      <span className="flex">
        <LevelReading cell={cell} size="sm" />
      </span>
    </Tooltip>
  );
}
