import type { Project, Task } from '../../shared/types';
import type { Caller } from './callers';

/**
 * Who may see or act on what. The only place scoping rules live; reached
 * through `registry.call` (target checks, and the view it hands untargeted
 * handlers). Pure: DB lookups come in as parameters.
 *
 * - The orchestrator sees every non-archived project and its tasks, and
 *   creates anywhere it sees.
 * - A task caller needs `dashAccess` (else everything is refused). It sees
 *   itself and the tasks it created (`parentTaskId`), and creates only in its
 *   own project.
 */

export interface ScopeLookups {
  getProjects(): Project[];
  getTask(id: string): Task | undefined;
}

export interface ScopeView {
  /** Projects the caller may list and create tasks in. */
  visibleProjectIds: ReadonlySet<string>;
  canSeeTask(task: Task): boolean;
}

export type ScopeResult = { ok: true; view: ScopeView } | { ok: false; reason: string };

export const DASH_ACCESS_OFF = 'dash access is off for this task';

export function scopeFor(caller: Caller, deps: ScopeLookups): ScopeResult {
  if (caller.kind === 'orchestrator') {
    const visibleProjectIds = new Set(
      deps
        .getProjects()
        .filter((p) => p.archivedAt == null)
        .map((p) => p.id),
    );
    return {
      ok: true,
      view: { visibleProjectIds, canSeeTask: (t) => visibleProjectIds.has(t.projectId) },
    };
  }

  const self = deps.getTask(caller.taskId);
  if (!self) return { ok: false, reason: 'unknown task' };
  if (!self.dashAccess) return { ok: false, reason: DASH_ACCESS_OFF };
  return {
    ok: true,
    view: {
      visibleProjectIds: new Set([self.projectId]),
      canSeeTask: (t) => t.id === self.id || t.parentTaskId === self.id,
    },
  };
}

export function canSeeTask(caller: Caller, task: Task, deps: ScopeLookups): boolean {
  const scope = scopeFor(caller, deps);
  return scope.ok && scope.view.canSeeTask(task);
}

export function canCreateIn(caller: Caller, projectId: string, deps: ScopeLookups): boolean {
  const scope = scopeFor(caller, deps);
  return scope.ok && scope.view.visibleProjectIds.has(projectId);
}
