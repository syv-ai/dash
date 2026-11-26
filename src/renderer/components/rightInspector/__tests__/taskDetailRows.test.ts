import { describe, it, expect } from 'vitest';
import type { Task } from '../../../../shared/types';
import {
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
  setupScript: null,
  teardownScript: null,
  previousPath: null,
  jobId: null,
  sessionId: null,
  sessionStoppedAt: null,
  archivedAt: null,
  dashAccess: false,
  parentTaskId: null,
  favorite: false,
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
  parentTaskName: null,
  liveModel: null,
  contextPercent: null,
  showCost: true,
  activity: null,
  lastActiveMs: null,
  homeDir: '/Users/me',
  now: NOW,
  ...patch,
});

const labels = (rows: { label: string }[]) => rows.map((r) => r.label);

describe('taskDetailSections', () => {
  it('shows only what is set: no parent, no activity, no session ids, no usage', () => {
    const s = taskDetailSections(input());
    expect(labels(s.task)).toEqual(['Name', 'Project', 'Kind', 'Worktree', 'Created']);
    expect(labels(s.session)).toEqual(['Model', 'Permissions', 'State', 'Dash access']);
    expect(s.usage).toEqual([]);
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
      'Permissions',
      'State',
      'Session',
      'Job',
      'Dash access',
    ]);
    expect(s.session.find((r) => r.label === 'State')?.value).toBe('Working');
    expect(s.usage.map((r) => [r.label, r.value])).toEqual([
      ['Tokens', '184k'],
      ['Cost', '$1.42'],
      ['Context', '42%'],
    ]);
  });

  it('leaves cost out when the cost setting is off', () => {
    const s = taskDetailSections(input({ showCost: false }, { totalTokens: 10, totalCostUsd: 1 }));
    expect(labels(s.usage)).toEqual(['Tokens']);
  });

  it('prefers the live model, keeping the configured one in the tooltip', () => {
    const live = taskDetailSections(input({ liveModel: 'Opus 5.5' })).session[0]!;
    expect(live).toMatchObject({ value: 'Opus 5.5', title: 'Configured: Opus' });
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
