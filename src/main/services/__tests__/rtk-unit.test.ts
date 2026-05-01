import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  writeFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  readlinkSync,
  lstatSync,
  existsSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

// RtkService imports `app` from electron for userData paths, which isn't
// available in the vitest Node env. The helpers we test don't touch it.
vi.mock('electron', () => ({ default: {}, app: {} }));

import { __test__ } from '../RtkService';

// These unit tests exercise the URL allowlist, archive-member safety checks,
// and JSON-extraction helpers. Imported from RtkService's __test__ export so
// the real module code is what's being verified — no re-implementation drift.

const {
  assertTrustedDownloadUrl,
  assertSafeArchiveMember,
  parseTarVerbose,
  shellQuoteUnix,
  extractRewrittenCommand,
  verifyChecksum,
  ensureUserBinSymlink,
} = __test__;

describe('assertTrustedDownloadUrl', () => {
  it('accepts canonical github.com release URLs', () => {
    expect(() =>
      assertTrustedDownloadUrl('https://github.com/rtk-ai/rtk/releases/download/v0.1.0/rtk.tar.gz'),
    ).not.toThrow();
  });

  it('accepts objects.githubusercontent.com CDN redirects', () => {
    expect(() =>
      assertTrustedDownloadUrl(
        'https://objects.githubusercontent.com/github-production-release-asset-2e65be/...',
      ),
    ).not.toThrow();
  });

  it('accepts any *.githubusercontent.com subdomain', () => {
    expect(() =>
      assertTrustedDownloadUrl('https://release-assets.githubusercontent.com/foo'),
    ).not.toThrow();
  });

  it('rejects http:// downloads', () => {
    expect(() =>
      assertTrustedDownloadUrl('http://github.com/rtk-ai/rtk/releases/download/v0.1.0/rtk.tar.gz'),
    ).toThrow(/non-HTTPS/);
  });

  it('rejects foreign hostnames', () => {
    expect(() => assertTrustedDownloadUrl('https://evil.example.com/rtk.tar.gz')).toThrow(
      /outside GitHub/,
    );
  });

  it('rejects similar-looking hostnames that are not github', () => {
    expect(() => assertTrustedDownloadUrl('https://github.com.evil.example/rtk.tar.gz')).toThrow(
      /outside GitHub/,
    );
  });

  it('rejects malformed URLs', () => {
    expect(() => assertTrustedDownloadUrl('not a url')).toThrow(/malformed/);
  });
});

describe('assertSafeArchiveMember', () => {
  const dest = process.platform === 'win32' ? 'C:\\tmp\\rtk-bin' : '/tmp/rtk-bin';
  const file = (name: string) => ({ type: 'file' as const, name });

  it('accepts a plain file at archive root', () => {
    expect(() => assertSafeArchiveMember(file('rtk'), dest)).not.toThrow();
  });

  it('accepts nested-under-directory entries that stay inside dest', () => {
    expect(() => assertSafeArchiveMember(file('nested/rtk'), dest)).not.toThrow();
  });

  it('accepts directories', () => {
    expect(() => assertSafeArchiveMember({ type: 'dir', name: 'subdir/' }, dest)).not.toThrow();
  });

  it('rejects symlinks regardless of target — tar would honor the link at extract time', () => {
    // A symlink whose name is benign (`./rtk`) but whose target points outside
    // dest is the canonical defense-in-depth bypass: the entry-name validator
    // sees nothing wrong, but `tar -xzf` writes through the link.
    expect(() => assertSafeArchiveMember({ type: 'symlink', name: 'rtk' }, dest)).toThrow(
      /symlink/,
    );
  });

  it('rejects hardlinks for the same reason', () => {
    expect(() => assertSafeArchiveMember({ type: 'hardlink', name: 'rtk' }, dest)).toThrow(
      /hardlink/,
    );
  });

  it('rejects unsupported member types (sockets, fifos, devices)', () => {
    expect(() => assertSafeArchiveMember({ type: 'other', name: 'weird' }, dest)).toThrow(
      /unsupported/,
    );
  });

  it('rejects entries with embedded null bytes', () => {
    // Some libcs truncate at \0; without this check a name like "rtk\0/etc/passwd"
    // could pass the dest-prefix test then resolve elsewhere downstream.
    expect(() => assertSafeArchiveMember(file('rtk\0../etc/passwd'), dest)).toThrow(/null byte/);
  });

  it('rejects absolute Unix paths', () => {
    expect(() => assertSafeArchiveMember(file('/etc/passwd'), dest)).toThrow(/absolute/);
  });

  it('rejects absolute Windows paths', () => {
    expect(() => assertSafeArchiveMember(file('C:\\Windows\\System32\\evil.exe'), dest)).toThrow(
      /absolute/,
    );
  });

  it('rejects parent-traversal (..) that escapes dest', () => {
    expect(() => assertSafeArchiveMember(file('../../etc/passwd'), dest)).toThrow(/escapes/);
  });

  it('rejects mixed traversal paths', () => {
    expect(() => assertSafeArchiveMember(file('subdir/../../../etc/evil'), dest)).toThrow(
      /escapes/,
    );
  });

  it('rejects backslash-traversal (Windows-style) on any OS', () => {
    // Regression guard: without normalize-to-forward-slashes in the real
    // helper, POSIX pathResolve would treat the backslashes as literal
    // filename chars and this entry would land inside destDir as a file
    // literally named "..\\..\\etc\\passwd" — a security-sensitive false pass.
    expect(() => assertSafeArchiveMember(file('..\\..\\etc\\passwd'), dest)).toThrow(
      /escapes|absolute/,
    );
  });
});

describe('shellQuoteUnix', () => {
  it('quotes plain paths', () => {
    expect(shellQuoteUnix('/usr/local/bin/rtk')).toBe("'/usr/local/bin/rtk'");
  });

  it('quotes paths containing spaces', () => {
    expect(shellQuoteUnix('/Application Support/Dash/bin/rtk')).toBe(
      "'/Application Support/Dash/bin/rtk'",
    );
  });

  it('escapes embedded single quotes without leaving an injection hole', () => {
    // The output must be a single concatenated shell token — decoding it
    // should yield the exact input back.
    const input = "/tmp/weird'dir/rtk";
    const quoted = shellQuoteUnix(input);
    expect(quoted).toBe("'/tmp/weird'\\''dir/rtk'");
    // Sanity: the quoted form contains no unescaped bareword that could run.
    expect(quoted).not.toMatch(/[^\\]\$\(/);
    expect(quoted).not.toMatch(/[^\\]`/);
  });

  it('survives $, backtick, and backslash without expansion', () => {
    const input = '/tmp/$(rm -rf ~)/`whoami`/rtk';
    const quoted = shellQuoteUnix(input);
    // With single quotes, none of these metachars get interpreted by sh.
    expect(quoted.startsWith("'") && quoted.endsWith("'")).toBe(true);
    expect(quoted).toContain('$(rm -rf ~)');
    expect(quoted).toContain('`whoami`');
  });
});

describe('extractRewrittenCommand', () => {
  it('returns a null command for empty stdout (rtk pass-through)', () => {
    const r = extractRewrittenCommand('');
    expect(r).toEqual({ ok: true, command: null });
  });

  it('returns ok:false on unparseable JSON', () => {
    const r = extractRewrittenCommand('<<not json>>');
    expect(r.ok).toBe(false);
  });

  it('extracts from hookSpecificOutput.updatedInput.command (current schema)', () => {
    const payload = JSON.stringify({
      hookSpecificOutput: { updatedInput: { command: 'rtk-wrapped git status' } },
    });
    expect(extractRewrittenCommand(payload)).toEqual({
      ok: true,
      command: 'rtk-wrapped git status',
    });
  });

  it('extracts from legacy modifiedToolInput at payload root', () => {
    const payload = JSON.stringify({ modifiedToolInput: { command: 'legacy-shape' } });
    expect(extractRewrittenCommand(payload)).toEqual({ ok: true, command: 'legacy-shape' });
  });

  it('returns command:null when the JSON is valid but matches no known path', () => {
    const payload = JSON.stringify({ unknownField: { command: 'ignored' } });
    expect(extractRewrittenCommand(payload)).toEqual({ ok: true, command: null });
  });
});

// ---------------------------------------------------------------------------
// Archive integrity: SHA-256 verification is one of the load-bearing security
// claims of the install flow ("Refusing to install" on mismatch). A regression
// (e.g. truncated comparison, swapped operator) needs to fail this test, not
// silently let a corrupt/swapped binary onto disk.
// ---------------------------------------------------------------------------

describe('verifyChecksum', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rtk-unit-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writeFixture(name: string, body: string): { path: string; sha: string } {
    const p = join(dir, name);
    writeFileSync(p, body);
    const sha = createHash('sha256').update(body).digest('hex');
    return { path: p, sha };
  }

  it('accepts a matching checksum', async () => {
    const { path, sha } = writeFixture('ok.bin', 'rtk binary contents');
    await expect(verifyChecksum(path, sha)).resolves.toBeUndefined();
  });

  it('rejects a one-character-off checksum (the canonical regression)', async () => {
    // A truncated comparison (`actual.startsWith(expected.slice(0, 8))`) or a
    // swapped operator (`===` → `!==`) would let this through. Mutating one
    // hex char makes the assertion pinpoint the equality check itself.
    const { path, sha } = writeFixture('mismatch.bin', 'rtk binary contents');
    const tampered = sha.slice(0, -1) + (sha.endsWith('a') ? 'b' : 'a');
    await expect(verifyChecksum(path, tampered)).rejects.toThrow(
      /Checksum mismatch.*Refusing to install/,
    );
  });

  it('rejects when the file content is mutated post-write', async () => {
    // Computes sha against original bytes, then writes different bytes — the
    // streaming hash should pick up the change.
    const { path, sha } = writeFixture('orig.bin', 'original content');
    writeFileSync(path, 'tampered content');
    await expect(verifyChecksum(path, sha)).rejects.toThrow(/Checksum mismatch/);
  });
});

// ---------------------------------------------------------------------------
// Tar verbose-output parsing: type-char detection is the only thing standing
// between a malicious symlink-bearing tarball and chmod-following the link
// out of dest. Both BSD (macOS) and GNU tar prefix entries with the mode
// string, so the first column is the file type ('-', 'd', 'l', 'h', ...).
// ---------------------------------------------------------------------------

describe('parseTarVerbose', () => {
  it('parses BSD-style (macOS) verbose lines', () => {
    const out = parseTarVerbose(
      [
        '-rwxr-xr-x  0 root  wheel  1234567 Jan  1 00:00 rtk',
        'drwxr-xr-x  0 root  wheel        0 Jan  1 00:00 doc/',
      ].join('\n'),
    );
    expect(out).toEqual([
      { type: 'file', name: 'rtk' },
      { type: 'dir', name: 'doc/' },
    ]);
  });

  it('parses GNU-style verbose lines', () => {
    const out = parseTarVerbose(
      [
        '-rwxr-xr-x user/group  1234567 2024-01-01 00:00 rtk',
        'lrwxrwxrwx user/group        0 2024-01-01 00:00 evil -> /etc/passwd',
      ].join('\n'),
    );
    expect(out).toEqual([
      { type: 'file', name: 'rtk' },
      { type: 'symlink', name: 'evil' },
    ]);
  });

  it('strips " -> target" from symlink lines so name validation only sees the entry path', () => {
    const out = parseTarVerbose('lrwxrwxrwx user 0 date evil -> /etc/passwd');
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ type: 'symlink', name: 'evil' });
  });

  it('classifies hardlinks as hardlink', () => {
    const out = parseTarVerbose('hrw-r--r-- user 1234 date hardlink');
    expect(out[0].type).toBe('hardlink');
  });

  it('falls back to "other" for unknown type chars', () => {
    const out = parseTarVerbose('crw-r--r-- user 0 date weird-device');
    expect(out[0].type).toBe('other');
  });
});

describe('ensureUserBinSymlink', () => {
  let tmpRoot: string;
  let target: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'rtk-symlink-'));
    mkdirSync(join(tmpRoot, 'managed'));
    mkdirSync(join(tmpRoot, 'bin'));
    target = join(tmpRoot, 'managed', 'rtk');
    writeFileSync(target, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('creates the symlink and intermediate dirs', () => {
    const linkPath = join(tmpRoot, 'home', '.local', 'bin', 'rtk');
    ensureUserBinSymlink(target, linkPath);
    expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);
    expect(readlinkSync(linkPath)).toBe(target);
  });

  it('refreshes a stale symlink to the new target', () => {
    const linkPath = join(tmpRoot, 'bin', 'rtk');
    const oldTarget = join(tmpRoot, 'old-rtk');
    writeFileSync(oldTarget, 'old');
    symlinkSync(oldTarget, linkPath);
    ensureUserBinSymlink(target, linkPath);
    expect(readlinkSync(linkPath)).toBe(target);
  });

  it('leaves a non-symlink in place (does not clobber a real file)', () => {
    const linkPath = join(tmpRoot, 'bin', 'rtk');
    writeFileSync(linkPath, 'user-installed-rtk');
    ensureUserBinSymlink(target, linkPath);
    expect(lstatSync(linkPath).isSymbolicLink()).toBe(false);
  });

  it('is a no-op when the link already points at the target', () => {
    const linkPath = join(tmpRoot, 'bin', 'rtk');
    symlinkSync(target, linkPath);
    const before = lstatSync(linkPath).ctimeMs;
    ensureUserBinSymlink(target, linkPath);
    expect(lstatSync(linkPath).ctimeMs).toBe(before);
  });

  it('does not throw when the parent dir cannot be created', () => {
    const blocker = join(tmpRoot, 'blocker');
    writeFileSync(blocker, 'not a dir');
    const linkPath = join(blocker, 'bin', 'rtk');
    expect(() => ensureUserBinSymlink(target, linkPath)).not.toThrow();
    expect(existsSync(linkPath)).toBe(false);
  });
});
