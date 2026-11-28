import { describe, it, expect } from 'vitest';
import type { Task } from '../../../../shared/types';
import {
  envRow,
  extraArgsRow,
  lastActiveRow,
  parseDbTime,
  taskDetailSections,
  type TaskDetailsInput,
} from '../taskDetailRows';

const NOW = Date.parse('2026-11-24T12:00:00.000Z');

const TASK: Task = {
  id: 't1',
  projectId: 'p1',
  name: 'Fix the header',
  branch: 'fix/header',
  path: '/Users/me/repo/.claude/worktrees/fix-header',
  status: 'idle',
  useWorktree: true,
  permissionMode: 'acceptEdits',
  model: 'opus',
  branchCreatedByDash: true,
  linkedItems: null,
  contextPrompt: null,
  previousPath: null,
  jobId: null,
  sessionId: null,
  sessionStoppedAt: null,
  archivedAt: null,
  dashAccess: false,
  extraArgs: null,
  addDirs: [],
  effort: null,
  agent: null,
  env: {},
  denyInsteadOfPrompting: false,
  parentTaskId: null,
  favorite: false,
  protected: false,
  sortOrder: 0,
  totalTokens: 0,
  totalCostUsd: 0,
  tokensBackfilledAt: null,
  createdAt: '2026-11-20T10:00:00.000Z',
  updatedAt: '2026-11-20T10:00:20.000Z',
};

const input = (
  patch: Partial<TaskDetailsInput> = {},
  task: Partial<Task> = {},
): TaskDetailsInput => ({
  task: { ...TASK, ...task },
  projectName: 'dash',
  hasGit: true,
  parentTaskName: null,
  liveModel: null,
  contextPercent: null,
  showCost: true,
  activity: null,
  livePermissionMode: null,
  lastActiveMs: null,
  homeDir: '/Users/me',
  now: NOW,
  ...patch,
});

const labels = (rows: { label: string }[]) => rows.map((r) => r.label);

describe('taskDetailSections', () => {
  it("shows the mode the session reports over the task's, with the configured one on hover", () => {
    const row = (live: TaskDetailsInput['livePermissionMode']) =>
      taskDetailSections(input({ livePermissionMode: live })).session.find(
        (r) => r.label === 'Permissions',
      );
    expect(row(null)).toMatchObject({ value: 'Accept edits', title: undefined });
    expect(row('acceptEdits')).toMatchObject({ value: 'Accept edits', title: undefined });
    expect(row('plan')).toMatchObject({ value: 'Plan', title: 'Configured: Accept edits' });
  });

  it('shows only what is set: no parent, no activity, no session ids, no usage', () => {
    const s = taskDetailSections(input());
    expect(labels(s.task)).toEqual(['Name', 'Project', 'Kind', 'Worktree', 'Created']);
    expect(labels(s.session)).toEqual(['Model', 'Effort', 'Permissions', 'State', 'Dash access']);
    expect(s.usage).toEqual([]);
  });

  it("leaves a plain folder's task without a Kind: it runs in the folder, as all do", () => {
    const s = taskDetailSections(input({ hasGit: false }, { useWorktree: false }));
    expect(labels(s.task)).toEqual(['Name', 'Project', 'Folder', 'Created']);
  });

  it('adds what a running, used task has', () => {
    const s = taskDetailSections(
      input(
        { parentTaskName: 'Orchestrator', contextPercent: 41.6, activity: 'busy' },
        {
          jobId: 'job1',
          sessionId: 'uuid-1',
          totalTokens: 184_000,
          totalCostUsd: 1.42,
        },
      ),
    );
    expect(labels(s.task)).toEqual([
      'Name',
      'Project',
      'Kind',
      'Worktree',
      'Created by',
      'Created',
      'Last active',
    ]);
    expect(labels(s.session)).toEqual([
      'Model',
      'Effort',
      'Permissions',
      'State',
      'Session',
      'Job',
      'Dash access',
    ]);
    expect(s.session.find((r) => r.label === 'State')?.value).toBe('Working');
    expect(s.usage.map((r) => [r.label, r.value])).toEqual([
      ['Tokens', '184.00k'],
      ['Cost', '$1.42'],
      ['Context', '42%'],
    ]);
  });

  it('leaves cost out when the cost setting is off', () => {
    const s = taskDetailSections(input({ showCost: false }, { totalTokens: 10, totalCostUsd: 1 }));
    expect(labels(s.usage)).toEqual(['Tokens']);
  });

  it('prefers the live model, naming the configured one on hover when they differ', () => {
    const live = taskDetailSections(input({ liveModel: 'Opus 5.5' })).session[0]!;
    expect(live).toMatchObject({ value: 'Opus 5.5', title: undefined });
    const switched = taskDetailSections(input({ liveModel: 'Sonnet 4.6' })).session[0]!;
    expect(switched).toMatchObject({ value: 'Sonnet 4.6', title: 'Configured: Opus' });
    const configured = taskDetailSections(input({}, { model: 'default' })).session[0]!;
    expect(configured.value).toBe('Claude Code default');
  });

  it('shows a live state over an old stop time', () => {
    const s = taskDetailSections(
      input({ activity: 'waiting' }, { jobId: 'j', sessionStoppedAt: '2026-11-22T08:00:00Z' }),
    );
    expect(s.session.find((r) => r.label === 'State')?.value).toBe('Needs you');
  });

  it('names a main-checkout task by its folder, and a stopped session', () => {
    const s = taskDetailSections(
      input({}, { useWorktree: false, jobId: 'j', sessionStoppedAt: '2026-11-22T08:00:00Z' }),
    );
    expect(s.task.find((r) => r.label === 'Kind')?.value).toBe('Main checkout');
    expect(labels(s.task)).toContain('Folder');
    expect(s.session.find((r) => r.label === 'State')?.value).toMatch(/^Stopped /);
  });
});

describe('the folder row', () => {
  it('shows the path from ~, copying the full one', () => {
    const row = taskDetailSections(input()).task.find((r) => r.label === 'Worktree')!;
    expect(row).toMatchObject({
      value: '~/repo/.claude/worktrees/fix-header',
      copy: '/Users/me/repo/.claude/worktrees/fix-header',
    });
  });
});

describe('lastActiveRow', () => {
  it('is "Active now" while the session works', () => {
    expect(lastActiveRow(input({ activity: 'busy', lastActiveMs: NOW - 3_600_000 }))?.value).toBe(
      'Active now',
    );
  });

  it("is the conversation's last change, the exact time in the tooltip", () => {
    const row = lastActiveRow(input({ activity: 'idle', lastActiveMs: NOW - 4 * 60_000 }))!;
    expect(row.value).toBe('4 min ago');
    expect(row.title).toBeTruthy();
  });

  it('falls back to when the session stopped, and is null for one that never ran', () => {
    const stopped = lastActiveRow(input({}, { sessionStoppedAt: '2026-11-24T10:00:00.000Z' }));
    expect(stopped?.value).toBe('2 hr ago');
    expect(lastActiveRow(input())).toBeNull();
  });
});

describe('parseDbTime', () => {
  it("reads ISO strings and SQLite's UTC CURRENT_TIMESTAMP", () => {
    expect(parseDbTime('2026-11-20T10:00:00.000Z')?.toISOString()).toBe('2026-11-20T10:00:00.000Z');
    expect(parseDbTime('2026-11-20 10:00:00')?.toISOString()).toBe('2026-11-20T10:00:00.000Z');
  });

  it('is null for empty or garbage values', () => {
    expect(parseDbTime(null)).toBeNull();
    expect(parseDbTime('')).toBeNull();
    expect(parseDbTime('soon')).toBeNull();
  });
});

describe('extraArgsRow', () => {
  it('is left out when the task has none', () => {
    expect(extraArgsRow({ extraArgs: null })).toBeNull();
    expect(extraArgsRow({ extraArgs: '  ' })).toBeNull();
  });

  it('shows them as typed, in the code font, copyable, with no chip when harmless', () => {
    expect(extraArgsRow({ extraArgs: " --chrome --add-dir '/a b' " })).toEqual({
      label: 'Extra arguments',
      value: "--chrome --add-dir '/a b'",
      copy: "--chrome --add-dir '/a b'",
      mono: true,
      caution: undefined,
    });
  });

  it('names the risky flags in the caution chip', () => {
    expect(extraArgsRow({ extraArgs: '--mcp-config m.json --tools Read' })?.caution).toBe(
      '--mcp-config loads MCP servers, which can run any command.\n--tools limits the built-in tools; an empty list also stops dashctl.',
    );
  });

  it('shows added folders beside it, with ~ for home', () => {
    const rows = taskDetailSections(
      input({ homeDir: '/Users/me' }, { addDirs: ['/Users/me/lib', '/opt/docs'] }),
    ).session;
    expect(rows.find((r) => r.label === 'Folders')).toEqual({
      label: 'Folders',
      value: '~/lib, /opt/docs',
      title: '/Users/me/lib\n/opt/docs',
      copy: '/Users/me/lib\n/opt/docs',
    });
    expect(taskDetailSections(input()).session.some((r) => r.label === 'Folders')).toBe(false);
  });

  it('names the agent the session runs as, only when it has one', () => {
    const rows = taskDetailSections(input({}, { agent: 'p:review:security' })).session;
    expect(rows.find((r) => r.label === 'Agent')).toEqual({
      label: 'Agent',
      value: 'p:review:security',
      copy: 'p:review:security',
    });
    expect(taskDetailSections(input()).session.some((r) => r.label === 'Agent')).toBe(false);
  });

  it('sits in the session section', () => {
    const rows = taskDetailSections(input({}, { extraArgs: '--chrome' })).session;
    expect(rows.find((r) => r.label === 'Extra arguments')?.value).toBe('--chrome');
  });
});

describe('envRow', () => {
  it('lists KEY=value in the code font, and nothing when the task has none', () => {
    expect(envRow({ env: {} })).toBeNull();
    expect(envRow({ env: { SEAT: 'lead', MODE: 'a=b' } })).toEqual({
      label: 'Environment',
      value: 'SEAT=lead, MODE=a=b',
      title: 'SEAT=lead\nMODE=a=b',
      copy: 'SEAT=lead\nMODE=a=b',
      mono: true,
    });
  });
});
