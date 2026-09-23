import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import type { Project, Task } from '@shared/types';

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }));

// In-memory stand-in for the SQLite-backed DatabaseService: the service under
// test only needs projects, tasks and relocateTask.
const db: { projects: Project[]; tasks: Task[] } = { projects: [], tasks: [] };
vi.mock('../DatabaseService', () => ({
  DatabaseService: {
    getProjects: () => db.projects,
    getTasks: (projectId: string) => db.tasks.filter((t) => t.projectId === projectId),
    getTask: (id: string) => db.tasks.find((t) => t.id === id),
    setTaskSession: (id: string, session: { jobId: string | null; sessionId: string | null }) => {
      const t = db.tasks.find((x) => x.id === id)!;
      t.jobId = session.jobId;
      t.sessionId = session.sessionId;
    },
    relocateTask: (id: string, newPath: string, previousPath: string) => {
      const t = db.tasks.find((x) => x.id === id)!;
      t.previousPath = t.previousPath ?? previousPath;
      t.path = newPath;
      return t;
    },
    deleteTask: (id: string) => {
      db.tasks = db.tasks.filter((x) => x.id !== id);
    },
  },
}));

// Task deletion goes through the add-on registry (add-ons are told, their
// task data dropped); here it just deletes from the in-memory rows.
const addonDeletes: string[] = [];
vi.mock('../../addonHost/registry', () => ({
  deleteTaskWithAddons: (id: string) => {
    addonDeletes.push(id);
    db.tasks = db.tasks.filter((x) => x.id !== id);
  },
}));

const killed: string[] = [];
const sessionsRemoved: string[] = [];
vi.mock('../ptyManager', () => ({
  listForTask: (taskId: string) => [taskId, `shell:${taskId}`],
  killPtyAwait: async (id: string) => {
    killed.push(id);
  },
  removeTaskSession: async (taskId: string) => {
    sessionsRemoved.push(taskId);
  },
}));

import { worktreeMigrationService } from '../WorktreeMigrationService';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
beforeEach(() => {
  db.projects = [];
  db.tasks = [];
  killed.length = 0;
  sessionsRemoved.length = 0;
  addonDeletes.length = 0;
});

/** Turn the legacy worktree into the husk Dash used to leave behind: git has
 *  dropped it, only a `.claude/` folder remains at the old path. */
function makeStale(repo: string, from: string) {
  git(repo, 'worktree', 'remove', '--force', from);
  fs.mkdirSync(path.join(from, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(from, '.claude', 'settings.local.json'), '{}');
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe' }).toString();
}

/** A repo at <root>/app with a legacy-layout worktree at <root>/worktrees/<name>. */
function legacySetup(name = 'fix-login-a1b') {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dash-mig-')));
  dirs.push(root);
  const repo = path.join(root, 'app');
  fs.mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'config', 'user.name', 'test');
  fs.writeFileSync(path.join(repo, 'README.md'), 'hi\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-qm', 'init');
  const legacyDir = path.join(root, 'worktrees');
  fs.mkdirSync(legacyDir);
  const from = path.join(legacyDir, name);
  git(repo, 'worktree', 'add', '-q', '-b', name, from, 'main');
  fs.writeFileSync(path.join(from, 'work.txt'), 'uncommitted work\n');

  db.projects = [
    {
      id: 'p1',
      name: 'app',
      path: repo,
      isGitRepo: true,
      gitRemote: null,
      gitBranch: 'main',
      baseRef: null,
      createdAt: '',
      updatedAt: '',
    } as Project,
  ];
  db.tasks = [
    {
      id: 't1',
      projectId: 'p1',
      name: 'Fix login',
      branch: name,
      path: from,
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
      sortOrder: 0,
      totalTokens: 0,
      totalCostUsd: 0,
      tokensBackfilledAt: null,
      createdAt: '',
      updatedAt: '',
    },
  ];
  return { root, repo, legacyDir, from, to: path.join(repo, '.claude', 'worktrees', name) };
}

describe('WorktreeMigrationService', () => {
  it('marks a legacy dir that git no longer tracks as stale and fails it unless removal is requested', async () => {
    const { repo, from } = legacySetup();
    makeStale(repo, from);

    expect(worktreeMigrationService.plan()[0]!.tasks[0]!.stale).toBe(true);

    const result = await worktreeMigrationService.migrateProject('p1');
    expect(result.moved).toEqual([]);
    expect(result.removed).toEqual([]);
    expect(result.failed).toEqual([
      expect.objectContaining({
        taskId: 't1',
        error: expect.stringContaining('Not a git worktree'),
      }),
    ]);
    expect(fs.existsSync(from)).toBe(true);
    expect(db.tasks).toHaveLength(1);
  });

  it('removes a stale task on request: session, row and leftover directory', async () => {
    const { repo, legacyDir, from } = legacySetup();
    makeStale(repo, from);

    const result = await worktreeMigrationService.migrateProject('p1', { removeStale: true });

    expect(result).toEqual({ projectId: 'p1', moved: [], removed: ['t1'], failed: [] });
    expect(killed).toEqual(['t1', 'shell:t1']);
    expect(sessionsRemoved).toEqual(['t1']);
    expect(db.tasks).toEqual([]);
    expect(addonDeletes).toEqual(['t1']);
    expect(fs.existsSync(from)).toBe(false);
    // Nothing else left at the old location, so the legacy dir goes too.
    expect(fs.existsSync(legacyDir)).toBe(false);
    expect(worktreeMigrationService.plan()).toEqual([]);
  });

  it('plans only legacy-layout worktree tasks', () => {
    const { from, to } = legacySetup();
    const plan = worktreeMigrationService.plan();
    expect(plan).toHaveLength(1);
    expect(plan[0]!.tasks).toEqual([
      expect.objectContaining({ taskId: 't1', fromPath: from, toPath: to }),
    ]);
    expect(worktreeMigrationService.plan()).toHaveLength(1);
  });

  it('moves the worktree with git, records previous_path, kills PTYs, and removes the empty legacy dir', async () => {
    const { repo, legacyDir, from, to } = legacySetup();

    const result = await worktreeMigrationService.migrateProject('p1');

    expect(result).toEqual({ projectId: 'p1', moved: ['t1'], removed: [], failed: [] });
    expect(killed).toEqual(['t1', 'shell:t1']);
    expect(fs.existsSync(from)).toBe(false);
    expect(fs.readFileSync(path.join(to, 'work.txt'), 'utf-8')).toBe('uncommitted work\n');
    expect(git(repo, 'worktree', 'list', '--porcelain')).toContain(`worktree ${to}`);
    expect(git(to, 'branch', '--show-current').trim()).toBe('fix-login-a1b');
    expect(db.tasks[0]!.path).toBe(to);
    expect(db.tasks[0]!.previousPath).toBe(from);
    expect(fs.existsSync(legacyDir)).toBe(false);
    expect(fs.readFileSync(path.join(repo, '.git', 'info', 'exclude'), 'utf-8')).toContain(
      '.claude/worktrees/',
    );
    // Nothing left to migrate.
    expect(worktreeMigrationService.plan()).toEqual([]);
  });

  it('lifts a worktree lock left behind by a session and retries the move', async () => {
    const { repo, from, to } = legacySetup();
    git(repo, 'worktree', 'lock', '--reason', 'Claude Code', from);

    const result = await worktreeMigrationService.migrateProject('p1');

    expect(result.failed).toEqual([]);
    expect(result.moved).toEqual(['t1']);
    expect(fs.existsSync(to)).toBe(true);
  });

  it('reports a per-task failure and keeps the task on its old path when the move cannot happen', async () => {
    const { from, to } = legacySetup();
    fs.mkdirSync(to, { recursive: true });
    fs.writeFileSync(path.join(to, 'stale'), '');

    const result = await worktreeMigrationService.migrateProject('p1');

    expect(result.moved).toEqual([]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]!.error).toMatch(/already exists/);
    expect(fs.existsSync(from)).toBe(true);
    expect(db.tasks[0]!.path).toBe(from);
    // Still offered next launch.
    expect(worktreeMigrationService.plan()).toHaveLength(1);
  });

  it('records a worktree that was already moved by hand without touching git', async () => {
    const { repo, from, to } = legacySetup();
    fs.mkdirSync(path.dirname(to), { recursive: true });
    git(repo, 'worktree', 'move', from, to);

    const result = await worktreeMigrationService.migrateProject('p1');

    expect(result).toEqual({ projectId: 'p1', moved: ['t1'], removed: [], failed: [] });
    expect(db.tasks[0]!.path).toBe(to);
    expect(db.tasks[0]!.previousPath).toBe(from);
  });
});
