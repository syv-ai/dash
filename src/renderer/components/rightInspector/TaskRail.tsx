import { FileDiff, GitPullRequestArrow, Info, Terminal } from 'lucide-react';
import type { ContextUsage, GitStatus, RateLimits } from '../../../shared/types';
import { useMinuteClock } from '../../hooks/useMinuteClock';
import { getBindingKeys } from '../../keybindings';
import { useSettings } from '../../stores/settingsStore';
import { SyncArrowsStacked, syncSentence } from '../changes/SyncStatus';
import { plural } from '../review/labels';
import { CountBadge } from '../ui/CountBadge';
import { IconButton } from '../ui/IconButton';
import { Rail, RailItem } from '../ui/Rail';
import { LevelReading, levelCells } from './UsageSection';
import { RAIL_SHOW, railParts, type RailShow, type RailTarget } from './rail';

/** The PRs from and into the branch, as the rail counts them, and the
 *  branch's own PR with its unresolved threads (0: no badge). */
interface RailPrs {
  count: number;
  own: { number: number; threads: number } | null;
}

/**
 * The task sidebar collapsed: a rail of what it would show at a glance, top
 * to bottom: the usage row's levels, the session's context and the account's
 * limits (their percent, coloured by use; the rest in their tooltips), how far the branch and its upstream have moved apart
 * ("↑3" over "↓1"), the changed files and the PRs (badged with the unresolved
 * threads on the branch's own); at its foot, Details and the terminal. A
 * click shows the sidebar narrow (`RAIL_SHOW`): ahead/behind on History, the
 * changes on Files, the PRs on PRs, Details on Details, the terminal and the
 * rail's own space as it was, the terminal opened and focused. A limit only
 * has its tooltip.
 */
export function TaskRail({
  contextUsage,
  rateLimits,
  status,
  prs,
  onShow,
}: {
  /** The task session's context window use; absent until its first reply. */
  contextUsage?: ContextUsage;
  /** The account's limits; undefined until a session reports one. */
  rateLimits?: RateLimits;
  /** The task's git status; null until loaded. */
  status: GitStatus | null;
  /** The PRs; null in review mode, or with none from or into the branch. */
  prs: RailPrs | null;
  /** Show the sidebar narrow, as `show` says. */
  onShow: (show: RailShow) => void;
}) {
  const showSession = useSettings((s) => s.showUsageInline);
  const showLimits = useSettings((s) => s.showRateLimits);
  const toggleBinding = useSettings((s) => s.keybindings.toggleInspector);
  const now = useMinuteClock();
  const levels = levelCells({ contextUsage, rateLimits, showSession, showLimits, now });
  const parts = railParts(status);
  const show = (target: RailTarget) => () => onShow(RAIL_SHOW[target]);

  return (
    <Rail
      label="Show task sidebar"
      tooltip={{
        title: 'Show task sidebar',
        shortcut: toggleBinding && getBindingKeys(toggleBinding),
      }}
      onClick={show('space')}
      footer={
        <>
          <IconButton title="Details" onClick={show('details')}>
            <Info size={14} strokeWidth={1.8} />
          </IconButton>
          <IconButton title="Terminal" onClick={show('terminal')}>
            <Terminal size={14} strokeWidth={1.8} />
          </IconButton>
        </>
      }
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
      {prs && (
        <RailItem
          aria-label={`${plural(prs.count, 'pull request')}: show PRs`}
          tooltip={{
            icon: GitPullRequestArrow,
            title: `${plural(prs.count, 'pull request')} from or into this branch`,
            rows:
              prs.own && prs.own.threads > 0
                ? [{ label: `Unresolved on #${prs.own.number}`, value: prs.own.threads }]
                : undefined,
            body: 'Click to show PRs.',
          }}
          onClick={show('pr')}
        >
          <GitPullRequestArrow size={14} strokeWidth={1.8} className="text-icon" aria-hidden />
          <span className="type-body flex items-center gap-0.5 tabular-nums">
            {prs.count}
            {prs.own && prs.own.threads > 0 && (
              <CountBadge count={prs.own.threads} tone="outline" />
            )}
          </span>
        </RailItem>
      )}
    </Rail>
  );
}
