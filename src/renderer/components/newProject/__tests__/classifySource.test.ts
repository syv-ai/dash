import { describe, it, expect } from 'vitest';
import { classifySource, isPathInput, usualProjectsDir, type PathFacts } from '../classifySource';

function facts(input: string, over: Partial<PathFacts> = {}): PathFacts {
  return {
    input,
    path: input.replace(/^~/, '/Users/me'),
    exists: false,
    isDirectory: false,
    isGitRepo: false,
    parentExists: true,
    project: null,
    ...over,
  };
}

describe('classifySource: empty and junk', () => {
  it('is empty for nothing or whitespace', () => {
    expect(classifySource('', null)).toEqual({ kind: 'empty' });
    expect(classifySource('   ', null)).toEqual({ kind: 'empty' });
  });

  it('is invalid for a bare word or a relative path', () => {
    expect(classifySource('hello', null).kind).toBe('invalid');
    expect(classifySource('./foo', null).kind).toBe('invalid');
    expect(classifySource('hello world/x y', null).kind).toBe('invalid');
  });
});

describe('classifySource: GitHub', () => {
  it('reads an https URL, with or without .git, and names it after the repo', () => {
    expect(classifySource('https://github.com/syv-ai/dash', null)).toEqual({
      kind: 'github',
      url: 'https://github.com/syv-ai/dash.git',
      name: 'dash',
    });
    expect(classifySource('https://github.com/syv-ai/dash.git', null)).toMatchObject({
      kind: 'github',
      url: 'https://github.com/syv-ai/dash.git',
    });
  });

  it('trims a browser URL down to the repository', () => {
    expect(
      classifySource('https://github.com/syv-ai/dash/tree/main/src?x=1#y', null),
    ).toMatchObject({ kind: 'github', url: 'https://github.com/syv-ai/dash.git', name: 'dash' });
  });

  it('keeps an ssh URL as typed', () => {
    expect(classifySource('git@github.com:syv-ai/dash.git', null)).toEqual({
      kind: 'github',
      url: 'git@github.com:syv-ai/dash.git',
      name: 'dash',
    });
    expect(classifySource('ssh://git@github.com/syv-ai/dash', null)).toMatchObject({
      kind: 'github',
      url: 'ssh://git@github.com/syv-ai/dash',
      name: 'dash',
    });
  });

  it('reads github.com/o/r and the o/r shorthand as https', () => {
    expect(classifySource('github.com/octocat/Hello-World', null)).toEqual({
      kind: 'github',
      url: 'https://github.com/octocat/Hello-World.git',
      name: 'Hello-World',
    });
    expect(classifySource('octocat/Hello-World', null)).toEqual({
      kind: 'github',
      url: 'https://github.com/octocat/Hello-World.git',
      name: 'Hello-World',
    });
  });

  it('needs an owner and a repo', () => {
    expect(classifySource('https://github.com/syv-ai', null).kind).toBe('invalid');
  });
});

describe('classifySource: Azure DevOps', () => {
  it('reads dev.azure.com, with or without a user', () => {
    expect(classifySource('https://dev.azure.com/acme/Platform/_git/api', null)).toEqual({
      kind: 'ado',
      url: 'https://dev.azure.com/acme/Platform/_git/api',
      name: 'api',
    });
    expect(
      classifySource('https://acme@dev.azure.com/acme/Platform/_git/api?path=/src', null),
    ).toEqual({
      kind: 'ado',
      url: 'https://acme@dev.azure.com/acme/Platform/_git/api',
      name: 'api',
    });
  });

  it('reads visualstudio.com and the ssh forms', () => {
    expect(
      classifySource('https://acme.visualstudio.com/DefaultCollection/Platform/_git/api', null),
    ).toMatchObject({ kind: 'ado', name: 'api' });
    expect(classifySource('git@ssh.dev.azure.com:v3/acme/Platform/api', null)).toEqual({
      kind: 'ado',
      url: 'git@ssh.dev.azure.com:v3/acme/Platform/api',
      name: 'api',
    });
    expect(classifySource('acme@vs-ssh.visualstudio.com:v3/acme/Platform/api', null)).toMatchObject(
      { kind: 'ado', name: 'api' },
    );
  });
});

describe('classifySource: other git hosts', () => {
  it('reads any other URL or scp-like address', () => {
    expect(classifySource('https://gitlab.com/group/sub/thing.git', null)).toEqual({
      kind: 'other-git',
      url: 'https://gitlab.com/group/sub/thing.git',
      name: 'thing',
    });
    expect(classifySource('git@bitbucket.org:team/repo.git', null)).toMatchObject({
      kind: 'other-git',
      name: 'repo',
    });
  });

  it('is invalid for a URL with no repo name', () => {
    expect(classifySource('https://gitlab.com/', null).kind).toBe('invalid');
  });
});

describe('classifySource: paths', () => {
  it('waits for the facts of the path typed', () => {
    expect(isPathInput('~/code/x')).toBe(true);
    expect(isPathInput('/tmp')).toBe(true);
    expect(isPathInput('octocat/x')).toBe(false);
    expect(classifySource('~/code/x', null)).toEqual({ kind: 'checking' });
    // Facts for an earlier input are stale.
    expect(classifySource('~/code/xy', facts('~/code/x'))).toEqual({ kind: 'checking' });
  });

  it('is a local repo when the folder has .git', () => {
    const f = facts('~/code/dash', { exists: true, isDirectory: true, isGitRepo: true });
    expect(classifySource('~/code/dash', f)).toEqual({
      kind: 'local-repo',
      path: '/Users/me/code/dash',
      name: 'dash',
    });
  });

  it('is a local folder when it exists without git', () => {
    const f = facts('/tmp/notes/', { path: '/tmp/notes', exists: true, isDirectory: true });
    expect(classifySource('/tmp/notes/', f)).toEqual({
      kind: 'local-folder',
      path: '/tmp/notes',
      name: 'notes',
    });
  });

  it('is a new folder when only its parent exists', () => {
    expect(classifySource('~/code/fresh', facts('~/code/fresh'))).toEqual({
      kind: 'new-folder',
      path: '/Users/me/code/fresh',
      name: 'fresh',
    });
  });

  it('is invalid when neither it nor its parent exists, or it is a file', () => {
    expect(classifySource('~/a/b', facts('~/a/b', { parentExists: false })).kind).toBe('invalid');
    expect(
      classifySource('/etc/hosts', facts('/etc/hosts', { exists: true, isDirectory: false })).kind,
    ).toBe('invalid');
  });

  it('opens the project a folder already is', () => {
    const f = facts('~/code/dash', {
      exists: true,
      isDirectory: true,
      isGitRepo: true,
      project: { id: 'p1', name: 'Dash', relation: 'same', archived: false },
    });
    expect(classifySource('~/code/dash', f)).toEqual({
      kind: 'project',
      projectId: 'p1',
      name: 'Dash',
    });
  });

  it('refuses a folder inside a project, a worktree of one, or an archived one', () => {
    const base = { exists: true, isDirectory: true, isGitRepo: true };
    const inside = facts('~/code/dash/src', {
      ...base,
      project: { id: 'p1', name: 'Dash', relation: 'inside', archived: false },
    });
    expect(classifySource('~/code/dash/src', inside)).toMatchObject({ kind: 'invalid' });
    const archived = facts('~/code/dash', {
      ...base,
      project: { id: 'p1', name: 'Dash', relation: 'same', archived: true },
    });
    expect(classifySource('~/code/dash', archived)).toMatchObject({ kind: 'invalid' });
  });
});

describe('usualProjectsDir', () => {
  it("is the folder most projects sit in, or the home folder's", () => {
    expect(
      usualProjectsDir(['/Users/me/repos/a', '/Users/me/repos/b', '/Users/me/x/c'], '/Users/me'),
    ).toBe('/Users/me/repos');
    expect(usualProjectsDir([], '/Users/me')).toBe('/Users/me');
  });
});

describe('classifySource: ADO names', () => {
  it('decodes a repository name with spaces', () => {
    expect(
      classifySource('https://dev.azure.com/acme/Platform/_git/My%20Repo', null),
    ).toMatchObject({ kind: 'ado', name: 'My Repo' });
  });
});
