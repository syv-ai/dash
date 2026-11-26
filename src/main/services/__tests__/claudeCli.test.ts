import { describe, it, expect } from 'vitest';
import {
  pickLatestSessionId,
  parseClaudeVersion,
  compareClaudeVersions,
  versionMeetsMinimum,
  describeUnsupportedClaude,
  devClaudeBinOverride,
  MIN_CLAUDE_VERSION,
} from '../claudeCli';

describe('pickLatestSessionId', () => {
  it('returns null when there are no files', () => {
    expect(pickLatestSessionId([])).toBeNull();
  });

  it('ignores non-.jsonl entries', () => {
    expect(
      pickLatestSessionId([
        { name: 'notes.md', mtimeMs: 100 },
        { name: 'config.json', mtimeMs: 200 },
      ]),
    ).toBeNull();
  });

  it('picks the newest-mtime session and strips the .jsonl suffix', () => {
    expect(
      pickLatestSessionId([
        { name: 'aaaa-old.jsonl', mtimeMs: 100 },
        { name: 'bbbb-new.jsonl', mtimeMs: 300 },
        { name: 'cccc-mid.jsonl', mtimeMs: 200 },
      ]),
    ).toBe('bbbb-new');
  });

  it('selects the newest .jsonl even when a non-jsonl file is newer', () => {
    // Mirrors the SessionWatcher selection: only .jsonl files are candidates,
    // so a newer settings/snapshot file in the dir must never win.
    expect(
      pickLatestSessionId([
        { name: 'session.jsonl', mtimeMs: 100 },
        { name: 'settings.local.json', mtimeMs: 999 },
      ]),
    ).toBe('session');
  });
});

describe('Claude Code version floor', () => {
  it('parses the leading M.m.p of `claude --version` output', () => {
    expect(parseClaudeVersion('2.1.278 (Claude Code)')).toEqual([2, 1, 278]);
    expect(parseClaudeVersion('10.0.1')).toEqual([10, 0, 1]);
    expect(parseClaudeVersion('v2.1.278')).toBeNull();
    expect(parseClaudeVersion('')).toBeNull();
    expect(parseClaudeVersion(null)).toBeNull();
  });

  it('orders versions numerically, not lexically', () => {
    expect(compareClaudeVersions([2, 1, 9], [2, 1, 10])).toBe(-1);
    expect(compareClaudeVersions([2, 2, 0], [2, 1, 999])).toBe(1);
    expect(compareClaudeVersions([3, 0, 0], [2, 9, 9])).toBe(1);
    expect(compareClaudeVersions([2, 1, 257], [2, 1, 257])).toBe(0);
  });

  it('accepts the floor itself and anything newer, rejects older or unknown', () => {
    expect(versionMeetsMinimum(MIN_CLAUDE_VERSION)).toBe(true);
    expect(versionMeetsMinimum('2.1.278 (Claude Code)')).toBe(true);
    expect(versionMeetsMinimum('3.0.0')).toBe(true);
    expect(versionMeetsMinimum('2.1.256')).toBe(false);
    expect(versionMeetsMinimum('2.0.999')).toBe(false);
    expect(versionMeetsMinimum('unknown')).toBe(false);
    expect(versionMeetsMinimum(null)).toBe(false);
    expect(versionMeetsMinimum('2.1.5', '2.1.4')).toBe(true);
  });

  it('describes why an install is unsupported, or null when it is fine', () => {
    expect(describeUnsupportedClaude({ installed: false, version: null })).toMatch(/not found/);
    expect(describeUnsupportedClaude({ installed: true, version: '2.1.100 (Claude Code)' })).toBe(
      `Claude Code ${MIN_CLAUDE_VERSION} or newer is required (found 2.1.100). Run: claude update`,
    );
    expect(
      describeUnsupportedClaude({ installed: true, version: '2.1.278 (Claude Code)' }),
    ).toBeNull();
  });
});

describe('devClaudeBinOverride', () => {
  it('names DASH_CLAUDE_BIN on a dev run only', () => {
    const env = { DASH_CLAUDE_BIN: '/tmp/claude-wrapper' };
    expect(devClaudeBinOverride(['electron', 'entry.js', '--dev'], env)).toBe(
      '/tmp/claude-wrapper',
    );
    expect(devClaudeBinOverride(['Dash'], env)).toBeNull();
    expect(devClaudeBinOverride(['electron', '--dev'], {})).toBeNull();
  });
});
