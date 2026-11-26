import { useState, type ReactNode } from 'react';
import { FolderPlus, Power } from 'lucide-react';
import type { Project, Task } from '../../../shared/types';
import { ListRow } from '../ui/ListRow';
import { StatusDot, type AgentState } from '../ui/StatusDot';
import { EmptyState } from '../ui/EmptyState';
import { Button } from '../ui/Button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '../ui/ContextMenu';
import { TaskMenuItems, onTaskMenuCloseAutoFocus, type MenuParts } from '../task/TaskMenuItems';
import { hasLiveSession } from '../task/TaskActions';
import { openInIde } from '../../lib/openInIde';
import { useRuntime } from '../../stores/runtimeStore';
import {
  IDLE_LIMIT,
  STATE_LABELS,
  isAtRest,
  visibleIdleRows,
  type TaskStateList as Rows,
  type TaskStateRow,
} from './taskStates';

const CONTEXT_PARTS: MenuParts = { Item: ContextMenuItem, Separator: ContextMenuSeparator };

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
  onOpenFolder: () => void;
}

/**
 * The left sidebar's default view: every task across projects, by state.
 * Each row names its project, faint at the end. Needs-you and failed rows
 * say why on a second line; idle rows follow a gap,
 * dimmed and capped, with More / Less for the rest. Right-click opens the
 * task menu.
 */
export function TaskStateList({
  rows,
  projects,
  activeTaskId,
  onOpenFolder,
  ...actions
}: TaskStateListProps) {
  const [showAllIdle, setShowAllIdle] = useState(false);
  const idle = visibleIdleRows(rows.idle, showAllIdle, activeTaskId);
  const hiddenIdle = rows.idle.length - idle.length;

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
  if (rows.active.length === 0 && rows.idle.length === 0) {
    return <EmptyState title="No tasks yet" />;
  }

  const projectPath = (task: Task) => projects.find((p) => p.id === task.projectId)?.path;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-2 pt-1 pb-3">
      {rows.active.map((row) => (
        <TaskStateRowItem
          key={row.task.id}
          row={row}
          selected={row.task.id === activeTaskId}
          projectPath={projectPath(row.task)}
          {...actions}
        />
      ))}
      {rows.active.length > 0 && idle.length > 0 && <div className="h-4 shrink-0" />}
      {idle.map((row) => (
        <TaskStateRowItem
          key={row.task.id}
          row={row}
          selected={row.task.id === activeTaskId}
          projectPath={projectPath(row.task)}
          {...actions}
        />
      ))}
      {rows.idle.length > IDLE_LIMIT && (
        <ListRow
          dimmed
          size="sm"
          leading={<StatusDot state="asleep" />}
          onClick={() => setShowAllIdle((v) => !v)}
        >
          {showAllIdle ? 'Less' : `More (${hiddenIdle})`}
        </ListRow>
      )}
    </div>
  );
}

function TaskStateRowItem({
  row,
  selected,
  projectPath,
  onSelectTask,
  onCloseTask,
  onTaskSettings,
  onArchiveTask,
  onDeleteTask,
}: TaskRowActions & { row: TaskStateRow; selected: boolean; projectPath?: string }) {
  const { task, state, reason, projectName } = row;
  const activityState = useRuntime((s) => s.taskActivity[task.id]?.state);
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <ListRow
          selected={selected}
          dimmed={isAtRest(state)}
          leading={<StatusDot state={state} label={STATE_LABELS[state]} />}
          description={reason && <ReasonText state={state}>{reason}</ReasonText>}
          // The name truncates first; the project keeps up to 6rem.
          trailing={projectName && <span className="max-w-24 truncate">{projectName}</span>}
          onClick={() => onSelectTask(task.projectId, task.id)}
        >
          {task.name}
        </ListRow>
      </ContextMenuTrigger>
      <ContextMenuContent onCloseAutoFocus={onTaskMenuCloseAutoFocus}>
        {hasLiveSession(activityState) && (
          <>
            <ContextMenuItem onSelect={() => onCloseTask(task.id)}>
              <Power size={13} strokeWidth={1.8} />
              Put to sleep
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}
        <TaskMenuItems
          taskId={task.id}
          parts={CONTEXT_PARTS}
          onOpenIde={() => void openInIde(task.path || projectPath || '')}
          onSettings={() => onTaskSettings(task.id)}
          onArchive={() => onArchiveTask(task.id)}
          onDelete={() => onDeleteTask(task.id)}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** A reason line in its state's colour (needs amber, failed red). */
function ReasonText({ state, children }: { state: AgentState; children: ReactNode }) {
  return (
    <span className={state === 'fail' ? 'text-state-fail' : 'text-state-needs'}>{children}</span>
  );
}
