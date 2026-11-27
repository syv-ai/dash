import type { ContextUsage } from '../../../shared/types';
import { Tooltip } from '../ui/Tooltip';
import { LevelText } from '../ui/LevelText';
import { LevelReading, levelCells } from '../rightInspector/UsageSection';
import { useSettings } from '../../stores/settingsStore';

/** The widest everyday reading: with `tabular-nums` every two-digit percent
 *  is this wide, so a column sized by it never moves as the figure changes. */
const TWO_DIGITS = '00%';

/**
 * A live task's session context as its percent at the row's end: the right
 * sidebar's Session level (`levelCells`, so the figures never disagree) read
 * as the narrow limits row reads it (`LevelReading`), a size down for a list
 * row and plain ink until it nears full (green would read as the session's
 * state), with the same rich tooltip (percent,
 * tokens). The card sets the column it sits in. Nothing until the session
 * has replied, or while the setting hides the session level, but always a
 * two-digit reading's room, so no row's name moves as a percent comes or
 * changes.
 */
export function ContextLevel({ usage }: { usage: ContextUsage | undefined }) {
  const showSession = useSettings((s) => s.showUsageInline);
  const [cell] = levelCells({ contextUsage: usage, showSession, showLimits: false, now: 0 });
  const reading = cell && cell.pct !== null && (
    <Tooltip content={cell.tooltip}>
      <span className="col-start-1 row-start-1 flex">
        <LevelReading cell={cell} size="sm" quiet />
      </span>
    </Tooltip>
  );
  // The reading over an unseen two-digit one in one cell: the wider sets
  // the width, right-aligned like the column.
  return (
    <span className="grid justify-items-end">
      <span aria-hidden className="invisible col-start-1 row-start-1 flex">
        <LevelText value={null} size="sm" aria-label="">
          {TWO_DIGITS}
        </LevelText>
      </span>
      {reading}
    </span>
  );
}
