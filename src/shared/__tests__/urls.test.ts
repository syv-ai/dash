import { describe, it, expect } from 'vitest';
import { parseAdoRemote, isAdoRemote, normalizeAdoProject, providerForRemote } from '../urls';

describe('normalizeAdoProject', () => {
  it('decodes a percent-encoded name saved from a remote (the double-encoding 404)', () => {
    expect(normalizeAdoProject('AI%20og%20DT')).toBe('AI og DT');
  });
  it('leaves a plain name alone, trimming whitespace', () => {
    expect(normalizeAdoProject('  AI og DT ')).toBe('AI og DT');
  });
  it('keeps a name that is not valid percent-encoding', () => {
    expect(normalizeAdoProject('50% done')).toBe('50% done');
  });
});

describe('parseAdoRemote', () => {
  it('parses a standard dev.azure.com HTTPS remote', () => {
    expect(parseAdoRemote('https://dev.azure.com/org/proj/_git/repo')).toEqual({
      organizationUrl: 'https://dev.azure.com/org',
      project: 'proj',
      repository: 'repo',
    });
  });

  it('parses an HTTPS remote with the org@ userinfo prefix (ADO clone-dialog default)', () => {
    // Regression: the old regexes rejected the userinfo prefix outright, so the
    // repository was never extracted and both PR features silently failed.
    expect(parseAdoRemote('https://org@dev.azure.com/org/proj/_git/repo')).toEqual({
      organizationUrl: 'https://dev.azure.com/org',
      project: 'proj',
      repository: 'repo',
    });
  });

  it('tolerates a trailing slash and a .git suffix', () => {
    expect(parseAdoRemote('https://dev.azure.com/org/proj/_git/repo/')).toMatchObject({
      repository: 'repo',
    });
    expect(parseAdoRemote('https://dev.azure.com/org/proj/_git/repo.git')).toMatchObject({
      repository: 'repo',
    });
  });

  it('decodes a URL-encoded project name', () => {
    expect(parseAdoRemote('https://dev.azure.com/org/My%20Project/_git/repo')).toMatchObject({
      project: 'My Project',
      repository: 'repo',
    });
  });

  it('parses a remote with no repo segment but leaves repository undefined', () => {
    expect(parseAdoRemote('https://dev.azure.com/org/proj')).toEqual({
      organizationUrl: 'https://dev.azure.com/org',
      project: 'proj',
      repository: undefined,
    });
  });

  it('parses the SSH form (with and without .git)', () => {
    expect(parseAdoRemote('git@ssh.dev.azure.com:v3/org/proj/repo')).toEqual({
      organizationUrl: 'https://dev.azure.com/org',
      project: 'proj',
      repository: 'repo',
    });
    expect(parseAdoRemote('git@ssh.dev.azure.com:v3/org/proj/repo.git')).toMatchObject({
      repository: 'repo',
    });
  });

  it('parses the legacy visualstudio.com form (org is the subdomain)', () => {
    expect(parseAdoRemote('https://org.visualstudio.com/proj/_git/repo')).toEqual({
      organizationUrl: 'https://dev.azure.com/org',
      project: 'proj',
      repository: 'repo',
    });
    expect(parseAdoRemote('https://org@org.visualstudio.com/proj/_git/repo')).toMatchObject({
      organizationUrl: 'https://dev.azure.com/org',
      repository: 'repo',
    });
  });

  it('returns null for non-ADO remotes', () => {
    expect(parseAdoRemote('https://github.com/owner/repo')).toBeNull();
    expect(parseAdoRemote('git@github.com:owner/repo.git')).toBeNull();
    expect(parseAdoRemote('not a url')).toBeNull();
  });

  it('isAdoRemote recognizes the org@ HTTPS form', () => {
    expect(isAdoRemote('https://org@dev.azure.com/org/proj/_git/repo')).toBe(true);
    expect(isAdoRemote('https://github.com/owner/repo')).toBe(false);
    expect(isAdoRemote(null)).toBe(false);
  });
});

describe('providerForRemote', () => {
  it('places GitHub and Azure DevOps remotes', () => {
    expect(providerForRemote('git@github.com:o/r.git')).toBe('github');
    expect(providerForRemote('https://github.com/o/r')).toBe('github');
    expect(providerForRemote('git@ssh.dev.azure.com:v3/org/Proj/repo')).toBe('ado');
    expect(providerForRemote('https://org@dev.azure.com/org/Proj/_git/repo')).toBe('ado');
  });

  it('has no provider without a remote, or on a forge Dash has none for', () => {
    expect(providerForRemote(null)).toBeNull();
    for (const remote of [
      'git@gitlab.com:o/r.git',
      'https://gitlab.example.com/o/r',
      'git@bitbucket.org:o/r.git',
      'https://codeberg.org/o/r',
      'https://git.sr.ht/~o/r',
    ]) {
      expect(providerForRemote(remote)).toBeNull();
    }
  });

  it("keeps a host it can't place on GitHub, which gh resolves (Enterprise, SSH aliases)", () => {
    expect(providerForRemote('git@github-work:o/r.git')).toBe('github');
    expect(providerForRemote('https://github.example.com/o/r.git')).toBe('github');
  });
});
