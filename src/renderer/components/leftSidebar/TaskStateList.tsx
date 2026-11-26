import { useMemo, useState, type ReactNode } from 'react';
import { FolderPlus, Power } from 'lucide-react';
import type { Project, Task } from '../../../shared/types';
import { Tree, TreeRow, ownNode, type TreeRowContext } from '../ui/Tree';
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
  STATE_LABELS,
  isAtRest,
  type TaskStateList as Rows,
  type TaskStateRow,
} from './taskStates';
import { taskTreeRows, type TaskTreeRow } from './taskTree';

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
  rows: list,
  projects,
  activeTaskId,
  onOpenFolder,
  ...actions
}: TaskStateListProps) {
  const [showAllIdle, setShowAllIdle] = useState(false);
  const rows = useMemo(
    () => taskTreeRows(list, showAllIdle, activeTaskId),
    [list, showAllIdle, activeTaskId],
  );

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
      onToggle={() => {}}
      estimateSize={estimate}
      renderRow={(r, ctx) => {
        if (r.kind === 'gap') return <div className="h-4" />;
        if (r.kind === 'more') {
          return (
            <TreeRow
              ctx={ctx}
              dimmed
              size="sm"
              leading={<StatusDot state="asleep" />}
              onActivate={() => setShowAllIdle((v) => !v)}
            >
              {r.expanded ? 'Less' : `More (${r.hidden})`}
            </TreeRow>
          );
        }
        return (
          <TaskStateRowItem
            row={r.row}
            ctx={ctx}
            projectPath={projectPath(r.row.task)}
            {...actions}
          />
        );
      }}
    />
  );
}

/** A row's height before it is measured: a reason adds a line. */
function estimate(r: TaskTreeRow): number {
  if (r.kind === 'gap') return 16;
  if (r.kind === 'more') return 32;
  return r.row.reason ? 54 : 36;
}

function TaskStateRowItem({
  row,
  ctx,
  projectPath,
  onSelectTask,
  onCloseTask,
  onTaskSettings,
  onArchiveTask,
  onDeleteTask,
}: TaskRowActions & { row: TaskStateRow; ctx: TreeRowContext; projectPath?: string }) {
  const { task, state, reason, projectName } = row;
  const activityState = useRuntime((s) => s.taskActivity[task.id]?.state);
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <TreeRow
          ctx={ctx}
          dimmed={isAtRest(state)}
          leading={<StatusDot state={state} label={STATE_LABELS[state]} />}
          description={reason && <ReasonText state={state}>{reason}</ReasonText>}
          // The name truncates first; the project keeps up to 6rem.
          trailing={projectName && <span className="max-w-24 truncate">{projectName}</span>}
          onActivate={() => onSelectTask(task.projectId, task.id)}
        >
          {task.name}
        </TreeRow>
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

/** A reason line in its state's colour (needs purple, failed red). */
function ReasonText({ state, children }: { state: AgentState; children: ReactNode }) {
  return (
    <span className={state === 'fail' ? 'text-state-fail' : 'text-state-needs'}>{children}</span>
  );
}
