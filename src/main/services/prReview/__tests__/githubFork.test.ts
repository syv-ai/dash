import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }));

import { GithubService } from '../../GithubService';
import { deleteOwnPushedBranch, ownPushedBranch } from '../../WorktreeService';

/**
 * The real git path, end to end: a bare repo stands in for origin, with
 * GitHub's `refs/pull/<n>/head` for a fork's PR 7 (head `fix/typo`, a name
 * origin's own `fix/typo` shares) and a same-repo PR 8 (head `feat/a`).
 */
describe('a GitHub PR task branch, and deleting its remote branch', () => {
  let dir: string;
  let origin: string;
  let work: string;
  let checkout: string;
  let forkHead: string;
  let originTypo: string;
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
  const commit = (cwd: string, file: string, msg: string) => {
    writeFileSync(path.join(cwd, file), `${msg}\n`);
    git(cwd, 'add', '.');
    git(cwd, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', msg);
    return git(cwd, 'rev-parse', 'HEAD');
  };
  const remoteTip = (branch: string) => git(origin, 'rev-parse', '--verify', '--quiet', branch);
  const hasUpstream = (branch: string) => {
    try {
      git(checkout, 'config', '--get', `branch.${branch}.remote`);
      return true;
    } catch {
      return false;
    }
  };

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'dash-ghfork-'));
    origin = path.join(dir, 'origin.git');
    work = path.join(dir, 'work');
    checkout = path.join(dir, 'checkout');
    git(dir, 'init', '-q', '--bare', '-b', 'main', origin);
    git(dir, 'clone', '-q', origin, work);
    git(work, 'checkout', '-qb', 'main');
    commit(work, 'a.txt', 'base');
    git(work, 'push', '-q', 'origin', 'main');
    // Origin's own fix/typo, unrelated to the fork's.
    git(work, 'checkout', '-qb', 'fix/typo');
    originTypo = commit(work, 'o.txt', "origin's typo fix");
    git(work, 'push', '-q', 'origin', 'fix/typo');
    // The fork's fix/typo, which origin holds only as PR 7's head.
    git(work, 'checkout', '-q', '-b', 'fork-typo', 'main');
    forkHead = commit(work, 'f.txt', "the fork's typo fix");
    git(work, 'push', '-q', 'origin', 'HEAD:refs/pull/7/head');
    // A same-repo PR: origin's feat/a, and PR 8's head on it.
    git(work, 'checkout', '-q', '-b', 'feat/a', 'main');
    commit(work, 'b.txt', 'feature');
    git(work, 'push', '-q', 'origin', 'feat/a', 'HEAD:refs/pull/8/head');
    git(dir, 'clone', '-q', origin, checkout);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("puts a fork PR's head on pr/<n>/<head> with no upstream, leaving origin's same-named branch alone", async () => {
    const branch = await GithubService.fetchPullRequestBranch(checkout, {
      number: 7,
      headRefName: 'fix/typo',
      fromFork: true,
    });
    expect(branch).toBe('pr/7/fix/typo');
    expect(git(checkout, 'rev-parse', 'refs/heads/pr/7/fix/typo')).toBe(forkHead);
    expect(hasUpstream(branch)).toBe(false);
    expect(() =>
      git(checkout, 'rev-parse', '--verify', '--quiet', 'refs/heads/fix/typo'),
    ).toThrow();
    // A push from the task fails rather than landing on origin.
    git(checkout, 'checkout', '-q', branch);
    expect(() =>
      git(checkout, '-c', 'push.default=simple', '-c', 'push.autoSetupRemote=false', 'push'),
    ).toThrow(/no upstream/);
    // And deleting the task never touches origin's fix/typo.
    expect(await ownPushedBranch(checkout, branch)).toBeNull();
    expect(remoteTip('fix/typo')).toBe(originTypo);
  });

  it("puts a same-repo PR's head on its own branch, tracking origin's, and fast-forwards it later", async () => {
    const pr = { number: 8, headRefName: 'feat/a', fromFork: false };
    expect(await GithubService.fetchPullRequestBranch(checkout, pr)).toBe('feat/a');
    expect(git(checkout, 'rev-parse', '--abbrev-ref', 'feat/a@{upstream}')).toBe('origin/feat/a');
    const next = commit(work, 'c.txt', 'more feature');
    git(work, 'push', '-q', 'origin', 'feat/a');
    await GithubService.fetchPullRequestBranch(checkout, pr);
    expect(git(checkout, 'rev-parse', 'refs/heads/feat/a')).toBe(next);
  });

  it("keeps a task branch that diverged from the PR's head", async () => {
    const pr = { number: 8, headRefName: 'feat/a', fromFork: false };
    await GithubService.fetchPullRequestBranch(checkout, pr);
    git(checkout, 'checkout', '-q', 'feat/a');
    const local = commit(checkout, 'd.txt', 'local work');
    git(checkout, 'checkout', '-q', 'main');
    commit(work, 'e.txt', 'remote work');
    git(work, 'push', '-q', 'origin', 'feat/a');
    await GithubService.fetchPullRequestBranch(checkout, pr);
    expect(git(checkout, 'rev-parse', 'refs/heads/feat/a')).toBe(local);
  });

  it("never deletes origin's branch from a task made before the fix, on a fork's head under its bare name", async () => {
    git(checkout, 'fetch', '-q', 'origin', 'pull/7/head:fix/typo');
    expect(await ownPushedBranch(checkout, 'fix/typo')).toBeNull();
  });

  it("deletes the task's own pushed branch, but not once someone else has pushed to it", async () => {
    git(checkout, 'checkout', '-qb', 'task/x');
    commit(checkout, 'x.txt', 'task work');
    git(checkout, 'push', '-q', '-u', 'origin', 'task/x');
    git(checkout, 'branch', '-q', 'task/y');
    git(checkout, 'push', '-q', '-u', 'origin', 'task/y');
    const own = await ownPushedBranch(checkout, 'task/x');
    expect(own).toEqual({ ref: 'refs/heads/task/x', sha: git(checkout, 'rev-parse', 'task/x') });
    await deleteOwnPushedBranch(checkout, own!);
    expect(() => remoteTip('task/x')).toThrow();

    const ownY = (await ownPushedBranch(checkout, 'task/y'))!;
    git(work, 'fetch', '-q', 'origin', 'task/y:task/y');
    git(work, 'checkout', '-q', 'task/y');
    const theirs = commit(work, 'y.txt', "someone else's work");
    git(work, 'push', '-q', 'origin', 'task/y');
    await expect(deleteOwnPushedBranch(checkout, ownY)).rejects.toThrow(/stale info|rejected/);
    expect(remoteTip('task/y')).toBe(theirs);
  });

  it("leaves alone the branch a task's branch was cut from", async () => {
    git(checkout, 'branch', '-q', '--track', 'task/z', 'origin/feat/a');
    expect(await ownPushedBranch(checkout, 'task/z')).toBeNull();
    git(checkout, 'push', '-q', 'origin', 'main:refs/heads/dev');
    git(checkout, 'fetch', '-q', 'origin');
    git(checkout, 'branch', '-q', '--track', 'dev', 'origin/dev');
    expect(await ownPushedBranch(checkout, 'dev')).toBeNull();
  });
});
