import { createReadStream, lstatSync, mkdirSync, readlinkSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, normalize, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';

// Pure helpers for the RTK add-on: shell runners, hook-output parsing, and the
// download safety checks (URL allowlist, archive-member validation, checksum).

/**
 * Run a shell string and capture its stdout/stderr up to a hard cap. Used by
 * the Test RTK flow to exec both the raw command (e.g. `git status`) and the
 * rtk-rewritten version (e.g. `rtk git status`) in a controlled environment.
 */
const RUN_SHELL_OUTPUT_CAP = 64 * 1024;

export function runShell(
  cmd: string,
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
  timeoutMs = 15_000,
): Promise<{ stdout: string; stderr: string; code: number | null; truncated: boolean }> {
  return new Promise((resolveP, rejectP) => {
    const shell = process.platform === 'win32' ? 'cmd.exe' : 'sh';
    const args = process.platform === 'win32' ? ['/c', cmd] : ['-c', cmd];
    const proc = spawn(shell, args, { cwd, env, timeout: timeoutMs });
    let stdout = '';
    let stderr = '';
    let truncated = false;
    proc.stdout.on('data', (c: Buffer) => {
      if (stdout.length < RUN_SHELL_OUTPUT_CAP) stdout += c.toString();
      else truncated = true;
    });
    proc.stderr.on('data', (c: Buffer) => {
      if (stderr.length < RUN_SHELL_OUTPUT_CAP) stderr += c.toString();
      else truncated = true;
    });
    proc.on('error', rejectP);
    proc.on('close', (code) => resolveP({ stdout, stderr, code, truncated }));
  });
}

export function pipeStdin(
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
        console.warn('[rtk.pipeStdin] unexpected stdin error:', err);
      }
    });
    proc.on('error', rejectP);
    proc.on('close', (code, signal) => resolveP({ code, signal, stdout, stderr }));
    proc.stdin.write(stdin);
    proc.stdin.end();
  });
}

type ExtractResult = { ok: true; command: string | null } | { ok: false; reason: string };

export function extractRewrittenCommand(stdout: string): ExtractResult {
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

export function shellQuoteUnix(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

interface ReleasePayload {
  tag_name: string;
  assets: Array<{ name: string; browser_download_url: string }>;
}

export function isReleasePayload(v: unknown): v is ReleasePayload {
  if (!isObject(v)) return false;
  if (typeof v.tag_name !== 'string') return false;
  if (!Array.isArray(v.assets)) return false;
  return v.assets.every(
    (a) => isObject(a) && typeof a.name === 'string' && typeof a.browser_download_url === 'string',
  );
}

export function assertTrustedDownloadUrl(raw: string): void {
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

type TarMemberType = 'file' | 'dir' | 'symlink' | 'hardlink' | 'other';

export interface TarEntry {
  /** First char of the mode column from `tar -tvf` (`-`, `d`, `l`, `h`, ...). */
  type: TarMemberType;
  name: string;
}

export function parseTarVerbose(stdout: string): TarEntry[] {
  const out: TarEntry[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line) continue;
    // Lines start with the mode string; first char encodes the file type.
    const typeChar = line[0];
    let type: TarMemberType;
    switch (typeChar) {
      case '-':
        type = 'file';
        break;
      case 'd':
        type = 'dir';
        break;
      case 'l':
        type = 'symlink';
        break;
      case 'h':
        type = 'hardlink';
        break;
      default:
        type = 'other';
    }
    // Strip "<name> -> <target>" tail so name validation only sees the entry path.
    // The target itself doesn't need validation: we reject symlinks/hardlinks outright.
    const arrow = line.indexOf(' -> ');
    const trail = arrow >= 0 ? line.slice(0, arrow) : line;
    // Name is the last whitespace-delimited token (mode/owner/size/date have
    // varying field counts between BSD and GNU tar; the name is always last).
    const tokens = trail.split(/\s+/);
    const name = tokens[tokens.length - 1];
    if (name) out.push({ type, name });
  }
  return out;
}

export function assertSafeArchiveMember(entry: TarEntry, destDir: string): void {
  // Refuse symlinks/hardlinks outright. `tar -xzf` honors their targets at
  // extract time, so a crafted archive with `rtk -> /etc/passwd` would let
  // chmod/exec follow the link out of dest even though the entry name is
  // benign. Defense-in-depth: SHA-256 + URL allowlist already make this hard
  // to reach, but the link types themselves are never legitimate in an rtk
  // release tarball.
  if (entry.type === 'symlink' || entry.type === 'hardlink') {
    throw new Error(`Archive contains ${entry.type}, which is not allowed: ${entry.name}`);
  }
  if (entry.type === 'other') {
    throw new Error(`Archive contains unsupported member type: ${entry.name}`);
  }
  // Reject embedded null bytes — tar entries should never contain them, and
  // some libcs truncate at \0 which could let a malicious entry name slip
  // past a downstream check.
  if (entry.name.includes('\0')) {
    throw new Error(`Archive member contains null byte: ${JSON.stringify(entry.name)}`);
  }
  // Reject absolute paths. The Windows-drive regex runs on every platform by
  // design: a tarball authored on Windows can reach any OS, so we refuse
  // `C:\...` entries regardless of where extraction happens.
  if (entry.name.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(entry.name)) {
    throw new Error(`Archive contains absolute path: ${entry.name}`);
  }
  // Normalize backslashes to forward slashes before resolve(). On POSIX,
  // path.resolve treats `\` as a literal filename character, so `..\\evil`
  // would not be recognised as a parent-traversal attempt without this step.
  const normalized = normalize(entry.name.replace(/\\/g, '/'));
  const resolved = resolve(destDir, normalized);
  const base = resolve(destDir) + sep;
  if (resolved !== resolve(destDir) && !resolved.startsWith(base)) {
    throw new Error(`Archive member escapes destDir: ${entry.name}`);
  }
}

export async function verifyChecksum(filePath: string, expectedSha: string): Promise<void> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(filePath), hash);
  const actual = hash.digest('hex');
  if (actual !== expectedSha) {
    throw new Error(
      `Checksum mismatch: expected ${expectedSha}, got ${actual}. Refusing to install.`,
    );
  }
}

export async function fetchWithTimeout(
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
 * Best-effort: create or refresh a symlink at `linkPath` pointing at `target`.
 * Never throws; install must not fail because the symlink could not be made.
 * Refuses to overwrite a non-symlink at the destination so a user-installed
 * `rtk` (e.g. via cargo) is not clobbered.
 */
function lstatOrNull(p: string): ReturnType<typeof lstatSync> | null {
  try {
    return lstatSync(p);
  } catch {
    return null;
  }
}

export function ensureUserBinSymlink(target: string, linkPath: string): void {
  try {
    mkdirSync(dirname(linkPath), { recursive: true });
    // lstat, not existsSync: existsSync follows the link, so a dangling link
    // (target moved or deleted) would look absent and symlinkSync would EEXIST.
    const stat = lstatOrNull(linkPath);
    if (stat) {
      if (!stat.isSymbolicLink()) return;
      if (readlinkSync(linkPath) === target) return;
      rmSync(linkPath);
    }
    symlinkSync(target, linkPath);
  } catch (err) {
    console.warn('[rtk] could not create user-bin symlink:', err);
  }
}

/**
 * Test-only exports of module-private helpers. Importing from here keeps the
 * unit tests exercising the real code instead of a drifting re-implementation.
 */
export const __test__ = {
  assertTrustedDownloadUrl,
  assertSafeArchiveMember,
  parseTarVerbose,
  shellQuoteUnix,
  extractRewrittenCommand,
  verifyChecksum,
  ensureUserBinSymlink,
};
