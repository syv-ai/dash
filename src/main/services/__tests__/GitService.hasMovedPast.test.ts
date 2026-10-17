import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GitService } from '../GitService';

/** Real git: a branch whose PR head is `prHead`, then a new commit on top. */
let repo: string;
let prHead: string;
let first: string;
const git = (...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
    cwd: repo,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();

beforeAll(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-git-moved-'));
  git('init', '-q', '-b', 'feature');
  git('commit', '-q', '--allow-empty', '-m', 'one');
  first = git('rev-parse', 'HEAD');
  git('commit', '-q', '--allow-empty', '-m', 'two');
  prHead = git('rev-parse', 'HEAD');
});

afterAll(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

describe('GitService.hasMovedPast', () => {
  it('is false while HEAD is the PR head', async () => {
    expect(await GitService.hasMovedPast(repo, prHead)).toBe(false);
  });

  it('is false when HEAD is behind the PR head', async () => {
    git('checkout', '-q', '--detach', first);
    expect(await GitService.hasMovedPast(repo, prHead)).toBe(false);
    git('checkout', '-q', 'feature');
  });

  it('is false for a commit the repo does not have', async () => {
    expect(await GitService.hasMovedPast(repo, 'f'.repeat(40))).toBe(false);
  });

  it('is true once the branch has a commit on top of the PR head', async () => {
    git('commit', '-q', '--allow-empty', '-m', 'three');
    expect(await GitService.hasMovedPast(repo, prHead)).toBe(true);
  });
});
