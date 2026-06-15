import { describe, it, expect } from 'vitest';
import { pickLatestSessionId } from '../claudeCli';

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
