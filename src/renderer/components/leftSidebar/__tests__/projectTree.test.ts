import { describe, it, expect } from 'vitest';
import type { Project, Task } from '../../../../shared/types';
import { projectTreeRows, type ProjectTreeInput } from '../projectTree';

const project = (id: string) => ({ id, name: id }) as Project;
const task = (id: string, projectId: string, archivedAt: string | null = null) =>
  ({ id, name: id, projectId, archivedAt }) as Task;

const input = (over: Partial<ProjectTreeInput> = {}): ProjectTreeInput => ({
  projects: [project('a'), project('b')],
  tasksByProject: {
    a: [task('a1', 'a'), task('a2', 'a'), task('ax', 'a', '2026-01-01')],
    b: [],
  },
  activeProjectId: null,
  expanded: new Set(),
  openArchived: new Set(),
  archivedProjects: [],
  archivedProjectsOpen: false,
  hasOtherSessions: () => false,
  ...over,
});

const keys = (over: Partial<ProjectTreeInput> = {}) =>
  projectTreeRows(input(over)).map((r) => r.key);

describe('projectTreeRows', () => {
  it('lists closed projects alone', () => {
    expect(keys()).toEqual(['p:a', 'p:b']);
  });

  it('opens a project onto its live tasks, its archived drawer (closed) and a gap', () => {
    expect(keys({ expanded: new Set(['a']) })).toEqual([
      'p:a',
      't:a1',
      't:a2',
      'a:a',
      'g:a',
      'p:b',
    ]);
  });

  it('lists the archived tasks once their drawer opens', () => {
    expect(keys({ expanded: new Set(['a']), openArchived: new Set(['a']) })).toEqual([
      'p:a',
      't:a1',
      't:a2',
      'a:a',
      'at:ax',
      'g:a',
      'p:b',
    ]);
  });

  it('says "no tasks yet" only under the active project', () => {
    expect(keys({ expanded: new Set(['b']) })).toEqual(['p:a', 'p:b', 'g:b']);
    expect(keys({ expanded: new Set(['b']), activeProjectId: 'b' })).toEqual([
      'p:a',
      'p:b',
      'e:b',
      'g:b',
    ]);
  });

  it("adds a project's other sessions after its tasks, when it has some", () => {
    const rows = keys({ expanded: new Set(['a']), hasOtherSessions: (p) => p.id === 'a' });
    expect(rows).toEqual(['p:a', 't:a1', 't:a2', 's:a', 'a:a', 'g:a', 'p:b']);
  });

  it('ends with the archived projects, listed once open', () => {
    const archivedProjects = [project('z')];
    expect(keys({ archivedProjects })).toEqual(['p:a', 'p:b', 'ap']);
    expect(keys({ archivedProjects, archivedProjectsOpen: true })).toEqual([
      'p:a',
      'p:b',
      'ap',
      'ap:z',
    ]);
  });

  it('asks for a project when there is none, archived ones still listed', () => {
    expect(keys({ projects: [], archivedProjects: [project('z')] })).toEqual(['none', 'ap']);
  });

  it('nests tasks a level under their project; branches carry their open state', () => {
    const rows = projectTreeRows(input({ expanded: new Set(['a']) }));
    expect(rows.map((r) => [r.key, r.depth, r.open, r.focusable])).toEqual([
      ['p:a', 0, true, true],
      ['t:a1', 1, undefined, true],
      ['t:a2', 1, undefined, true],
      ['a:a', 1, false, true],
      ['g:a', 1, undefined, false],
      ['p:b', 0, false, true],
    ]);
  });
});
