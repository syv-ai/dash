import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';

/**
 * The language servers Dash knows, as data: which files each serves, how to
 * find its executable for a worktree, and what it is told when it asks for
 * settings. Adding a language is one entry in `SERVER_SPECS`.
 */

/** How to start a server process. */
export interface ServerLaunch {
  command: string;
  args: string[];
  /** Merged over `process.env`. */
  env?: Record<string, string>;
  /** Where the executable came from, for the status indicator. */
  source: 'workspace' | 'bundled' | 'path';
}

export type LaunchResolution = { ok: true; launch: ServerLaunch } | { ok: false; reason: string };

/** What resolution depends on besides the worktree; injectable for tests. */
export interface ResolveEnv {
  platform: NodeJS.Platform;
  arch: string;
  /** PATH to search. `fixPath()` in main.ts has already merged the login shell's PATH. */
  pathEnv: string;
  /** Electron's binary: bundled JS servers run on it with ELECTRON_RUN_AS_NODE. */
  execPath: string;
  /** Directory bundled packages resolve from (Dash's own `node_modules` above it). */
  bundledFrom: string;
}

export interface ServerSpec {
  /** Stable id, also the manager's key part. */
  id: string;
  /** Display name for the status indicator. */
  name: string;
  /** File extension (with dot, lower case) → LSP languageId sent in didOpen. */
  extensions: Readonly<Record<string, string>>;
  resolve(root: string, env: ResolveEnv): LaunchResolution;
  /** Answers `workspace/configuration`, keyed by section (dotted sections are looked up nested). */
  settings?(root: string): Record<string, unknown>;
}

export function defaultResolveEnv(): ResolveEnv {
  return {
    platform: process.platform,
    arch: process.arch,
    pathEnv: process.env.PATH ?? '',
    execPath: process.execPath,
    bundledFrom: __dirname,
  };
}

/**
 * A packaged app's `node_modules` lives in `app.asar`, which only Electron's
 * patched fs can read; executables and scripts a child process loads must come
 * from `app.asar.unpacked` (see `asarUnpack` in package.json).
 */
export function unpackedPath(p: string): string {
  return p.replace(/app\.asar(?=[\\/])/, 'app.asar.unpacked');
}

function resolveFrom(fromDir: string, request: string): string | null {
  try {
    return createRequire(path.join(fromDir, 'noop.js')).resolve(request);
  } catch {
    return null;
  }
}

function readVersion(packageJson: string): string | null {
  try {
    const { version } = JSON.parse(fs.readFileSync(packageJson, 'utf8')) as { version?: unknown };
    return typeof version === 'string' ? version : null;
  } catch {
    return null;
  }
}

/**
 * TS 7's `tsc` is a native binary in a per-platform package next to
 * `typescript` (what its own `lib/getExePath.js` resolves). Spawning it
 * directly skips the Node launcher, so no `node` on PATH is needed.
 */
function tsgoExecutable(typescriptDir: string, env: ResolveEnv): string | null {
  const platformPkg = `@typescript/typescript-${env.platform}-${env.arch}/package.json`;
  const pkgJson = resolveFrom(typescriptDir, platformPkg);
  if (!pkgJson) return null;
  const exe = path.join(path.dirname(pkgJson), 'lib', env.platform === 'win32' ? 'tsc.exe' : 'tsc');
  return fs.existsSync(exe) ? exe : null;
}

const TSC_LSP_ARGS = ['--lsp', '--stdio'];

/**
 * D26: the worktree's own TypeScript when it is 7 or newer (its version is
 * what the project compiles with), otherwise the bundled `typescript@7`.
 */
export function resolveTypescript(root: string, env: ResolveEnv): LaunchResolution {
  const workspacePkg = path.join(root, 'node_modules', 'typescript', 'package.json');
  const major = Number.parseInt(readVersion(workspacePkg) ?? '', 10);
  if (major >= 7) {
    const exe = tsgoExecutable(path.dirname(fs.realpathSync(workspacePkg)), env);
    if (exe) return { ok: true, launch: { command: exe, args: TSC_LSP_ARGS, source: 'workspace' } };
  }
  const bundledPkg = resolveFrom(env.bundledFrom, 'typescript7/package.json');
  const exe = bundledPkg && tsgoExecutable(path.dirname(bundledPkg), env);
  if (!exe)
    return { ok: false, reason: `TypeScript 7 has no binary for ${env.platform}-${env.arch}` };
  return {
    ok: true,
    launch: { command: unpackedPath(exe), args: TSC_LSP_ARGS, source: 'bundled' },
  };
}

/** Pyright is plain JS: run it on Electron's own Node. */
export function resolvePyright(_root: string, env: ResolveEnv): LaunchResolution {
  const pkgJson = resolveFrom(env.bundledFrom, 'pyright/package.json');
  if (!pkgJson) return { ok: false, reason: 'The bundled pyright is missing' };
  const script = unpackedPath(path.join(path.dirname(pkgJson), 'langserver.index.js'));
  return {
    ok: true,
    launch: {
      command: env.execPath,
      args: [script, '--stdio'],
      env: { ELECTRON_RUN_AS_NODE: '1' },
      source: 'bundled',
    },
  };
}

export function findOnPath(name: string, env: ResolveEnv): string | null {
  const sep = env.platform === 'win32' ? ';' : ':';
  const names = env.platform === 'win32' ? [`${name}.exe`, `${name}.cmd`] : [name];
  for (const dir of env.pathEnv.split(sep)) {
    if (!dir) continue;
    for (const n of names) {
      const candidate = path.join(dir, n);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch {
        // Not here.
      }
    }
  }
  return null;
}

function onPath(binary: string, args: string[] = []): ServerSpec['resolve'] {
  return (_root, env) => {
    const command = findOnPath(binary, env);
    return command
      ? { ok: true, launch: { command, args, source: 'path' } }
      : { ok: false, reason: `${binary} was not found on PATH` };
  };
}

/** A project virtualenv, so pyright resolves the packages the project installs. */
function pythonSettings(root: string): Record<string, unknown> {
  const venvPython = ['.venv', 'venv']
    .map((dir) =>
      process.platform === 'win32'
        ? path.join(root, dir, 'Scripts', 'python.exe')
        : path.join(root, dir, 'bin', 'python'),
    )
    .find((p) => fs.existsSync(p));
  return {
    python: {
      ...(venvPython ? { pythonPath: venvPython } : {}),
      analysis: {
        autoSearchPaths: true,
        useLibraryCodeForTypes: true,
        diagnosticMode: 'openFilesOnly',
      },
    },
  };
}

export const SERVER_SPECS: readonly ServerSpec[] = [
  {
    id: 'typescript',
    name: 'TypeScript',
    extensions: {
      '.ts': 'typescript',
      '.mts': 'typescript',
      '.cts': 'typescript',
      '.tsx': 'typescriptreact',
      '.js': 'javascript',
      '.mjs': 'javascript',
      '.cjs': 'javascript',
      '.jsx': 'javascriptreact',
    },
    resolve: resolveTypescript,
    // TS 7 asks for `js/ts`, `typescript`, `javascript` and `editor`; its
    // defaults are what we want, so every section answers null.
  },
  {
    id: 'python',
    name: 'Pyright',
    extensions: { '.py': 'python', '.pyi': 'python' },
    resolve: resolvePyright,
    settings: pythonSettings,
  },
  {
    id: 'go',
    name: 'gopls',
    extensions: { '.go': 'go' },
    resolve: onPath('gopls'),
  },
  {
    id: 'rust',
    name: 'rust-analyzer',
    extensions: { '.rs': 'rust' },
    resolve: onPath('rust-analyzer'),
  },
];

/** The spec serving `filePath` (by extension), and the languageId to open it as. */
export function specForFile(
  filePath: string,
  specs: readonly ServerSpec[] = SERVER_SPECS,
): { spec: ServerSpec; languageId: string } | null {
  const ext = path.extname(filePath).toLowerCase();
  for (const spec of specs) {
    const languageId = spec.extensions[ext];
    if (languageId) return { spec, languageId };
  }
  return null;
}

/** `workspace/configuration` lookup: `python.analysis` reads `settings.python.analysis`. */
export function settingsSection(
  settings: Record<string, unknown> | undefined,
  section: string | undefined,
): unknown {
  if (!settings) return null;
  if (!section) return settings;
  let node: unknown = settings;
  for (const part of section.split('.')) {
    if (node === null || typeof node !== 'object') return null;
    node = (node as Record<string, unknown>)[part];
  }
  return node ?? null;
}
