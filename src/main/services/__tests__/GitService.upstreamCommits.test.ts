import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GitService } from '../GitService';

/** Real git: a clone two commits ahead of its upstream and one behind it. */
let root: string;
let remote: string;
let clone: string;
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-git-upstream-'));
  remote = path.join(root, 'remote');
  clone = path.join(root, 'clone');
  fs.mkdirSync(remote);
  git(remote, 'init', '-q', '-b', 'main');
  git(remote, 'commit', '-q', '--allow-empty', '-m', 'base');
  git(root, 'clone', '-q', remote, clone);
  git(remote, 'commit', '-q', '--allow-empty', '-m', 'upstream only');
  git(clone, 'fetch', '-q');
  git(clone, 'commit', '-q', '--allow-empty', '-m', 'local one');
  git(clone, 'commit', '-q', '--allow-empty', '-m', 'local two');
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('GitService.getUpstreamCommits', () => {
  it("lists HEAD's unpushed commits, newest first, and the upstream's tip", async () => {
    expect(await GitService.getUpstreamCommits(clone)).toEqual({
      unpushed: [git(clone, 'rev-parse', 'HEAD'), git(clone, 'rev-parse', 'HEAD~1')],
      upstreamHead: git(remote, 'rev-parse', 'HEAD'),
    });
  });

  it('is empty without an upstream', async () => {
    expect(await GitService.getUpstreamCommits(remote)).toEqual({
      unpushed: [],
      upstreamHead: null,
    });
  });
});
