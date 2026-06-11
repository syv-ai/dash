import { describe, it, expect } from 'vitest';
import { isPromptOnlySnapshot } from '../snapshotFilter';

// Real serialized idle prompt captured from a live PTY mirror (zsh with the
// Dash clack prompt): green ◇, dir, gutter bar, bracketed-paste enable.
const IDLE_PROMPT = '[32m◇[0m  [94m/tmp\r\n[90m│[0m  [?2004h';

describe('isPromptOnlySnapshot', () => {
  it('a single idle prompt is prompt-only', () => {
    expect(isPromptOnlySnapshot(IDLE_PROMPT)).toBe(true);
  });

  it('a failure-status prompt (■) is prompt-only', () => {
    expect(isPromptOnlySnapshot('[31m■[0m  [94mdash\r\n[90m│[0m  ')).toBe(true);
  });

  it('stacked idle prompts (old dup artifacts) are prompt-only', () => {
    expect(isPromptOnlySnapshot(`${IDLE_PROMPT.replace('[?2004h', '')}\r\n${IDLE_PROMPT}`)).toBe(
      true,
    );
  });

  it('a prompt with a venv suffix is prompt-only', () => {
    expect(isPromptOnlySnapshot('[32m◇[0m  [94mdash[0m  [36m.venv[0m\r\n[90m│[0m  ')).toBe(true);
  });

  it('command output means real content — not prompt-only', () => {
    expect(
      isPromptOnlySnapshot(
        `${IDLE_PROMPT.replace('[?2004h', '')}ls\r\nREADME.md  package.json\r\n${IDLE_PROMPT}`,
      ),
    ).toBe(false);
  });

  it('typed-but-unsubmitted input on the gutter line is real content', () => {
    expect(isPromptOnlySnapshot('[32m◇[0m  dash\r\n[90m│[0m  git sta')).toBe(false);
  });

  it('empty or whitespace-only snapshots are prompt-only (nothing to replay)', () => {
    expect(isPromptOnlySnapshot('')).toBe(true);
    expect(isPromptOnlySnapshot('  \r\n \r\n')).toBe(true);
  });
});
