import { describe, it, expect, vi } from 'vitest';

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
  shellQuoteUnix,
  extractRewrittenCommand,
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

  it('accepts a plain file at archive root', () => {
    expect(() => assertSafeArchiveMember('rtk', dest)).not.toThrow();
  });

  it('accepts nested-under-directory entries that stay inside dest', () => {
    expect(() => assertSafeArchiveMember('nested/rtk', dest)).not.toThrow();
  });

  it('rejects absolute Unix paths', () => {
    expect(() => assertSafeArchiveMember('/etc/passwd', dest)).toThrow(/absolute/);
  });

  it('rejects absolute Windows paths', () => {
    expect(() => assertSafeArchiveMember('C:\\Windows\\System32\\evil.exe', dest)).toThrow(
      /absolute/,
    );
  });

  it('rejects parent-traversal (..) that escapes dest', () => {
    expect(() => assertSafeArchiveMember('../../etc/passwd', dest)).toThrow(/escapes/);
  });

  it('rejects mixed traversal paths', () => {
    expect(() => assertSafeArchiveMember('subdir/../../../etc/evil', dest)).toThrow(/escapes/);
  });

  it('rejects backslash-traversal (Windows-style) on any OS', () => {
    // Regression guard: without normalize-to-forward-slashes in the real
    // helper, POSIX pathResolve would treat the backslashes as literal
    // filename chars and this entry would land inside destDir as a file
    // literally named "..\\..\\etc\\passwd" — a security-sensitive false pass.
    expect(() => assertSafeArchiveMember('..\\..\\etc\\passwd', dest)).toThrow(/escapes|absolute/);
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

// ---------------------------------------------------------------------------
// Settings-merge safety: user-authored hook entries must survive
// write → cleanup round-trips. We build the same dash-tagged shapes the
// ptyManager emits and exercise the filter logic directly.
// ---------------------------------------------------------------------------

type Hook = { type: string; __dash?: true } & Record<string, unknown>;
type HookEntry = { matcher: string; hooks: Hook[] };

function entryIsDashOwned(entry: unknown): boolean {
  if (!entry || typeof entry !== 'object') return false;
  const hooks = (entry as { hooks?: unknown }).hooks;
  if (!Array.isArray(hooks)) return false;
  return hooks.some(
    (h) => !!h && typeof h === 'object' && (h as { __dash?: unknown }).__dash === true,
  );
}

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

describe('settings.local.json merge safety (entryIsDashOwned)', () => {
  it('recognises a tagged Dash entry', () => {
    const entry: HookEntry = {
      matcher: '*',
      hooks: [{ type: 'http', url: 'x', __dash: true }],
    };
    expect(entryIsDashOwned(entry)).toBe(true);
  });

  it('ignores a user-authored entry without the tag', () => {
    const entry: HookEntry = {
      matcher: '*',
      hooks: [{ type: 'command', command: 'echo hi' }],
    };
    expect(entryIsDashOwned(entry)).toBe(false);
  });

  it('considers entries with a mixed bag as Dash-owned (leaves conservative trail)', () => {
    // If any hook is tagged, we treat the entry as ours; users shouldn't
    // mix their hooks into a Dash entry, but if they do, cleanup erring on
    // "remove" is safer than leaving a mystery tagged hook behind.
    const entry: HookEntry = {
      matcher: '*',
      hooks: [
        { type: 'command', command: 'user-thing' },
        { type: 'http', url: 'x', __dash: true },
      ],
    };
    expect(entryIsDashOwned(entry)).toBe(true);
  });
});
