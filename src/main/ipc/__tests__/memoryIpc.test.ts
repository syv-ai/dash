import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  shell: { openPath: vi.fn(), trashItem: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] },
}));

import { ipcMain, shell } from 'electron';
import {
  memoryDeleteArgsSchema,
  memoryProjectArgsSchema,
  memoryUpdateArgsSchema,
  registerMemoryIpc,
} from '../memoryIpc';
import { readProjectMemory, resolveMemoryDir } from '../../services/MemoryService';

describe('memoryProjectArgsSchema', () => {
  it('accepts an absolute project path', () => {
    expect(() => memoryProjectArgsSchema.parse({ projectPath: '/repos/dash' })).not.toThrow();
  });
  it('rejects a relative path', () => {
    expect(() => memoryProjectArgsSchema.parse({ projectPath: 'repos/dash' })).toThrow();
  });
  it('rejects a missing path', () => {
    expect(() => memoryProjectArgsSchema.parse({})).toThrow();
  });
});

describe('memory file arguments', () => {
  const fields = { projectPath: '/repos/dash', name: 'a', description: '', type: 'user', body: '' };
  const update = { ...fields, file: 'a.md', expectedMtimeMs: 1, expectedSizeBytes: 1 };

  it('accepts a memory basename', () => {
    expect(() => memoryUpdateArgsSchema.parse(update)).not.toThrow();
  });
  it.each(['../a.md', 'sub/a.md', 'sub\\a.md', '/etc/a.md', 'a.txt', 'MEMORY.md', 'memory.md'])(
    'rejects %s as a file',
    (file) => {
      expect(() => memoryDeleteArgsSchema.parse({ projectPath: '/repos/dash', file })).toThrow();
      expect(() => memoryUpdateArgsSchema.parse({ ...update, file })).toThrow();
    },
  );
  it('rejects a blank or multi-line name, a multi-line description and an unknown type', () => {
    expect(() => memoryUpdateArgsSchema.parse({ ...update, name: '  ' })).toThrow();
    expect(() => memoryUpdateArgsSchema.parse({ ...update, name: 'a\nmetadata:' })).toThrow();
    expect(() => memoryUpdateArgsSchema.parse({ ...update, description: 'a\nb' })).toThrow();
    expect(() => memoryUpdateArgsSchema.parse({ ...update, type: 'bogus' })).toThrow();
    expect(() => memoryUpdateArgsSchema.parse({ ...update, hook: 'a\n- [x](y.md)' })).toThrow();
  });
});

describe('memory handlers', () => {
  let tmp: string;
  let project: string;
  const originalConfigDir = process.env.CLAUDE_CONFIG_DIR;
  const invoke = (channel: string, raw: unknown): Promise<unknown> => {
    const call = vi.mocked(ipcMain.handle).mock.calls.find(([ch]) => ch === channel);
    if (!call) throw new Error(`${channel} not registered`);
    return Promise.resolve(call[1]({} as Electron.IpcMainInvokeEvent, raw));
  };
  const openDir = (raw: unknown) => invoke('memory:openDir', raw);

  beforeAll(() => registerMemoryIpc());

  beforeEach(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dash-memipc-')));
    process.env.CLAUDE_CONFIG_DIR = path.join(tmp, 'claude');
    project = path.join(tmp, 'plain');
    fs.mkdirSync(project);
    vi.mocked(shell.openPath).mockReset().mockResolvedValue('');
    vi.mocked(shell.trashItem)
      .mockReset()
      .mockImplementation((full) => fs.promises.unlink(full));
  });

  afterEach(() => {
    if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = originalConfigDir;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('opens only the memory folder it computes itself', async () => {
    const dir = await resolveMemoryDir(project);
    fs.mkdirSync(dir, { recursive: true });
    expect(await openDir({ projectPath: project })).toEqual({ success: true, data: null });
    expect(shell.openPath).toHaveBeenCalledWith(dir);
  });

  it('reports NOT_FOUND without opening anything when there is no folder', async () => {
    expect(await openDir({ projectPath: project })).toMatchObject({
      success: false,
      code: 'NOT_FOUND',
    });
    expect(shell.openPath).not.toHaveBeenCalled();
  });

  it("surfaces the OS's failure to open the folder", async () => {
    fs.mkdirSync(await resolveMemoryDir(project), { recursive: true });
    vi.mocked(shell.openPath).mockResolvedValue('no handler');
    expect(await openDir({ projectPath: project })).toMatchObject({
      success: false,
      error: 'no handler',
    });
  });

  it('rejects a relative path without opening anything', async () => {
    expect(await openDir({ projectPath: 'plain' })).toMatchObject({ success: false });
    expect(shell.openPath).not.toHaveBeenCalled();
  });

  it('creates, updates and trashes a memory through the handlers', async () => {
    const fields = { name: 'Prefer CI', description: 'hook', type: 'feedback', body: 'Use CI.' };
    expect(await invoke('memory:create', { projectPath: project, ...fields })).toEqual({
      success: true,
      data: { file: 'prefer-ci.md' },
    });
    const [entry] = (await readProjectMemory(project)).entries;

    expect(
      await invoke('memory:update', {
        projectPath: project,
        file: 'prefer-ci.md',
        ...fields,
        body: 'Always.',
        hook: 'when tests are slow',
        expectedMtimeMs: entry!.mtimeMs,
        expectedSizeBytes: entry!.sizeBytes,
      }),
    ).toMatchObject({ success: true, data: { ok: true } });
    expect((await readProjectMemory(project)).entries[0]).toMatchObject({
      body: '\nAlways.\n',
      hook: 'when tests are slow',
    });

    // The same expectation is now out of date: reported, not written.
    expect(
      await invoke('memory:update', {
        projectPath: project,
        file: 'prefer-ci.md',
        ...fields,
        expectedMtimeMs: entry!.mtimeMs,
        expectedSizeBytes: entry!.sizeBytes,
      }),
    ).toMatchObject({ success: true, data: { ok: false, stale: true } });

    const dir = await resolveMemoryDir(project);
    fs.appendFileSync(path.join(dir, 'MEMORY.md'), '- [Gone](gone.md) — deleted by hand\n');
    expect(await invoke('memory:prune', { projectPath: project })).toEqual({
      success: true,
      data: { removed: ['gone.md'] },
    });
    expect(await invoke('memory:delete', { projectPath: project, file: 'prefer-ci.md' })).toEqual({
      success: true,
      data: null,
    });
    expect(shell.trashItem).toHaveBeenCalledWith(path.join(dir, 'prefer-ci.md'));
    expect(await readProjectMemory(project)).toMatchObject({ entries: [], index: '' });
  });

  it('reports a name that is already taken instead of replacing the memory', async () => {
    const args = { projectPath: project, name: 'Dup', description: '', type: 'user', body: 'a' };
    await invoke('memory:create', args);
    expect(await invoke('memory:create', { ...args, body: 'b' })).toMatchObject({
      success: false,
      error: expect.stringContaining('dup.md already exists'),
    });
  });

  it('never touches a path outside the memory folder', async () => {
    const outside = path.join(tmp, 'outside.md');
    fs.writeFileSync(outside, 'keep');
    for (const file of ['../outside.md', outside]) {
      expect(await invoke('memory:delete', { projectPath: project, file })).toMatchObject({
        success: false,
        code: 'VALIDATION',
      });
    }
    expect(shell.trashItem).not.toHaveBeenCalled();
    expect(fs.readFileSync(outside, 'utf8')).toBe('keep');
  });
});
