import { FileDiff } from 'lucide-react';
import type { GitStatus, RateLimits } from '../../../shared/types';
import { useMinuteClock } from '../../hooks/useMinuteClock';
import { getBindingKeys } from '../../keybindings';
import type { LimitKey } from '../../lib/pace';
import { useSettings } from '../../stores/settingsStore';
import { SyncArrowsStacked, syncSentence } from '../changes/SyncStatus';
import { Rail, RailItem } from '../ui/Rail';
import { LevelReading, LIMIT_LABELS, limitCell } from './UsageSection';
import { RAIL_VIEW, railParts, type RailTarget } from './rail';
import type { CodeSegment } from './sidebarState';

const LIMITS = Object.keys(LIMIT_LABELS) as LimitKey[];

/**
 * The task sidebar collapsed: a rail of what it would show at a glance, top
 * to bottom: the account's limits (their percent, coloured by use; the rest
 * in their tooltips), how far the branch and its upstream have moved apart
 * ("↑3" over "↓1") and the changed files. A click shows the sidebar narrow:
 * ahead/behind on History, the changes on Files, the rail's own space as it
 * was (`RAIL_VIEW`); a limit only has its tooltip.
 */
export function TaskRail({
  rateLimits,
  status,
  onShow,
}: {
  /** The account's limits; undefined until a session reports one. */
  rateLimits?: RateLimits;
  /** The task's git status; null until loaded. */
  status: GitStatus | null;
  /** Show the sidebar narrow, on `view` (null: the view it has). */
  onShow: (view: CodeSegment | null) => void;
}) {
  const showLimits = useSettings((s) => s.showRateLimits);
  const toggleBinding = useSettings((s) => s.keybindings.toggleInspector);
  const now = useMinuteClock();
  const parts = railParts({ limitsShown: showLimits && !!rateLimits, status });
  const show = (target: RailTarget) => () => onShow(RAIL_VIEW[target]);

  return (
    <Rail
      label="Show task sidebar"
      tooltip={{
        title: 'Show task sidebar',
        shortcut: toggleBinding && getBindingKeys(toggleBinding),
      }}
      onClick={show('space')}
    >
      {parts.limits &&
        LIMITS.map((key) => {
          const cell = limitCell(key, rateLimits?.[key], now);
          return (
            <RailItem key={key} tooltip={cell.tooltip}>
              <LevelReading cell={cell} />
              <span className="type-caption">{cell.label}</span>
            </RailItem>
          );
        })}
      {parts.sync && (
        <RailItem
          aria-label={`${syncSentence(parts.sync.ahead, parts.sync.behind)}: show History`}
          tooltip={{
            title: syncSentence(parts.sync.ahead, parts.sync.behind),
            body: 'Click to show History.',
          }}
          onClick={show('sync')}
        >
          <span className="type-body">
            <SyncArrowsStacked {...parts.sync} />
          </span>
        </RailItem>
      )}
      {parts.changes !== null && (
        <RailItem
          aria-label={`${parts.changes} changed: show Files`}
          tooltip={{
            title: `${parts.changes} changed ${parts.changes === 1 ? 'file' : 'files'}`,
            body: 'Click to show Files.',
          }}
          onClick={show('changes')}
        >
          <FileDiff size={14} strokeWidth={1.8} className="text-icon" aria-hidden />
          <span className="type-body tabular-nums">{parts.changes}</span>
        </RailItem>
      )}
    </Rail>
  );
}
