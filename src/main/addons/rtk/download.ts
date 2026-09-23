import { chmodSync, createWriteStream, existsSync, lstatSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import {
  assertSafeArchiveMember,
  assertTrustedDownloadUrl,
  fetchWithTimeout,
  isReleasePayload,
  parseTarVerbose,
  verifyChecksum,
  type TarEntry,
} from './helpers';
import {
  linkIntoUserPath,
  managedBinDir,
  managedBinPath,
  releaseAssetName,
  resolveBinary,
} from './binary';
import type { RtkDownloadProgress, RtkResolution } from './types';

// Cap each phase so a hung CDN can't leave the single-flight download pending forever.
const FETCH_API_TIMEOUT_MS = 60_000;
const FETCH_BODY_TIMEOUT_MS = 300_000;
const TAR_TIMEOUT_MS = 120_000;

type OnProgress = (p: RtkDownloadProgress) => void;

/**
 * Download the latest rtk release for this platform into `<dataDir>/bin`,
 * verified against the release's checksums.txt and checked member by member
 * before extraction. Reports progress through `onProgress` and rejects on
 * failure; resolves with the installed binary.
 */
export async function downloadRtk(dataDir: string, onProgress: OnProgress): Promise<RtkResolution> {
  const assetName = releaseAssetName();
  if (!assetName) {
    const msg = `No rtk release for ${process.platform}/${process.arch}. Install manually from rtk-ai.app.`;
    onProgress({ phase: 'error', error: msg });
    throw new Error(msg);
  }

  const binDir = managedBinDir(dataDir);
  const tmpArchive = join(binDir, `${assetName}.tmp`);
  const binPath = managedBinPath(dataDir);

  try {
    onProgress({ phase: 'downloading', percent: 0 });

    const apiRes = await fetchWithTimeout(
      'https://api.github.com/repos/rtk-ai/rtk/releases/latest',
      { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'dash-rtk-installer' } },
      FETCH_API_TIMEOUT_MS,
    );
    if (!apiRes.ok) throw new Error(`GitHub API ${apiRes.status}: ${apiRes.statusText}`);
    const release = (await apiRes.json()) as unknown;
    if (!isReleasePayload(release)) {
      throw new Error(`Unexpected GitHub API response: ${JSON.stringify(release).slice(0, 200)}`);
    }

    const asset = release.assets.find((a) => a.name === assetName);
    if (!asset) throw new Error(`Release ${release.tag_name} has no asset "${assetName}"`);
    assertTrustedDownloadUrl(asset.browser_download_url);

    const checksumAsset = release.assets.find((a) => a.name === 'checksums.txt');
    if (!checksumAsset) {
      throw new Error(`Release ${release.tag_name} has no checksums.txt — refusing to install.`);
    }
    assertTrustedDownloadUrl(checksumAsset.browser_download_url);

    if (!existsSync(binDir)) mkdirSync(binDir, { recursive: true });
    const expectedSha = await fetchExpectedSha256(checksumAsset.browser_download_url, assetName);

    // GitHub's release CDN occasionally serves truncated/corrupt bytes; retry.
    const MAX_ATTEMPTS = 3;
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        await fetchToFile(asset.browser_download_url, tmpArchive, onProgress);
        onProgress({ phase: 'verifying' });
        await verifyChecksum(tmpArchive, expectedSha);
        await verifyArchive(tmpArchive, binDir);
        lastError = null;
        break;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        console.warn(`[rtk.download] attempt ${attempt} failed:`, lastError.message);
        rmSync(tmpArchive, { force: true });
        if (attempt < MAX_ATTEMPTS) onProgress({ phase: 'downloading', percent: 0 });
      }
    }
    if (lastError) {
      throw new Error(
        `Download repeatedly failed (${MAX_ATTEMPTS} attempts): ${lastError.message}`,
      );
    }

    onProgress({ phase: 'extracting' });
    try {
      await extractTarball(tmpArchive, binDir, binPath);
    } catch (err) {
      rmSync(binPath, { force: true }); // a partial extraction may leave a half-written binary
      throw err;
    }

    if (!existsSync(binPath))
      throw new Error(`Archive did not contain expected binary at ${binPath}`);
    // verifyArchive already refused links; lstat again before chmod, which would follow one.
    if (!lstatSync(binPath).isFile()) {
      rmSync(binPath, { force: true });
      throw new Error(`Extracted binary is not a regular file at ${binPath}`);
    }
    chmodSync(binPath, 0o755); // before --version; some tars drop +x

    const resolved = await resolveBinary(dataDir);
    if (!resolved) {
      rmSync(binPath, { force: true });
      throw new Error('Installed binary failed to report --version; removed.');
    }
    linkIntoUserPath(resolved.path);
    onProgress({ phase: 'done', version: release.tag_name });
    return resolved;
  } catch (err) {
    const message = describeError(err);
    onProgress({ phase: 'error', error: message });
    throw new Error(message);
  } finally {
    rmSync(tmpArchive, { force: true });
  }
}

/**
 * `fetch` rejects with a bare "fetch failed"; the reason (DNS, TLS, refused
 * connection, timeout) is on `cause`. Surface it so the user can act on it.
 */
export function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = (err as { cause?: unknown }).cause;
  if (cause instanceof Error) {
    const code = (cause as { code?: unknown }).code;
    const detail = typeof code === 'string' ? `${code}: ${cause.message}` : cause.message;
    return `${err.message} (${detail})`;
  }
  if (err.name === 'AbortError') return `${err.message} (timed out)`;
  return err.message;
}

async function fetchExpectedSha256(url: string, assetName: string): Promise<string> {
  const res = await fetchWithTimeout(url, {}, FETCH_API_TIMEOUT_MS);
  if (!res.ok) throw new Error(`Failed to fetch checksums.txt: ${res.status} ${res.statusText}`);
  const body = await res.text();
  for (const line of body.split(/\r?\n/)) {
    // `\*?` accepts the BSD "binary mode" marker some sha256sum builds emit.
    const match = line.match(/^([a-f0-9]{64})\s+\*?(.+?)\s*$/i);
    if (match && match[2] === assetName) return match[1]!.toLowerCase();
  }
  throw new Error(`checksums.txt does not list ${assetName}`);
}

async function fetchToFile(url: string, dest: string, onProgress: OnProgress): Promise<void> {
  const controller = new AbortController();
  const wallTimer = setTimeout(() => controller.abort(), FETCH_BODY_TIMEOUT_MS);
  try {
    const dlRes = await fetch(url, { signal: controller.signal });
    if (!dlRes.ok || !dlRes.body)
      throw new Error(`Download failed: ${dlRes.status} ${dlRes.statusText}`);
    const total = Number(dlRes.headers.get('content-length') || '0');
    let transferred = 0;
    const source = Readable.fromWeb(dlRes.body as unknown as WebReadableStream<Uint8Array>);
    source.on('data', (chunk: Buffer) => {
      transferred += chunk.length;
      if (total > 0) {
        onProgress({
          phase: 'downloading',
          percent: Math.min(99, Math.round((transferred / total) * 100)),
        });
      }
    });
    await pipeline(source, createWriteStream(dest));
    if (total > 0 && transferred !== total) {
      throw new Error(`Truncated download: expected ${total} bytes, got ${transferred}.`);
    }
    onProgress({ phase: 'downloading', percent: 100 });
  } finally {
    clearTimeout(wallTimer);
  }
}

async function verifyArchive(archivePath: string, dest: string): Promise<void> {
  try {
    // Every member must be relative, stay inside dest, and be a regular file or
    // directory: tar honours link targets at extract time, so links are refused.
    for (const entry of await listTarball(archivePath)) assertSafeArchiveMember(entry, dest);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Archive integrity check failed: ${detail}`);
  }
}

async function extractTarball(
  archivePath: string,
  destDir: string,
  binPath: string,
): Promise<void> {
  // rtk releases put the binary at the archive root; retry with
  // --strip-components=1 for archives that nest it under a directory.
  await runTar(['-xzf', archivePath, '-C', destDir, '--no-same-owner']);
  if (existsSync(binPath)) return;
  console.warn('[rtk] binary not at archive root, retrying with --strip-components=1');
  await runTar(['-xzf', archivePath, '-C', destDir, '--strip-components=1', '--no-same-owner']);
}

function listTarball(archivePath: string): Promise<TarEntry[]> {
  return new Promise((resolveP, rejectP) => {
    // `tar -tvf` prints "<mode> <owner> <size> <mtime> <name>[ -> target]"; the
    // mode's first char is the type ('-', 'd', 'l', 'h'). BSD and GNU tar agree.
    const proc = spawn('tar', ['-tvzf', archivePath], {
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
      rejectP(
        err.code === 'ENOENT'
          ? new Error('`tar` is not available on PATH. Install it and retry.')
          : err,
      );
    });
    proc.on('exit', (code, signal) => {
      if (signal) rejectP(new Error(`tar -tvzf killed by signal ${signal} (timed out?)`));
      else if (code === 0) resolveP(parseTarVerbose(stdout));
      else rejectP(new Error(`tar -tvzf exited ${code}: ${stderr.trim()}`));
    });
  });
}

function runTar(args: string[]): Promise<void> {
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
      rejectP(
        err.code === 'ENOENT'
          ? new Error('`tar` is not available on PATH. Install it and retry.')
          : err,
      );
    });
    proc.on('exit', (code, signal) => {
      if (signal) rejectP(new Error(`tar killed by signal ${signal} (timed out?)`));
      else if (code === 0) resolveP();
      else rejectP(new Error(`tar exited ${code}: ${stderr.trim()}`));
    });
  });
}
