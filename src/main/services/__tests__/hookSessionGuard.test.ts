import { execFileSync } from 'child_process';
import { describe, it, expect } from 'vitest';
import { ownSessionGuard } from '../hookSessionGuard';

/** Run `guard; echo ran` under sh with CLAUDE_PROJECT_DIR set (or unset). */
function runs(guard: string, projectDir: string | undefined): boolean {
  const env = { ...process.env };
  delete env.CLAUDE_PROJECT_DIR;
  if (projectDir !== undefined) env.CLAUDE_PROJECT_DIR = projectDir;
  return execFileSync('sh', ['-c', `${guard}echo ran`], { env, encoding: 'utf8' }).trim() === 'ran';
}

describe('ownSessionGuard', () => {
  const guard = ownSessionGuard(['/repo', '/private/repo']);

  it("lets the hook run in its own task's session, by either path", () => {
    expect(runs(guard, '/repo')).toBe(true);
    expect(runs(guard, '/private/repo')).toBe(true);
  });

  it('ends it in a worktree session under the task', () => {
    expect(runs(guard, '/repo/.claude/worktrees/wt')).toBe(false);
  });

  it('lets it run when Claude Code sets no project dir', () => {
    expect(runs(guard, undefined)).toBe(true);
    expect(runs(guard, '')).toBe(true);
  });

  it('matches paths with quotes, spaces and glob characters literally', () => {
    const odd = ownSessionGuard(["/Users/me/it's [my] *repo*"]);
    expect(runs(odd, "/Users/me/it's [my] *repo*")).toBe(true);
    expect(runs(odd, '/Users/me/it')).toBe(false);
    expect(runs(odd, "/Users/me/it's m *repo*")).toBe(false);
  });
});
