import type { ActivityError, ActivityInfo, Project, Task } from '../../../shared/types';
import type { AgentState } from '../ui/StatusDot';

/** Idle rows shown before "More". */
export const IDLE_LIMIT = 5;

/** One row of the state-ordered task list. */
export interface TaskStateRow {
  task: Task;
  state: AgentState;
  /** Why a needs-you or failed task stopped; absent for the other states. */
  reason?: string;
  /** The task's project, only when another listed task in a different project
   *  has the same name (otherwise the name alone is unambiguous). */
  projectName?: string;
}

export interface TaskStateList {
  /** Needs you, failed, working, done — in that order. */
  active: TaskStateRow[];
  /** Idle and sleeping tasks, most recently updated first. */
  idle: TaskStateRow[];
}

const ACTIVE_ORDER: AgentState[] = ['needs', 'fail', 'work', 'done'];

const ERROR_LABELS: Record<ActivityError['type'], string> = {
  rate_limit: 'Rate limited',
  auth_error: 'Authentication error',
  billing_error: 'Billing error',
  supervisor: 'Session failed',
  unknown: 'Failed',
};

/** A failed task's reason: the error's own message, else a label for its type. */
export function failureReason(error: ActivityError | undefined): string {
  return error?.message?.trim() || ERROR_LABELS[error?.type ?? 'unknown'];
}

/**
 * A task's agent state. `waiting` needs you, `error` failed, `busy` works; an
 * idle session is done until the user has seen it. A sleeping (`stopped`)
 * session and one that never ran are plain idle.
 */
export function agentState(info: ActivityInfo | undefined, unseen: boolean): AgentState {
  switch (info?.state) {
    case 'waiting':
      return 'needs';
    case 'error':
      return 'fail';
    case 'busy':
      return 'work';
    case 'idle':
      return unseen ? 'done' : 'idle';
    default:
      return 'idle';
  }
}

function reasonFor(state: AgentState, info: ActivityInfo | undefined): string | undefined {
  if (state === 'needs') return info?.detail?.trim() || 'Waiting for you';
  if (state === 'fail') return failureReason(info?.error);
  return undefined;
}

/** Most recently updated first; id breaks ties so the order never flickers. */
function byRecency(a: Task, b: Task): number {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Names used by tasks in more than one project. */
function collidingNames(tasks: Task[]): Set<string> {
  const projectsByName = new Map<string, Set<string>>();
  for (const t of tasks) {
    const set = projectsByName.get(t.name) ?? new Set<string>();
    set.add(t.projectId);
    projectsByName.set(t.name, set);
  }
  return new Set([...projectsByName].filter(([, ids]) => ids.size > 1).map(([name]) => name));
}

/**
 * Every non-archived task across projects, ordered by what it asks of the
 * user: needs you, failed, working, done, then idle. Within a state, most
 * recently updated first.
 */
export function orderTasksByState(
  tasks: Task[],
  activity: Record<string, ActivityInfo>,
  unseen: ReadonlySet<string>,
  projects: Project[],
): TaskStateList {
  const live = tasks.filter((t) => !t.archivedAt).sort(byRecency);
  const collisions = collidingNames(live);
  const projectNames = new Map(projects.map((p) => [p.id, p.name]));

  const rows = live.map((task): TaskStateRow => {
    const info = activity[task.id];
    const state = agentState(info, unseen.has(task.id));
    const row: TaskStateRow = { task, state };
    const reason = reasonFor(state, info);
    if (reason) row.reason = reason;
    if (collisions.has(task.name)) row.projectName = projectNames.get(task.projectId);
    return row;
  });

  return {
    active: ACTIVE_ORDER.flatMap((s) => rows.filter((r) => r.state === s)),
    idle: rows.filter((r) => r.state === 'idle'),
  };
}

/**
 * The idle rows on show: all when expanded, else the first IDLE_LIMIT — plus
 * the selected task if it sits further down, so the selection never hides.
 */
export function visibleIdleRows(
  idle: TaskStateRow[],
  expanded: boolean,
  selectedTaskId: string | null,
): TaskStateRow[] {
  if (expanded || idle.length <= IDLE_LIMIT) return idle;
  return idle.filter((r, i) => i < IDLE_LIMIT || r.task.id === selectedTaskId);
}
