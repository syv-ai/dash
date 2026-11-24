import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  findOnPath,
  resolvePyright,
  resolveTypescript,
  settingsSection,
  SERVER_SPECS,
  specForFile,
  unpackedPath,
  type ResolveEnv,
} from '../serverRegistry';

const write = (file: string, content: string, mode?: number): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, { mode });
};

/** A `typescript`-shaped package (named `pkgDir`) with TS 7's per-platform binary beside it. */
function fakeTypescript(
  nodeModules: string,
  pkgDir: string,
  version: string,
  withBinary = true,
): string {
  write(
    path.join(nodeModules, pkgDir, 'package.json'),
    JSON.stringify({ name: 'typescript', version }),
  );
  const platformPkg = path.join(
    nodeModules,
    '@typescript',
    `typescript-${process.platform}-${process.arch}`,
  );
  if (!withBinary) return '';
  write(path.join(platformPkg, 'package.json'), JSON.stringify({ name: 'platform', version }));
  const exe = path.join(platformPkg, 'lib', process.platform === 'win32' ? 'tsc.exe' : 'tsc');
  write(exe, '', 0o755);
  return exe;
}

describe('serverRegistry', () => {
  let tmp: string;
  let env: ResolveEnv;
  let worktree: string;
  let bundledExe: string;

  beforeEach(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dash-lsp-reg-')));
    worktree = path.join(tmp, 'worktree');
    fs.mkdirSync(worktree);
    const bundle = path.join(tmp, 'app');
    bundledExe = fakeTypescript(path.join(bundle, 'node_modules'), 'typescript7', '7.0.2');
    env = {
      platform: process.platform,
      arch: process.arch,
      pathEnv: '',
      execPath: '/electron',
      bundledFrom: path.join(bundle, 'dist'),
    };
  });

  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  describe('TypeScript (D26: workspace TS ≥ 7 first, else bundled TS 7)', () => {
    it('uses the worktree’s own TypeScript 7', () => {
      const exe = fakeTypescript(path.join(worktree, 'node_modules'), 'typescript', '7.1.0');
      expect(resolveTypescript(worktree, env)).toEqual({
        ok: true,
        launch: { command: exe, args: ['--lsp', '--stdio'], source: 'workspace' },
      });
    });

    it('falls back to the bundled TS 7 when the worktree pins TypeScript 6', () => {
      fakeTypescript(path.join(worktree, 'node_modules'), 'typescript', '6.0.3');
      expect(resolveTypescript(worktree, env)).toEqual({
        ok: true,
        launch: { command: bundledExe, args: ['--lsp', '--stdio'], source: 'bundled' },
      });
    });

    it('falls back to the bundled TS 7 when the worktree has none, or its binary is missing', () => {
      expect(resolveTypescript(worktree, env)).toMatchObject({
        ok: true,
        launch: { source: 'bundled' },
      });
      const other = path.join(tmp, 'other');
      fakeTypescript(path.join(other, 'node_modules'), 'typescript', '7.0.2', false);
      // TS 7 installed without its platform package (e.g. --no-optional).
      expect(resolveTypescript(other, env)).toMatchObject({
        ok: true,
        launch: { source: 'bundled' },
      });
    });

    it('is unavailable without a binary for the platform', () => {
      expect(resolveTypescript(worktree, { ...env, arch: 'mips' })).toEqual({
        ok: false,
        reason: `TypeScript 7 has no binary for ${process.platform}-mips`,
      });
    });
  });

  it('runs the bundled pyright on Electron’s Node', () => {
    const resolution = resolvePyright(worktree, { ...env, bundledFrom: __dirname });
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.launch.command).toBe('/electron');
    expect(resolution.launch.env).toEqual({ ELECTRON_RUN_AS_NODE: '1' });
    expect(resolution.launch.args[1]).toBe('--stdio');
    expect(fs.existsSync(resolution.launch.args[0] ?? '')).toBe(true);
  });

  it('finds PATH servers and reports the ones it can’t', () => {
    const bin = path.join(tmp, 'bin');
    write(path.join(bin, 'gopls'), '#!/bin/sh\n', 0o755);
    write(path.join(bin, 'rust-analyzer'), 'not executable', 0o644);
    const pathEnv = ['', path.join(tmp, 'nope'), bin].join(path.delimiter);
    expect(findOnPath('gopls', { ...env, pathEnv })).toBe(path.join(bin, 'gopls'));
    const go = SERVER_SPECS.find((s) => s.id === 'go');
    const rust = SERVER_SPECS.find((s) => s.id === 'rust');
    expect(go?.resolve(worktree, { ...env, pathEnv })).toMatchObject({
      ok: true,
      launch: { source: 'path' },
    });
    expect(rust?.resolve(worktree, { ...env, pathEnv })).toEqual({
      ok: false,
      reason: 'rust-analyzer was not found on PATH',
    });
  });

  it('picks the server and languageId by extension, and nothing for unknown ones', () => {
    expect(specForFile('/w/a.tsx')).toMatchObject({
      spec: { id: 'typescript' },
      languageId: 'typescriptreact',
    });
    expect(specForFile('/w/a.MJS')).toMatchObject({
      spec: { id: 'typescript' },
      languageId: 'javascript',
    });
    expect(specForFile('/w/a.pyi')).toMatchObject({ spec: { id: 'python' }, languageId: 'python' });
    expect(specForFile('/w/README.md')).toBeNull();
    expect(specForFile('/w/Makefile')).toBeNull();
  });

  it('maps packaged paths to app.asar.unpacked once', () => {
    expect(unpackedPath('/A/Resources/app.asar/node_modules/pyright/x.js')).toBe(
      '/A/Resources/app.asar.unpacked/node_modules/pyright/x.js',
    );
    expect(unpackedPath('/A/Resources/app.asar.unpacked/x')).toBe(
      '/A/Resources/app.asar.unpacked/x',
    );
    expect(unpackedPath('/dev/node_modules/x')).toBe('/dev/node_modules/x');
  });

  it('looks up dotted configuration sections', () => {
    const settings = { python: { analysis: { autoSearchPaths: true } } };
    expect(settingsSection(settings, 'python.analysis')).toEqual({ autoSearchPaths: true });
    expect(settingsSection(settings, 'pyright')).toBeNull();
    expect(settingsSection(undefined, 'js/ts')).toBeNull();
  });
});
