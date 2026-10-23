import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }));

const knownProjects = vi.hoisted(() => ({ paths: [] as string[] }));
vi.mock('../../services/DatabaseService', () => ({
  DatabaseService: { getProjects: () => knownProjects.paths.map((path) => ({ path })) },
}));

import { ipcMain } from 'electron';
import { registerEditorIpc } from '../editorIpc';
import { resolveMemoryDir } from '../../services/MemoryService';

const invoke = (channel: string, args: unknown): Promise<unknown> => {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(([ch]) => ch === channel);
  if (!call) throw new Error(`${channel} not registered`);
  return Promise.resolve(call[1]({} as Electron.IpcMainInvokeEvent, args));
};
const listFiles = (cwd: string) =>
  invoke('editor:listRepoFiles', { cwd, source: { kind: 'working' } });

describe('the editor on a memory folder', () => {
  let tmp: string;
  let memoryDir: string;
  const originalConfigDir = process.env.CLAUDE_CONFIG_DIR;

  beforeAll(() => registerEditorIpc());

  beforeEach(async () => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dash-editor-mem-')));
    // The config dir is itself a repository (dotfiles) that ignores Claude's
    // projects, so git would answer for the memory folder: with nothing.
    const configDir = path.join(tmp, 'claude');
    fs.mkdirSync(configDir);
    execFileSync('git', ['init', '-q'], { cwd: configDir });
    fs.writeFileSync(path.join(configDir, '.gitignore'), 'projects/\n');
    process.env.CLAUDE_CONFIG_DIR = configDir;
    const project = path.join(tmp, 'project');
    fs.mkdirSync(project);
    knownProjects.paths = [project];
    memoryDir = await resolveMemoryDir(project);
    fs.mkdirSync(path.join(memoryDir, 'nested'), { recursive: true });
    fs.writeFileSync(path.join(memoryDir, 'nested', 'deep.md'), '');
    fs.writeFileSync(path.join(memoryDir, 'MEMORY.md'), '- [A](a.md)\n');
    fs.writeFileSync(path.join(memoryDir, 'a.md'), 'remember this\n');
  });

  afterEach(() => {
    if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = originalConfigDir;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('lists its own files, ignored or not, and nothing below it', async () => {
    expect(await listFiles(memoryDir)).toEqual({ success: true, data: ['MEMORY.md', 'a.md'] });
  });

  it('opens a memory as unchanged: the file on disk is the original', async () => {
    expect(
      await invoke('editor:readWorking', { cwd: memoryDir, filePath: 'a.md', ref: 'HEAD' }),
    ).toMatchObject({
      success: true,
      data: { originalContent: 'remember this\n', workingContent: 'remember this\n' },
    });
  });

  it("does not list a folder that is no project's memory", async () => {
    const stranger = path.join(tmp, 'stranger');
    fs.mkdirSync(stranger);
    fs.writeFileSync(path.join(stranger, 'id_rsa'), 'secret');
    expect(await listFiles(stranger)).toMatchObject({ success: false });
  });
});
