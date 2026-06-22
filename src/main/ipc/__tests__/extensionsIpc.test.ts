import { describe, it, expect } from 'vitest';
import {
  extensionScopeInputSchema,
  setSkillOverrideSchema,
  getPluginComponentsSchema,
  getPluginComponentDetailSchema,
  getSkillDetailSchema,
} from '../extensionsIpc';

describe('extensionScopeInputSchema', () => {
  it('accepts a valid scope input', () => {
    const ok = {
      projects: [{ id: 'p1', name: 'dash', path: '/repos/dash' }],
      tasks: [{ taskId: 't1', name: 'feat', worktreePath: '/wt/feat', projectId: 'p1' }],
    };
    expect(() => extensionScopeInputSchema.parse(ok)).not.toThrow();
  });
  it('rejects a project missing its path', () => {
    expect(() =>
      extensionScopeInputSchema.parse({ projects: [{ id: 'p1', name: 'dash' }], tasks: [] }),
    ).toThrow();
  });
});

describe('setSkillOverrideSchema', () => {
  it('accepts null visibility (clear)', () => {
    const ok = {
      scope: { id: 'global', kind: 'global', name: 'Global', path: '/home/u' },
      skillName: 'deploy',
      visibility: null,
    };
    expect(() => setSkillOverrideSchema.parse(ok)).not.toThrow();
  });
  it('rejects an invalid visibility', () => {
    const bad = {
      scope: { id: 'global', kind: 'global', name: 'Global', path: '/home/u' },
      skillName: 'deploy',
      visibility: 'bogus',
    };
    expect(() => setSkillOverrideSchema.parse(bad)).toThrow();
  });
});

describe('getPluginComponentsSchema', () => {
  it('accepts a plugin id', () => {
    expect(() => getPluginComponentsSchema.parse({ pluginId: 'a@b' })).not.toThrow();
  });
  it('rejects a missing plugin id', () => {
    expect(() => getPluginComponentsSchema.parse({})).toThrow();
  });
});

describe('getPluginComponentDetailSchema', () => {
  it('accepts a plugin id, kind, and name', () => {
    expect(() =>
      getPluginComponentDetailSchema.parse({ pluginId: 'a@b', kind: 'agent', name: 'x' }),
    ).not.toThrow();
  });
  it('rejects an unknown kind', () => {
    expect(() =>
      getPluginComponentDetailSchema.parse({ pluginId: 'a@b', kind: 'mcp', name: 'x' }),
    ).toThrow();
  });
});

describe('getSkillDetailSchema', () => {
  it('accepts a scope + skill name', () => {
    const ok = {
      scope: { id: 'global', kind: 'global', name: 'Global', path: '/home/u' },
      skillName: 'deploy',
    };
    expect(() => getSkillDetailSchema.parse(ok)).not.toThrow();
  });
  it('rejects a missing skill name', () => {
    expect(() =>
      getSkillDetailSchema.parse({
        scope: { id: 'global', kind: 'global', name: 'Global', path: '/home/u' },
      }),
    ).toThrow();
  });
});
