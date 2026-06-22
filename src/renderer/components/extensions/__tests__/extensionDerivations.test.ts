import { describe, it, expect } from 'vitest';
import type { ExtensionsOverview, CatalogPlugin } from '../../../../shared/types';
import {
  pluginInstallScopes,
  skillInstallScopes,
  filterCatalogByMarketplace,
  effectivePlugins,
  effectiveSkills,
  inheritingTaskCount,
} from '../extensionDerivations';

const overview: ExtensionsOverview = {
  claudeAvailable: true,
  scopes: [
    {
      scope: { id: 'global', kind: 'global', name: 'Global', path: '/h' },
      plugins: [{ id: 'cr@official', name: 'cr', marketplace: 'official', enabled: true }],
      skills: [{ name: 'pr-review', visibility: 'on', fromRegistry: true }],
      skillOverrides: {},
    },
    {
      scope: { id: 'project:p1', kind: 'project', name: 'dash', path: '/d' },
      plugins: [{ id: 'cr@official', name: 'cr', marketplace: 'official', enabled: true }],
      skills: [],
      skillOverrides: {},
    },
  ],
};

describe('pluginInstallScopes', () => {
  it('returns scope names that have the plugin id', () => {
    expect(pluginInstallScopes(overview, 'cr@official')).toEqual(['Global', 'dash']);
  });
  it('returns [] when not installed anywhere', () => {
    expect(pluginInstallScopes(overview, 'missing@x')).toEqual([]);
  });
});

describe('skillInstallScopes', () => {
  it('returns scope names that have the skill folder', () => {
    expect(skillInstallScopes(overview, 'pr-review')).toEqual(['Global']);
  });
});

describe('filterCatalogByMarketplace', () => {
  const catalog: CatalogPlugin[] = [
    { id: 'a@official', name: 'a', marketplace: 'official' },
    { id: 'b@community', name: 'b', marketplace: 'community' },
  ];
  it('returns all when marketplace is null', () => {
    expect(filterCatalogByMarketplace(catalog, null)).toHaveLength(2);
  });
  it('filters to the chosen marketplace', () => {
    expect(filterCatalogByMarketplace(catalog, 'community').map((p) => p.id)).toEqual([
      'b@community',
    ]);
  });
});

// Global → Project → Task inheritance fixture.
const hierarchy: ExtensionsOverview = {
  claudeAvailable: true,
  scopes: [
    {
      scope: { id: 'global', kind: 'global', name: 'Global', path: '/h' },
      plugins: [{ id: 'g@m', name: 'g', marketplace: 'm', enabled: true }],
      skills: [{ name: 'g-skill', visibility: 'on', fromRegistry: true }],
      skillOverrides: {},
    },
    {
      scope: { id: 'project:p1', kind: 'project', name: 'dash', path: '/d' },
      plugins: [{ id: 'p@m', name: 'p', marketplace: 'm', enabled: true }],
      skills: [{ name: 'p-skill', visibility: 'on', fromRegistry: false }],
      skillOverrides: {},
    },
    {
      scope: { id: 'task:t1', kind: 'task', name: 'feat', path: '/wt', projectId: 'p1' },
      plugins: [{ id: 't@m', name: 't', marketplace: 'm', enabled: true }],
      skills: [{ name: 't-skill', visibility: 'on', fromRegistry: false }],
      // task turns an inherited project skill off, without a local folder
      skillOverrides: { 'p-skill': 'off' },
    },
    {
      scope: { id: 'task:t2', kind: 'task', name: 'fix', path: '/wt2', projectId: 'p1' },
      plugins: [],
      skills: [],
      skillOverrides: {},
    },
  ],
};

const taskScope = hierarchy.scopes[2]!;
const projectScope = hierarchy.scopes[1]!;
const globalScope = hierarchy.scopes[0]!;

describe('effectivePlugins', () => {
  it('marks task plugins inherited from Global, the project, or local', () => {
    const eff = effectivePlugins(hierarchy, taskScope);
    expect(eff.map((e) => [e.plugin.id, e.provenance])).toEqual([
      ['g@m', { kind: 'inherited', from: 'Global' }],
      ['p@m', { kind: 'inherited', from: 'dash' }],
      ['t@m', { kind: 'local' }],
    ]);
  });
  it('treats a child plugin sharing an inherited id as overridden', () => {
    const scope = {
      ...taskScope,
      plugins: [{ id: 'g@m', name: 'g', marketplace: 'm', enabled: false }],
    };
    const eff = effectivePlugins(hierarchy, scope);
    const g = eff.find((e) => e.plugin.id === 'g@m')!;
    expect(g.provenance).toEqual({ kind: 'overridden', from: 'Global' });
    expect(g.plugin.enabled).toBe(false);
  });
  it('at global scope everything is local', () => {
    expect(effectivePlugins(hierarchy, globalScope).map((e) => e.provenance.kind)).toEqual([
      'local',
    ]);
  });
});

describe('effectiveSkills', () => {
  it('includes inherited skills with provenance, owner scope, and overridden visibility', () => {
    const eff = effectiveSkills(hierarchy, taskScope);
    expect(eff).toEqual([
      {
        name: 'g-skill',
        visibility: 'on',
        fromRegistry: true,
        provenance: { kind: 'inherited', from: 'Global' },
        hasLocalFolder: false,
        ownerScope: globalScope.scope,
      },
      {
        name: 'p-skill',
        visibility: 'off',
        fromRegistry: false,
        provenance: { kind: 'overridden', from: 'dash' },
        hasLocalFolder: false,
        ownerScope: projectScope.scope,
      },
      {
        name: 't-skill',
        visibility: 'on',
        fromRegistry: false,
        provenance: { kind: 'local' },
        hasLocalFolder: true,
        ownerScope: taskScope.scope,
      },
    ]);
  });
  it('at project scope inherits only from Global', () => {
    const eff = effectiveSkills(hierarchy, projectScope);
    expect(eff.map((e) => [e.name, e.provenance])).toEqual([
      ['g-skill', { kind: 'inherited', from: 'Global' }],
      ['p-skill', { kind: 'local' }],
    ]);
  });
  it('a project skill the worktree shares is inherited (not overridden) and read locally', () => {
    // The task worktree physically holds the project's committed `p-skill` folder.
    const sharing: typeof taskScope = {
      ...taskScope,
      skills: [{ name: 'p-skill', visibility: 'on', fromRegistry: false }],
      skillOverrides: {},
    };
    const p = effectiveSkills(hierarchy, sharing).find((e) => e.name === 'p-skill')!;
    expect(p.provenance).toEqual({ kind: 'inherited', from: 'dash' });
    expect(p.hasLocalFolder).toBe(true);
    expect(p.ownerScope.id).toBe('task:t1');
  });
});

describe('inheritingTaskCount', () => {
  it('counts task scopes under a project', () => {
    expect(inheritingTaskCount(hierarchy, 'project:p1')).toBe(2);
  });
  it('is 0 for an unknown project', () => {
    expect(inheritingTaskCount(hierarchy, 'project:none')).toBe(0);
  });
});
