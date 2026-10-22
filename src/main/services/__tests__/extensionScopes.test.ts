import { describe, it, expect, afterEach } from 'vitest';
import os from 'os';
import path from 'path';
import { enumerateScopes, scopeClaudeDir, settingsFilePath } from '../extensionScopes';

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
  const original = process.env.CLAUDE_CONFIG_DIR;
  afterEach(() => {
    if (original === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = original;
  });

  it('global → ~/.claude/settings.json', () => {
    delete process.env.CLAUDE_CONFIG_DIR;
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
  it('global follows CLAUDE_CONFIG_DIR; project and task keep <path>/.claude', () => {
    process.env.CLAUDE_CONFIG_DIR = '/srv/alt-claude';
    const [global, project, task] = enumerateScopes(input);
    expect(settingsFilePath(global!)).toBe('/srv/alt-claude/settings.json');
    expect(scopeClaudeDir(global!)).toBe('/srv/alt-claude');
    expect(scopeClaudeDir(project!)).toBe(path.join('/repos/dash', '.claude'));
    expect(scopeClaudeDir(task!)).toBe(path.join('/repos/wt/feat-x', '.claude'));
  });
});
