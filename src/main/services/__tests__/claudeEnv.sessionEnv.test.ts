import { describe, it, expect, vi } from 'vitest';

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
