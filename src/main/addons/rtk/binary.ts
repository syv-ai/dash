import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ensureUserBinSymlink, shellQuoteUnix } from './helpers';
import type { RtkResolution } from './types';

const execFileAsync = promisify(execFile);

// Where the managed binary lives and how an installed rtk is found. The managed
// binary (in the add-on's data dir) wins over $PATH so uninstalling Dash leaves
// no orphan binary.

export function managedBinDir(dataDir: string): string {
  return join(dataDir, 'bin');
}

export function managedBinPath(dataDir: string): string {
  return join(managedBinDir(dataDir), process.platform === 'win32' ? 'rtk.exe' : 'rtk');
}

/**
 * `~/.local/bin/rtk` symlink to the managed binary. RTK's hook rewrites
 * `git status` → `rtk git status`, so `rtk` must resolve via $PATH wherever
 * Claude Code's Bash tool runs — including sessions the supervisor dispatched
 * with a frozen env. `~/.local/bin` is on $PATH by default on Linux and harmless
 * on macOS. Null on Windows (no native release upstream).
 */
export function userPathSymlink(): string | null {
  if (process.platform === 'win32') return null;
  return join(homedir(), '.local', 'bin', 'rtk');
}

export function linkIntoUserPath(target: string): void {
  const link = userPathSymlink();
  if (link) ensureUserBinSymlink(target, link);
}

/**
 * Before add-ons, the managed binary lived at `<userData>/bin/rtk`. Move it
 * into the add-on's data dir (`<userData>/addons/rtk/bin/rtk`) once, and repoint
 * the user-PATH symlink. Best-effort: a failure leaves the old copy in place and
 * resolution falls back to $PATH.
 */
export function migrateLegacyBinary(dataDir: string): void {
  const userData = dirname(dirname(dataDir));
  const legacy = join(userData, 'bin', process.platform === 'win32' ? 'rtk.exe' : 'rtk');
  const target = managedBinPath(dataDir);
  if (!existsSync(legacy) || existsSync(target)) return;
  try {
    mkdirSync(dirname(target), { recursive: true });
    renameSync(legacy, target);
    linkIntoUserPath(target);
  } catch (err) {
    console.warn('[rtk] could not move the managed binary into the add-on dir:', err);
  }
}

async function probeVersion(binPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(binPath, ['--version'], { timeout: 3000 });
    return stdout.trim();
  } catch (err) {
    console.warn(`[rtk] ${binPath} --version failed:`, err);
    return null;
  }
}

export async function resolveBinary(dataDir: string): Promise<RtkResolution | null> {
  const managed = managedBinPath(dataDir);
  if (existsSync(managed)) {
    const version = await probeVersion(managed);
    if (version === null) {
      console.warn('[rtk] managed binary exists but --version failed:', managed);
      return null;
    }
    return { path: managed, source: 'managed', version };
  }

  try {
    const findCmd = process.platform === 'win32' ? 'where.exe' : 'which';
    const { stdout } = await execFileAsync(findCmd, ['rtk']);
    const resolved = stdout.trim().split(/\r?\n/)[0]?.trim();
    if (resolved) {
      const version = await probeVersion(resolved);
      if (version === null) {
        console.warn('[rtk] PATH binary found but --version failed:', resolved);
        return null;
      }
      return { path: resolved, source: 'path', version };
    }
  } catch (err) {
    // execFile rejects with `code` 'ENOENT' for a missing `which`, or the
    // numeric exit code; exit 1 from which/where.exe means "not found".
    const code = (err as { code?: unknown }).code;
    if (code !== 'ENOENT' && code !== 1) {
      console.warn('[rtk] which/where.exe lookup failed unexpectedly:', err);
    }
  }
  return null;
}

/**
 * The PreToolUse hook command. Claude Code runs hooks via `sh -c`, so the path
 * is single-quoted: spaces and shell metacharacters in userData can't break or
 * inject into the command.
 */
export function hookCommand(binPath: string): string {
  return `${shellQuoteUnix(binPath)} hook claude`;
}

// No Windows native release exists upstream — manual install only there.
export function isPlatformDownloadable(): boolean {
  if (process.platform === 'darwin') return true;
  if (process.platform === 'linux') return process.arch === 'x64' || process.arch === 'arm64';
  return false;
}

export function releaseAssetName(): string | null {
  if (process.platform === 'darwin') {
    return process.arch === 'arm64'
      ? 'rtk-aarch64-apple-darwin.tar.gz'
      : 'rtk-x86_64-apple-darwin.tar.gz';
  }
  if (process.platform === 'linux') {
    if (process.arch === 'x64') return 'rtk-x86_64-unknown-linux-musl.tar.gz';
    if (process.arch === 'arm64') return 'rtk-aarch64-unknown-linux-gnu.tar.gz';
  }
  return null;
}
