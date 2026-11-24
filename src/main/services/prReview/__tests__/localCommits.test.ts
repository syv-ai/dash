import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import {
  commitsPastHead,
  ensureCommits,
  filesAtCommit,
  parseRawNumstat,
  prLocalStats,
  runGit,
  type RunGit,
} from '../localCommits';

let repo: string;
let head: string;
const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();

beforeAll(() => {
  repo = mkdtempSync(path.join(tmpdir(), 'dash-localcommits-'));
  git('init', '-q');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  writeFileSync(path.join(repo, 'a.txt'), 'a\n');
  git('add', '.');
  git('commit', '-qm', 'one');
  head = git('rev-parse', 'HEAD');
});
afterAll(() => rmSync(repo, { recursive: true, force: true }));

function recording(): { run: RunGit; calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    run: (cwd, args, t) => {
      calls.push(args);
      return runGit(cwd, args, t);
    },
  };
}

describe('ensureCommits', () => {
  it('fetches nothing when every commit is present', async () => {
    const { run, calls } = recording();
    await ensureCommits(repo, [head, head], run);
    expect(calls.some((a) => a[0] === 'fetch')).toBe(false);
  });

  it('fetches the missing ones by sha, and says so when that fails', async () => {
    const { run, calls } = recording();
    const missing = 'f'.repeat(40);
    await expect(ensureCommits(repo, [head, missing], run)).rejects.toThrow(
      `Could not fetch ${missing} from origin`,
    );
    expect(calls.find((a) => a[0] === 'fetch')).toEqual(['fetch', '--no-tags', 'origin', missing]);
  });
});

describe('commitsPastHead', () => {
  it("counts HEAD's commits the PR head lacks; null for a head not in the checkout", async () => {
    expect(await commitsPastHead(repo, head)).toBe(0);
    git('commit', '-q', '--allow-empty', '-m', 'local 1');
    git('commit', '-q', '--allow-empty', '-m', 'local 2');
    expect(await commitsPastHead(repo, head)).toBe(2);
    expect(await commitsPastHead(repo, 'f'.repeat(40))).toBeNull();
    git('reset', '-q', '--hard', head);
  });
});

describe('filesAtCommit', () => {
  it('returns the paths that exist in the commit', async () => {
    expect(await filesAtCommit(repo, head, ['a.txt', 'gone.txt'])).toEqual(new Set(['a.txt']));
    expect(await filesAtCommit(repo, head, [])).toEqual(new Set());
  });
});

describe('prLocalStats', () => {
  let base: string;
  let prHead: string;
  let baseTip: string;

  beforeAll(() => {
    const write = (f: string, text: string | Buffer) => writeFileSync(path.join(repo, f), text);
    write('keep.txt', 'one\ntwo\nthree\n');
    write('drop.txt', 'bye\n');
    write('move.txt', 'line 1\nline 2\nline 3\nline 4\nline 5\n');
    git('add', '.');
    git('commit', '-qm', 'base');
    base = git('rev-parse', 'HEAD');

    git('checkout', '-qb', 'pr');
    write('keep.txt', 'one\n2\nthree\nfour\n');
    git('rm', '-q', 'drop.txt');
    git('mv', 'move.txt', 'moved.txt');
    write('new file.bin', Buffer.from([0, 1, 2, 0]));
    git('add', '.');
    git('commit', '-qm', 'pr 1');
    write('more.txt', 'x\n');
    git('add', '.');
    git('commit', '-qm', 'pr 2');
    prHead = git('rev-parse', 'HEAD');

    // The base branch moves on by three commits; the forge names its tip.
    git('checkout', '-q', base);
    for (const n of [1, 2, 3]) git('commit', '-q', '--allow-empty', '-m', `main ${n}`);
    baseTip = git('rev-parse', 'HEAD');
    git('checkout', '-q', 'pr');
  });

  it("lists the PR's files with status, line counts and head blob, and counts commits", async () => {
    const stats = await prLocalStats(repo, { base, head: prHead, baseTip });
    const blob = (f: string) => git('rev-parse', `${prHead}:${f}`);
    expect(stats.commits).toBe(2);
    expect(stats.behindBase).toBe(3);
    expect(stats.files.sort((a, b) => a.path.localeCompare(b.path))).toEqual([
      { path: 'drop.txt', status: 'deleted', additions: 0, deletions: 1, blob: null },
      { path: 'keep.txt', status: 'modified', additions: 2, deletions: 1, blob: blob('keep.txt') },
      { path: 'more.txt', status: 'added', additions: 1, deletions: 0, blob: blob('more.txt') },
      {
        path: 'moved.txt',
        status: 'renamed',
        oldPath: 'move.txt',
        additions: 0,
        deletions: 0,
        blob: blob('moved.txt'),
      },
      {
        path: 'new file.bin',
        status: 'added',
        additions: 0,
        deletions: 0,
        blob: blob('new file.bin'),
      },
    ]);
  });

  it("says null behind base when the base tip isn't known", async () => {
    const stats = await prLocalStats(repo, { base, head: prHead, baseTip: null });
    expect(stats.behindBase).toBeNull();
    const missing = await prLocalStats(repo, { base, head: prHead, baseTip: 'f'.repeat(40) });
    expect(missing.behindBase).toBeNull();
  });

  it('tolerates empty output', () => {
    expect(parseRawNumstat('')).toEqual([]);
  });
});
