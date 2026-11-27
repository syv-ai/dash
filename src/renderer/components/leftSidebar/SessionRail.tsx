import type { ContextUsage } from '../../../shared/types';
import { quietUsageColor } from '../../lib/usageColor';
import { useSettings } from '../../stores/settingsStore';
import { levelCells } from '../rightInspector/UsageSection';
import { ProgressRing } from '../ui/ProgressRing';
import { RailItem } from '../ui/Rail';
import { StatusDot } from '../ui/StatusDot';
import { railInitials } from './railInitials';
import { STATE_LABELS, type TaskStateRow } from './taskStates';

/** A session's ring (px): room for its dot inside, the rail's width around it. */
const RING_PX = 20;
const RING_STROKE_PX = 2;

/**
 * The app sidebar collapsed: its live sessions, in the Tasks view's order,
 * each its state dot inside a ring of its context use and its initials
 * under them (`railInitials`), so a session is known without its name. The
 * ring reads as a task row's context does (`ContextLevel`): the Session
 * level (`levelCells`, so the figures never disagree), in plain ink until it
 * nears full (`quietUsageColor`; green would read as the session's state),
 * just the track until the session has replied or while the setting hides
 * it. The tooltip names the task, its project, state and context; a click
 * selects it.
 */
export function SessionRail({
  rows,
  activeTaskId,
  contextUsage,
  onSelectTask,
}: {
  /** The live sessions, top to bottom. */
  rows: TaskStateRow[];
  activeTaskId: string | null;
  contextUsage?: Record<string, ContextUsage>;
  onSelectTask: (projectId: string, taskId: string) => void;
}) {
  const showSession = useSettings((s) => s.showUsageInline);
  const initials = railInitials(rows.map((r) => r.task));
  return (
    // The thin scrollbar's 3px gutter is always kept on the right; the same
    // on the left keeps the sessions centred under the foot's buttons.
    <div className="scrollbar-thin-hover flex min-h-0 w-full flex-1 flex-col items-center gap-1 overflow-y-auto pr-0.5 pl-1.25">
      {rows.map(({ task, state, reason, projectName }) => {
        const [cell] = levelCells({
          contextUsage: contextUsage?.[task.id],
          showSession,
          showLimits: false,
          now: 0,
        });
        const pct = cell?.pct ?? null;
        const label = STATE_LABELS[state];
        return (
          <RailItem
            key={task.id}
            side="right"
            aria-label={`${task.name}: ${label}`}
            pressed={task.id === activeTaskId}
            onClick={() => onSelectTask(task.projectId, task.id)}
            tooltip={{
              title: task.name,
              ...(reason ? { body: reason } : {}),
              rows: [
                ...(projectName ? [{ label: 'Project', value: projectName }] : []),
                { label: 'State', value: label },
                ...(pct !== null ? [{ label: 'Context', value: `${pct}%` }] : []),
              ],
            }}
          >
            <ProgressRing
              value={pct}
              size={RING_PX}
              stroke={RING_STROKE_PX}
              color={pct === null ? undefined : quietUsageColor(pct)}
              aria-label={cell?.aria ?? 'Session context used'}
            >
              <StatusDot state={state} className="block" />
            </ProgressRing>
            <span className="type-caption">{initials.get(task.id)}</span>
          </RailItem>
        );
      })}
    </div>
  );
}
