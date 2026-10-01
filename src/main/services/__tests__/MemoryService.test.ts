import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { claudeProjectDir } from '../../utils/claudePaths';
import {
  createMemory,
  deleteMemory,
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
    expect(byFile['orphan.md']).toMatchObject({ name: 'orphan', type: 'other', inIndex: false });
    expect(byFile['orphan.md']!.mtimeMs).toBeGreaterThan(0);
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
    const file = await createMemory(worktree, fields);
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
    expect(fs.readFileSync(path.join(dir, 'ci.md'), 'utf8')).toBe(
      '---\nname: Prefer CI\ndescription: CI over local\ntype: feedback\noriginSessionId: abc\n---\n\nUse CI.\n',
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
    const file = await createMemory(repo, fields);
    await createMemory(repo, { ...fields, name: 'Other' });
    // Claude's own wording for the hook.
    fs.writeFileSync(
      indexPath,
      '- [Prefer CI](prefer-ci.md) — when tests are slow\n- [Other](other.md) — two\n',
    );

    // A body edit is not a reason to reword the line.
    await updateMemory(repo, file, { ...fields, body: 'Always.' }, await entryOf(file));
    expect(fs.readFileSync(indexPath, 'utf8')).toContain('— when tests are slow');

    // A new name or description is: the line follows, in place.
    const renamed = { ...fields, name: 'CI first', description: 'Run the suite in CI' };
    await updateMemory(repo, file, renamed, await entryOf(file));
    expect(fs.readFileSync(indexPath, 'utf8')).toBe(
      '- [CI first](prefer-ci.md) — Run the suite in CI\n- [Other](other.md) — two\n',
    );
  });

  it("moves other memories' [[links]] when a memory is renamed", async () => {
    const dir = await resolveMemoryDir(repo);
    const file = await createMemory(repo, fields);
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

  it('leaves links alone when another memory still has the old name', async () => {
    const dir = await resolveMemoryDir(repo);
    const file = await createMemory(repo, fields);
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
    const file = await createMemory(repo, fields);
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
    const file = await createMemory(repo, fields);
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
    expect((await entryOf(file)).body).toBe('\nmine\n');
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

  it('keeps the index when the file could not be removed', async () => {
    await createMemory(repo, fields);
    await expect(
      deleteMemory(repo, 'prefer-ci.md', () => Promise.reject(new Error('no trash'))),
    ).rejects.toThrow('no trash');
    expect((await entryOf('prefer-ci.md')).inIndex).toBe(true);
  });
});
