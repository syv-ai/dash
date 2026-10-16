import { describe, it, expect } from 'vitest';
import { scopeFor, canSeeTask, canCreateIn } from '../scope';
import { fakeLookups, makeProject, makeTask } from './fixtures';

const pA = makeProject({ id: 'pA' });
const pB = makeProject({ id: 'pB' });
const pArchived = makeProject({ id: 'pX', archivedAt: '2026-02-01T00:00:00.000Z' });

const me = makeTask({ id: 'me', projectId: 'pA', dashAccess: true });
const child = makeTask({ id: 'child', projectId: 'pA', parentTaskId: 'me' });
const sibling = makeTask({ id: 'sibling', projectId: 'pA' });
const otherProject = makeTask({ id: 'other', projectId: 'pB' });
const inArchived = makeTask({ id: 'arch', projectId: 'pX' });
const noAccess = makeTask({ id: 'noaccess', projectId: 'pA', dashAccess: false });

const deps = fakeLookups(
  [pA, pB, pArchived],
  [me, child, sibling, otherProject, inArchived, noAccess],
);
const orch = { kind: 'orchestrator' } as const;
const asTask = (taskId: string) => ({ kind: 'task', taskId }) as const;

describe('scope', () => {
  it('refuses a task caller without dash access, for everything', () => {
    const result = scopeFor(asTask('noaccess'), deps);
    expect(result).toEqual({ ok: false, reason: 'dash access is off for this task' });
    expect(canSeeTask(asTask('noaccess'), noAccess, deps)).toBe(false);
    expect(canCreateIn(asTask('noaccess'), 'pA', deps)).toBe(false);
  });

  it('refuses a task caller whose task does not exist', () => {
    expect(scopeFor(asTask('ghost'), deps).ok).toBe(false);
  });

  it('a task sees itself and its child but not a sibling or another project', () => {
    const c = asTask('me');
    expect(canSeeTask(c, me, deps)).toBe(true);
    expect(canSeeTask(c, child, deps)).toBe(true);
    expect(canSeeTask(c, sibling, deps)).toBe(false);
    expect(canSeeTask(c, otherProject, deps)).toBe(false);
  });

  it('a task creates only in its own project', () => {
    expect(canCreateIn(asTask('me'), 'pA', deps)).toBe(true);
    expect(canCreateIn(asTask('me'), 'pB', deps)).toBe(false);
  });

  it("the orchestrator sees non-archived projects and their tasks, not archived projects'", () => {
    const result = scopeFor(orch, deps);
    if (!result.ok) throw new Error('expected a view');
    expect([...result.view.visibleProjectIds].sort()).toEqual(['pA', 'pB']);
    expect(canSeeTask(orch, sibling, deps)).toBe(true);
    expect(canSeeTask(orch, otherProject, deps)).toBe(true);
    expect(canSeeTask(orch, inArchived, deps)).toBe(false);
    expect(canCreateIn(orch, 'pB', deps)).toBe(true);
    expect(canCreateIn(orch, 'pX', deps)).toBe(false);
    expect(canCreateIn(orch, 'nope', deps)).toBe(false);
  });
});
