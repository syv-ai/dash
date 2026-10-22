import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../RtkService', () => ({ RtkService: { getManagedBinDirForPath: () => null } }));
vi.mock('../WorkspacePortsRuntime', () => ({
  WorkspacePortsRuntime: {
    getEnvForWorktree: (cwd: string) =>
      cwd === '/wt/a' ? { WEB_PORT: '3001', PATH: '/evil' } : {},
  },
}));

import { buildClaudeEnv, buildSessionEnv, setClaudeEnvVars } from '../claudeEnv';

describe('buildSessionEnv', () => {
  it("holds the user's env vars and the task's ports, never a reserved key", () => {
    setClaudeEnvVars({ MY_TOKEN: 'x', WEB_PORT: 'user', HOME: '/nope' });
    // Ports win over a user var of the same name, as in buildClaudeEnv.
    expect(buildSessionEnv('/wt/a')).toEqual({ MY_TOKEN: 'x', WEB_PORT: '3001' });
    expect(buildSessionEnv('/wt/other')).toEqual({ MY_TOKEN: 'x', WEB_PORT: 'user' });
  });

  it('is part of the dispatch env too', () => {
    setClaudeEnvVars({ MY_TOKEN: 'x' });
    expect(buildClaudeEnv(true, '/wt/a')).toMatchObject({ MY_TOKEN: 'x', WEB_PORT: '3001' });
  });
});

describe("buildClaudeEnv and Dash's CLAUDE_CONFIG_DIR", () => {
  const original = process.env.CLAUDE_CONFIG_DIR;
  afterEach(() => {
    if (original === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = original;
  });

  it('hands Dash’s config dir to every claude it spawns, so they write where Dash reads', () => {
    process.env.CLAUDE_CONFIG_DIR = '/cfg/holi';
    expect(buildClaudeEnv(true).CLAUDE_CONFIG_DIR).toBe('/cfg/holi');
  });

  it('leaves it unset when Dash has none (setting ~/.claude would move .claude.json)', () => {
    delete process.env.CLAUDE_CONFIG_DIR;
    expect(buildClaudeEnv(true)).not.toHaveProperty('CLAUDE_CONFIG_DIR');
  });

  it('never takes it from the user env vars, which would split writes from reads', () => {
    delete process.env.CLAUDE_CONFIG_DIR;
    setClaudeEnvVars({ CLAUDE_CONFIG_DIR: '/elsewhere' });
    expect(buildClaudeEnv(true)).not.toHaveProperty('CLAUDE_CONFIG_DIR');
    expect(buildSessionEnv()).not.toHaveProperty('CLAUDE_CONFIG_DIR');
  });
});
