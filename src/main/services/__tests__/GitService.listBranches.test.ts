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

describe('GitService.fetchAndListBranches', () => {
  it("lists origin/HEAD (the remote's default) after the real branches, not as a bare 'origin'", async () => {
    const list = await GitService.fetchAndListBranches(clone);
    expect(list.map((b) => b.name)).toEqual(['main', 'origin/HEAD']);
    expect(list.map((b) => b.ref)).toEqual(['origin/main', 'origin/HEAD']);
  });
});
