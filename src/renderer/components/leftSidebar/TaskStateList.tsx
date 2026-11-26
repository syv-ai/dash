import { useMemo, type ReactNode } from 'react';
import { FolderPlus } from 'lucide-react';
import type { ContextUsage, Project, Task } from '../../../shared/types';
import { Tree, TreeHeading, TreeRow, ownNode, type TreeRowContext } from '../ui/Tree';
import { HoverSwapSlot } from '../ui/HoverSwapSlot';
import { StatusDot, type AgentState } from '../ui/StatusDot';
import { EmptyState } from '../ui/EmptyState';
import { Button } from '../ui/Button';
import { FavoriteButton } from '../task/FavoriteButton';
import { TaskContextMenu } from '../task/TaskContextMenu';
import { openInIde } from '../../lib/openInIde';
import { useSettings } from '../../stores/settingsStore';
import {
  STATE_LABELS,
  isAtRest,
  taskGroups,
  type TaskStateList as Rows,
  type TaskStateRow,
} from './taskStates';
import { taskTreeRows, type TaskTreeRow } from './taskTree';
import { ContextLevel } from './ContextLevel';

export interface TaskRowActions {
  onSelectTask: (projectId: string, taskId: string) => void;
  onCloseTask: (id: string) => void;
  onTaskSettings: (id: string) => void;
  onArchiveTask: (id: string) => void;
  onDeleteTask: (id: string) => void;
}

interface TaskStateListProps extends TaskRowActions {
  rows: Rows;
  projects: Project[];
  activeTaskId: string | null;
  /** Each live task's session context (the right sidebar's Session level). */
  contextUsage?: Record<string, ContextUsage>;
  onOpenFolder: () => void;
}

/**
 * The left sidebar's default view: favourites first (any state), then every
 * live task across projects by state (`taskGroups`), and the sleeping ones
 * folded under "Inactive sessions", open or closed as last left. Each row
 * is two lines: the name, then its project (and why, for needs-you and
 * failed); a live one ends in its session's context percent. At-rest rows are
 * dimmed. Hover shows the favourite star; right-click opens the task menu.
 */
export function TaskStateList({
  rows: list,
  projects,
  activeTaskId,
  contextUsage,
  onOpenFolder,
  ...actions
}: TaskStateListProps) {
  const inactiveOpen = useSettings((s) => s.inactiveSessionsOpen);
  const setInactiveOpen = useSettings((s) => s.setInactiveSessionsOpen);
  const rows = useMemo(() => taskTreeRows(taskGroups(list), inactiveOpen), [list, inactiveOpen]);

  if (projects.length === 0) {
    return (
      <EmptyState
        icon={<FolderPlus size={14} strokeWidth={1.8} />}
        title="Add a project to start"
        action={
          <Button size="sm" variant="secondary" onClick={onOpenFolder}>
            Add project
          </Button>
        }
      />
    );
  }
  if (list.active.length === 0 && list.idle.length === 0) {
    return <EmptyState title="No tasks yet" />;
  }

  const projectPath = (task: Task) => projects.find((p) => p.id === task.projectId)?.path;

  return (
    <Tree
      aria-label="Tasks"
      rows={rows}
      nodeOf={ownNode}
      variant="sidebar"
      className="min-h-0 flex-1"
      isSelected={(r) => r.kind === 'task' && r.row.task.id === activeTaskId}
      onToggle={() => setInactiveOpen(!inactiveOpen)}
      estimateSize={estimate}
      renderRow={(r, ctx) => {
        if (r.kind === 'gap') return <div className="h-4" />;
        if (r.kind === 'heading') return <TreeHeading>{r.label}</TreeHeading>;
        if (r.kind === 'inactive') {
          return (
            <TreeRow ctx={ctx} dimmed size="sm" onActivate={() => setInactiveOpen(!inactiveOpen)}>
              {`Inactive sessions (${r.count})`}
            </TreeRow>
          );
        }
        return (
          <TaskStateRowItem
            row={r.row}
            ctx={ctx}
            usage={contextUsage?.[r.row.task.id]}
            projectPath={projectPath(r.row.task)}
            {...actions}
          />
        );
      }}
    />
  );
}

/** A row's height before it is measured: a task is two lines. */
function estimate(r: TaskTreeRow): number {
  if (r.kind === 'gap') return 16;
  if (r.kind === 'heading') return 28;
  if (r.kind === 'inactive') return 32;
  return 54;
}

function TaskStateRowItem({
  row,
  ctx,
  usage,
  projectPath,
  onSelectTask,
  onCloseTask,
  onTaskSettings,
  onArchiveTask,
  onDeleteTask,
}: TaskRowActions & {
  row: TaskStateRow;
  ctx: TreeRowContext;
  usage: ContextUsage | undefined;
  projectPath?: string;
}) {
  const { task, state, reason, projectName } = row;
  return (
    <TaskContextMenu
      taskId={task.id}
      onOpenIde={() => void openInIde(task.path || projectPath || '')}
      onSleep={() => onCloseTask(task.id)}
      onSettings={() => onTaskSettings(task.id)}
      onArchive={() => onArchiveTask(task.id)}
      onDelete={() => onDeleteTask(task.id)}
    >
      <TreeRow
        ctx={ctx}
        className="group/swap"
        dimmed={isAtRest(state)}
        strong={ctx.selected}
        leading={<StatusDot state={state} label={STATE_LABELS[state]} />}
        description={
          (projectName || reason) && (
            <>
              {projectName}
              {projectName && reason && ' · '}
              {reason && <ReasonText state={state}>{reason}</ReasonText>}
            </>
          )
        }
        trailing={
          <HoverSwapSlot
            rest={state !== 'asleep' && <ContextLevel usage={usage} />}
            actions={<FavoriteButton task={task} />}
          />
        }
        onActivate={() => onSelectTask(task.projectId, task.id)}
      >
        {task.name}
      </TreeRow>
    </TaskContextMenu>
  );
}

/** A reason line in its state's colour (needs purple, failed red). */
function ReasonText({ state, children }: { state: AgentState; children: ReactNode }) {
  return (
    <span className={state === 'fail' ? 'text-state-fail' : 'text-state-needs'}>{children}</span>
  );
}
