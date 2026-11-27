import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const broadcast = vi.fn();
vi.mock('../../utils/broadcast', () => ({ broadcast: (...a: unknown[]) => broadcast(...a) }));

import { resolveGitDirs, startWatching, stopAll } from '../FileWatcherService';

/** Real git: a repository and a linked worktree of it, whose `.git` is a file. */
let root: string;
let repo: string;
let worktree: string;
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
    cwd,
    stdio: 'ignore',
  });

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dash-git-watch-')));
  repo = path.join(root, 'repo');
  worktree = path.join(root, 'wt');
  fs.mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'base');
  git(repo, 'worktree', 'add', '-q', '-b', 'side', worktree);
});

afterEach(() => {
  stopAll();
  broadcast.mockClear();
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/** Resolves once `git:fileChanged` went out for `id`. */
const changed = (id: string) =>
  vi.waitFor(() => expect(broadcast).toHaveBeenCalledWith('git:fileChanged', id), {
    timeout: 4000,
    interval: 50,
  });

describe('resolveGitDirs', () => {
  it("is the checkout's .git folder for both in a main checkout", () => {
    const dotGit = path.join(repo, '.git');
    expect(resolveGitDirs(repo)).toEqual({ gitDir: dotGit, commonDir: dotGit });
  });

  it("follows a worktree's .git file to its own dir and the shared one", () => {
    expect(resolveGitDirs(worktree)).toEqual({
      gitDir: path.join(repo, '.git', 'worktrees', 'wt'),
      commonDir: path.join(repo, '.git'),
    });
  });

  it('falls back to <cwd>/.git outside a repository', () => {
    const dotGit = path.join(root, '.git');
    expect(resolveGitDirs(root)).toEqual({ gitDir: dotGit, commonDir: dotGit });
  });
});

describe('startWatching', () => {
  it("reports a change to a linked worktree's index", async () => {
    startWatching('wt', worktree);
    fs.writeFileSync(path.join(worktree, 'a.txt'), 'a\n');
    git(worktree, 'add', 'a.txt');
    await changed('wt');
  });

  it("reports a change to a main checkout's index", async () => {
    startWatching('repo', repo);
    fs.writeFileSync(path.join(repo, 'b.txt'), 'b\n');
    git(repo, 'add', 'b.txt');
    await changed('repo');
  });
});
