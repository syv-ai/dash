import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { buildMigrationPlan, isInsideDir, isWorktreeLockedError } from '../worktreeMigrationPlan';
import type { Project, Task } from '@shared/types';

const helpers = {
  getLegacyWorktreesDir: (p: string) => path.join(path.dirname(p), 'worktrees'),
  getWorktreesDir: (p: string) => path.join(p, '.claude', 'worktrees'),
};

function project(over: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'app',
    path: '/code/app',
    isGitRepo: true,
    gitRemote: null,
    gitBranch: 'main',
    baseRef: null,
    createdAt: '',
    updatedAt: '',
    ...over,
  } as Project;
}

function task(over: Partial<Task> = {}): Task {
  return {
    id: 't1',
    projectId: 'p1',
    name: 'Fix login',
    branch: 'fix-login-a1b',
    path: '/code/worktrees/fix-login-a1b',
    status: 'active',
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
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}

describe('isInsideDir', () => {
  it('accepts strict descendants only', () => {
    expect(isInsideDir('/code/worktrees', '/code/worktrees/x')).toBe(true);
    expect(isInsideDir('/code/worktrees', '/code/worktrees/x/y')).toBe(true);
    expect(isInsideDir('/code/worktrees', '/code/worktrees')).toBe(false);
    expect(isInsideDir('/code/worktrees', '/code/worktrees-old/x')).toBe(false);
    expect(isInsideDir('/code/worktrees', '/code/app')).toBe(false);
  });
});

describe('buildMigrationPlan', () => {
  it('moves legacy worktree tasks to <repo>/.claude/worktrees keeping the basename', () => {
    const plan = buildMigrationPlan([project()], { p1: [task()] }, helpers);
    expect(plan).toHaveLength(1);
    expect(plan[0]!.legacyDir).toBe('/code/worktrees');
    expect(plan[0]!.targetDir).toBe('/code/app/.claude/worktrees');
    expect(plan[0]!.tasks).toEqual([
      {
        taskId: 't1',
        taskName: 'Fix login',
        branch: 'fix-login-a1b',
        archived: false,
        fromPath: '/code/worktrees/fix-login-a1b',
        toPath: '/code/app/.claude/worktrees/fix-login-a1b',
        stale: false,
      },
    ]);
  });

  it('flags a legacy directory that is no longer a git worktree as stale', () => {
    // The dir survived (Dash used to recreate `.claude/` inside it) but git
    // dropped the worktree: `git worktree move` would fail on it every launch.
    const plan = buildMigrationPlan(
      [project()],
      { p1: [task()] },
      {
        ...helpers,
        pathExists: (p) => p === '/code/worktrees/fix-login-a1b',
        isWorktreeDir: () => false,
      },
    );
    expect(plan[0]!.tasks[0]!.stale).toBe(true);
  });

  it('does not call a worktree stale when it was already moved by hand', () => {
    const plan = buildMigrationPlan(
      [project()],
      { p1: [task()] },
      {
        ...helpers,
        pathExists: (p) => p === '/code/app/.claude/worktrees/fix-login-a1b',
        isWorktreeDir: () => false,
      },
    );
    expect(plan[0]!.tasks[0]!.stale).toBe(false);
  });

  it('still leaves out tasks whose directory is gone from both locations', () => {
    const plan = buildMigrationPlan(
      [project()],
      { p1: [task()] },
      {
        ...helpers,
        pathExists: () => false,
        isWorktreeDir: () => false,
      },
    );
    expect(plan).toEqual([]);
  });

  it('skips tasks already at the new location, non-worktree tasks, and non-git projects', () => {
    const tasks = [
      task({ id: 'new', path: '/code/app/.claude/worktrees/new-abc' }),
      task({ id: 'plain', useWorktree: false, path: '/code/app' }),
      task({ id: 'legacy', path: '/code/worktrees/legacy-abc' }),
    ];
    const plan = buildMigrationPlan([project()], { p1: tasks }, helpers);
    expect(plan[0]!.tasks.map((t) => t.taskId)).toEqual(['legacy']);

    const noGit = buildMigrationPlan([project({ isGitRepo: false })], { p1: tasks }, helpers);
    expect(noGit).toEqual([]);
  });

  it('includes archived tasks and flags them', () => {
    const plan = buildMigrationPlan(
      [project()],
      { p1: [task({ id: 'a', archivedAt: '2026-01-01' })] },
      helpers,
    );
    expect(plan[0]!.tasks[0]!.archived).toBe(true);
  });

  it('omits projects with nothing to move', () => {
    const plan = buildMigrationPlan(
      [project(), project({ id: 'p2', name: 'other', path: '/code/other' })],
      { p1: [], p2: [task({ id: 'x', projectId: 'p2', path: '/code/worktrees/x-1' })] },
      helpers,
    );
    expect(plan.map((p) => p.projectId)).toEqual(['p2']);
  });
});

describe('isWorktreeLockedError', () => {
  it('recognises git’s locked-worktree refusal', () => {
    expect(
      isWorktreeLockedError('fatal: cannot move a locked working tree, lock reason: Claude Code'),
    ).toBe(true);
    expect(isWorktreeLockedError('fatal: destination already exists')).toBe(false);
  });
});

describe('buildMigrationPlan — missing worktree directories', () => {
  it('leaves out a task whose worktree exists at neither location', () => {
    const tasks = [
      task({ id: 'gone', path: '/code/worktrees/gone-111' }),
      task({ id: 'there', path: '/code/worktrees/there-222' }),
      task({ id: 'moved', path: '/code/worktrees/moved-333' }),
    ];
    const plan = buildMigrationPlan(
      [project()],
      { p1: tasks },
      {
        ...helpers,
        pathExists: (p) =>
          p === '/code/worktrees/there-222' || p === '/code/app/.claude/worktrees/moved-333',
      },
    );
    expect(plan[0]!.tasks.map((t) => t.taskId)).toEqual(['there', 'moved']);
  });

  it('drops the project when every task is gone', () => {
    const plan = buildMigrationPlan(
      [project()],
      { p1: [task({ id: 'gone', path: '/code/worktrees/gone-111' })] },
      { ...helpers, pathExists: () => false },
    );
    expect(plan).toEqual([]);
  });
});
