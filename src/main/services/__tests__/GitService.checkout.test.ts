import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GitService } from '../GitService';

/** Real git: an origin with `main` + `feat`, cloned so `feat` is remote-only. */
let root: string;
let repo: string;
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-git-checkout-'));
  const origin = path.join(root, 'origin');
  fs.mkdirSync(origin);
  git(origin, 'init', '-q', '-b', 'main');
  git(
    origin,
    '-c',
    'user.name=t',
    '-c',
    'user.email=t@t',
    'commit',
    '-q',
    '--allow-empty',
    '-m',
    'a',
  );
  git(origin, 'branch', 'feat');
  git(root, 'clone', '-q', origin, 'repo');
  repo = path.join(root, 'repo');
  fs.writeFileSync(path.join(repo, 'f.txt'), 'committed\n');
  git(repo, 'add', 'f.txt');
  git(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'f');
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('GitService.branchExists', () => {
  it('knows local and origin-only branches', async () => {
    expect(await GitService.branchExists(repo, 'main')).toBe(true);
    expect(await GitService.branchExists(repo, 'feat')).toBe(true);
    expect(await GitService.branchExists(repo, 'nope')).toBe(false);
  });

  it('refuses names that are not branch names', async () => {
    for (const name of ['.', '..', '-f', 'a..b', 'HEAD~1', '@{-1}', 'f.txt']) {
      expect(await GitService.branchExists(repo, name)).toBe(false);
    }
  });
});

describe('GitService.checkoutBranch', () => {
  it('never reads the name as a path: "." keeps unstaged changes', async () => {
    fs.writeFileSync(path.join(repo, 'f.txt'), 'unstaged\n');
    await expect(GitService.checkoutBranch(repo, '.')).rejects.toThrow(/not found/);
    await expect(GitService.checkoutBranch(repo, 'f.txt')).rejects.toThrow(/not found/);
    expect(fs.readFileSync(path.join(repo, 'f.txt'), 'utf8')).toBe('unstaged\n');
    git(repo, 'checkout', '--', 'f.txt');
  });

  it('refuses an option-like name', async () => {
    await expect(GitService.checkoutBranch(repo, '-f')).rejects.toThrow(/Invalid branch/);
  });

  it('still checks out a remote-only branch as a tracking branch', async () => {
    await GitService.checkoutBranch(repo, 'feat');
    expect(await GitService.getBranch(repo)).toBe('feat');
    await GitService.checkoutBranch(repo, 'main');
  });
});
