import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { claudeProjectDir } from '../../utils/claudePaths';
import { readProjectMemory, resolveMemoryDir } from '../MemoryService';

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd });
}

let tmp: string;
let repo: string;
let worktree: string;
const originalConfigDir = process.env.CLAUDE_CONFIG_DIR;

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dash-memory-')));
  repo = path.join(tmp, 'repo');
  fs.mkdirSync(path.join(repo, 'packages', 'web'), { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(repo, 'README.md'), 'x');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'init');
  worktree = path.join(repo, '.claude', 'worktrees', 'feat-abc');
  git(repo, 'worktree', 'add', '-q', '-b', 'feat', worktree);
  process.env.CLAUDE_CONFIG_DIR = path.join(tmp, 'claude');
});

afterEach(() => {
  if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = originalConfigDir;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('resolveMemoryDir', () => {
  const memoryOf = (root: string) => path.join(claudeProjectDir(root), 'memory');

  it("uses the repo root's Claude project dir for the repo itself", async () => {
    expect(await resolveMemoryDir(repo)).toBe(memoryOf(repo));
  });
  it('uses the main checkout for a linked worktree', async () => {
    expect(await resolveMemoryDir(worktree)).toBe(memoryOf(repo));
  });
  it('uses the repo root for a subfolder project', async () => {
    expect(await resolveMemoryDir(path.join(repo, 'packages', 'web'))).toBe(memoryOf(repo));
  });
  it('falls back to the path itself outside git', async () => {
    const plain = path.join(tmp, 'plain');
    fs.mkdirSync(plain);
    expect(await resolveMemoryDir(plain)).toBe(memoryOf(plain));
  });
});

describe('readProjectMemory', () => {
  it('reports a missing folder without throwing', async () => {
    const memory = await readProjectMemory(repo);
    expect(memory).toEqual({
      dir: await resolveMemoryDir(repo),
      exists: false,
      hasIndex: false,
      entries: [],
      dangling: [],
    });
  });

  it('throws when the memory folder exists but cannot be read', async () => {
    const dir = await resolveMemoryDir(repo);
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    fs.writeFileSync(dir, 'a file where the folder should be');
    await expect(readProjectMemory(repo)).rejects.toThrow(/ENOTDIR/);
  });

  it('throws when MEMORY.md exists but cannot be read', async () => {
    const dir = await resolveMemoryDir(repo);
    fs.mkdirSync(path.join(dir, 'MEMORY.md'), { recursive: true });
    await expect(readProjectMemory(repo)).rejects.toThrow(/EISDIR/);
  });

  it('reads entries, the index, and index membership, from a worktree path', async () => {
    const dir = await resolveMemoryDir(repo);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'MEMORY.md'),
      '- [CI](feedback_ci.md) — hook\n- [Old](old.md) — deleted since\n',
    );
    fs.writeFileSync(
      path.join(dir, 'feedback_ci.md'),
      '---\nname: prefer-ci\ndescription: CI over local\nmetadata:\n  type: feedback\n---\nUse CI.',
    );
    fs.writeFileSync(path.join(dir, 'orphan.md'), 'no frontmatter');
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'ignored');

    const memory = await readProjectMemory(worktree);
    expect(memory.exists).toBe(true);
    expect(memory.hasIndex).toBe(true);
    expect(memory.dangling).toEqual(['old.md']);
    const byFile = Object.fromEntries(memory.entries.map((e) => [e.file, e]));
    expect(Object.keys(byFile).sort()).toEqual(['feedback_ci.md', 'orphan.md']);
    expect(byFile['feedback_ci.md']).toMatchObject({
      name: 'prefer-ci',
      description: 'CI over local',
      type: 'feedback',
      body: 'Use CI.',
      inIndex: true,
    });
    expect(byFile['orphan.md']).toMatchObject({
      name: 'orphan',
      type: 'other',
      inIndex: false,
    });
    expect(byFile['orphan.md']!.mtimeMs).toBeGreaterThan(0);
  });
});

describe('what Claude will not see', () => {
  it('flags a memory indexed only past the part of MEMORY.md Claude loads', async () => {
    const dir = await resolveMemoryDir(repo);
    fs.mkdirSync(dir, { recursive: true });
    const filler = Array.from({ length: 199 }, (_, i) => `- note ${i}`);
    fs.writeFileSync(
      path.join(dir, 'MEMORY.md'),
      ['- [In](in.md) — seen', ...filler, '- [Out](out.md) — never loaded', ''].join('\n'),
    );
    fs.writeFileSync(path.join(dir, 'in.md'), 'in');
    fs.writeFileSync(path.join(dir, 'out.md'), 'out');
    fs.writeFileSync(path.join(dir, 'loose.md'), 'loose');

    const byFile = Object.fromEntries(
      (await readProjectMemory(repo)).entries.map((e) => [e.file, e]),
    );
    expect(byFile['in.md']).toMatchObject({ inIndex: true, pastIndexLimit: false });
    expect(byFile['out.md']).toMatchObject({ inIndex: true, pastIndexLimit: true });
    expect(byFile['loose.md']).toMatchObject({ inIndex: false, pastIndexLimit: false });
  });

  it('lists only files a link can name', async () => {
    const dir = await resolveMemoryDir(repo);
    fs.mkdirSync(dir, { recursive: true });
    for (const name of ['ok.md', 'todo: later.md', 'notes.txt']) {
      fs.writeFileSync(path.join(dir, name), 'x');
    }
    expect((await readProjectMemory(repo)).entries.map((e) => e.file)).toEqual(['ok.md']);
  });
});
