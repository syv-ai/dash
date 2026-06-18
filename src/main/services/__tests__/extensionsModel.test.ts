import { describe, it, expect } from 'vitest';
import type { InstalledPlugin, ExtensionScopeRef, OverviewSkill } from '@shared/types';
import { assignPluginsToScopes, assembleOverview } from '../extensionsModel';

const scopes: ExtensionScopeRef[] = [
  { id: 'global', kind: 'global', name: 'Global', path: '/home/u' },
  { id: 'project:p1', kind: 'project', name: 'dash', path: '/repos/dash' },
  { id: 'task:t1', kind: 'task', name: 'feat-x', path: '/repos/wt/feat-x', projectId: 'p1' },
];

const installed: InstalledPlugin[] = [
  {
    id: 'syv-skills@syv-skills',
    name: 'syv-skills',
    marketplace: 'syv-skills',
    scope: 'user',
    enabled: true,
  },
  {
    id: 'code-review@official',
    name: 'code-review',
    marketplace: 'official',
    scope: 'project',
    enabled: true,
    projectPath: '/repos/dash',
  },
  {
    id: 'scratch@official',
    name: 'scratch',
    marketplace: 'official',
    scope: 'local',
    enabled: false,
    projectPath: '/repos/wt/feat-x',
  },
  {
    id: 'orphan@x',
    name: 'orphan',
    marketplace: 'x',
    scope: 'project',
    enabled: true,
    projectPath: '/unknown',
  },
];

describe('assignPluginsToScopes', () => {
  it('routes user→global, project/local→scope matching projectPath, drops unmatched', () => {
    const byScope = assignPluginsToScopes(installed, scopes);
    expect(byScope['global']!.map((p) => p.id)).toEqual(['syv-skills@syv-skills']);
    expect(byScope['project:p1']!.map((p) => p.id)).toEqual(['code-review@official']);
    expect(byScope['task:t1']!.map((p) => p.id)).toEqual(['scratch@official']);
    expect(byScope['task:t1']![0]!.enabled).toBe(false);
  });
});

describe('assembleOverview', () => {
  it('composes per-scope plugins + skills into the overview shape', () => {
    const skillsByScope: Record<string, OverviewSkill[]> = {
      global: [{ name: 'pr-review', visibility: 'on', fromRegistry: true }],
      'project:p1': [],
      'task:t1': [{ name: 'scratch-skill', visibility: 'off', fromRegistry: false }],
    };
    const overridesByScope = { 'task:t1': { 'pr-review': 'off' as const } };
    const ov = assembleOverview(scopes, installed, skillsByScope, true, overridesByScope);
    expect(ov.claudeAvailable).toBe(true);
    expect(ov.scopes).toHaveLength(3);
    expect(ov.scopes[0]).toMatchObject({
      scope: { id: 'global' },
      plugins: [{ id: 'syv-skills@syv-skills' }],
      skills: [{ name: 'pr-review' }],
    });
    expect(ov.scopes[2]!.skills[0]).toMatchObject({ name: 'scratch-skill', visibility: 'off' });
  });

  it('attaches each scope’s raw skillOverrides (default {})', () => {
    const ov = assembleOverview(scopes, [], { global: [], 'project:p1': [], 'task:t1': [] }, true, {
      'task:t1': { 'pr-review': 'off' },
    });
    expect(ov.scopes[0]!.skillOverrides).toEqual({});
    expect(ov.scopes[2]!.skillOverrides).toEqual({ 'pr-review': 'off' });
  });
});
