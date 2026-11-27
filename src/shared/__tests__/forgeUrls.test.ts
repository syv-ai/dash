import { describe, it, expect } from 'vitest';
import {
  branchUrl,
  forgeBranchUrl,
  forgeCommitUrl,
  githubProfileUrl,
  parseForgeRepo,
} from '../urls';

describe('parseForgeRepo', () => {
  it.each([
    ['git@github.com:syv-ai/dash.git', 'https://github.com/syv-ai/dash'],
    ['git@github.com:syv-ai/dash', 'https://github.com/syv-ai/dash'],
    ['ssh://git@github.com/syv-ai/dash.git', 'https://github.com/syv-ai/dash'],
    ['https://github.com/syv-ai/dash.git', 'https://github.com/syv-ai/dash'],
    ['https://user@github.com/syv-ai/dash/', 'https://github.com/syv-ai/dash'],
  ])('reads GitHub from %s', (remote, webUrl) => {
    expect(parseForgeRepo(remote)).toEqual({ kind: 'github', webUrl });
  });

  it.each([
    ['git@gitlab.com:group/sub/proj.git', 'https://gitlab.com/group/sub/proj'],
    ['https://gitlab.com/group/proj.git', 'https://gitlab.com/group/proj'],
    ['git@gitlab.example.com:team/proj.git', 'https://gitlab.example.com/team/proj'],
  ])('reads GitLab from %s', (remote, webUrl) => {
    expect(parseForgeRepo(remote)).toEqual({ kind: 'gitlab', webUrl });
  });

  it.each([
    [
      'https://org@dev.azure.com/org/My%20Proj/_git/repo',
      'https://dev.azure.com/org/My%20Proj/_git/repo',
    ],
    ['git@ssh.dev.azure.com:v3/org/proj/repo', 'https://dev.azure.com/org/proj/_git/repo'],
    ['https://org.visualstudio.com/proj/_git/repo', 'https://dev.azure.com/org/proj/_git/repo'],
  ])('reads Azure DevOps from %s', (remote, webUrl) => {
    expect(parseForgeRepo(remote)).toEqual({ kind: 'ado', webUrl });
  });

  it('knows no forge for other hosts, a repo-less ADO remote or nothing', () => {
    expect(parseForgeRepo('git@bitbucket.org:o/r.git')).toBeNull();
    expect(parseForgeRepo('/srv/git/repo.git')).toBeNull();
    expect(parseForgeRepo('https://dev.azure.com/org/proj')).toBeNull();
    expect(parseForgeRepo(null)).toBeNull();
  });
});

describe('forgeBranchUrl', () => {
  const gh = { kind: 'github', webUrl: 'https://github.com/o/r' } as const;
  const gl = { kind: 'gitlab', webUrl: 'https://gitlab.com/g/p' } as const;
  const ado = { kind: 'ado', webUrl: 'https://dev.azure.com/org/p/_git/r' } as const;

  it('keeps the slashes of a GitHub or GitLab branch and encodes the rest', () => {
    expect(forgeBranchUrl(gh, 'feat/a b#1')).toBe('https://github.com/o/r/tree/feat/a%20b%231');
    expect(forgeBranchUrl(gl, 'feat/x')).toBe('https://gitlab.com/g/p/-/tree/feat/x');
  });

  it('passes an ADO branch as an encoded version query', () => {
    expect(forgeBranchUrl(ado, 'feat/x')).toBe(
      'https://dev.azure.com/org/p/_git/r?version=GBfeat%2Fx',
    );
  });

  it('branchUrl goes from a remote straight to the branch page, or null', () => {
    expect(branchUrl('git@github.com:o/r.git', 'main')).toBe('https://github.com/o/r/tree/main');
    expect(branchUrl('git@bitbucket.org:o/r.git', 'main')).toBeNull();
  });
});

describe('forgeCommitUrl', () => {
  it('builds each forge commit page', () => {
    expect(forgeCommitUrl({ kind: 'github', webUrl: 'https://github.com/o/r' }, 'abc')).toBe(
      'https://github.com/o/r/commit/abc',
    );
    expect(forgeCommitUrl({ kind: 'gitlab', webUrl: 'https://gitlab.com/g/p' }, 'abc')).toBe(
      'https://gitlab.com/g/p/-/commit/abc',
    );
    expect(
      forgeCommitUrl({ kind: 'ado', webUrl: 'https://dev.azure.com/org/p/_git/r' }, 'abc'),
    ).toBe('https://dev.azure.com/org/p/_git/r/commit/abc');
  });
});

describe('githubProfileUrl', () => {
  it('links a login on a GitHub remote to its profile', () => {
    expect(githubProfileUrl('git@github.com:syv-ai/dash.git', 'octo-cat')).toBe(
      'https://github.com/octo-cat',
    );
  });

  it('has none for another forge, no remote or no login', () => {
    expect(githubProfileUrl('git@gitlab.com:group/proj.git', 'octo')).toBeNull();
    expect(githubProfileUrl('https://dev.azure.com/org/proj/_git/repo', 'Jane Doe')).toBeNull();
    expect(githubProfileUrl(null, 'octo')).toBeNull();
    expect(githubProfileUrl('git@github.com:syv-ai/dash.git', '')).toBeNull();
  });
});
