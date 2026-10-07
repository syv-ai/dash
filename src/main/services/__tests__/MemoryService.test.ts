import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { claudeProjectDir } from '../../utils/claudePaths';
import {
  createMemory,
  deleteMemory,
  indexMemory,
  pruneIndex,
  raiseMemory,
  readProjectMemory,
  resolveMemoryDir,
  updateMemory,
} from '../MemoryService';

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
      index: null,
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
    fs.writeFileSync(path.join(dir, 'MEMORY.md'), '- [CI](feedback_ci.md) — hook\n');
    fs.writeFileSync(
      path.join(dir, 'feedback_ci.md'),
      '---\nname: prefer-ci\ndescription: CI over local\nmetadata:\n  type: feedback\n---\nUse CI.',
    );
    fs.writeFileSync(path.join(dir, 'orphan.md'), 'no frontmatter');
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'ignored');

    const memory = await readProjectMemory(worktree);
    expect(memory.exists).toBe(true);
    expect(memory.index).toContain('feedback_ci.md');
    const byFile = Object.fromEntries(memory.entries.map((e) => [e.file, e]));
    expect(Object.keys(byFile).sort()).toEqual(['feedback_ci.md', 'orphan.md']);
    expect(byFile['feedback_ci.md']).toMatchObject({
      name: 'prefer-ci',
      description: 'CI over local',
      type: 'feedback',
      body: 'Use CI.',
      inIndex: true,
    });
    expect(byFile['feedback_ci.md']!.hook).toBe('hook');
    expect(byFile['orphan.md']).toMatchObject({
      name: 'orphan',
      type: 'other',
      inIndex: false,
      hook: null,
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

describe('writing memories', () => {
  const fields = {
    name: 'Prefer CI',
    description: 'CI over local',
    type: 'feedback',
    body: 'Use CI.',
  } as const;
  const entryOf = async (file: string) =>
    (await readProjectMemory(repo)).entries.find((e) => e.file === file)!;

  it('creates the folder, the memory and its index line, from a worktree path', async () => {
    const { file } = await createMemory(worktree, fields);
    expect(file).toBe('prefer-ci.md');

    const memory = await readProjectMemory(repo);
    expect(memory.index).toBe('- [Prefer CI](prefer-ci.md) — CI over local\n');
    expect(memory.entries).toHaveLength(1);
    expect(memory.entries[0]).toMatchObject({
      ...fields,
      body: '\nUse CI.\n',
      file,
      inIndex: true,
    });
    // Nothing but the memory and the index is left behind (no tmp files).
    expect(fs.readdirSync(memory.dir).sort()).toEqual(['MEMORY.md', 'prefer-ci.md']);
  });

  it('appends to an existing index and refuses to replace an existing memory', async () => {
    const dir = await resolveMemoryDir(repo);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'MEMORY.md'), '# Index\n\n- [Old](old.md)');
    await createMemory(repo, fields);
    expect(fs.readFileSync(path.join(dir, 'MEMORY.md'), 'utf8')).toBe(
      '# Index\n\n- [Old](old.md)\n- [Prefer CI](prefer-ci.md) — CI over local\n',
    );

    await expect(createMemory(repo, { ...fields, body: 'clobber' })).rejects.toThrow(
      /prefer-ci\.md already exists/,
    );
    expect((await entryOf('prefer-ci.md')).body).toBe('\nUse CI.\n');
    expect(fs.readFileSync(path.join(dir, 'MEMORY.md'), 'utf8').match(/prefer-ci/g)).toHaveLength(
      1,
    );
  });

  it('updates a memory it was shown, keeping frontmatter it does not own', async () => {
    const dir = await resolveMemoryDir(repo);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'ci.md'),
      '---\nname: ci\ntype: project\noriginSessionId: abc\n---\nOld',
    );
    const before = await entryOf('ci.md');

    const result = await updateMemory(repo, 'ci.md', fields, before);
    expect(result).toMatchObject({ ok: true });
    expect(fs.readFileSync(path.join(dir, 'ci.md'), 'utf8')).toMatch(
      /^---\nname: Prefer CI\ndescription: CI over local\ntype: feedback\noriginSessionId: abc\nmodified: \S+Z\n---\nUse CI\.\n$/,
    );
    const after = await entryOf('ci.md');
    expect(result).toEqual({
      ok: true,
      mtimeMs: after.mtimeMs,
      sizeBytes: after.sizeBytes,
      relinked: [],
    });
  });

  it('keeps the index line in step with an edit', async () => {
    const dir = await resolveMemoryDir(repo);
    const indexPath = path.join(dir, 'MEMORY.md');
    const { file } = await createMemory(repo, fields);
    await createMemory(repo, { ...fields, name: 'Other' });
    // Claude's own wording for the hook.
    fs.writeFileSync(
      indexPath,
      '- [Prefer CI](prefer-ci.md) — when tests are slow\n- [Other](other.md) — two\n',
    );

    // A body edit is not a reason to reword the line.
    await updateMemory(repo, file, { ...fields, body: 'Always.' }, await entryOf(file));
    expect(fs.readFileSync(indexPath, 'utf8')).toContain('— when tests are slow');

    // A rename moves a title that was the old name, in place; a new
    // description is the file's business, and the hook stays Claude's.
    const renamed = { ...fields, name: 'CI first', description: 'Run the suite in CI' };
    await updateMemory(repo, file, renamed, await entryOf(file));
    expect(fs.readFileSync(indexPath, 'utf8')).toBe(
      '- [CI first](prefer-ci.md) — when tests are slow\n- [Other](other.md) — two\n',
    );
    expect((await entryOf(file)).hook).toBe('when tests are slow');

    // The hook changes when the save says so.
    await updateMemory(repo, file, renamed, await entryOf(file), 'when CI is green');
    expect(fs.readFileSync(indexPath, 'utf8')).toBe(
      '- [CI first](prefer-ci.md) — when CI is green\n- [Other](other.md) — two\n',
    );
  });

  it('indexes a new memory under the hook it is given', async () => {
    const { file } = await createMemory(repo, fields, 'tests are slow locally');
    const memory = await readProjectMemory(repo);
    expect(memory.index).toBe('- [Prefer CI](prefer-ci.md) — tests are slow locally\n');
    expect(memory.entries[0]).toMatchObject({ file, hook: 'tests are slow locally' });
  });

  it('keeps a line Claude adds to the index while Dash is editing it', async () => {
    const dir = await resolveMemoryDir(repo);
    const indexPath = path.join(dir, 'MEMORY.md');
    await createMemory(repo, fields);
    // Claude's write lands between Dash reading the index and replacing it.
    const readFile = fs.promises.readFile.bind(fs.promises);
    const spy = vi.spyOn(fs.promises, 'readFile').mockImplementation((async (
      ...args: Parameters<typeof fs.promises.readFile>
    ) => {
      const content = await readFile(...args);
      if (args[0] === indexPath && spy.mock.calls.filter((c) => c[0] === indexPath).length === 1) {
        fs.appendFileSync(indexPath, '- [From Claude](claude.md) — just saved\n');
      }
      return content;
    }) as typeof fs.promises.readFile);
    try {
      await createMemory(repo, { ...fields, name: 'Other' });
    } finally {
      spy.mockRestore();
    }
    expect(fs.readFileSync(indexPath, 'utf8')).toBe(
      [
        '- [Prefer CI](prefer-ci.md) — CI over local',
        '- [From Claude](claude.md) — just saved',
        '- [Other](other.md) — CI over local',
        '',
      ].join('\n'),
    );
  });

  it("moves other memories' [[links]] when a memory is renamed", async () => {
    const dir = await resolveMemoryDir(repo);
    const { file } = await createMemory(repo, fields);
    const write = (name: string, body: string) =>
      fs.writeFileSync(path.join(dir, name), `---\nname: ${name.replace('.md', '')}\n---\n${body}`);
    write('a.md', 'See [[Prefer CI]] and [[ Prefer CI ]], not [[Prefer]].');
    write('b.md', 'Nothing to move, [[a]] stays.');
    const untouched = fs.statSync(path.join(dir, 'b.md')).mtimeMs;

    const result = await updateMemory(
      repo,
      file,
      { ...fields, name: 'CI first' },
      await entryOf(file),
    );
    expect(result).toMatchObject({ ok: true, relinked: ['a.md'] });
    expect((await entryOf('a.md')).body).toBe('See [[CI first]] and [[CI first]], not [[Prefer]].');
    expect(fs.statSync(path.join(dir, 'b.md')).mtimeMs).toBe(untouched);

    // No rename, no relinking.
    const again = await updateMemory(
      repo,
      file,
      { ...fields, name: 'CI first', body: 'x' },
      await entryOf(file),
    );
    expect(again).toMatchObject({ ok: true, relinked: [] });
  });

  it('moves links written against the basename of a memory that had no name', async () => {
    const dir = await resolveMemoryDir(repo);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'notes.md'), 'no frontmatter');
    fs.writeFileSync(path.join(dir, 'a.md'), 'See [[notes]].');

    const edit = { name: 'Team notes', description: '', type: 'other', body: 'x' } as const;
    const result = await updateMemory(repo, 'notes.md', edit, await entryOf('notes.md'));
    expect(result).toMatchObject({ relinked: ['a.md'] });
    expect(fs.readFileSync(path.join(dir, 'a.md'), 'utf8')).toBe('See [[Team notes]].');
  });

  it('keeps the index line of a memory with no name when only its body is edited', async () => {
    const dir = await resolveMemoryDir(repo);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'notes.md'), 'no frontmatter');
    const index = "- [Notes](notes.md) — Claude's hook\n";
    fs.writeFileSync(path.join(dir, 'MEMORY.md'), index);

    // The name it is shown under is its basename: saving that back is no rename.
    const edit = { name: 'notes', description: '', type: 'other', body: 'x' } as const;
    await updateMemory(repo, 'notes.md', edit, await entryOf('notes.md'));
    expect(fs.readFileSync(path.join(dir, 'MEMORY.md'), 'utf8')).toBe(index);
  });

  it('leaves links alone when another memory still has the old name', async () => {
    const dir = await resolveMemoryDir(repo);
    const { file } = await createMemory(repo, fields);
    fs.writeFileSync(path.join(dir, 'twin.md'), '---\nname: Prefer CI\n---\nI am the other one.');
    fs.writeFileSync(path.join(dir, 'a.md'), 'See [[Prefer CI]].');

    const result = await updateMemory(
      repo,
      file,
      { ...fields, name: 'CI first' },
      await entryOf(file),
    );
    expect(result).toMatchObject({ ok: true, relinked: [] });
    expect(fs.readFileSync(path.join(dir, 'a.md'), 'utf8')).toBe('See [[Prefer CI]].');
  });

  it('indexes an unindexed memory when it is saved', async () => {
    const dir = await resolveMemoryDir(repo);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'orphan.md'), '---\nname: orphan\n---\nOld');
    expect((await entryOf('orphan.md')).inIndex).toBe(false);

    const edit = { name: 'orphan', description: '', type: 'other', body: 'New' } as const;
    await updateMemory(repo, 'orphan.md', edit, await entryOf('orphan.md'));
    expect(fs.readFileSync(path.join(dir, 'MEMORY.md'), 'utf8')).toBe('- [orphan](orphan.md)\n');
    expect((await entryOf('orphan.md')).inIndex).toBe(true);
  });

  it('leaves the index alone when the save was refused as stale', async () => {
    const { file } = await createMemory(repo, fields);
    const indexPath = path.join(await resolveMemoryDir(repo), 'MEMORY.md');
    const before = fs.readFileSync(indexPath, 'utf8');
    const stale = await updateMemory(
      repo,
      file,
      { ...fields, name: 'Renamed' },
      { mtimeMs: 1, sizeBytes: 1 },
    );
    expect(stale.ok).toBe(false);
    expect(fs.readFileSync(indexPath, 'utf8')).toBe(before);
  });

  it('does not overwrite a memory that changed since it was read', async () => {
    const { file } = await createMemory(repo, fields);
    const seen = await entryOf(file);
    const full = path.join(await resolveMemoryDir(repo), file);
    fs.writeFileSync(full, '---\nname: Prefer CI\n---\nClaude rewrote this, and it is longer.');

    const stale = await updateMemory(repo, file, { ...fields, body: 'mine' }, seen);
    expect(stale).toMatchObject({ ok: false, stale: true });
    expect(fs.readFileSync(full, 'utf8')).toContain('Claude rewrote this');

    // Overwriting is saving again against what is on disk now.
    if (stale.ok) throw new Error('expected a stale result');
    const forced = await updateMemory(
      repo,
      file,
      { ...fields, body: 'mine' },
      { mtimeMs: stale.currentMtimeMs, sizeBytes: stale.currentSizeBytes },
    );
    expect(forced.ok).toBe(true);
    expect((await entryOf(file)).body).toBe('mine\n');
  });

  it('deletes a memory and its index line, leaving the others', async () => {
    const dir = await resolveMemoryDir(repo);
    await createMemory(repo, fields);
    await createMemory(repo, { ...fields, name: 'Other' });

    const removed: string[] = [];
    await deleteMemory(repo, 'prefer-ci.md', async (full) => {
      removed.push(full);
      await fs.promises.unlink(full);
    });
    expect(removed).toEqual([path.join(dir, 'prefer-ci.md')]);

    const memory = await readProjectMemory(repo);
    expect(memory.entries.map((e) => e.file)).toEqual(['other.md']);
    expect(memory.index).toBe('- [Other](other.md) — CI over local\n');
  });

  it('saves the memory and says so when its index line could not follow', async () => {
    const dir = await resolveMemoryDir(repo);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    // An index that can't be read as a file.
    fs.mkdirSync(path.join(dir, 'MEMORY.md'), { recursive: true });

    const created = await createMemory(repo, fields);
    expect(created).toMatchObject({ file: 'prefer-ci.md' });
    expect(created.warning).toMatch(/^Saved, but MEMORY\.md could not be updated: .*EISDIR/);
    expect(fs.existsSync(path.join(dir, 'prefer-ci.md'))).toBe(true);

    const stat = fs.statSync(path.join(dir, 'prefer-ci.md'));
    const saved = await updateMemory(
      repo,
      'prefer-ci.md',
      { ...fields, body: 'Always.' },
      { mtimeMs: stat.mtimeMs, sizeBytes: stat.size },
    );
    expect(saved).toMatchObject({ ok: true, relinked: [] });
    expect(saved.ok && saved.warning).toMatch(/MEMORY\.md could not be updated/);
    expect(fs.readFileSync(path.join(dir, 'prefer-ci.md'), 'utf8')).toContain('Always.');
    error.mockRestore();
  });

  it('reports and prunes index lines for memories that are gone', async () => {
    const dir = await resolveMemoryDir(repo);
    await createMemory(repo, fields);
    fs.writeFileSync(
      path.join(dir, 'MEMORY.md'),
      [
        '- [Prefer CI](prefer-ci.md) — CI over local',
        '- [Gone](gone.md) — deleted by hand',
        '- see [Lost](lost.md) and [Prefer CI](prefer-ci.md)',
        '',
      ].join('\n'),
    );
    expect((await readProjectMemory(repo)).dangling).toEqual(['gone.md', 'lost.md']);

    // A line shared with a memory that exists stays, dead link and all.
    expect(await pruneIndex(repo)).toEqual(['gone.md']);
    const memory = await readProjectMemory(repo);
    expect(memory.index).toBe(
      '- [Prefer CI](prefer-ci.md) — CI over local\n- see [Lost](lost.md) and [Prefer CI](prefer-ci.md)\n',
    );
    expect(memory.dangling).toEqual(['lost.md']);
    expect(await pruneIndex(repo)).toEqual([]);
  });

  it('indexes a memory Claude left out without touching its file, and only once', async () => {
    const dir = await resolveMemoryDir(repo);
    fs.mkdirSync(dir, { recursive: true });
    const loose = '---\ndescription: Found by hand\ntype: user\n---\n\nBody.\n';
    fs.writeFileSync(path.join(dir, 'loose_note.md'), loose);
    expect((await entryOf('loose_note.md')).inIndex).toBe(false);

    await indexMemory(repo, 'loose_note.md');
    await indexMemory(repo, 'loose_note.md');
    expect(fs.readFileSync(path.join(dir, 'MEMORY.md'), 'utf8')).toBe(
      '- [loose_note](loose_note.md) — Found by hand\n',
    );
    expect(fs.readFileSync(path.join(dir, 'loose_note.md'), 'utf8')).toBe(loose);
    await expect(indexMemory(repo, 'missing.md')).rejects.toThrow(/ENOENT/);
  });

  it('indexes a memory on top when the end of the index is past what Claude loads', async () => {
    const dir = await resolveMemoryDir(repo);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'loose.md'), '---\nname: Loose\ntype: user\n---\n');
    const filler = Array.from({ length: 200 }, (_, i) => `- [N${i}](n${i}.md)`);
    fs.writeFileSync(path.join(dir, 'MEMORY.md'), ['# Index', ...filler, ''].join('\n'));

    await indexMemory(repo, 'loose.md');
    expect(await entryOf('loose.md')).toMatchObject({ inIndex: true, pastIndexLimit: false });
    expect((await readProjectMemory(repo)).index?.split('\n')[1]).toBe('- [Loose](loose.md)');
  });

  it('raises a memory past the cut into the part of the index Claude loads', async () => {
    const dir = await resolveMemoryDir(repo);
    await createMemory(repo, fields);
    const filler = Array.from({ length: 200 }, (_, i) => `- [N${i}](n${i}.md)`);
    fs.writeFileSync(
      path.join(dir, 'MEMORY.md'),
      ['# Index', ...filler, '- [Prefer CI](prefer-ci.md) — CI over local', ''].join('\n'),
    );
    expect((await entryOf('prefer-ci.md')).pastIndexLimit).toBe(true);

    await raiseMemory(repo, 'prefer-ci.md');
    expect((await entryOf('prefer-ci.md')).pastIndexLimit).toBe(false);
    expect((await readProjectMemory(repo)).index?.split('\n').slice(0, 2)).toEqual([
      '# Index',
      '- [Prefer CI](prefer-ci.md) — CI over local',
    ]);
  });

  it('drops the index line of a memory that is already gone', async () => {
    const dir = await resolveMemoryDir(repo);
    await createMemory(repo, fields);
    fs.unlinkSync(path.join(dir, 'prefer-ci.md'));
    await deleteMemory(repo, 'prefer-ci.md', () => Promise.reject(new Error('nothing to trash')));
    expect(fs.readFileSync(path.join(dir, 'MEMORY.md'), 'utf8')).toBe('');
  });

  it('keeps the index when the file could not be removed', async () => {
    await createMemory(repo, fields);
    await expect(
      deleteMemory(repo, 'prefer-ci.md', () => Promise.reject(new Error('no trash'))),
    ).rejects.toThrow('no trash');
    expect((await entryOf('prefer-ci.md')).inIndex).toBe(true);
  });
});
