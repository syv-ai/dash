import { describe, it, expect } from 'vitest';
import { resolveHookTaskId, payloadDirectory } from '../hookTaskResolver';

const ROOT = '/home/u/music removal';
const tasks = [
  { id: 'root', path: ROOT },
  { id: 'ball', path: `${ROOT}/.claude/worktrees/ball-kinetics-071` },
  { id: 'court', path: `${ROOT}/.claude/worktrees/court-segmentation-ed2` },
];

describe('resolveHookTaskId', () => {
  it('credits a worktree session to its own task even when the root task id arrives', () => {
    // The root's settings.local.json is loaded inside the worktree session,
    // so the event carries ptyId=root but runs in the ball-kinetics worktree.
    const payload = { workspace: { project_dir: `${ROOT}/.claude/worktrees/ball-kinetics-071` } };
    expect(resolveHookTaskId('root', payload, tasks)).toBe('ball');
  });

  it('keeps the root task for a session running in the root', () => {
    expect(resolveHookTaskId('root', { cwd: ROOT }, tasks)).toBe('root');
  });

  it('matches a subdirectory of a task worktree', () => {
    const cwd = `${ROOT}/.claude/worktrees/court-segmentation-ed2/src/deep`;
    expect(resolveHookTaskId('root', { cwd }, tasks)).toBe('court');
  });

  it('does not match a sibling that merely shares a name prefix', () => {
    const cwd = `${ROOT}/.claude/worktrees/ball-kinetics-071-perf`;
    expect(resolveHookTaskId('ball', { cwd }, tasks)).toBeNull();
  });

  it('drops events from a subagent worktree nested under the root task', () => {
    const cwd = `${ROOT}/.claude/worktrees/agent-a046c38a0db796e46`;
    expect(resolveHookTaskId('root', { cwd }, tasks)).toBeNull();
  });

  it('falls back to the query id without a directory', () => {
    expect(resolveHookTaskId('court', {}, tasks)).toBe('court');
  });

  it('falls back to the query id for a directory outside every task', () => {
    expect(resolveHookTaskId('court', { cwd: '/elsewhere' }, tasks)).toBe('court');
  });

  it('prefers workspace.project_dir over cwd', () => {
    const p = { cwd: ROOT, workspace: { project_dir: tasks[1]!.path } };
    expect(payloadDirectory(p)).toBe(tasks[1]!.path);
  });

  it('tolerates a trailing slash', () => {
    expect(resolveHookTaskId('x', { cwd: ROOT + '/' }, tasks)).toBe('root');
  });
});
