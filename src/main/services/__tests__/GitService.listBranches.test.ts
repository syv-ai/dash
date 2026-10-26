import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GitService } from '../GitService';

/** Real git: a clone, so origin/HEAD exists beside origin/main. */
let root: string;
let clone: string;
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-git-branches-'));
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
  git(root, 'clone', '-q', origin, 'clone');
  clone = path.join(root, 'clone');
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const commit = (cwd: string, message: string, date?: string) =>
  execFileSync(
    'git',
    ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', message],
    {
      cwd,
      env: date ? { ...process.env, GIT_COMMITTER_DATE: date } : process.env,
      stdio: 'ignore',
    },
  );

describe('GitService.fetchAndListBranches', () => {
  it('lists origin/HEAD, not a bare origin, just above the branch it points to', async () => {
    const list = await GitService.fetchAndListBranches(clone);
    expect(list.map((b) => b.name)).toEqual(['origin/HEAD', 'main']);
    expect(list.map((b) => b.ref)).toEqual(['origin/HEAD', 'origin/main']);
  });

  it('keeps it above the default branch when another branch is newer', async () => {
    git(path.join(root, 'origin'), 'checkout', '-q', '-b', 'feature');
    commit(path.join(root, 'origin'), 'b', '2099-01-01T00:00:00');
    git(path.join(root, 'origin'), 'checkout', '-q', 'main');
    const names = (await GitService.fetchAndListBranches(clone)).map((b) => b.name);
    expect(names).toEqual(['feature', 'origin/HEAD', 'main']);
  });

  it('creates origin/HEAD for a repo that was not cloned', async () => {
    const repo = path.join(root, 'added');
    fs.mkdirSync(repo);
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'remote', 'add', 'origin', path.join(root, 'origin'));
    const names = (await GitService.fetchAndListBranches(repo)).map((b) => b.name);
    expect(names).toContain('origin/HEAD');
  });
});
