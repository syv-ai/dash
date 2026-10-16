import { describe, it, expect } from 'vitest';
import { AttachScreen } from '../composerDraft';

const COLS = 60;
const RULE = '─'.repeat(COLS);
const NAMED_RULE = `${'─'.repeat(COLS - 9)} task-1 ─`;
const DIM = (s: string) => `\x1b[2m${s}\x1b[22m`;
const GREY = (s: string) => `\x1b[38;2;153;153;153m${s}\x1b[39m`;

/** A screen shaped like `claude attach`'s: transcript, the input box between
 *  two rules, and a status line under it. */
function screen(composer: string[], transcript: string[] = []): AttachScreen {
  const term = new AttachScreen(COLS, 20);
  const lines = [...transcript, NAMED_RULE, ...composer, RULE, GREY('  ⏵⏵ auto mode on')];
  term.write(lines.join('\r\n'));
  return term;
}

const composerHasDraft = (term: AttachScreen) => term.hasDraft();

describe('AttachScreen.hasDraft', () => {
  it('is false for an empty input box', async () => {
    expect(await composerHasDraft(screen(['❯ ']))).toBe(false);
  });

  it('is true for text the user typed', async () => {
    expect(await composerHasDraft(screen(['❯ my unsent draft']))).toBe(true);
  });

  it('is true for a draft on a continuation row (wrapped or multi-line)', async () => {
    expect(await composerHasDraft(screen(['❯ line a', '  line b']))).toBe(true);
    expect(await composerHasDraft(screen(['❯ ', '  b']))).toBe(true);
  });

  it('is true for a collapsed paste', async () => {
    expect(await composerHasDraft(screen(['❯ [Pasted text #1 +11 lines]']))).toBe(true);
  });

  it('ignores the dim placeholder hint', async () => {
    expect(
      await composerHasDraft(screen([`${GREY('❯')} ${DIM('Press up to edit queued messages')}`])),
    ).toBe(false);
  });

  it('ignores earlier prompts in the transcript above the box', async () => {
    const transcript = ['❯ write a poem', '', '⏺ Here it is', ''];
    expect(await composerHasDraft(screen(['❯ '], transcript))).toBe(false);
  });

  it('is false when no input box is on screen (a dialog, the trust prompt)', async () => {
    const term = new AttachScreen(COLS, 20);
    term.write('Do you trust the files in this folder?\r\n❯ 1. Yes, proceed');
    expect(await composerHasDraft(term)).toBe(false);
  });

  it('answers false, without hanging, once disposed mid-parse', async () => {
    const term = screen(['❯ draft']);
    const answer = term.hasDraft();
    term.dispose();
    expect(await answer).toBe(false);
  });
});
