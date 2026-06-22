import { describe, it, expect } from 'vitest';
import os from 'os';
import path from 'path';
import { enumerateScopes, settingsFilePath } from '../extensionScopes';

const input = {
  projects: [{ id: 'p1', name: 'dash', path: '/repos/dash' }],
  tasks: [{ taskId: 't1', name: 'feat-x', worktreePath: '/repos/wt/feat-x', projectId: 'p1' }],
};

describe('enumerateScopes', () => {
  it('lists global first, then projects, then tasks', () => {
    const scopes = enumerateScopes(input);
    expect(scopes.map((s) => s.id)).toEqual(['global', 'project:p1', 'task:t1']);
    expect(scopes[0]).toMatchObject({ kind: 'global', name: 'Global', path: os.homedir() });
    expect(scopes[1]).toMatchObject({ kind: 'project', name: 'dash', path: '/repos/dash' });
    expect(scopes[2]).toMatchObject({
      kind: 'task',
      name: 'feat-x',
      path: '/repos/wt/feat-x',
      projectId: 'p1',
    });
  });
});

describe('settingsFilePath', () => {
  it('global → ~/.claude/settings.json', () => {
    const s = enumerateScopes(input)[0]!;
    expect(settingsFilePath(s)).toBe(path.join(os.homedir(), '.claude', 'settings.json'));
  });
  it('project → <path>/.claude/settings.json (committed/shared)', () => {
    const s = enumerateScopes(input)[1]!;
    expect(settingsFilePath(s)).toBe(path.join('/repos/dash', '.claude', 'settings.json'));
  });
  it('task → <path>/.claude/settings.local.json (worktree-local)', () => {
    const s = enumerateScopes(input)[2]!;
    expect(settingsFilePath(s)).toBe(
      path.join('/repos/wt/feat-x', '.claude', 'settings.local.json'),
    );
  });
});
