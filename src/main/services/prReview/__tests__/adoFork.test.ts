import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import forkPr from './fixtures/ado-fork-pr.json';
import adoPr from './fixtures/ado-pr.json';
import { adoForkHead, fetchAdoForkHead } from '../adoFork';
import { runGit, type RunGit } from '../localCommits';
import { makeAdoProvider, type AdoDeps } from '../ado';

const HTTPS_ORIGIN = 'https://org@dev.azure.com/org/Proj/_git/repo';
const SSH_ORIGIN = 'git@ssh.dev.azure.com:v3/org/Proj/repo';

describe('adoForkHead', () => {
  it("reads a fork PR's clone URL, source ref and head from the PR", () => {
    expect(adoForkHead(forkPr, HTTPS_ORIGIN)).toEqual({
      url: 'https://org@dev.azure.com/org/Forks/_git/repo-fork',
      ref: 'refs/heads/feature/x',
      sha: '1'.repeat(40),
    });
  });

  it("takes the fork's ssh URL when origin is ssh, the https one when that's all there is", () => {
    expect(adoForkHead(forkPr, SSH_ORIGIN)?.url).toBe(
      'git@ssh.dev.azure.com:v3/org/Forks/repo-fork',
    );
    const httpsOnly = {
      ...forkPr,
      forkSource: {
        ...forkPr.forkSource,
        repository: { remoteUrl: forkPr.forkSource.repository.remoteUrl },
      },
    };
    expect(adoForkHead(httpsOnly, SSH_ORIGIN)?.url).toBe(forkPr.forkSource.repository.remoteUrl);
  });

  it('is null for a PR from a branch of the repo itself', () => {
    expect(adoForkHead(adoPr, HTTPS_ORIGIN)).toBeNull();
  });

  it('hands git no URL that is not https or ssh, and no head before the first merge', () => {
    for (const remoteUrl of ['ext::sh -c touch% /tmp/x', '--upload-pack=x', 'file:///tmp/fork']) {
      const pr = {
        ...forkPr,
        forkSource: { repository: { remoteUrl } },
        lastMergeSourceCommit: null,
      };
      expect(adoForkHead(pr, HTTPS_ORIGIN)).toEqual({
        url: null,
        ref: 'refs/heads/feature/x',
        sha: null,
      });
    }
  });
});

describe('the ADO forge, preparing a fork PR', () => {
  it("puts the fork's head on pr/<id>/<branch>, and a same-repo PR's on its own branch", async () => {
    const calls: unknown[][] = [];
    const answers: Record<string, unknown> = { 'pullRequests/7': forkPr, 'pullRequests/3': adoPr };
    const deps = {
      request: async (_c: unknown, p: string) =>
        answers[Object.keys(answers).find((k) => p.endsWith(k))!],
      fetchBranch: async (...a: unknown[]) => void calls.push(['branch', ...a.slice(1)]),
      fetchForkHead: async (...a: unknown[]) => void calls.push(['fork', ...a.slice(1)]),
    } as unknown as AdoDeps;
    const ctx = {
      cwd: '/repo',
      projectId: 'p1',
      remote: HTTPS_ORIGIN,
      ado: {
        organizationUrl: 'https://dev.azure.com/org',
        project: 'Proj',
        repository: 'repo',
        pat: 'x',
      },
    };
    const forge = makeAdoProvider(deps);
    expect(await forge.prepareBranch(ctx, { number: 7, headRefName: 'feature/x' })).toBe(
      'pr/7/feature/x',
    );
    expect(await forge.prepareBranch(ctx, { number: 3, headRefName: 'feature/wire-inputs' })).toBe(
      'feature/wire-inputs',
    );
    expect(calls).toEqual([
      ['fork', 7, adoForkHead(forkPr, HTTPS_ORIGIN), 'pr/7/feature/x'],
      ['branch', 'feature/wire-inputs'],
    ]);
  });
});

/**
 * The real git path, end to end: two bare repos stand in for the target
 * (origin, with Azure Repos' `refs/pull/<id>/merge`) and the fork.
 */
describe('fetchAdoForkHead', () => {
  let dir: string;
  let checkout: string;
  let fork: string;
  let head: string;
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  const commit = (cwd: string, file: string, msg: string) => {
    writeFileSync(path.join(cwd, file), `${msg}\n`);
    git(cwd, 'add', '.');
    git(cwd, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', msg);
    return git(cwd, 'rev-parse', 'HEAD');
  };
  const recording = () => {
    const calls: string[][] = [];
    const run: RunGit = (cwd, args, t) => (calls.push(args), runGit(cwd, args, t));
    return { run, calls };
  };

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'dash-adofork-'));
    const origin = path.join(dir, 'origin.git');
    fork = path.join(dir, 'fork.git');
    const work = path.join(dir, 'work');
    checkout = path.join(dir, 'checkout');
    git(dir, 'init', '-q', '--bare', '-b', 'main', origin);
    git(dir, 'clone', '-q', origin, work);
    git(work, 'checkout', '-qb', 'main');
    commit(work, 'a.txt', 'base');
    git(work, 'push', '-q', 'origin', 'main');
    git(dir, 'clone', '-q', '--bare', origin, fork);
    // The fork's PR branch, pushed only to the fork.
    git(work, 'checkout', '-qb', 'feature/x');
    head = commit(work, 'b.txt', 'fork work');
    git(work, 'push', '-q', fork, 'feature/x');
    // What Azure Repos keeps in the target: the PR's merge, head as its second parent.
    git(work, 'checkout', '-q', 'main');
    commit(work, 'c.txt', 'main moves on');
    git(
      work,
      '-c',
      'user.email=t@t',
      '-c',
      'user.name=t',
      'merge',
      '-q',
      '--no-ff',
      '-m',
      'Merge PR 7',
      'feature/x',
    );
    git(work, 'push', '-q', 'origin', 'HEAD:refs/pull/7/merge');
    git(dir, 'clone', '-q', origin, checkout);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const at = (branch: string) => git(checkout, 'rev-parse', `refs/heads/${branch}`);
  const upstream = (branch: string) =>
    execFileSync('git', ['config', '--get', `branch.${branch}.remote`], {
      cwd: checkout,
    }).toString();

  it('fetches the head from the fork by URL, adds no remote, and sets no upstream', async () => {
    const { run, calls } = recording();
    await fetchAdoForkHead(
      checkout,
      7,
      { url: fork, ref: 'refs/heads/feature/x', sha: head },
      'pr/7/feature/x',
      run,
    );
    expect(at('pr/7/feature/x')).toBe(head);
    expect(calls[0]).toEqual([
      'fetch',
      '--no-tags',
      '--',
      fork,
      'refs/heads/feature/x:refs/heads/pr/7/feature/x',
    ]);
    expect(git(checkout, 'remote')).toBe('origin');
    expect(() => upstream('pr/7/feature/x')).toThrow();
  });

  it("falls back to origin's merge ref when the fork can't be reached", async () => {
    const gone = path.join(dir, 'no-such-fork.git');
    await fetchAdoForkHead(
      checkout,
      7,
      { url: gone, ref: 'refs/heads/feature/x', sha: head },
      'pr/7/feature/x',
    );
    expect(at('pr/7/feature/x')).toBe(head);
  });

  it('keeps a task branch that has moved past the head, and fast-forwards a stale one', async () => {
    const h = { url: fork, ref: 'refs/heads/feature/x', sha: head };
    await fetchAdoForkHead(checkout, 7, h, 'pr/7/feature/x');
    git(checkout, 'checkout', '-q', 'pr/7/feature/x');
    const local = commit(checkout, 'd.txt', 'local work');
    git(checkout, 'checkout', '-q', 'main');
    git(checkout, 'reset', '-q', '--hard', 'HEAD'); // stays on main
    await fetchAdoForkHead(checkout, 7, h, 'pr/7/feature/x');
    expect(at('pr/7/feature/x')).toBe(local);
  });

  it('says so when neither the fork nor origin has the head', async () => {
    const gone = path.join(dir, 'no-such-fork.git');
    await expect(
      fetchAdoForkHead(
        checkout,
        7,
        { url: gone, ref: 'refs/heads/feature/x', sha: 'f'.repeat(40) },
        'pr/7/x',
      ),
    ).rejects.toThrow(/Could not fetch PR 7's head ffffffff from its fork .* or from origin/);
    await expect(
      fetchAdoForkHead(
        checkout,
        7,
        { url: null, ref: 'refs/heads/feature/x', sha: null },
        'pr/7/x',
      ),
    ).rejects.toThrow(/names no head commit/);
  });
});

describe('adoForkBranchUrl', () => {
  it("links a fork PR's head on the fork's page, dropping user info", async () => {
    const { adoForkBranchUrl } = await import('../adoFork');
    expect(
      adoForkBranchUrl({
        sourceRefName: 'refs/heads/fix/typo',
        forkSource: {
          repository: { remoteUrl: 'https://me@dev.azure.com/org/proj/_git/fork' },
        },
      }),
    ).toBe('https://dev.azure.com/org/proj/_git/fork?version=GBfix%2Ftypo');
  });

  it('is null for a same-repo PR or a fork without an https URL', async () => {
    const { adoForkBranchUrl } = await import('../adoFork');
    expect(adoForkBranchUrl({ sourceRefName: 'refs/heads/x' })).toBeNull();
    expect(
      adoForkBranchUrl({
        sourceRefName: 'refs/heads/x',
        forkSource: { repository: { remoteUrl: 'git@ssh.dev.azure.com:v3/org/proj/fork' } },
      }),
    ).toBeNull();
  });
});
