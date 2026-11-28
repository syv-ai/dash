import { describe, it, expect } from 'vitest';
import { prDetectionTargets } from '../prDetectionTargets';
import type { Project, Task } from '../../../shared/types';

function project(p: Partial<Project> = {}): Project {
  return {
    id: 'proj1',
    name: 'Proj',
    path: '/repo',
    isGitRepo: true,
    gitRemote: 'https://github.com/acme/repo.git',
    gitBranch: 'main',
    baseRef: 'main',
    archivedAt: null,
    createdAt: '',
    updatedAt: '',
    ...p,
  };
}

function task(p: Partial<Task> = {}): Task {
  return {
    id: 't1',
    projectId: 'proj1',
    name: 'Task',
    branch: 'feature/x',
    path: '/repo/../worktrees/task',
    status: 'idle',
    useWorktree: true,
    permissionMode: 'default',
    model: 'default',
    branchCreatedByDash: true,
    linkedItems: null,
    contextPrompt: null,
    archivedAt: null,
    sortOrder: 0,
    totalTokens: 0,
    totalCostUsd: 0,
    tokensBackfilledAt: null,
    createdAt: '',
    updatedAt: '',
    ...p,
  } as Task;
}

describe('prDetectionTargets', () => {
  it('includes a task with its project, for main to pick the forge, and the default branch to compare', () => {
    const targets = prDetectionTargets(project(), [task({ id: 'a', branch: 'feature/a' })]);
    expect(targets).toEqual([
      {
        taskId: 'a',
        cwd: '/repo/../worktrees/task',
        defaultBranch: 'main',
        projectId: 'proj1',
      },
    ]);
  });

  it("looks up every task, whatever branch was recorded: main reads the checkout's live branch", () => {
    const targets = prDetectionTargets(project({ baseRef: 'develop' }), [
      task({ id: 'a', branch: 'develop' }),
      task({ id: 'b', branch: 'feature/b' }),
      task({ id: 'c', branch: '' }),
    ]);
    expect(targets.map((t) => t.taskId)).toEqual(['a', 'b', 'c']);
    expect(targets[0]?.defaultBranch).toBe('develop');
  });

  it('falls back to gitBranch then "main" for the default branch', () => {
    expect(
      prDetectionTargets(project({ baseRef: null, gitBranch: 'trunk' }), [task()])[0]
        ?.defaultBranch,
    ).toBe('trunk');
    expect(
      prDetectionTargets(project({ baseRef: null, gitBranch: null }), [task()])[0]?.defaultBranch,
    ).toBe('main');
  });

  it('falls back to the project path when the task has no path', () => {
    const targets = prDetectionTargets(project(), [task({ id: 'a', path: '' })]);
    expect(targets[0]?.cwd).toBe('/repo');
  });
});
