import { FileDiff } from 'lucide-react';
import type { ContextUsage, GitStatus, RateLimits } from '../../../shared/types';
import { useMinuteClock } from '../../hooks/useMinuteClock';
import { getBindingKeys } from '../../keybindings';
import { useSettings } from '../../stores/settingsStore';
import { SyncArrowsStacked, syncSentence } from '../changes/SyncStatus';
import { Rail, RailItem } from '../ui/Rail';
import { LevelReading, levelCells } from './UsageSection';
import { RAIL_VIEW, railParts, type RailTarget } from './rail';
import type { CodeSegment } from './sidebarState';

/**
 * The task sidebar collapsed: a rail of what it would show at a glance, top
 * to bottom: the usage row's levels, the session's context and the account's
 * limits (their percent, coloured by use; the rest in their tooltips), how far the branch and its upstream have moved apart
 * ("↑3" over "↓1") and the changed files. A click shows the sidebar narrow:
 * ahead/behind on History, the changes on Files, the rail's own space as it
 * was (`RAIL_VIEW`); a limit only has its tooltip.
 */
export function TaskRail({
  contextUsage,
  rateLimits,
  status,
  onShow,
}: {
  /** The task session's context window use; absent until its first reply. */
  contextUsage?: ContextUsage;
  /** The account's limits; undefined until a session reports one. */
  rateLimits?: RateLimits;
  /** The task's git status; null until loaded. */
  status: GitStatus | null;
  /** Show the sidebar narrow, on `view` (null: the view it has). */
  onShow: (view: CodeSegment | null) => void;
}) {
  const showSession = useSettings((s) => s.showUsageInline);
  const showLimits = useSettings((s) => s.showRateLimits);
  const toggleBinding = useSettings((s) => s.keybindings.toggleInspector);
  const now = useMinuteClock();
  const levels = levelCells({ contextUsage, rateLimits, showSession, showLimits, now });
  const parts = railParts(status);
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
      {levels.map((cell) => (
        <RailItem key={cell.key} tooltip={cell.tooltip}>
          <LevelReading cell={cell} />
          <span className="type-caption">{cell.label}</span>
        </RailItem>
      ))}
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
