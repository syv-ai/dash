import { describe, it, expect } from 'vitest';
import { isPromptOnlySnapshot } from '../snapshotFilter';

// Real serialized idle prompt captured from a live drawer shell: Dash's plain
// two-line prompt — the dim cwd basename, then a bare `$` with bracketed-paste
// enable. `\x1b[2m`…`\x1b[0m` dim, `\x1b[?2004h` bracketed paste.
const LABEL = 'feat-integrate-with-reminders-97b';
const IDLE_PROMPT = `\x1b[2m${LABEL}\x1b[0m\r\n$ \x1b[?2004h`;

describe('isPromptOnlySnapshot', () => {
  it('a single idle two-line prompt is prompt-only', () => {
    expect(isPromptOnlySnapshot(IDLE_PROMPT, LABEL)).toBe(true);
  });

  it('stacked idle prompts (old dup artifacts) are prompt-only', () => {
    expect(isPromptOnlySnapshot(`${LABEL}\r\n$ \r\n${LABEL}\r\n$ `, LABEL)).toBe(true);
  });

  it('a zsh `%` sigil prompt is prompt-only', () => {
    expect(isPromptOnlySnapshot(`${LABEL}\r\n% `, LABEL)).toBe(true);
  });

  it('command output means real content — not prompt-only', () => {
    expect(
      isPromptOnlySnapshot(`${LABEL}\r\n$ ls\r\nREADME.md  package.json\r\n${LABEL}\r\n$ `, LABEL),
    ).toBe(false);
  });

  it('typed-but-unsubmitted input on the prompt line is real content', () => {
    expect(isPromptOnlySnapshot(`${LABEL}\r\n$ git sta`, LABEL)).toBe(false);
  });

  it('without a label, the folder line reads as real content', () => {
    // Defensive: the caller always passes the cwd basename, but a bare prompt
    // with no label should not be silently treated as content-free.
    expect(isPromptOnlySnapshot(IDLE_PROMPT)).toBe(false);
  });

  it('empty or whitespace-only snapshots are prompt-only (nothing to replay)', () => {
    expect(isPromptOnlySnapshot('')).toBe(true);
    expect(isPromptOnlySnapshot('  \r\n \r\n')).toBe(true);
  });
});
