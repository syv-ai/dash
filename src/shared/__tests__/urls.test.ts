import { describe, it, expect } from 'vitest';
import { parseAdoRemote, isAdoRemote } from '../urls';

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
