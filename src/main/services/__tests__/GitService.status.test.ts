import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GitService } from '../GitService';

/** Real git: a clone one commit ahead of its upstream and one behind it. */
let root: string;
let clone: string;
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
const write = (file: string, body: string) => fs.writeFileSync(path.join(clone, file), body);
const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i}\n`).join('');
const fileIn = async (cwd: string, p: string, staged: boolean) =>
  (await GitService.getStatus(cwd)).files.find((f) => f.path === p && f.staged === staged);

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-git-status-'));
  const remote = path.join(root, 'remote');
  clone = path.join(root, 'clone');
  fs.mkdirSync(remote);
  git(remote, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(remote, 'a.txt'), lines(3));
  git(remote, 'add', 'a.txt');
  git(remote, 'commit', '-q', '-m', 'base');
  git(root, 'clone', '-q', remote, clone);
  git(remote, 'commit', '-q', '--allow-empty', '-m', 'upstream only');
  git(clone, 'fetch', '-q');
  git(clone, 'commit', '-q', '--allow-empty', '-m', 'local');
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('GitService.getStatus', () => {
  it('reads the branch, HEAD, upstream and ahead/behind from one status', async () => {
    expect(await GitService.getStatus(clone)).toEqual({
      branch: 'main',
      headSha: git(clone, 'rev-parse', 'HEAD'),
      hasUpstream: true,
      upstream: { remote: 'origin', branch: 'main' },
      ahead: 1,
      behind: 1,
      files: [],
    });
  });

  it('recounts a changed file whose status stays the same', async () => {
    write('a.txt', lines(5));
    expect(await fileIn(clone, 'a.txt', false)).toMatchObject({ additions: 2, deletions: 0 });
    write('a.txt', lines(9));
    expect(await fileIn(clone, 'a.txt', false)).toMatchObject({ additions: 6, deletions: 0 });
  });

  it('counts staged changes apart from the worktree ones', async () => {
    git(clone, 'add', 'a.txt');
    write('a.txt', lines(2));
    const status = await GitService.getStatus(clone);
    expect(status.files.find((f) => f.staged)).toMatchObject({ additions: 6, deletions: 0 });
    expect(status.files.find((f) => !f.staged)).toMatchObject({ additions: 0, deletions: 7 });
    git(clone, 'reset', '-q', '--hard');
  });

  it('counts an untracked file again when it grows', async () => {
    write('new.txt', lines(4));
    expect(await fileIn(clone, 'new.txt', false)).toMatchObject({
      status: 'untracked',
      additions: 4,
    });
    write('new.txt', lines(7));
    expect(await fileIn(clone, 'new.txt', false)).toMatchObject({ additions: 7 });
    fs.rmSync(path.join(clone, 'new.txt'));
  });

  it('reads a linked worktree, whose branch tracks nothing', async () => {
    const wt = path.join(root, 'wt');
    git(clone, 'worktree', 'add', '-q', '-b', 'side', wt);
    expect(await GitService.getStatus(wt)).toMatchObject({
      branch: 'side',
      hasUpstream: false,
      upstream: null,
      ahead: 0,
      behind: 0,
    });
  });

  it('has no branch or upstream on a detached HEAD', async () => {
    git(clone, 'checkout', '-q', '--detach');
    expect(await GitService.getStatus(clone)).toMatchObject({
      branch: null,
      headSha: git(clone, 'rev-parse', 'HEAD'),
      hasUpstream: false,
      upstream: null,
    });
    git(clone, 'checkout', '-q', 'main');
  });

  it('is empty outside a repository', async () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-git-plain-'));
    expect(await GitService.getStatus(plain)).toEqual({
      branch: null,
      headSha: null,
      hasUpstream: false,
      upstream: null,
      ahead: 0,
      behind: 0,
      files: [],
    });
    fs.rmSync(plain, { recursive: true, force: true });
  });
});
