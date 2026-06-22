import { describe, it, expect } from 'vitest';
import type { ExtensionScopeRef } from '../../../../shared/types';
import { pluginTargetFor, skillTargetFor, buildScopeTree } from '../scopeTargets';

const global: ExtensionScopeRef = { id: 'global', kind: 'global', name: 'Global', path: '/home/u' };
const proj: ExtensionScopeRef = {
  id: 'project:p1',
  kind: 'project',
  name: 'dash',
  path: '/repos/dash',
};
const task: ExtensionScopeRef = {
  id: 'task:t1',
  kind: 'task',
  name: 'feat',
  path: '/wt/feat',
  projectId: 'p1',
};

describe('pluginTargetFor', () => {
  it('maps scopes to PluginInstallTarget', () => {
    expect(pluginTargetFor(global)).toEqual({ scope: 'user' });
    expect(pluginTargetFor(proj)).toEqual({ scope: 'project', cwd: '/repos/dash' });
    expect(pluginTargetFor(task)).toEqual({ scope: 'local', cwd: '/wt/feat' });
  });
});

describe('skillTargetFor', () => {
  it('maps scopes to SkillInstallTarget', () => {
    expect(skillTargetFor(global)).toEqual({ kind: 'global' });
    expect(skillTargetFor(proj)).toEqual({ kind: 'project', projectPath: '/repos/dash' });
    expect(skillTargetFor(task)).toEqual({ kind: 'task', worktreePath: '/wt/feat' });
  });
});

describe('buildScopeTree', () => {
  it('nests tasks under their project, global first', () => {
    const tree = buildScopeTree([global, proj, task]);
    expect(tree.global).toEqual(global);
    expect(tree.projects).toHaveLength(1);
    expect(tree.projects[0]!.project).toEqual(proj);
    expect(tree.projects[0]!.tasks).toEqual([task]);
  });
  it('keeps a project with no tasks', () => {
    const tree = buildScopeTree([global, proj]);
    expect(tree.projects[0]!.tasks).toEqual([]);
  });
});
