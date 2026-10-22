import type { Project, Task } from '../../../shared/types';

/** Minimal Task/Project rows for control tests; only the fields scope reads matter. */
export function makeTask(over: Partial<Task> & { id: string; projectId: string }): Task {
  return {
    name: over.id,
    branch: `b-${over.id}`,
    path: `/tmp/${over.id}`,
    status: 'idle',
    useWorktree: true,
    permissionMode: 'default',
    model: 'default',
    branchCreatedByDash: true,
    linkedItems: null,
    contextPrompt: null,
    setupScript: null,
    teardownScript: null,
    previousPath: null,
    jobId: null,
    sessionId: null,
    sessionStoppedAt: null,
    archivedAt: null,
    dashAccess: false,
    parentTaskId: null,
    sortOrder: 0,
    totalTokens: 0,
    totalCostUsd: 0,
    tokensBackfilledAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

export function makeProject(over: Partial<Project> & { id: string }): Project {
  return {
    name: over.id,
    path: `/repos/${over.id}`,
    isGitRepo: true,
    gitRemote: null,
    gitBranch: 'main',
    baseRef: null,
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

/** Lookup deps over fixed arrays, in the shape scope/registry take. */
export function fakeLookups(projects: Project[], tasks: Task[]) {
  return {
    getProjects: () => projects,
    getTask: (id: string) => tasks.find((t) => t.id === id),
  };
}
