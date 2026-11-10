import type { Project, Task } from '../../shared/types';
import type { Caller } from './callers';

/**
 * Who may see or act on what. The only place scoping rules live; reached
 * through `registry.call` (target checks, and the view it hands untargeted
 * handlers). Pure: DB lookups come in as parameters.
 *
 * - The orchestrator needs the Settings switch on. It sees every non-archived project and its tasks, and
 *   creates anywhere it sees.
 * - A task caller needs `dashAccess` (else everything is refused). It sees
 *   itself and the tasks it created (`parentTaskId`), and creates only in its
 *   own project.
 */

export interface ScopeLookups {
  getProjects(): Project[];
  getTask(id: string): Task | undefined;
  /** The Settings switch "Let other agents control Dash"; absent → on. */
  isOrchestratorAllowed?(): boolean;
}

export interface ScopeView {
  /** Projects the caller may list and create tasks in. */
  visibleProjectIds: ReadonlySet<string>;
  canSeeTask(task: Task): boolean;
}

export type ScopeResult = { ok: true; view: ScopeView } | { ok: false; reason: string };

export const DASH_ACCESS_OFF = 'dash access is off for this task';
export const ORCHESTRATOR_ACCESS_OFF = 'orchestrator access is off in Dash settings';

export function scopeFor(caller: Caller, deps: ScopeLookups): ScopeResult {
  if (caller.kind === 'orchestrator') {
    if (deps.isOrchestratorAllowed && !deps.isOrchestratorAllowed()) {
      return { ok: false, reason: ORCHESTRATOR_ACCESS_OFF };
    }
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
