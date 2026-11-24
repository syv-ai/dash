import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }));
vi.mock('../../services/DatabaseService', () => ({
  DatabaseService: { getProjects: () => [] },
}));

import { ipcMain } from 'electron';
import {
  listDirectory,
  listIgnoredRepoFiles,
  listWorkingRepoFiles,
  parseLsFilesStageZ,
  registerEditorIpc,
} from '../editorIpc';

const invoke = (channel: string, args: unknown): Promise<unknown> => {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(([ch]) => ch === channel);
  if (!call) throw new Error(`${channel} not registered`);
  return Promise.resolve(call[1]({} as Electron.IpcMainInvokeEvent, args));
};

/*
 * A worktree as Dash sees one: `node_modules` a symlink to a directory
 * outside it (another checkout's), a tracked file symlink, a tracked dir
 * symlink, and an ignored real directory (`.husky/_`).
 */
describe('the editor tree listing', () => {
  let tmp: string;
  let repo: string;
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' });

  beforeAll(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dash-tree-')));
    repo = path.join(tmp, 'repo');
    const shared = path.join(tmp, 'shared-node-modules');
    fs.mkdirSync(path.join(shared, 'pkg'), { recursive: true });
    fs.writeFileSync(path.join(shared, 'pkg', 'index.js'), 'module.exports = 1;\n');

    fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
    fs.mkdirSync(path.join(repo, '.husky', '_'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'src', 'a.ts'), 'export const a = 1;\n');
    fs.writeFileSync(path.join(repo, '.husky', 'pre-commit'), 'pnpm lint-staged\n');
    fs.writeFileSync(path.join(repo, '.husky', '_', 'h'), '#!/bin/sh\n');
    fs.writeFileSync(path.join(repo, '.husky', '_', '.gitignore'), '*\n');
    fs.symlinkSync('src/a.ts', path.join(repo, 'link-file.ts'));
    fs.symlinkSync('src', path.join(repo, 'link-dir'));
    fs.symlinkSync(shared, path.join(repo, 'node_modules'));
    fs.writeFileSync(path.join(repo, '.gitignore'), 'node_modules\n');

    execFileSync('git', ['init', '-q', repo]);
    git('add', 'src', '.husky/pre-commit', 'link-file.ts', 'link-dir', '.gitignore');
    fs.writeFileSync(path.join(repo, 'untracked.md'), '# new\n');
    fs.symlinkSync('src', path.join(repo, 'untracked-link-dir'));

    registerEditorIpc();
  });

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('lists symlinked directories as dirs and file symlinks as files', async () => {
    expect(await listWorkingRepoFiles(repo)).toEqual({
      files: ['.gitignore', '.husky/pre-commit', 'link-file.ts', 'src/a.ts', 'untracked.md'],
      dirs: ['link-dir', 'untracked-link-dir'],
    });
  });

  it('lists ignored directories, symlinked or not, as dirs without walking them', async () => {
    expect(await listIgnoredRepoFiles(repo)).toEqual({
      files: [],
      dirs: ['.husky/_', 'node_modules'],
    });
  });

  it("lists one directory's entries, following symlinks out of the worktree", async () => {
    expect(await listDirectory(repo, 'node_modules')).toEqual([{ name: 'pkg', dir: true }]);
    expect(await listDirectory(repo, 'link-dir')).toEqual([{ name: 'a.ts', dir: false }]);
    expect(await listDirectory(repo, '.husky')).toEqual([
      { name: '_', dir: true },
      { name: 'pre-commit', dir: false },
    ]);
  });

  it('refuses a path outside the worktree', async () => {
    await expect(listDirectory(repo, '../shared-node-modules')).rejects.toThrow(/escapes cwd/);
  });

  it('reads a file through a symlinked directory', async () => {
    const res = (await invoke('editor:readWorking', {
      cwd: repo,
      filePath: 'node_modules/pkg/index.js',
      ref: 'HEAD',
    })) as { success: boolean; data?: { workingContent: string | null } };
    expect(res.success).toBe(true);
    expect(res.data?.workingContent).toBe('module.exports = 1;\n');
  });

  it('answers a directory read with IS_DIRECTORY, not EISDIR', async () => {
    for (const filePath of ['.husky/_', 'node_modules', 'link-dir']) {
      expect(
        await invoke('editor:readWorking', { cwd: repo, filePath, ref: 'HEAD' }),
      ).toMatchObject({ success: false, code: 'IS_DIRECTORY' });
    }
  });

  it('still refuses to write through a symlink that leads out', async () => {
    expect(
      await invoke('editor:writeWorking', {
        cwd: repo,
        filePath: 'node_modules/pkg/index.js',
        content: 'x',
        expectedMtimeMs: 0,
        expectedSizeBytes: 0,
      }),
    ).toMatchObject({ success: false });
  });
});

describe('parseLsFilesStageZ', () => {
  it('flags symlinks and lists a conflicted path once', () => {
    const out = [
      '100644 aaa 0\tsrc/a.ts',
      '120000 bbb 0\tlink',
      '100644 ccc 1\tboth.ts',
      '100644 ddd 2\tboth.ts',
      '',
    ].join('\0');
    expect(parseLsFilesStageZ(out)).toEqual([
      { path: 'src/a.ts', symlink: false },
      { path: 'link', symlink: true },
      { path: 'both.ts', symlink: false },
    ]);
  });
});
