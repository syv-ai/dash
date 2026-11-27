import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }));

// One task at `worktree` in `project`; its scratchpad is `scratch`.
const world = vi.hoisted(() => ({ worktree: '', project: '', scratch: '' }));
vi.mock('../../services/DatabaseService', () => ({
  DatabaseService: {
    getProjects: () => [{ id: 'p1', path: world.project }],
    getTasksByPath: (p: string) =>
      p === world.worktree ? [{ id: 't1', projectId: 'p1', path: world.worktree }] : [],
  },
}));
vi.mock('../../services/ScratchpadService', () => ({
  taskScratchpadDir: (id: string) => (id === 't1' ? world.scratch : null),
}));

import { ipcMain } from 'electron';
import { registerEditorIpc } from '../editorIpc';
import { resolveEditorPath } from '../../services/editorPaths';
import { resolveMemoryDir } from '../../services/MemoryService';

// The editor's outside folders (A10) are a write boundary: the renderer names
// an absolute path, and only the task's scratchpad and its project's memory
// may be reached that way. Anything else must be refused, however it is
// spelled.

describe('resolveEditorPath', () => {
  let tmp: string;
  let cwd: string;
  let root: string;
  let elsewhere: string;

  beforeEach(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dash-roots-')));
    cwd = path.join(tmp, 'worktree');
    root = path.join(tmp, 'memory');
    elsewhere = path.join(tmp, 'elsewhere');
    for (const d of [cwd, root, elsewhere]) fs.mkdirSync(d);
    fs.writeFileSync(path.join(elsewhere, 'secret'), 'secret');
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('keeps worktree files on the worktree, with git', () => {
    expect(resolveEditorPath(cwd, 'src/a.ts', [root], 'write')).toEqual({
      abs: path.join(cwd, 'src/a.ts'),
      plain: false,
    });
    expect(resolveEditorPath(cwd, path.join(cwd, 'a.ts'), [root], 'read').plain).toBe(false);
  });

  it('opens a file of an allowed outside folder as a plain file', () => {
    const file = path.join(root, 'feedback_x.md');
    expect(resolveEditorPath(cwd, file, [root], 'write')).toEqual({ abs: file, plain: true });
    expect(resolveEditorPath(cwd, path.join(root, 'deep/n.md'), [root], 'read').plain).toBe(true);
  });

  it('refuses a folder that is not one of the allowed ones', () => {
    expect(() => resolveEditorPath(cwd, path.join(elsewhere, 'secret'), [root], 'read')).toThrow(
      /escapes/,
    );
    expect(() => resolveEditorPath(cwd, '/etc/passwd', [root], 'write')).toThrow(/escapes/);
  });

  it('refuses the outside folder itself', () => {
    expect(() => resolveEditorPath(cwd, root, [root], 'write')).toThrow(/escapes/);
  });

  it('refuses .. out of an allowed folder, and out of the worktree', () => {
    expect(() => resolveEditorPath(cwd, `${root}/../elsewhere/secret`, [root], 'write')).toThrow(
      /escapes/,
    );
    expect(() => resolveEditorPath(cwd, '../memory/a.md', [root], 'write')).toThrow(/escapes/);
  });

  it('refuses a relative path into an outside folder: those are named absolutely', () => {
    expect(() => resolveEditorPath(cwd, '../memory/a.md', [root], 'read')).toThrow();
  });

  it('refuses a symlink in an allowed folder that leads out of it, read or write', () => {
    fs.symlinkSync(path.join(elsewhere, 'secret'), path.join(root, 'link.md'));
    for (const access of ['read', 'write'] as const) {
      expect(() => resolveEditorPath(cwd, path.join(root, 'link.md'), [root], access)).toThrow(
        /symlink/,
      );
    }
  });

  it('refuses a linked folder inside an allowed one that leads out of it', () => {
    fs.symlinkSync(elsewhere, path.join(root, 'out'));
    expect(() => resolveEditorPath(cwd, path.join(root, 'out', 'secret'), [root], 'write')).toThrow(
      /symlink/,
    );
  });

  it('refuses null bytes', () => {
    expect(() => resolveEditorPath(cwd, `${root}/a\0.md`, [root], 'write')).toThrow(/null/);
  });

  it('with no outside folders, refuses every absolute path outside the worktree', () => {
    expect(() => resolveEditorPath(cwd, path.join(root, 'a.md'), [], 'read')).toThrow(/escapes/);
  });
});

const invoke = (channel: string, args: unknown): Promise<unknown> => {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(([ch]) => ch === channel);
  if (!call) throw new Error(`${channel} not registered`);
  return Promise.resolve(call[1]({} as Electron.IpcMainInvokeEvent, args));
};

describe("a task's editor on its scratchpad and memory", () => {
  let tmp: string;
  let memoryDir: string;
  const originalConfigDir = process.env.CLAUDE_CONFIG_DIR;
  const write = (cwd: string, filePath: string, content: string) =>
    invoke('editor:writeWorking', {
      cwd,
      filePath,
      content,
      expectedMtimeMs: 0,
      expectedSizeBytes: 0,
    });

  beforeAll(() => registerEditorIpc());

  beforeEach(async () => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dash-roots-ipc-')));
    process.env.CLAUDE_CONFIG_DIR = path.join(tmp, 'claude');
    world.project = path.join(tmp, 'project');
    world.worktree = path.join(tmp, 'worktree');
    world.scratch = path.join(tmp, 'scratch');
    for (const d of [world.project, world.worktree, world.scratch]) fs.mkdirSync(d);
    memoryDir = await resolveMemoryDir(world.project);
    fs.mkdirSync(memoryDir, { recursive: true });
    fs.writeFileSync(path.join(memoryDir, 'a.md'), 'remember this\n');
  });

  afterEach(() => {
    if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = originalConfigDir;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('reads a memory as a plain file: the file on disk is the original', async () => {
    expect(
      await invoke('editor:readWorking', {
        cwd: world.worktree,
        filePath: path.join(memoryDir, 'a.md'),
        ref: 'HEAD',
      }),
    ).toMatchObject({
      success: true,
      data: { originalContent: 'remember this\n', workingContent: 'remember this\n' },
    });
  });

  it('writes to the task’s scratchpad and its project’s memory', async () => {
    const note = path.join(world.scratch, 'note.md');
    expect(await write(world.worktree, note, 'hi')).toMatchObject({ data: { ok: true } });
    expect(fs.readFileSync(note, 'utf8')).toBe('hi');
    const memory = path.join(memoryDir, 'b.md');
    expect(await write(world.worktree, memory, 'm')).toMatchObject({ data: { ok: true } });
  });

  it('refuses a folder of no task, and a traversal out of the memory', async () => {
    const outside = path.join(tmp, 'pwned.md');
    expect(await write(world.worktree, outside, 'x')).toMatchObject({ success: false });
    expect(await write(world.worktree, `${memoryDir}/../../../pwned.md`, 'x')).toMatchObject({
      success: false,
    });
    expect(fs.existsSync(outside)).toBe(false);
  });

  it("refuses the task's folders from a cwd that is no task's", async () => {
    const stranger = path.join(tmp, 'stranger');
    fs.mkdirSync(stranger);
    const note = path.join(world.scratch, 'note.md');
    expect(await write(stranger, note, 'x')).toMatchObject({ success: false });
    expect(fs.existsSync(note)).toBe(false);
  });
});
