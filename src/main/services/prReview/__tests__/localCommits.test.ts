import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { ensureCommits, filesAtCommit, runGit, type RunGit } from '../localCommits';

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

describe('filesAtCommit', () => {
  it('returns the paths that exist in the commit', async () => {
    expect(await filesAtCommit(repo, head, ['a.txt', 'gone.txt'])).toEqual(new Set(['a.txt']));
    expect(await filesAtCommit(repo, head, [])).toEqual(new Set());
  });
});
