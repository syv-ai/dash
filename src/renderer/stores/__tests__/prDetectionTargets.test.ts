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
  it('includes a feature-branch task via the github provider', () => {
    const targets = prDetectionTargets(project(), [task({ id: 'a', branch: 'feature/a' })]);
    expect(targets).toEqual([
      {
        taskId: 'a',
        branch: 'feature/a',
        provider: 'github',
        cwd: '/repo/../worktrees/task',
        remote: 'https://github.com/acme/repo.git',
        projectId: 'proj1',
      },
    ]);
  });

  it('skips tasks on the default branch (baseRef)', () => {
    const targets = prDetectionTargets(project({ baseRef: 'develop' }), [
      task({ id: 'a', branch: 'develop' }),
      task({ id: 'b', branch: 'feature/b' }),
    ]);
    expect(targets.map((t) => t.taskId)).toEqual(['b']);
  });

  it('skips tasks with no branch', () => {
    const targets = prDetectionTargets(project(), [task({ id: 'a', branch: '' })]);
    expect(targets).toEqual([]);
  });

  it('uses the ado provider for an Azure DevOps remote', () => {
    const targets = prDetectionTargets(
      project({ gitRemote: 'https://dev.azure.com/org/proj/_git/repo' }),
      [task({ id: 'a', branch: 'feature/a' })],
    );
    expect(targets[0]?.provider).toBe('ado');
  });

  it('falls back to gitBranch then "main" for the default branch', () => {
    const targets = prDetectionTargets(project({ baseRef: null, gitBranch: 'trunk' }), [
      task({ id: 'a', branch: 'trunk' }),
      task({ id: 'b', branch: 'feature/b' }),
    ]);
    expect(targets.map((t) => t.taskId)).toEqual(['b']);
  });

  it('falls back to the project path when the task has no path', () => {
    const targets = prDetectionTargets(project(), [
      task({ id: 'a', branch: 'feature/a', path: '' }),
    ]);
    expect(targets[0]?.cwd).toBe('/repo');
  });
});
