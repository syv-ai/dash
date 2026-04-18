import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  createReadStream,
  createWriteStream,
  chmodSync,
  rmSync,
} from 'node:fs';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { app } from 'electron';
import type { WebContents } from 'electron';
import type { RtkStatus, RtkDownloadProgress, RtkSource, RtkTestResult } from '@shared/types';

const execFileAsync = promisify(execFile);

/** Managed-bin resolution wins over $PATH so uninstalling Dash leaves no orphan binary. */
export class RtkService {
  private static sender: WebContents | null = null;
  private static cachedResolution: {
    path: string;
    source: RtkSource;
    version: string | null;
  } | null = null;
  private static downloadInFlight: Promise<void> | null = null;

  static setSender(sender: WebContents): void {
    RtkService.sender = sender;
  }

  private static getConfigPath(): string {
    return join(app.getPath('userData'), 'rtk-config.json');
  }

  static isEnabled(): boolean {
    const p = RtkService.getConfigPath();
    if (!existsSync(p)) return false;
    try {
      const raw = JSON.parse(readFileSync(p, 'utf-8')) as { enabled?: unknown };
      return raw.enabled === true;
    } catch (err) {
      console.error(
        '[RtkService.isEnabled] rtk-config.json unreadable, treating as disabled:',
        err,
      );
      return false;
    }
  }

  static setEnabled(enabled: boolean): void {
    const p = RtkService.getConfigPath();
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify({ enabled }, null, 2));
  }

  private static getManagedBinDir(): string {
    return join(app.getPath('userData'), 'bin');
  }

  private static getManagedBinPath(): string {
    const exe = process.platform === 'win32' ? 'rtk.exe' : 'rtk';
    return join(RtkService.getManagedBinDir(), exe);
  }

  static getManagedBinDirForPath(): string | null {
    return existsSync(RtkService.getManagedBinPath()) ? RtkService.getManagedBinDir() : null;
  }

  private static async resolveBinary(): Promise<{
    path: string;
    source: RtkSource;
    version: string | null;
  } | null> {
    const managed = RtkService.getManagedBinPath();
    if (existsSync(managed)) {
      const version = await RtkService.probeVersion(managed);
      if (version === null) {
        console.warn('[RtkService] managed binary exists but --version failed:', managed);
        return null;
      }
      return { path: managed, source: 'managed', version };
    }

    try {
      const findCmd = process.platform === 'win32' ? 'where.exe' : 'which';
      const { stdout } = await execFileAsync(findCmd, ['rtk']);
      const resolved = stdout.trim().split(/\r?\n/)[0]?.trim();
      if (resolved) {
        const version = await RtkService.probeVersion(resolved);
        if (version === null) {
          console.warn('[RtkService] PATH binary found but --version failed:', resolved);
          return null;
        }
        return { path: resolved, source: 'path', version };
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      // `which` exits 1 when not found; `where.exe` also signals "not found" via non-zero.
      // Everything else (EACCES, EMFILE, `which` binary missing) is worth surfacing.
      if (code !== 'ENOENT' && !/exited.*1/i.test(String((err as Error).message ?? ''))) {
        console.warn('[RtkService] which/where.exe lookup failed unexpectedly:', err);
      }
    }

    return null;
  }

  private static async probeVersion(binPath: string): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync(binPath, ['--version'], { timeout: 3000 });
      return stdout.trim();
    } catch (err) {
      console.warn(`[RtkService] ${binPath} --version failed:`, err);
      return null;
    }
  }

  static getHookCommand(): string | null {
    const resolved = RtkService.cachedResolution;
    if (!resolved) return null;
    // Claude Code runs the hook via sh -c on Unix. Single-quote-escape the
    // path so spaces and any shell metachars ($, `, ", \) in the userData
    // directory never break or inject into the command.
    return `${shellQuoteUnix(resolved.path)} hook claude`;
  }

  static async getStatus(): Promise<RtkStatus> {
    const resolved = await RtkService.resolveBinary();
    RtkService.cachedResolution = resolved;

    return {
      installed: !!resolved,
      version: resolved?.version ?? null,
      path: resolved?.path ?? null,
      source: resolved?.source ?? 'none',
      enabled: RtkService.isEnabled(),
      downloadable: RtkService.isPlatformDownloadable(),
    };
  }

  /** Populates cachedResolution so getHookCommand() is synchronous later. */
  static async warmUp(): Promise<void> {
    RtkService.cachedResolution = await RtkService.resolveBinary();
  }

  // No Windows native release exists upstream — manual-install guidance only there.
  private static isPlatformDownloadable(): boolean {
    if (process.platform === 'darwin') return true;
    if (process.platform === 'linux') return process.arch === 'x64' || process.arch === 'arm64';
    return false;
  }

  private static getReleaseAssetName(): string | null {
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

  /** Single-flight wrapper so double-clicks don't race on the tmp archive. */
  static download(): Promise<void> {
    if (RtkService.downloadInFlight) return RtkService.downloadInFlight;
    RtkService.downloadInFlight = RtkService.doDownload().finally(() => {
      RtkService.downloadInFlight = null;
    });
    return RtkService.downloadInFlight;
  }

  /**
   * Streams RtkDownloadProgress via rtk:downloadProgress AND rejects on failure
   * so the IPC caller sees the same error. Progress events are for UI; the
   * promise is authoritative.
   */
  private static async doDownload(): Promise<void> {
    const assetName = RtkService.getReleaseAssetName();
    if (!assetName) {
      const msg = `No rtk release for ${process.platform}/${process.arch}. Install manually from rtk-ai.app.`;
      RtkService.emitProgress({ phase: 'error', error: msg });
      throw new Error(msg);
    }

    const binDir = RtkService.getManagedBinDir();
    const tmpArchive = join(binDir, `${assetName}.tmp`);
    const binPath = RtkService.getManagedBinPath();

    try {
      RtkService.emitProgress({ phase: 'downloading', percent: 0 });

      const apiRes = await fetch('https://api.github.com/repos/rtk-ai/rtk/releases/latest', {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'dash-rtk-installer' },
      });
      if (!apiRes.ok) {
        throw new Error(`GitHub API ${apiRes.status}: ${apiRes.statusText}`);
      }
      const release = (await apiRes.json()) as unknown;
      if (!isReleasePayload(release)) {
        throw new Error(`Unexpected GitHub API response: ${JSON.stringify(release).slice(0, 200)}`);
      }

      const asset = release.assets.find((a) => a.name === assetName);
      if (!asset) {
        throw new Error(`Release ${release.tag_name} has no asset "${assetName}"`);
      }
      assertTrustedDownloadUrl(asset.browser_download_url);

      const checksumAsset = release.assets.find((a) => a.name === 'checksums.txt');
      if (!checksumAsset) {
        throw new Error(`Release ${release.tag_name} has no checksums.txt — refusing to install.`);
      }
      assertTrustedDownloadUrl(checksumAsset.browser_download_url);

      if (!existsSync(binDir)) mkdirSync(binDir, { recursive: true });

      const expectedSha = await RtkService.fetchExpectedSha256(
        checksumAsset.browser_download_url,
        assetName,
      );

      // GitHub's release CDN occasionally serves truncated/corrupt bytes;
      // retry a few times before surfacing an error to the user.
      const MAX_ATTEMPTS = 3;
      let lastError: Error | null = null;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          await RtkService.fetchToFile(asset.browser_download_url, tmpArchive);
          RtkService.emitProgress({ phase: 'verifying' });
          await RtkService.verifyChecksum(tmpArchive, expectedSha);
          await RtkService.verifyArchive(tmpArchive);
          lastError = null;
          break;
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          console.warn(`[RtkService.download] attempt ${attempt} failed:`, lastError.message);
          rmSync(tmpArchive, { force: true });
          if (attempt < MAX_ATTEMPTS) {
            RtkService.emitProgress({ phase: 'downloading', percent: 0 });
          }
        }
      }
      if (lastError) {
        throw new Error(
          `Download repeatedly failed (${MAX_ATTEMPTS} attempts): ${lastError.message}`,
        );
      }

      RtkService.emitProgress({ phase: 'extracting' });
      try {
        await RtkService.extractTarball(tmpArchive, binDir);
      } catch (err) {
        // Partial extraction may have dropped a half-written binary.
        rmSync(binPath, { force: true });
        throw err;
      }

      if (!existsSync(binPath)) {
        throw new Error(`Archive did not contain expected binary at ${binPath}`);
      }
      // Must chmod before the probeVersion spawn below; tar on some systems drops +x.
      chmodSync(binPath, 0o755);

      RtkService.cachedResolution = await RtkService.resolveBinary();
      if (!RtkService.cachedResolution) {
        rmSync(binPath, { force: true });
        throw new Error('Installed binary failed to report --version; removed.');
      }

      RtkService.emitProgress({ phase: 'done', version: release.tag_name });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      RtkService.emitProgress({ phase: 'error', error: message });
      throw err instanceof Error ? err : new Error(message);
    } finally {
      rmSync(tmpArchive, { force: true });
    }
  }

  private static async fetchExpectedSha256(url: string, assetName: string): Promise<string> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch checksums.txt: ${res.status} ${res.statusText}`);
    const body = await res.text();
    // checksums.txt format: "<hex-sha256>  <filename>" per line.
    for (const line of body.split(/\r?\n/)) {
      const match = line.match(/^([a-f0-9]{64})\s+\*?(.+?)\s*$/i);
      if (match && match[2] === assetName) return match[1]!.toLowerCase();
    }
    throw new Error(`checksums.txt does not list ${assetName}`);
  }

  private static async verifyChecksum(filePath: string, expectedSha: string): Promise<void> {
    const hash = createHash('sha256');
    await pipeline(createReadStream(filePath), hash);
    const actual = hash.digest('hex');
    if (actual !== expectedSha) {
      throw new Error(
        `Checksum mismatch: expected ${expectedSha}, got ${actual}. Refusing to install.`,
      );
    }
  }

  private static async fetchToFile(url: string, dest: string): Promise<void> {
    const dlRes = await fetch(url);
    if (!dlRes.ok || !dlRes.body) {
      throw new Error(`Download failed: ${dlRes.status} ${dlRes.statusText}`);
    }
    const total = Number(dlRes.headers.get('content-length') || '0');
    let transferred = 0;

    const source = Readable.fromWeb(dlRes.body as unknown as WebReadableStream<Uint8Array>);
    source.on('data', (chunk: Buffer) => {
      transferred += chunk.length;
      if (total > 0) {
        RtkService.emitProgress({
          phase: 'downloading',
          percent: Math.min(99, Math.round((transferred / total) * 100)),
        });
      }
    });
    await pipeline(source, createWriteStream(dest));
    if (total > 0 && transferred !== total) {
      throw new Error(`Truncated download: expected ${total} bytes, got ${transferred}.`);
    }
    RtkService.emitProgress({ phase: 'downloading', percent: 100 });
  }

  private static async verifyArchive(archivePath: string): Promise<void> {
    try {
      // Also validates every member is relative and stays inside dest (prevents
      // path-traversal via crafted archives).
      const entries = await RtkService.listTarball(archivePath);
      const dest = RtkService.getManagedBinDir();
      for (const entry of entries) {
        assertSafeArchiveMember(entry, dest);
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(`Archive integrity check failed: ${detail}`);
    }
  }

  private static async extractTarball(archivePath: string, destDir: string): Promise<void> {
    // Plain extract first (rtk's releases put the binary at the archive root).
    // If the binary still isn't where we expect, retry with --strip-components=1
    // for archives that nest the binary under a top-level directory.
    await RtkService.runTar(['-xzf', archivePath, '-C', destDir, '--no-same-owner']);
    if (existsSync(RtkService.getManagedBinPath())) return;
    console.warn('[RtkService] binary not at archive root, retrying with --strip-components=1');
    await RtkService.runTar([
      '-xzf',
      archivePath,
      '-C',
      destDir,
      '--strip-components=1',
      '--no-same-owner',
    ]);
  }

  private static listTarball(archivePath: string): Promise<string[]> {
    return new Promise((resolveP, rejectP) => {
      const proc = spawn('tar', ['-tzf', archivePath], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', (d: Buffer) => {
        stdout += d.toString();
      });
      proc.stderr.on('data', (d: Buffer) => {
        stderr += d.toString();
      });
      proc.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'ENOENT') {
          rejectP(new Error('`tar` is not available on PATH. Install it and retry.'));
        } else {
          rejectP(err);
        }
      });
      proc.on('exit', (code) => {
        if (code === 0) resolveP(stdout.split(/\r?\n/).filter(Boolean));
        else rejectP(new Error(`tar -tzf exited ${code}: ${stderr.trim()}`));
      });
    });
  }

  private static runTar(args: string[]): Promise<void> {
    return new Promise((resolveP, rejectP) => {
      const proc = spawn('tar', args, { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      proc.stderr?.on('data', (d: Buffer) => {
        stderr += d.toString();
      });
      proc.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'ENOENT') {
          rejectP(new Error('`tar` is not available on PATH. Install it and retry.'));
        } else {
          rejectP(err);
        }
      });
      proc.on('exit', (code) => {
        if (code === 0) resolveP();
        else rejectP(new Error(`tar exited ${code}: ${stderr.trim()}`));
      });
    });
  }

  private static emitProgress(progress: RtkDownloadProgress): void {
    const sender = RtkService.sender;
    if (sender && !sender.isDestroyed()) {
      sender.send('rtk:downloadProgress', progress);
    }
  }

  /** Exercises `rtk hook claude` end-to-end so Settings can prove the binary rewrites. */
  static async runHookTest(): Promise<RtkTestResult> {
    const resolved = RtkService.cachedResolution ?? (await RtkService.resolveBinary());
    if (!resolved) {
      return { ok: false, error: 'rtk is not installed' };
    }

    const testedCommand = 'git status';
    const input = JSON.stringify({
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: testedCommand, description: 'RTK self-test' },
    });

    try {
      const { stdout, stderr, code, signal } = await pipeStdin(
        resolved.path,
        ['hook', 'claude'],
        input,
        10_000,
      );

      if (/panic|unwrap|segfault/i.test(stderr)) {
        return { ok: false, testedCommand, error: `rtk crashed: ${stderr.trim().slice(0, 400)}` };
      }
      if (code === null) {
        return {
          ok: false,
          testedCommand,
          error: `rtk killed by signal ${signal ?? 'unknown'} (likely timeout)`,
        };
      }
      if (code !== 0 && code !== 2) {
        return {
          ok: false,
          testedCommand,
          error: `rtk exited ${code}${stderr ? ': ' + stderr.trim().slice(0, 400) : ''}`,
        };
      }

      const rewritten = extractRewrittenCommand(stdout);
      if (rewritten instanceof Error) {
        return {
          ok: false,
          testedCommand,
          error: `rtk produced unparsable output: ${rewritten.message}`,
        };
      }

      return {
        ok: true,
        testedCommand,
        rewrittenCommand: rewritten,
        rawOutput: stdout.slice(0, 2000),
        ...(code === 2 ? { blocked: { stderr: stderr.trim().slice(0, 400) } } : {}),
      };
    } catch (err) {
      return { ok: false, testedCommand, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

// ── Helpers (module-private) ───────────────────────────────────────────────

function pipeStdin(
  cmd: string,
  args: string[],
  stdin: string,
  timeoutMs: number,
): Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }> {
  return new Promise((resolveP, rejectP) => {
    const proc = spawn(cmd, args, { timeout: timeoutMs });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (c: Buffer) => {
      stdout += c.toString();
    });
    proc.stderr.on('data', (c: Buffer) => {
      stderr += c.toString();
    });
    // rtk may exit before reading stdin; EPIPE must not become unhandled.
    proc.stdin.on('error', () => {});
    proc.on('error', rejectP);
    proc.on('close', (code, signal) => resolveP({ code, signal, stdout, stderr }));
    proc.stdin.write(stdin);
    proc.stdin.end();
  });
}

function extractRewrittenCommand(stdout: string): string | null | Error {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(trimmed) as Record<string, unknown>;
  } catch (err) {
    return err instanceof Error ? err : new Error(String(err));
  }
  const paths: Array<(v: Record<string, unknown>) => unknown> = [
    (v) => (isObject(v.hookSpecificOutput) ? v.hookSpecificOutput.updatedInput : undefined),
    (v) => (isObject(v.hookSpecificOutput) ? v.hookSpecificOutput.modifiedToolInput : undefined),
    (v) => (isObject(v.hookSpecificOutput) ? v.hookSpecificOutput.updatedToolInput : undefined),
    (v) => v.updatedInput,
    (v) => v.modifiedToolInput,
    (v) => v.updatedToolInput,
    (v) => v.tool_input,
  ];
  for (const get of paths) {
    const node = get(parsed);
    if (isObject(node) && typeof node.command === 'string') {
      return node.command;
    }
  }
  return null;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object';
}

function shellQuoteUnix(s: string): string {
  // POSIX sh single-quote escape: close quote, inject escaped ', reopen.
  return `'${s.replace(/'/g, "'\\''")}'`;
}

interface ReleasePayload {
  tag_name: string;
  assets: Array<{ name: string; browser_download_url: string }>;
}

function isReleasePayload(v: unknown): v is ReleasePayload {
  if (!isObject(v)) return false;
  if (typeof v.tag_name !== 'string') return false;
  if (!Array.isArray(v.assets)) return false;
  return v.assets.every(
    (a) => isObject(a) && typeof a.name === 'string' && typeof a.browser_download_url === 'string',
  );
}

function assertTrustedDownloadUrl(raw: string): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Refusing malformed asset URL: ${raw}`);
  }
  if (url.protocol !== 'https:') {
    throw new Error(`Refusing non-HTTPS asset URL: ${raw}`);
  }
  const host = url.hostname.toLowerCase();
  const allowed =
    host === 'github.com' ||
    host === 'api.github.com' ||
    host === 'objects.githubusercontent.com' ||
    host.endsWith('.githubusercontent.com');
  if (!allowed) {
    throw new Error(`Refusing asset URL outside GitHub: ${raw}`);
  }
}

function assertSafeArchiveMember(entry: string, destDir: string): void {
  // Reject absolute paths and any entry whose resolved location escapes destDir.
  if (entry.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(entry)) {
    throw new Error(`Archive contains absolute path: ${entry}`);
  }
  const resolved = resolve(destDir, normalize(entry));
  const base = resolve(destDir) + sep;
  if (resolved !== resolve(destDir) && !resolved.startsWith(base)) {
    throw new Error(`Archive member escapes destDir: ${entry}`);
  }
}
