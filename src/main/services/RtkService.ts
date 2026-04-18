import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  createWriteStream,
  chmodSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { app } from 'electron';
import type { WebContents } from 'electron';
import type { RtkStatus, RtkDownloadProgress, RtkSource, RtkTestResult } from '@shared/types';

const execFileAsync = promisify(execFile);

/**
 * RTK (Rust Token Killer) integration. Dash manages rtk's lifecycle so users get
 * ~60–90% token savings on common shell commands without touching their global
 * ~/.claude/settings.json. Binary resolution prefers a Dash-managed copy under
 * userData/bin over whatever is on $PATH, so uninstalling Dash is clean.
 */
export class RtkService {
  private static sender: WebContents | null = null;
  private static cachedResolution: {
    path: string;
    source: RtkSource;
    version: string | null;
  } | null = null;

  static setSender(sender: WebContents): void {
    RtkService.sender = sender;
  }

  private static getConfigPath(): string {
    return join(app.getPath('userData'), 'rtk-config.json');
  }

  static isEnabled(): boolean {
    try {
      const p = RtkService.getConfigPath();
      if (!existsSync(p)) return false;
      const raw = JSON.parse(readFileSync(p, 'utf-8'));
      return raw.enabled === true;
    } catch {
      return false;
    }
  }

  static setEnabled(enabled: boolean): void {
    writeFileSync(RtkService.getConfigPath(), JSON.stringify({ enabled }, null, 2));
  }

  private static getManagedBinDir(): string {
    return join(app.getPath('userData'), 'bin');
  }

  private static getManagedBinPath(): string {
    const exe = process.platform === 'win32' ? 'rtk.exe' : 'rtk';
    return join(RtkService.getManagedBinDir(), exe);
  }

  private static async resolveBinary(): Promise<{
    path: string;
    source: RtkSource;
    version: string | null;
  } | null> {
    const managed = RtkService.getManagedBinPath();
    if (existsSync(managed)) {
      const version = await RtkService.probeVersion(managed);
      return { path: managed, source: 'managed', version };
    }

    try {
      const findCmd = process.platform === 'win32' ? 'where.exe' : 'which';
      const { stdout } = await execFileAsync(findCmd, ['rtk']);
      const resolved = stdout.trim().split(/\r?\n/)[0]?.trim();
      if (resolved) {
        const version = await RtkService.probeVersion(resolved);
        return { path: resolved, source: 'path', version };
      }
    } catch {
      // Not on PATH
    }

    return null;
  }

  private static async probeVersion(binPath: string): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync(binPath, ['--version']);
      return stdout.trim();
    } catch {
      return null;
    }
  }

  /** Absolute path + subcommand emitted into the PreToolUse hook. */
  static getHookCommand(): string | null {
    const resolved = RtkService.cachedResolution;
    if (!resolved) return null;
    // Quote for paths containing spaces (userData on macOS: "Application Support").
    const quoted = resolved.path.includes(' ') ? `"${resolved.path}"` : resolved.path;
    return `${quoted} hook claude`;
  }

  static async getStatus(): Promise<RtkStatus> {
    const resolved = await RtkService.resolveBinary();
    RtkService.cachedResolution = resolved;

    const downloadable = RtkService.isPlatformDownloadable();

    if (!resolved) {
      return {
        installed: false,
        version: null,
        path: null,
        source: 'none',
        enabled: RtkService.isEnabled(),
        downloadable,
      };
    }

    return {
      installed: true,
      version: resolved.version,
      path: resolved.path,
      source: resolved.source,
      enabled: RtkService.isEnabled(),
      downloadable,
    };
  }

  /** Called once at startup so getHookCommand() works synchronously later. */
  static async warmUp(): Promise<void> {
    RtkService.cachedResolution = await RtkService.resolveBinary();
  }

  /** No Windows native release exists upstream — fall back to manual-install guidance there. */
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

  /** Streams RtkDownloadProgress to the renderer via rtk:downloadProgress. */
  static async download(): Promise<void> {
    const assetName = RtkService.getReleaseAssetName();
    if (!assetName) {
      RtkService.emitProgress({
        phase: 'error',
        error: `No rtk release for ${process.platform}/${process.arch}. Install manually from rtk-ai.app.`,
      });
      return;
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
      const release = (await apiRes.json()) as {
        tag_name: string;
        assets: Array<{ name: string; browser_download_url: string }>;
      };

      const asset = release.assets.find((a) => a.name === assetName);
      if (!asset) {
        throw new Error(`Release ${release.tag_name} has no asset "${assetName}"`);
      }

      if (!existsSync(binDir)) mkdirSync(binDir, { recursive: true });

      // GitHub's release CDN occasionally serves truncated/corrupt bytes. Download,
      // verify the gzip is intact via `tar -tzf`, and retry a few times before
      // surfacing an error to the user.
      const MAX_ATTEMPTS = 3;
      let lastError: Error | null = null;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          await RtkService.fetchToFile(asset.browser_download_url, tmpArchive);
          await RtkService.verifyArchive(tmpArchive);
          lastError = null;
          break;
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          rmSync(tmpArchive, { force: true });
          if (attempt < MAX_ATTEMPTS) {
            RtkService.emitProgress({ phase: 'downloading', percent: 0 });
          }
        }
      }
      if (lastError) {
        throw new Error(
          `Download repeatedly corrupted (${MAX_ATTEMPTS} attempts): ${lastError.message}. ` +
            `This is usually a transient CDN issue — try again in a minute.`,
        );
      }

      RtkService.emitProgress({ phase: 'extracting' });
      try {
        await RtkService.extractTarball(tmpArchive, binDir);
      } catch (err) {
        // Partial extraction may have dropped a half-written binary at binPath.
        rmSync(binPath, { force: true });
        throw err;
      }

      if (!existsSync(binPath)) {
        throw new Error(`Archive did not contain expected binary at ${binPath}`);
      }
      chmodSync(binPath, 0o755);

      RtkService.cachedResolution = await RtkService.resolveBinary();
      RtkService.emitProgress({ phase: 'done', version: release.tag_name });
    } catch (err) {
      RtkService.emitProgress({
        phase: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      rmSync(tmpArchive, { force: true });
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
  }

  /** Throws if the archive isn't a valid gzip-ed tar — cheap enough to do before extraction. */
  private static async verifyArchive(archivePath: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn('tar', ['-tzf', archivePath], { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      proc.stderr?.on('data', (d: Buffer) => {
        stderr += d.toString();
      });
      proc.on('error', reject);
      proc.on('exit', (code) => {
        if (code === 0) resolve();
        else
          reject(
            new Error(`Archive integrity check failed: ${stderr.trim() || `tar exited ${code}`}`),
          );
      });
    });
  }

  private static async extractTarball(archivePath: string, destDir: string): Promise<void> {
    // Try plain extract first (rtk's releases put the binary at the archive root).
    // If the binary still isn't where we expect, retry with --strip-components=1
    // to handle archives that nest the binary under a top-level directory.
    await RtkService.runTar(['-xzf', archivePath, '-C', destDir]);
    if (existsSync(RtkService.getManagedBinPath())) return;
    await RtkService.runTar(['-xzf', archivePath, '-C', destDir, '--strip-components=1']);
  }

  private static runTar(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn('tar', args, { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      proc.stderr?.on('data', (d: Buffer) => {
        stderr += d.toString();
      });
      proc.on('error', reject);
      proc.on('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`tar exited ${code}: ${stderr.trim()}`));
      });
    });
  }

  private static emitProgress(progress: RtkDownloadProgress): void {
    const sender = RtkService.sender;
    if (sender && !sender.isDestroyed()) {
      sender.send('rtk:downloadProgress', progress);
    }
  }

  /**
   * Pipe a synthetic Claude Code PreToolUse payload through `rtk hook claude`
   * so the UI can prove, in-process, that the same binary Dash hands to Claude
   * actually emits a rewrite directive. `git status` is the headline example
   * in rtk's README (~75% token reduction) so it's a reliable positive case.
   */
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
      const { stdout, stderr, code } = await pipeStdin(
        resolved.path,
        ['hook', 'claude'],
        input,
        10_000,
      );

      if (/panic|unwrap|segfault/i.test(stderr)) {
        return { ok: false, testedCommand, error: `rtk crashed: ${stderr.trim().slice(0, 400)}` };
      }
      if (code !== 0 && code !== 2) {
        return {
          ok: false,
          testedCommand,
          error: `rtk exited ${code}${stderr ? ': ' + stderr.trim().slice(0, 400) : ''}`,
        };
      }

      const rewritten = extractRewrittenCommand(stdout);
      return {
        ok: true,
        testedCommand,
        rewrittenCommand: rewritten,
        wouldCompress: rewritten != null && rewritten !== testedCommand,
        rawOutput: stdout.slice(0, 2000),
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
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { timeout: timeoutMs });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (c: Buffer) => {
      stdout += c.toString();
    });
    proc.stderr.on('data', (c: Buffer) => {
      stderr += c.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code) => resolve({ code, stdout, stderr }));
    proc.stdin.write(stdin);
    proc.stdin.end();
  });
}

/**
 * Claude Code's hook schema accepts a few equivalent shapes for rewriting a
 * tool call. Walk the likely paths rather than pinning to one — keeps the
 * test resilient if rtk's output format shifts between releases.
 */
function extractRewrittenCommand(stdout: string): string | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const paths: Array<(v: Record<string, unknown>) => unknown> = [
      // rtk's actual shape as of writing: hookSpecificOutput.updatedInput.command
      (v) => (v.hookSpecificOutput as Record<string, unknown>)?.updatedInput,
      (v) => (v.hookSpecificOutput as Record<string, unknown>)?.modifiedToolInput,
      (v) => (v.hookSpecificOutput as Record<string, unknown>)?.updatedToolInput,
      (v) => v.updatedInput,
      (v) => v.modifiedToolInput,
      (v) => v.updatedToolInput,
      (v) => v.tool_input,
    ];
    for (const get of paths) {
      const node = get(parsed);
      if (node && typeof node === 'object' && 'command' in node) {
        const cmd = (node as Record<string, unknown>).command;
        if (typeof cmd === 'string') return cmd;
      }
    }
    return null;
  } catch {
    return null;
  }
}
