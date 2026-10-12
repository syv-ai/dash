import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
  it('falls back to the path itself outside git, quietly', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const plain = path.join(tmp, 'plain');
    fs.mkdirSync(plain);
    expect(await resolveMemoryDir(plain)).toBe(memoryOf(plain));
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("uses a bare repo's git dir for its worktrees, and a submodule's own root", async () => {
    // Where Claude Code keys them: neither has a main checkout to share.
    const bare = path.join(tmp, 'bare.git');
    git(tmp, 'clone', '-q', '--bare', repo, bare);
    const checkout = path.join(tmp, 'bare-main');
    git(bare, 'worktree', 'add', '-q', checkout, 'main');
    expect(await resolveMemoryDir(checkout)).toBe(memoryOf(bare));

    git(repo, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', bare, 'sub');
    const sub = path.join(repo, 'sub');
    fs.mkdirSync(path.join(sub, 'inner'));
    expect(await resolveMemoryDir(path.join(sub, 'inner'))).toBe(memoryOf(sub));
  });

  it("uses Claude's autoMemoryDirectory setting, the project's over the user's", async () => {
    const settings = (file: string, autoMemoryDirectory: unknown) => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ autoMemoryDirectory }));
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const userSettings = path.join(tmp, 'claude', 'settings.json');
    settings(userSettings, '~/notes/claude');
    expect(await resolveMemoryDir(repo)).toBe(path.join(os.homedir(), 'notes', 'claude'));

    // The repository's own file counts only once the workspace is trusted.
    settings(path.join(repo, '.claude', 'settings.json'), path.join(tmp, 'shared'));
    expect(await resolveMemoryDir(repo)).toBe(path.join(os.homedir(), 'notes', 'claude'));
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('untrusted workspace'),
      path.join(repo, '.claude', 'settings.json'),
    );
    fs.writeFileSync(
      path.join(tmp, 'claude', '.claude.json'),
      JSON.stringify({ projects: { [repo]: { hasTrustDialogAccepted: true } } }),
    );
    expect(await resolveMemoryDir(repo)).toBe(path.join(tmp, 'shared'));
    settings(path.join(repo, '.claude', 'settings.local.json'), path.join(tmp, 'mine'));
    expect(await resolveMemoryDir(repo)).toBe(path.join(tmp, 'mine'));

    // A value Claude would not accept, or a broken file, is passed over.
    settings(path.join(repo, '.claude', 'settings.local.json'), 'relative/dir');
    fs.writeFileSync(path.join(repo, '.claude', 'settings.json'), '{ not json');
    settings(userSettings, 42);
    expect(await resolveMemoryDir(repo)).toBe(memoryOf(repo));
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('unreadable Claude settings'),
      path.join(repo, '.claude', 'settings.json'),
      expect.anything(),
    );
    warn.mockRestore();
  });

  it("finds the user's settings.local.json at the repo root from a subfolder project", async () => {
    const local = path.join(repo, '.claude', 'settings.local.json');
    fs.writeFileSync(local, JSON.stringify({ autoMemoryDirectory: path.join(tmp, 'mine') }));
    expect(await resolveMemoryDir(path.join(repo, 'packages', 'web'))).toBe(path.join(tmp, 'mine'));
  });

  it("takes the user's own settings.local.json untrusted, but not one the repo checks in", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const local = path.join(repo, '.claude', 'settings.local.json');
    fs.writeFileSync(local, JSON.stringify({ autoMemoryDirectory: path.join(tmp, 'mine') }));
    expect(await resolveMemoryDir(repo)).toBe(path.join(tmp, 'mine'));

    git(repo, 'add', '-f', local);
    expect(await resolveMemoryDir(repo)).toBe(memoryOf(repo));
    warn.mockRestore();
  });

  it('warns when git itself fails rather than reporting "not a repo"', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const gone = path.join(tmp, 'deleted-project');
    expect(await resolveMemoryDir(gone)).toBe(memoryOf(gone));
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('git root lookup failed'),
      gone,
      expect.anything(),
    );
    warn.mockRestore();
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
      disabledBy: null,
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
  const settings = (file: string, value: unknown) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value));
  };
  const disabledBy = async () => (await readProjectMemory(repo)).disabledBy;

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

  it('reports the setting that turned auto memory off, the nearest file deciding', async () => {
    expect(await disabledBy()).toBeNull();
    const user = path.join(tmp, 'claude', 'settings.json');
    settings(user, { autoMemoryEnabled: false });
    expect(await disabledBy()).toBe(`autoMemoryEnabled in ${user}`);
    // The project turns it back on for itself.
    settings(path.join(repo, '.claude', 'settings.json'), { autoMemoryEnabled: true });
    expect(await disabledBy()).toBeNull();
    // Off, the folder is still shown.
    settings(path.join(repo, '.claude', 'settings.local.json'), { autoMemoryEnabled: false });
    expect(await readProjectMemory(repo)).toMatchObject({
      exists: false,
      dir: await resolveMemoryDir(repo),
      disabledBy: `autoMemoryEnabled in ${path.join(repo, '.claude', 'settings.local.json')}`,
    });
  });

  it('reports the environment variable, from a settings file or Dash itself', async () => {
    const user = path.join(tmp, 'claude', 'settings.json');
    settings(user, { env: { CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' }, autoMemoryEnabled: true });
    expect(await disabledBy()).toBe(`CLAUDE_CODE_DISABLE_AUTO_MEMORY in ${user}`);
    settings(user, { env: { CLAUDE_CODE_DISABLE_AUTO_MEMORY: '0' } });
    expect(await disabledBy()).toBeNull();

    vi.stubEnv('CLAUDE_CODE_DISABLE_AUTO_MEMORY', '1');
    try {
      expect(await disabledBy()).toBe('CLAUDE_CODE_DISABLE_AUTO_MEMORY');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
