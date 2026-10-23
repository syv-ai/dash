import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  shell: { openPath: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] },
}));

const knownProjects = vi.hoisted(() => ({ paths: [] as string[] }));
vi.mock('../../services/DatabaseService', () => ({
  DatabaseService: { getProjects: () => knownProjects.paths.map((path) => ({ path })) },
}));

import { ipcMain, shell } from 'electron';
import { memoryProjectArgsSchema, registerMemoryIpc } from '../memoryIpc';
import { resolveMemoryDir } from '../../services/MemoryService';

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
    knownProjects.paths = [project];
    vi.mocked(shell.openPath).mockReset().mockResolvedValue('');
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

  it("refuses a folder that is not one of Dash's projects, on every channel", async () => {
    const stranger = path.join(tmp, 'stranger');
    fs.mkdirSync(await resolveMemoryDir(stranger), { recursive: true });
    for (const channel of ['memory:get', 'memory:openDir']) {
      expect(await invoke(channel, { projectPath: stranger }), channel).toMatchObject({
        success: false,
        code: 'VALIDATION',
      });
    }
    expect(shell.openPath).not.toHaveBeenCalled();
  });

  it("reads a project's memory through the handler", async () => {
    const dir = await resolveMemoryDir(project);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'a.md'), '---\nname: A\n---\nbody');
    expect(await invoke('memory:get', { projectPath: project })).toMatchObject({
      success: true,
      data: { dir, exists: true, hasIndex: false, entries: [{ file: 'a.md', name: 'A' }] },
    });
  });
});
