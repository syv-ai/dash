import { describe, it, expect } from 'vitest';
import { isSubagentHook, statusLineTaskId } from '../hookPayload';

describe('isSubagentHook', () => {
  it('is true when Claude Code tags the hook with an agent_id', () => {
    expect(isSubagentHook({ agent_id: 'ae82aa4f719d76ab8', agent_type: 'general-purpose' })).toBe(
      true,
    );
  });

  it('is false for the main agent, which carries no agent_id', () => {
    expect(isSubagentHook({ session_id: 's', hook_event_name: 'PreToolUse' })).toBe(false);
    expect(isSubagentHook({ agent_id: '' })).toBe(false);
  });
});

describe('statusLineTaskId', () => {
  const tasksByPath: Record<string, string> = {
    '/repo': 'root',
    '/repo/.claude/worktrees/wt': 'wt',
  };
  const lookup = (dir: string) => tasksByPath[dir];

  it("credits a worktree session's report to the worktree task, not the root's ptyId", () => {
    const payload = { workspace: { project_dir: '/repo/.claude/worktrees/wt' }, cwd: '/x' };
    expect(statusLineTaskId('root', payload, lookup)).toBe('wt');
  });

  it('falls back to cwd, then to the URL id', () => {
    expect(statusLineTaskId('root', { cwd: '/repo/.claude/worktrees/wt' }, lookup)).toBe('wt');
    expect(statusLineTaskId('root', { cwd: '/elsewhere' }, lookup)).toBe('root');
    expect(statusLineTaskId('root', {}, lookup)).toBe('root');
  });
});
