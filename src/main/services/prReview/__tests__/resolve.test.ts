import { describe, it, expect } from 'vitest';
import type { AzureDevOpsConfig, Project } from '../../../../shared/types';
import { prContextFor, type PrContextDeps } from '../resolve';

const project = (gitRemote: string | null): Project => ({
  id: 'p1',
  name: 'p',
  path: '/repo',
  isGitRepo: true,
  gitRemote,
  gitBranch: 'main',
  baseRef: null,
  archivedAt: null,
  createdAt: '',
  updatedAt: '',
});
const ado: AzureDevOpsConfig = {
  organizationUrl: 'https://dev.azure.com/org',
  project: 'Proj',
  pat: 'x',
};
const deps = (remote: string | null, config: AzureDevOpsConfig | null = null): PrContextDeps => ({
  getProject: (id) => (id === 'p1' ? project(remote) : undefined),
  getAdoConfig: () => config,
});

describe('prContextFor', () => {
  it('uses GitHub for a GitHub remote, or no remote', () => {
    for (const remote of ['git@github.com:o/r.git', null]) {
      const r = prContextFor('p1', '/wt', deps(remote));
      expect(r.provider).toBe('github');
      expect(r.ctx).toEqual({ cwd: '/wt', projectId: 'p1', remote });
    }
  });

  it('needs an ADO config and a repository for an ADO remote', () => {
    const remote = 'git@ssh.dev.azure.com:v3/org/Proj/repo';
    expect(() => prContextFor('p1', '/wt', deps(remote))).toThrow('Azure DevOps not configured');
    expect(() => prContextFor('p1', '/wt', deps('https://dev.azure.com/org/Proj', ado))).toThrow(
      'Could not determine repository from remote',
    );
  });

  it('passes an ADO remote its config and repository', () => {
    const remote = 'git@ssh.dev.azure.com:v3/org/Proj/repo';
    const r = prContextFor('p1', '/wt', deps(remote, ado));
    expect(r.provider).toBe('ado');
    expect(r.ctx.ado).toEqual({ ...ado, repository: 'repo' });
  });

  it('refuses an unknown project', () => {
    expect(() => prContextFor('nope', '/wt', deps(null))).toThrow('Unknown project');
  });
});
