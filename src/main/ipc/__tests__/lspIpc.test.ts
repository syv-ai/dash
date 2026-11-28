import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { URI } from 'vscode-uri';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] },
}));

const tasks = vi.hoisted(() => ({ byPath: new Map<string, { archivedAt: string | null }[]>() }));
vi.mock('../../services/DatabaseService', () => ({
  DatabaseService: {
    getTasksByPath: (p: string) => tasks.byPath.get(p) ?? [],
    getProjects: () => [],
  },
}));

const manager = vi.hoisted(() => ({
  open: vi.fn(() => ({ serverId: 'typescript' })),
  change: vi.fn(),
  close: vi.fn(),
  request: vi.fn(async () => ({ contents: 'hi' })),
  cancel: vi.fn(),
  status: vi.fn(() => []),
  closeOwner: vi.fn(),
}));
vi.mock('../../lsp/languageServers', () => ({ languageServers: manager }));

import { ipcMain } from 'electron';
import { registerLspIpc } from '../lspIpc';

const sender = { id: 4, on: vi.fn(), once: vi.fn() };

function invoke(
  channel: string,
  raw: unknown,
): Promise<{ success: boolean; code?: string; data?: unknown }> {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(([ch]) => ch === channel);
  if (!call) throw new Error(`${channel} not registered`);
  return Promise.resolve(call[1]({ sender } as unknown as Electron.IpcMainInvokeEvent, raw));
}

function send(channel: string, raw: unknown): void {
  const call = vi.mocked(ipcMain.on).mock.calls.find(([ch]) => ch === channel);
  if (!call) throw new Error(`${channel} not registered`);
  call[1]({ sender } as unknown as Electron.IpcMainEvent, raw);
}

describe('lsp IPC', () => {
  let tmp: string;
  let worktree: string;
  let fileUri: string;

  beforeAll(() => registerLspIpc());

  beforeEach(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dash-lspipc-')));
    worktree = path.join(tmp, 'wt');
    fs.mkdirSync(path.join(worktree, 'src'), { recursive: true });
    fileUri = URI.file(path.join(worktree, 'src', 'a.ts')).toString();
    tasks.byPath = new Map([[worktree, [{ archivedAt: null }]]]);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const fn of Object.values(manager)) fn.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const open = (over: Record<string, unknown> = {}) =>
    invoke('lsp:open', { worktree, uri: fileUri, version: 1, text: 'x', ...over });

  it('opens a file inside a live task worktree for the calling renderer', async () => {
    expect(await open()).toEqual({ success: true, data: { serverId: 'typescript' } });
    expect(manager.open).toHaveBeenCalledWith(4, { worktree, uri: fileUri, version: 1, text: 'x' });
    expect(sender.once).toHaveBeenCalledWith('destroyed', expect.any(Function));
  });

  it('rejects non-file URIs', async () => {
    for (const uri of ['inmemory://model/1', 'http://example.com/a.ts', 'not a uri']) {
      expect(await open({ uri })).toMatchObject({ success: false, code: 'VALIDATION' });
    }
    expect(manager.open).not.toHaveBeenCalled();
  });

  it('rejects URIs outside the worktree, and worktrees that are not live tasks', async () => {
    const outside = URI.file(path.join(tmp, 'elsewhere.ts')).toString();
    const escape = URI.file(path.join(worktree, '..', 'x.ts')).toString();
    expect(await open({ uri: outside })).toMatchObject({ success: false, code: 'VALIDATION' });
    expect(await open({ uri: escape })).toMatchObject({ success: false, code: 'VALIDATION' });

    fs.symlinkSync(tmp, path.join(worktree, 'link'));
    const viaLink = URI.file(path.join(worktree, 'link', 'elsewhere.ts')).toString();
    expect(await open({ uri: viaLink })).toMatchObject({ success: false, code: 'VALIDATION' });

    expect(await open({ worktree: tmp })).toMatchObject({ success: false, code: 'VALIDATION' });
    tasks.byPath.set(worktree, [{ archivedAt: '2026-11-24' }]);
    expect(await open()).toMatchObject({ success: false, code: 'VALIDATION' });
    expect(manager.open).not.toHaveBeenCalled();
  });

  it('opens a file in a folder whose first task is archived but another is live', async () => {
    tasks.byPath.set(worktree, [{ archivedAt: '2026-11-24' }, { archivedAt: null }]);
    expect(await open()).toEqual({ success: true, data: { serverId: 'typescript' } });
  });

  it('allows only the listed request methods', async () => {
    const request = (method: string) =>
      invoke('lsp:request', {
        uri: fileUri,
        method,
        params: { textDocument: { uri: fileUri } },
        requestId: 1,
      });
    expect(await request('textDocument/hover')).toEqual({
      success: true,
      data: { contents: 'hi' },
    });
    expect(manager.request).toHaveBeenCalledWith(4, {
      uri: fileUri,
      method: 'textDocument/hover',
      params: { textDocument: { uri: fileUri } },
      requestId: '1',
    });
    for (const method of ['workspace/executeCommand', 'shutdown', 'textDocument/formatting']) {
      expect(await request(method)).toMatchObject({ success: false, code: 'VALIDATION' });
    }
    expect(manager.request).toHaveBeenCalledOnce();
  });

  it('surfaces the manager’s error codes', async () => {
    const { IpcError } = await import('../ipcErrors');
    manager.request.mockRejectedValueOnce(new IpcError('Request cancelled', 'CANCELLED'));
    expect(
      await invoke('lsp:request', {
        uri: fileUri,
        method: 'textDocument/completion',
        params: {},
        requestId: 'r',
      }),
    ).toMatchObject({ success: false, code: 'CANCELLED' });
  });

  it('drops malformed fire-and-forget messages', () => {
    send('lsp:change', { uri: 'inmemory://x', version: 2, text: '' });
    send('lsp:change', { uri: fileUri, version: -1, text: '' });
    send('lsp:close', { uri: 42 });
    send('lsp:cancel', {});
    expect(manager.change).not.toHaveBeenCalled();
    expect(manager.close).not.toHaveBeenCalled();
    expect(manager.cancel).not.toHaveBeenCalled();

    send('lsp:change', { uri: fileUri, version: 2, text: 'y' });
    send('lsp:cancel', { requestId: 'r1' });
    expect(manager.change).toHaveBeenCalledWith({ uri: fileUri, version: 2, text: 'y' });
    expect(manager.cancel).toHaveBeenCalledWith(4, 'r1');
  });
});
