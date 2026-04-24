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
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { delimiter, dirname, join, normalize, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { app } from 'electron';
import type { WebContents } from 'electron';
import type { RtkStatus, RtkDownloadProgress, RtkTestResult } from '@shared/types';

const execFileAsync = promisify(execFile);

// Cap download phases so a hung CDN cannot leave the single-flight promise
// pending forever — subsequent download() calls would await the dead promise.
const FETCH_API_TIMEOUT_MS = 60_000;
const FETCH_BODY_TIMEOUT_MS = 300_000;
const TAR_TIMEOUT_MS = 120_000;

/** Managed-bin resolution wins over $PATH so uninstalling Dash leaves no orphan binary. */
export class RtkService {
  private static sender: WebContents | null = null;
  private static cachedResolution: {
    path: string;
    source: 'path' | 'managed';
    version: string;
  } | null = null;
  private static downloadInFlight: Promise<void> | null = null;
  // Mirrors the on-disk rtk-config.json flag; saves a disk read per hook write.
  // null = not yet loaded; hydrated on first isEnabled() call and after setEnabled().
  private static enabledCache: boolean | null = null;

  static setSender(sender: WebContents): void {
    RtkService.sender = sender;
  }

  private static getConfigPath(): string {
    return join(app.getPath('userData'), 'rtk-config.json');
  }

  static isEnabled(): boolean {
    if (RtkService.enabledCache !== null) return RtkService.enabledCache;
    const p = RtkService.getConfigPath();
    if (!existsSync(p)) {
      RtkService.enabledCache = false;
      return false;
    }
    try {
      const raw = JSON.parse(readFileSync(p, 'utf-8')) as { enabled?: unknown };
      const value = raw.enabled === true;
      if (raw.enabled !== undefined && typeof raw.enabled !== 'boolean') {
        console.warn(
          '[RtkService.isEnabled] rtk-config.json "enabled" is not a boolean; treating as false.',
        );
      }
      RtkService.enabledCache = value;
      return value;
    } catch (err) {
      console.error(
        '[RtkService.isEnabled] rtk-config.json unreadable, treating as disabled:',
        err,
      );
      RtkService.enabledCache = false;
      return false;
    }
  }

  /**
   * Enforces the "installed before enabled" invariant at the data layer so
   * callers outside the IPC handler can't write a config that lies about state.
   */
  static setEnabled(enabled: boolean): void {
    if (enabled && !RtkService.cachedResolution) {
      throw new Error('rtk is not installed');
    }
    const p = RtkService.getConfigPath();
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify({ enabled }, null, 2));
    RtkService.enabledCache = enabled;
  }

  private static getManagedBinDir(): string {
    return join(app.getPath('userData'), 'bin');
  }

  private static getManagedBinPath(): string {
    const exe = process.platform === 'win32' ? 'rtk.exe' : 'rtk';
    return join(RtkService.getManagedBinDir(), exe);
  }

  /**
   * Returns the managed bin dir ONLY when a probed-good binary is there.
   * Gating on cachedResolution (not just existsSync) prevents poisoning the
   * PTY PATH with a dir whose binary failed --version.
   */
  static getManagedBinDirForPath(): string | null {
    return RtkService.cachedResolution?.source === 'managed' ? RtkService.getManagedBinDir() : null;
  }

  private static async resolveBinary(): Promise<{
    path: string;
    source: 'path' | 'managed';
    version: string;
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
      // Node's execFile rejects with an Error decorated with `code`: the
      // string 'ENOENT' for a missing `which` binary, or the numeric exit
      // code for a non-zero exit. Exit 1 from `which`/`where.exe` is the
      // "not found" signal — not noise.
      const code = (err as { code?: unknown }).code;
      if (code !== 'ENOENT' && code !== 1) {
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

    const enabled = RtkService.isEnabled();
    const downloadable = RtkService.isPlatformDownloadable();
    if (resolved) {
      return {
        installed: true,
        version: resolved.version,
        path: resolved.path,
        source: resolved.source,
        enabled,
        downloadable,
      };
    }
    return { installed: false, enabled, downloadable };
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

      const apiRes = await fetchWithTimeout(
        'https://api.github.com/repos/rtk-ai/rtk/releases/latest',
        {
          headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'dash-rtk-installer' },
        },
        FETCH_API_TIMEOUT_MS,
      );
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
    const res = await fetchWithTimeout(url, {}, FETCH_API_TIMEOUT_MS);
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
    const controller = new AbortController();
    const wallTimer = setTimeout(() => controller.abort(), FETCH_BODY_TIMEOUT_MS);
    try {
      const dlRes = await fetch(url, { signal: controller.signal });
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
    } finally {
      clearTimeout(wallTimer);
    }
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
      const proc = spawn('tar', ['-tzf', archivePath], {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: TAR_TIMEOUT_MS,
      });
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
      proc.on('exit', (code, signal) => {
        if (signal) rejectP(new Error(`tar -tzf killed by signal ${signal} (timed out?)`));
        else if (code === 0) resolveP(stdout.split(/\r?\n/).filter(Boolean));
        else rejectP(new Error(`tar -tzf exited ${code}: ${stderr.trim()}`));
      });
    });
  }

  private static runTar(args: string[]): Promise<void> {
    return new Promise((resolveP, rejectP) => {
      const proc = spawn('tar', args, {
        stdio: ['ignore', 'ignore', 'pipe'],
        timeout: TAR_TIMEOUT_MS,
      });
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
      proc.on('exit', (code, signal) => {
        if (signal) rejectP(new Error(`tar killed by signal ${signal} (timed out?)`));
        else if (code === 0) resolveP();
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
      // rtk exits 2 to signal "block this tool call" — a valid hook result, not an error.
      if (code !== 0 && code !== 2) {
        return {
          ok: false,
          testedCommand,
          error: `rtk exited ${code}${stderr ? ': ' + stderr.trim().slice(0, 400) : ''}`,
        };
      }

      const extracted = extractRewrittenCommand(stdout);
      if (!extracted.ok) {
        return {
          ok: false,
          testedCommand,
          error: `rtk produced unparsable output: ${extracted.reason}`,
        };
      }

      // Only attempt real execution when rtk actually rewrote the command AND
      // didn't block it — otherwise the diff would be empty or meaningless.
      const execDiff =
        extracted.command && extracted.command !== testedCommand && code !== 2
          ? await RtkService.captureExecDiff(testedCommand, extracted.command)
          : null;

      return {
        ok: true,
        testedCommand,
        rewrittenCommand: extracted.command,
        rawOutput: stdout.slice(0, 2000),
        ...(code === 2 ? { blocked: { stderr: stderr.trim().slice(0, 400) } } : {}),
        ...(execDiff ? { execDiff } : {}),
      };
    } catch (err) {
      return { ok: false, testedCommand, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Execute both the raw and rtk-rewritten commands inside a throwaway git
   * repo populated with enough untracked files to make `git status` verbose.
   * Returns null on any failure — this is a best-effort visualization, not a
   * correctness check. The rewrite-directive check above already proved rtk
   * is working; this just makes the compression visible to the user.
   */
  private static async captureExecDiff(
    rawCommand: string,
    rewrittenCommand: string,
  ): Promise<import('@shared/types').RtkExecDiff | null> {
    const dir = await mkdtemp(join(tmpdir(), 'dash-rtk-verify-'));
    try {
      // Give `git status` something non-trivial to emit — multiple files
      // across a few directories so rtk's grouping/dedup filters have work.
      await Promise.all([
        writeFile(join(dir, 'package.json'), '{}\n'),
        writeFile(join(dir, 'README.md'), '# test\n'),
        writeFile(join(dir, 'config.toml'), '[section]\nvalue = 1\n'),
        mkdir(join(dir, 'src')).then(() =>
          Promise.all([
            writeFile(join(dir, 'src', 'index.ts'), 'export {};\n'),
            writeFile(join(dir, 'src', 'lib.ts'), 'export {};\n'),
            writeFile(join(dir, 'src', 'types.ts'), 'export {};\n'),
          ]),
        ),
        mkdir(join(dir, 'tests')).then(() =>
          Promise.all([
            writeFile(join(dir, 'tests', 'a.test.ts'), 'test\n'),
            writeFile(join(dir, 'tests', 'b.test.ts'), 'test\n'),
          ]),
        ),
      ]);

      await runShell('git init -q', dir);

      // Make sure rtk resolves from the rewritten command even when the user
      // never installed it on the system PATH — prepend our managed bin dir.
      const managedDir = RtkService.getManagedBinDirForPath();
      const pathWithRtk = [managedDir, process.env.PATH].filter(Boolean).join(delimiter);
      const env = { ...process.env, PATH: pathWithRtk };

      const [rawRes, rewrittenRes] = await Promise.all([
        runShell(rawCommand, dir, env),
        runShell(rewrittenCommand, dir, env),
      ]);

      // Trim IPC payload but report the TRUE byte counts so savings math stays honest.
      const DISPLAY_CAP = 8 * 1024;
      return {
        rawStdout: rawRes.stdout.slice(0, DISPLAY_CAP),
        compressedStdout: rewrittenRes.stdout.slice(0, DISPLAY_CAP),
        rawBytes: Buffer.byteLength(rawRes.stdout),
        compressedBytes: Buffer.byteLength(rewrittenRes.stdout),
      };
    } catch (err) {
      console.warn('[RtkService.captureExecDiff] non-fatal:', err);
      return null;
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

// ── Helpers (module-private) ───────────────────────────────────────────────

/**
 * Run a shell string and capture its stdout/stderr up to a hard cap. Used by
 * the Test RTK flow to exec both the raw command (e.g. `git status`) and the
 * rtk-rewritten version (e.g. `rtk git status`) in a controlled environment.
 */
const RUN_SHELL_OUTPUT_CAP = 64 * 1024;

function runShell(
  cmd: string,
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
  timeoutMs = 15_000,
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolveP, rejectP) => {
    const shell = process.platform === 'win32' ? 'cmd.exe' : 'sh';
    const args = process.platform === 'win32' ? ['/c', cmd] : ['-c', cmd];
    const proc = spawn(shell, args, { cwd, env, timeout: timeoutMs });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (c: Buffer) => {
      if (stdout.length < RUN_SHELL_OUTPUT_CAP) stdout += c.toString();
    });
    proc.stderr.on('data', (c: Buffer) => {
      if (stderr.length < RUN_SHELL_OUTPUT_CAP) stderr += c.toString();
    });
    proc.on('error', rejectP);
    proc.on('close', (code) => resolveP({ stdout, stderr, code }));
  });
}

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
    proc.stdin.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code !== 'EPIPE') {
        console.warn('[RtkService.pipeStdin] unexpected stdin error:', err);
      }
    });
    proc.on('error', rejectP);
    proc.on('close', (code, signal) => resolveP({ code, signal, stdout, stderr }));
    proc.stdin.write(stdin);
    proc.stdin.end();
  });
}

type ExtractResult = { ok: true; command: string | null } | { ok: false; reason: string };

function extractRewrittenCommand(stdout: string): ExtractResult {
  const trimmed = stdout.trim();
  if (!trimmed) return { ok: true, command: null };
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(trimmed) as Record<string, unknown>;
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
  // Claude Code's hook JSON schema has evolved; accept both historical and
  // current field names so version skew between rtk releases and Dash's
  // expectations doesn't silently render as "pass-through".
  const hso = isObject(parsed.hookSpecificOutput) ? parsed.hookSpecificOutput : null;
  const candidates: unknown[] = [
    hso?.updatedInput,
    hso?.modifiedToolInput,
    hso?.updatedToolInput,
    parsed.updatedInput,
    parsed.modifiedToolInput,
    parsed.updatedToolInput,
    parsed.tool_input,
  ];
  for (const node of candidates) {
    if (isObject(node) && typeof node.command === 'string') {
      return { ok: true, command: node.command };
    }
  }
  return { ok: true, command: null };
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
  // Reject absolute paths. The Windows-drive regex runs on every platform by
  // design: a tarball authored on Windows can reach any OS, so we refuse
  // `C:\...` entries regardless of where extraction happens.
  if (entry.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(entry)) {
    throw new Error(`Archive contains absolute path: ${entry}`);
  }
  // Normalize backslashes to forward slashes before resolve(). On POSIX,
  // path.resolve treats `\` as a literal filename character, so `..\\evil`
  // would not be recognised as a parent-traversal attempt without this step.
  const normalized = normalize(entry.replace(/\\/g, '/'));
  const resolved = resolve(destDir, normalized);
  const base = resolve(destDir) + sep;
  if (resolved !== resolve(destDir) && !resolved.startsWith(base)) {
    throw new Error(`Archive member escapes destDir: ${entry}`);
  }
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Test-only exports of module-private helpers. Importing from here keeps the
 * unit tests exercising the real code instead of a drifting re-implementation.
 */
export const __test__ = {
  assertTrustedDownloadUrl,
  assertSafeArchiveMember,
  shellQuoteUnix,
  extractRewrittenCommand,
};
