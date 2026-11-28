import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { hasGit, withinGitRepo } from '../gitPresence';

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-git-presence-'));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const dir = (...parts: string[]) => {
  const d = path.join(root, ...parts);
  fs.mkdirSync(d, { recursive: true });
  return d;
};

describe('hasGit', () => {
  it('is false for a plain folder', () => {
    expect(hasGit(dir('plain'))).toBe(false);
  });

  it("is true for a repository's root (.git a folder) and a linked worktree (.git a file)", () => {
    dir('repo', '.git');
    const wt = dir('wt');
    fs.writeFileSync(path.join(wt, '.git'), 'gitdir: ../repo/.git/worktrees/wt\n');
    expect(hasGit(path.join(root, 'repo'))).toBe(true);
    expect(hasGit(wt)).toBe(true);
  });

  it('is false for a folder inside a repository: only its root is a git project', () => {
    dir('repo', '.git');
    expect(hasGit(dir('repo', 'sub'))).toBe(false);
  });

  it('follows the folder: true once .git appears, false once it goes', () => {
    const d = dir('later');
    expect(hasGit(d)).toBe(false);
    fs.mkdirSync(path.join(d, '.git'));
    expect(hasGit(d)).toBe(true);
    fs.rmSync(path.join(d, '.git'), { recursive: true });
    expect(hasGit(d)).toBe(false);
  });
});

describe('withinGitRepo', () => {
  it('finds a repository at the folder or above it', () => {
    dir('repo', '.git');
    expect(withinGitRepo(path.join(root, 'repo'))).toBe(true);
    expect(withinGitRepo(dir('repo', 'a', 'b'))).toBe(true);
  });

  it('is false for a folder with no repository at or above it', () => {
    // The temp dir itself sits in no repository on CI or a dev machine.
    expect(withinGitRepo(dir('plain', 'deep'))).toBe(false);
  });
});
